import { createChunkedFinancialStorage } from './chunkedFinancialStorage.ts';
import { validateAndSanitizeBackupPayload } from './financialEngine.ts';
import { validateFinancialAudit } from './financialAudit.ts';
import { sameFinancialState } from './conflictResolutionCore.ts';
import { isAbsoluteTimestamp } from '../utils/absoluteTimestamp.ts';
import type { MaliState } from '../types/mali';

const COLLECTIONS = ['accounts', 'contacts', 'transactions', 'deals', 'debts', 'procedures', 'budgets', 'marketRates'] as const;
const LIMIT = 96 * 1024 * 1024;
export const RECOVERY_ARCHIVE_PAGE_SIZE = 5;
export interface RecoveryReadStorage {
  getItem(key: string): Promise<string | null>;
  getAllKeys(): Promise<readonly string[]>;
}
export interface RecoveryArchiveSummary { id: string; createdAt: string }
export interface RecoveryVersion { id: string; label: string; readable: boolean }
export interface RecoveryArchive extends RecoveryArchiveSummary {
  source: 'backup' | 'conflict';
  versions: RecoveryVersion[];
}
type Backup = Pick<MaliState, typeof COLLECTIONS[number] | 'financialAudit' | 'lastModifiedAt'>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new Error('تعذر قراءة الأرشيف بأمان. بقيت النسخة المحفوظة دون تغيير.');
const noWrite = async () => { throw new Error('Recovery archive access is read-only.'); };
function parse(raw: string) {
  if (typeof raw !== 'string' || raw.length > LIMIT) throw invalid();
  return JSON.parse(raw) as unknown;
}

