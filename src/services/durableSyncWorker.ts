import type { SyncResult } from './supabaseSyncCore';

export interface SyncScheduler {
  now(): number;
  random(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}
const scheduler: SyncScheduler = {
  now: () => Date.now(), random: () => Math.random(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export type SyncStopReason = 'conflict' | 'session' | 'configuration' | 'permanent';
export interface SyncOutbox<T> {
  version: 1;
  ownerId: string;
  configId: string;
  pending: { revision: number; payload: T } | null;
  attempts: number;
  nextAttemptAt: number;
  syncedAt?: string;
  acknowledgedRevision?: number;
  stop?: { reason: SyncStopReason; result: SyncResult; attempted?: { revision: number; payload: T } };
}
export interface CloudSyncStatus<T> {
  phase: 'idle' | 'pending' | 'uploading' | 'retrying' | 'paused' | 'blocked' | 'storage-error';
  outbox: SyncOutbox<T> | null;
}
interface Dependencies<T> {
  ownerId: string;
  initial?: SyncOutbox<T>;
  scheduler?: SyncScheduler;
  persist(record: SyncOutbox<T>): Promise<void>;
  send(payload: T, signal: AbortSignal): Promise<SyncResult>;
  withBaseline(payload: T, timestamp?: string): T;
  onStatus(status: CloudSyncStatus<T>): void;
  onResult?(result: SyncResult): void;
}
const failed = (message: string): SyncResult => ({ ok: false, success: false, message });
export function retryDelay(attempt: number, random: number) {
  const ceiling = Math.min(120_000, 2_000 * 2 ** Math.min(16, Math.max(0, attempt - 1)));
  return Math.round(ceiling * (0.5 + Math.min(1, Math.max(0, random)) * 0.5));
}

/** One active worker per authenticated owner/session. Durable state precedes I/O. */
export function createDurableSyncWorker<T>(deps: Dependencies<T>) {
  const clock = deps.scheduler || scheduler;
  let record = deps.initial || null, active = false, disposed = false, storageError = false;
  let configEpoch = 0, desiredConfigId = record?.configId;
  let timer: unknown, request: AbortController | null = null, running: Promise<SyncResult> | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  const status = () => deps.onStatus({ outbox: record, phase: storageError ? 'storage-error' : record?.stop ? 'blocked'
    : request ? 'uploading' : !record?.pending ? 'idle' : !active ? 'paused' : record.attempts ? 'retrying' : 'pending' });
  function serialize<R>(operation: () => Promise<R>): Promise<R> {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }
  async function save(next: SyncOutbox<T>) {
    if (disposed) throw failed('تغيرت جلسة المستخدم.');
    try { await deps.persist(next); } catch {
      record = next; storageError = true; status(); throw failed('تعذر حفظ قائمة الرفع على هذا الجهاز.');
    }
    if (disposed) throw failed('تغيرت جلسة المستخدم.');
    record = next; storageError = false; status();
  }
  function unschedule() { if (timer !== undefined) clock.clearTimeout(timer); timer = undefined; }
  function schedule() {
    unschedule();
    if (disposed || !active || storageError || request || record?.stop || !record?.pending) return;
    timer = clock.setTimeout(() => { timer = undefined; void flush(false).catch(() => {}); }, Math.max(0, record.nextAttemptAt - clock.now()));
  }
  async function enqueue(payload: T, revision: number, configId: string, baseline?: string) {
    if (desiredConfigId && desiredConfigId !== configId) { configEpoch++; request?.abort(); }
    desiredConfigId = configId;
    await serialize(async () => {
      if (disposed) return;
      if (!Number.isSafeInteger(revision) || revision < 0) throw failed('رقم النسخة المحلية غير صالح.');
      if (record?.pending && revision < record.pending.revision) return;
      const sameConfig = !record || configId === record.configId;
      const syncedAt = sameConfig ? record?.syncedAt || baseline : baseline;
      await save({ version: 1, ownerId: deps.ownerId, configId: record?.configId || configId,
        pending: { revision, payload: deps.withBaseline(payload, syncedAt) }, syncedAt,
        attempts: record?.attempts || 0, nextAttemptAt: record?.nextAttemptAt || clock.now(), acknowledgedRevision: record?.acknowledgedRevision,
        stop: record?.stop || (!sameConfig ? { reason: 'configuration', result: failed('تغير مشروع المزامنة. تم إيقاف الرفع للحفاظ على النسختين.') } : undefined) });
    });
    schedule();
  }
  async function execute(): Promise<SyncResult> {
    const epoch = configEpoch;
    let captured: { revision: number; payload: T } | null = null;
    let configId = '';
    await serialize(async () => {
      if (storageError && record && !disposed) await save(record);
      if (disposed || record?.stop || !record?.pending) return;
      captured = record.pending; configId = record.configId;
      const attempts = Math.min(32, record.attempts + 1);
      // A crash during the request resumes with this already persisted delay.
      await save({ ...record, attempts, nextAttemptAt: clock.now() + retryDelay(attempts, clock.random()) });
    });
    if (!captured || disposed || record?.stop || epoch !== configEpoch) return record?.stop?.result || (record?.syncedAt && !disposed
      ? { ok: true, success: true, updatedAt: record.syncedAt, message: 'تم تأكيد الحفظ المحلي لإقرار الرفع.' } : failed('لا توجد نسخة معلقة للرفع.'));
    const sent = captured as { revision: number; payload: T };
    const controller = new AbortController(); request = controller; status();
    let timeout: unknown;
    let onAbort: () => void = () => {};
    let result: SyncResult;
    try {
      result = await Promise.race([
        deps.send(sent.payload, controller.signal),
        new Promise<SyncResult>(resolve => {
          onAbort = () => resolve({ ...failed('تم إلغاء طلب الرفع.'), failureKind: 'transient' });
          controller.signal.addEventListener('abort', onAbort, { once: true });
        }),
        new Promise<SyncResult>(resolve => { timeout = clock.setTimeout(() => {
          resolve({ ...failed('انتهت مهلة الرفع. تم الاحتفاظ بالنسخة المحلية.'), failureKind: 'transient' }); controller.abort();
        }, 30_000); }),
      ]);
    } catch { result = { ...failed('تعذر الاتصال بالسحابة. تم الاحتفاظ بالنسخة المحلية.'), failureKind: 'transient' }; }
    finally { if (timeout !== undefined) clock.clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort); request = null; }
    if (result.ok && !result.updatedAt) result = { ...failed('استجابة الرفع لا تحتوي على تاريخ حفظ موثق.'), failureKind: 'permanent' };
    if (disposed) return failed('تغيرت جلسة المستخدم.');
    await serialize(async () => {
      if (!record || record.configId !== configId || disposed) return;
      // A stop created by a configuration change must survive a late response.
      if (record.stop) return;
      if (result.ok && result.updatedAt) {
        const pending = record.pending && record.pending.revision !== sent.revision
          ? { ...record.pending, payload: deps.withBaseline(record.pending.payload, result.updatedAt) } : null;
        await save({ ...record, pending, syncedAt: result.updatedAt, acknowledgedRevision: sent.revision, attempts: 0, nextAttemptAt: clock.now() });
      } else {
        const reason = result.conflictDetected ? 'conflict' : result.failureKind === 'session' ? 'session'
          : result.failureKind === 'configuration' ? 'configuration'
          : result.failureKind && result.failureKind !== 'transient' ? 'permanent' : undefined;
        await save({ ...record, nextAttemptAt: clock.now() + retryDelay(record.attempts, clock.random()), stop: reason ? { reason, result, attempted: sent } : undefined });
      }
    });
    if (!disposed) { deps.onResult?.(result); status(); }
    return result;
  }
  function flush(force = true): Promise<SyncResult> {
    if (disposed) return Promise.resolve(failed('تغيرت جلسة المستخدم.'));
    if (running) return running;
    if (record?.stop) return Promise.resolve(record.stop.result);
    if (!force && (!active || !record?.pending || record.nextAttemptAt > clock.now())) { schedule(); return Promise.resolve(failed('الرفع مؤجل.')); }
    unschedule();
    running = execute().catch(error => error?.message ? failed(error.message) : failed('تعذر حفظ الرفع محلياً.'))
      .finally(() => { running = null; schedule(); });
    return running;
  }
  return {
    enqueue, flush,
    getRecord: () => record,
    observeCloudBaseline: (timestamp?: string, empty = false) => serialize(async () => {
      if (!record || record.stop || (record.pending && !empty)) return;
      await save({ ...record, syncedAt: timestamp, pending: record.pending ? { ...record.pending, payload: deps.withBaseline(record.pending.payload, timestamp) } : null });
    }),
    resumeAfterRepair: (configId: string) => serialize(async () => {
      if (record?.configId === configId && ['configuration', 'permanent'].includes(record.stop?.reason || '')) {
        await save({ ...record, stop: undefined, attempts: 0, nextAttemptAt: clock.now() });
      }
    }),
    // Caller must first verify current server ownership/CAS and durably retain
    // both versions. Object identity fences edits during that asynchronous work.
    resolveConflict: (expected: SyncOutbox<T>, payload: T, revision: number, configId: string, verifiedTimestamp: string, pending: boolean) => serialize(async () => {
      if (disposed || record !== expected || record.ownerId !== deps.ownerId || record.configId !== configId || record.stop?.reason !== 'conflict'
        || !Number.isSafeInteger(revision) || revision < (record.pending?.revision || 0) || !Number.isFinite(Date.parse(verifiedTimestamp))) throw failed('تغيرت النسخة أثناء مراجعة التعارض. أعد مراجعة النسختين.');
      await save({ ...record, pending: pending ? { revision, payload: deps.withBaseline(payload, verifiedTimestamp) } : null,
        syncedAt: verifiedTimestamp, acknowledgedRevision: pending ? record.acknowledgedRevision : revision, stop: undefined, attempts: 0, nextAttemptAt: clock.now() });
      schedule();
    }),
    changeConfiguration: (configId: string) => {
      if (desiredConfigId !== configId) { configEpoch++; request?.abort(); }
      desiredConfigId = configId;
      return serialize(async () => {
      if (!record || record.configId === configId) return;
      await save(record.pending || record.stop ? { ...record, stop: record.stop || { reason: 'configuration', result: failed('تغير مشروع المزامنة. تم إيقاف الرفع للحفاظ على النسختين.') } }
        : { ...record, configId, syncedAt: undefined });
      unschedule();
      });
    },
    setActive: (value: boolean) => { active = value; status(); schedule(); },
    wake: () => { if (active && !record?.stop) void flush().catch(() => {}); },
    // Only the provider calls this after fresh verified authentication.
    resumeVerifiedSession: () => serialize(async () => {
      if (record?.stop?.reason === 'session') await save({ ...record, stop: undefined, nextAttemptAt: clock.now() });
      schedule();
    }),
    dispose: () => { disposed = true; active = false; unschedule(); request?.abort(); },
  };
}
