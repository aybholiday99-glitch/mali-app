import type { AuthUser, MaliState, SupabaseConfig } from '../types/mali';
import type { PullResult, SyncResult } from './supabaseSyncCore';

/**
 * Online-only financial session. This unit deliberately has no AsyncStorage,
 * IndexedDB, SecureStore or filesystem dependency. Cash data lives only in
 * process memory while the screen is open; the server is the sole durable copy.
 *
 * This is a migration building block, NOT a toggle that can safely replace
 * the existing offline provider before legacy device data is reconciled.
 */
export interface CentralVaultGateway {
  pull(config: SupabaseConfig, user: AuthUser): Promise<PullResult>;
  push(candidate: MaliState, config: SupabaseConfig, user: AuthUser): Promise<SyncResult>;
}
export type CentralVaultResult =
  | { ok: true; state: MaliState }
  | { ok: false; reason: 'session' | 'unavailable' | 'conflict' | 'invalid'; message: string };

const failure = (reason: 'session' | 'unavailable' | 'conflict' | 'invalid', message: string): CentralVaultResult =>
  ({ ok: false, reason, message });
const authenticated = (u: AuthUser | null): u is AuthUser =>
  Boolean(u && u.id && !u.isLocalOnly && u.id !== 'local-offline-guest');

export function createCentralVaultSession(
  gateway: CentralVaultGateway,
  emptyVault: (user: AuthUser) => MaliState,
) {
  let generation = 0;
  let owner: AuthUser | null = null;
  let current: MaliState | null = null;
  let blocked = false;
  let inFlight: Promise<unknown> = Promise.resolve();

  function snapshot(): MaliState | null {
    return current ? structuredClone(current) : null;
  }
  function clear() {
    generation += 1;
    owner = null;
    current = null;
    blocked = false;
  }
  async function open(user: AuthUser, config: SupabaseConfig): Promise<CentralVaultResult> {
    clear();
    if (!authenticated(user)) return failure('session', 'يلزم تسجيل الدخول بحساب معتمد. الدخول المحلي غير متاح.');
    const token = generation;
    owner = user;
    try {
      const pulled = await gateway.pull(config, user);
      if (generation !== token || owner?.id !== user.id) return failure('session', 'تغيرت جلسة المستخدم.');
      // Empty remote vault is safe only after authenticated owner verification.
      if (pulled.isEmpty && pulled.identityVerified === true) {
        current = emptyVault(user);
        current.supabaseConfig = { ...config, lastSyncedAt: undefined };
        return { ok: true, state: structuredClone(current) };
      }
      if (!pulled.ok || !pulled.state || pulled.identityVerified !== true) {
        blocked = true;
        return failure('unavailable', 'تعذر تحميل الخزنة المعتمدة من الخادم. العمليات المالية متوقفة.');
      }
      current = { ...emptyVault(user), ...pulled.state,
        supabaseConfig: { ...config, lastSyncedAt: pulled.snapshotUpdatedAt === null
          ? undefined : (pulled.snapshotUpdatedAt || pulled.updatedAt) },
        pendingCloudSync: false };
      return { ok: true, state: structuredClone(current) };
    } catch {
      if (generation === token) blocked = true;
      return failure('unavailable', 'تعذر الاتصال بالخادم. لا توجد نسخة مالية محلية قابلة للاستخدام.');
    }
  }
  async function update(mutate: (before: MaliState) => MaliState): Promise<CentralVaultResult> {
    const requestedGeneration = generation;
    const operation = inFlight.then(async (): Promise<CentralVaultResult> => {
      const user = owner;
      if (generation !== requestedGeneration || !authenticated(user)) return failure('session', 'جلسة غير صالحة.');
      if (blocked || !current) return failure('unavailable', 'الخزنة غير جاهزة. يلزم اتصال آمن بالخادم.');
      const before = current;
      let candidate: MaliState;
      try {
        candidate = mutate(structuredClone(before));
        if (!candidate || JSON.stringify(candidate) === JSON.stringify(before)) return failure('invalid', 'لا توجد عملية مالية صالحة.');
        if (candidate.supabaseConfig.url !== before.supabaseConfig.url ||
            candidate.supabaseConfig.anonKey !== before.supabaseConfig.anonKey)
          return failure('invalid', 'لا يمكن تغيير خادم البيانات ضمن عملية مالية.');
        candidate.supabaseConfig.lastSyncedAt = before.supabaseConfig.lastSyncedAt;
        candidate.pendingCloudSync = false;
      } catch { return failure('invalid', 'تعذر التحقق من العملية المالية.'); }
      let result: SyncResult;
      try { result = await gateway.push(candidate, candidate.supabaseConfig, user); }
      catch { return failure('unavailable', 'فشل الوصول للخادم، لم تُعتمد العملية.'); }
      if (generation !== requestedGeneration || owner?.id !== user.id)
        return failure('session', 'تغير الحساب أثناء العملية. تحقق من السجل على الخادم.');
      if (!result.ok || !result.success || !result.updatedAt) {
        if (result.conflictDetected) {
          blocked = true; current = null;
          return failure('conflict', 'تغيرت بيانات الحساب على الخادم. أعد تحميلها قبل إجراء أي تعديل.');
        }
        // An indeterminate server timeout may have committed the write.
        // Invalidate memory and force a new authoritative pull before retry.
        blocked = true; current = null;
        return failure('unavailable', 'لم تتأكد استجابة الخادم. أعد تحميل الخزنة قبل المحاولة مجدداً.');
      }
      current = { ...candidate, pendingCloudSync: false,
        supabaseConfig: { ...candidate.supabaseConfig, lastSyncedAt: result.snapshotUpdatedAt === null
          ? undefined : (result.snapshotUpdatedAt || result.updatedAt) } };
      return { ok: true, state: structuredClone(current) };
    });
    inFlight = operation.then(() => {}, () => {});
    return operation;
  }
  return { open, update, snapshot, clear };
}