/** Only owned physical keys are read. Every underlying await has a session fence. */
export function createRecoveryArchiveReader(storage: RecoveryReadStorage, ownerId: string, canContinue: () => boolean) {
  // These are the two identities the authentication service can persist. Restricting
  // names also prevents an owner string from impersonating an archive suffix.
  if (ownerId !== 'local-offline-guest' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) throw invalid();
  const originalKey = '@mali_app_state_v2_' + ownerId;
  const physicalPrefix = '@mali_financial_chunks_v1:' + encodeURIComponent(originalKey) + ':';
  const archivePrefix = originalKey + '_recovery_';
  const check = () => { if (!canContinue()) throw new Error('تم إلغاء قراءة الأرشيف لتغير الجلسة.'); };
  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    check(); const result = await operation(); check(); return result;
  }
  function archiveId(id: string) {
    if (typeof id !== 'string' || !id.startsWith(archivePrefix)) throw invalid();
    const suffix = /^(\d{1,16})_([1-9]\d{0,15})$/.exec(id.slice(archivePrefix.length));
    if (!suffix || !Number.isSafeInteger(Number(suffix[1])) || !Number.isSafeInteger(Number(suffix[2]))) throw invalid();
    const createdAt = new Date(Number(suffix[1])).toISOString();
    return { id, createdAt, time: Number(suffix[1]), sequence: Number(suffix[2]) };
  }
  function backup(value: unknown): Backup {
    if (!object(value) || (value.ownerId !== undefined && value.ownerId !== ownerId)) throw invalid();
    const result: Record<string, unknown> = {};
    for (const key of COLLECTIONS) {
      if (key === 'marketRates' ? !object(value[key]) : !Array.isArray(value[key])) throw invalid();
      result[key] = value[key];
    }
    if (value.lastModifiedAt !== undefined) {
      if (!isAbsoluteTimestamp(value.lastModifiedAt)) throw invalid();
      result.lastModifiedAt = value.lastModifiedAt;
    }
    const financial = result as unknown as MaliState;
    const checked = validateAndSanitizeBackupPayload(JSON.stringify(result), financial);
    // Validate, but export exact original rows/children rather than sanitized projections.
    if (!checked.valid || !checked.state || !sameFinancialState(financial, checked.state)) throw invalid();
    if (value.financialAudit !== undefined) {
      validateFinancialAudit(value.financialAudit, financial, ownerId);
      result.financialAudit = value.financialAudit;
    }
    return result as unknown as Backup;
  }
  async function read(id: string) {
    check(); const summary = archiveId(id);
    const prefix = '@mali_financial_chunks_v1:' + encodeURIComponent(id) + ':';
    if (await guarded(() => storage.getItem(prefix + 'head')) === null) throw invalid();
    const reader = createChunkedFinancialStorage({
      getItem: key => {
        if (key !== id && !(key.startsWith(prefix) && /^(head|enrolled|[01]:\d+)$/.test(key.slice(prefix.length)))) throw invalid();
        return guarded(() => storage.getItem(key));
      }, setItem: noWrite,
    });
    const raw = await guarded(() => reader.getItem(id));
    if (raw === null) throw invalid();
    const envelope = parse(raw);
    if (!object(envelope) || envelope.version !== 1 || envelope.originalKey !== originalKey || !isAbsoluteTimestamp(envelope.capturedAt)
      || !Array.isArray(envelope.originals) || typeof envelope.incoming !== 'string'
      || (envelope.sourceEvidence !== undefined && typeof envelope.sourceEvidence !== 'string')) throw invalid();
    const originals = new Map<string, string>();
    for (const row of envelope.originals) {
      if (!object(row) || typeof row.key !== 'string' || typeof row.value !== 'string' || originals.has(row.key)
        || !(row.key === originalKey || row.key.startsWith(physicalPrefix) && /^(head|enrolled|[01]:\d+)$/.test(row.key.slice(physicalPrefix.length)))) throw invalid();
      originals.set(row.key, row.value);
    }
    const versions: (RecoveryVersion & { backup?: Backup })[] = [];
    const add = (id: string, label: string, value: () => unknown) => {
      try { versions.push({ id, label, readable: true, backup: backup(value()) }); }
      catch { versions.push({ id, label, readable: false }); }
    };
    let old: string | null = null;
    try {
      const virtual = createChunkedFinancialStorage({ getItem: async key => originals.get(key) ?? null, setItem: noWrite });
      old = await guarded(() => virtual.getItem(originalKey));
    } catch { check(); }
    add('previous', 'الخزنة السابقة على هذا الجهاز', () => old === null ? null : parse(old));
    add('incoming', 'النسخة المختارة وقت الحفظ', () => parse(envelope.incoming as string));
    let source: RecoveryArchive['source'] = 'backup';
    if (envelope.sourceEvidence !== undefined) {
      let evidence: unknown;
      try { evidence = parse(envelope.sourceEvidence as string); } catch { /* Shown as unreadable below. */ }
      if (object(evidence) && ('choice' in evidence || 'latestLocal' in evidence)) {
        source = 'conflict';
        if (evidence.version !== 1 || evidence.ownerId !== ownerId || !['keep-local', 'adopt-cloud'].includes(String(evidence.choice))) throw invalid();
        const captured = evidence;
        add('attempted', 'المحلية عند محاولة الرفع', () => object(captured.attempted) ? captured.attempted.state : null);
        if (captured.pending !== null) add('pending', 'المحلية المعلقة وقت القرار', () => object(captured.pending) ? captured.pending.state : null);
        add('latest-local', 'أحدث محلية قبل القرار', () => captured.latestLocal);
        add('original-cloud', 'السحابية عند اكتشاف التعارض', () => captured.originalCloud);
        add('fresh-cloud', 'السحابية بعد التحقق وقت القرار', () => captured.freshCloud);
        add('chosen', 'النسخة المعتمدة في القرار', () => captured.chosen);
      } else add('imported', 'ملف النسخة الاحتياطية الذي تم اختياره', () => evidence);
    }
    check();
    return { archive: { id: summary.id, createdAt: envelope.capturedAt as string, source,
      versions: versions.map(({ id, label, readable }) => ({ id, label, readable })) }, versions };
  }
  return {
    async list(before?: string): Promise<{ rows: RecoveryArchiveSummary[]; nextCursor?: string }> {
      check(); if (before !== undefined) archiveId(before);
      const keys = await guarded(() => storage.getAllKeys());
      const ownPrefix = '@mali_financial_chunks_v1:' + encodeURIComponent(archivePrefix);
      const rows = new Map<string, ReturnType<typeof archiveId>>();
      for (const key of keys) {
        if (!key.startsWith(ownPrefix) || !key.endsWith(':head')) continue;
        try {
          const id = decodeURIComponent(key.slice('@mali_financial_chunks_v1:'.length, -5));
          if (key !== '@mali_financial_chunks_v1:' + encodeURIComponent(id) + ':head') continue;
          const row = archiveId(id); rows.set(id, row);
        } catch { /* Never read malformed or foreign keys. */ }
      }
      const ordered = [...rows.values()].sort((a, b) => b.time - a.time || b.sequence - a.sequence);
      const offset = before === undefined ? 0 : ordered.findIndex(row => row.id === before) + 1;
      if (before !== undefined && offset === 0) throw invalid();
      const page = ordered.slice(offset, offset + RECOVERY_ARCHIVE_PAGE_SIZE);
      check();
      return { rows: page.map(({ id, createdAt }) => ({ id, createdAt })),
        nextCursor: offset + page.length < ordered.length ? page.at(-1)?.id : undefined };
    },
    async inspect(id: string): Promise<RecoveryArchive> { return (await read(id)).archive; },
    async exportVersion(id: string, versionId: string): Promise<string> {
      const result = await read(id);
      const version = result.versions.find(row => row.id === versionId);
      if (!version?.readable || !version.backup) throw invalid();
      check(); return JSON.stringify(version.backup, null, 2);
    },
  };
}
