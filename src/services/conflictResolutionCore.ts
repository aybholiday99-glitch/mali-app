import type { MaliState } from '../types/mali';
import type { SyncOutbox } from './durableSyncWorker';
import { appendFinancialAudit, validateFinancialAudit } from './financialAudit.ts';
import { validateAndSanitizeBackupPayload } from './financialEngine.ts';
import { syncConfigIdentity, validateSyncOutbox } from './syncOutboxValidation.ts';

const COLLECTIONS = ['accounts', 'contacts', 'transactions', 'deals', 'debts', 'procedures', 'budgets', 'marketRates'] as const;
export const MAX_CONFLICT_EVIDENCE_LENGTH = 48 * 1024 * 1024;
export type ConflictChoice = 'keep-local' | 'adopt-cloud';
export interface ConflictReviewToken {
  ownerId: string;
  sessionGeneration: number;
  configId: string;
  localRevision: number;
  /** Preserve PostgreSQL precision and timezone spelling; never normalize this token. */
  cloudTimestamp: string;
}
export interface ConflictResolutionInput {
  choice: ConflictChoice;
  reason: string;
  review: ConflictReviewToken;
  current: Omit<ConflictReviewToken, 'cloudTimestamp'> & { cancelled?: boolean };
  local: MaliState;
  blockedOutbox: SyncOutbox<MaliState>;
  freshCloud: {
    ownerId: string;
    configId: string;
    identityVerified?: true;
    snapshotUpdatedAt: string | null;
    state?: Partial<MaliState>;
    isEmpty?: boolean;
  };
}
type SemanticState = Omit<MaliState, 'supabaseConfig'> & { baseline?: string };
interface SemanticRevision { revision: number; state: SemanticState }
export interface ConflictRecoveryEvidence {
  version: 1;
  ownerId: string;
  connection: { url: string; workspaceKey: string };
  choice: ConflictChoice;
  reason: string;
  sessionGeneration: number;
  reviewedTimestamp: string;
  freshTimestamp: string;
  attempted: SemanticRevision;
  pending: SemanticRevision | null;
  latestLocal: SemanticState;
  originalCloud: SemanticState;
  originalCloudTimestamp: string;
  freshCloud: SemanticState;
  chosen: SemanticState;
  priorOutbox: { attempts: number; nextAttemptAt: number; syncedAt?: string; acknowledgedRevision?: number };
}
export type ConflictResolutionResult =
  | { status: 'prepared'; candidate: Readonly<MaliState>; revision: number;
      blockedRecord: Readonly<SyncOutbox<MaliState>>; readyRecord: Readonly<SyncOutbox<MaliState>>;
      evidence: Readonly<ConflictRecoveryEvidence> }
  | { status: 'changed-cloud'; review: Readonly<ConflictReviewToken>; cloud: Readonly<SemanticState> }
  | { status: 'refused'; code: 'cancelled' | 'stale-review' | 'configuration' | 'ownership' | 'unverified-cloud'
      | 'invalid-state' | 'invalid-conflict' | 'invalid-reason' | 'revision-overflow' | 'audit-reconciliation' | 'evidence-too-large'; message: string };
type RefusalCode = Extract<ConflictResolutionResult, { status: 'refused' }>['code'];
const refuse = (code: RefusalCode): ConflictResolutionResult => ({ status: 'refused', code,
  message: 'تعذر اعتماد الاختيار بأمان. تم الاحتفاظ بالتعارض والنسخ السابقة؛ راجع النسخ ثم حاول مجدداً.' });
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= limit;
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days && hour < 24 && minute < 60 && second < 60
    && (parts[7] === undefined || Number(parts[7]) < 16 && Number(parts[8]) < 60) && Number.isFinite(Date.parse(value));
}

/** Detached JSON copies reject non-JSON values instead of silently losing them. */
function copy<T>(value: T, depth = 0): T {
  if (depth > 64) throw new Error('Invalid JSON.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => copy(item, depth + 1)) as T;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Invalid JSON.');
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) Object.defineProperty(result, key, { value: copy(item, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return result as T;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => [key, canonical((value as Record<string, unknown>)[key])]));
}
function sameFinancial(a: MaliState, b: MaliState) {
  return COLLECTIONS.every(key => JSON.stringify(canonical(a[key])) === JSON.stringify(canonical(b[key])));
}
function validateState(value: unknown, fallback: MaliState, ownerId: string): MaliState {
  const raw = copy(value) as MaliState & { ownerId?: string };
  if (!raw || raw.ownerId !== undefined && raw.ownerId !== ownerId
    || COLLECTIONS.some(key => key === 'marketRates' ? !raw[key] || Array.isArray(raw[key]) || typeof raw[key] !== 'object' : !Array.isArray(raw[key]))) throw new Error('Invalid state.');
  // Validate business invariants through the engine, then the complete journal
  // against the original rows below. Its sanitizer projects known rate fields;
  // replaying there would reject a legitimate journal with additional rate data.
  const checked = validateAndSanitizeBackupPayload(JSON.stringify({ ...raw, financialAudit: undefined }), fallback);
  if (!checked.valid) throw new Error('Invalid state.');
  // The engine validates then sanitizes. Retain full originals, including extra
  // row/child/rate keys, and verify their journal against those exact originals.
  validateFinancialAudit(raw.financialAudit ?? [], raw, ownerId);
  return raw;
}
function semantic(state: MaliState): SemanticState {
  const result: SemanticState = { accounts: copy(state.accounts), contacts: copy(state.contacts), transactions: copy(state.transactions),
    deals: copy(state.deals), debts: copy(state.debts), procedures: copy(state.procedures), budgets: copy(state.budgets), marketRates: copy(state.marketRates) };
  if (state.financialAudit !== undefined) result.financialAudit = copy(state.financialAudit);
  if (state.lastModifiedAt !== undefined) result.lastModifiedAt = state.lastModifiedAt;
  if (state.localRevision !== undefined) result.localRevision = state.localRevision;
  if (state.pendingCloudSync !== undefined) result.pendingCloudSync = state.pendingCloudSync;
  if (state.supabaseConfig?.lastSyncedAt !== undefined) result.baseline = state.supabaseConfig.lastSyncedAt;
  return result;
}

/**
 * No I/O or authorization side effects. The provider owns the resolution lock,
 * fresh server pull, currentness checks around every await, and verified archive
 * before committing candidate+blockedRecord. Only then may it commit readyRecord.
 * A prepared result is permission to stage a choice, never proof of persistence
 * or cloud acceptance. Keep-local still uses normal server CAS and can conflict.
 */
export function prepareConflictResolution(input: ConflictResolutionInput): ConflictResolutionResult {
  try {
    const { review, current, freshCloud } = input;
    if (current.cancelled) return refuse('cancelled');
    if (!text(current.ownerId, 256) || current.ownerId !== review.ownerId || freshCloud.ownerId !== current.ownerId) return refuse('ownership');
    if (!revision(current.sessionGeneration) || current.sessionGeneration !== review.sessionGeneration
      || !revision(current.localRevision) || current.localRevision !== review.localRevision || input.local.localRevision !== current.localRevision) return refuse('stale-review');
    if (!text(current.configId, 8192) || current.configId !== review.configId || current.configId !== freshCloud.configId
      || current.configId !== syncConfigIdentity(input.local.supabaseConfig)) return refuse('configuration');
    if (freshCloud.identityVerified !== true || freshCloud.isEmpty || !freshCloud.state
      || !timestamp(freshCloud.snapshotUpdatedAt) || !timestamp(review.cloudTimestamp)) return refuse('unverified-cloud');
    if (!['keep-local', 'adopt-cloud'].includes(input.choice) || !text(input.reason, 2048)) return refuse('invalid-reason');
    const local = validateState(input.local, input.local, current.ownerId);
    const cloud = validateState(freshCloud.state, local, current.ownerId);
    const outbox = copy(input.blockedOutbox);
    if (!outbox || outbox.ownerId !== current.ownerId || outbox.configId !== current.configId
      || outbox.stop?.reason !== 'conflict' || !outbox.stop.attempted || !timestamp(outbox.stop.result.updatedAt)) return refuse('invalid-conflict');
    try {
      validateSyncOutbox(outbox, current.ownerId, raw => { validateState(JSON.parse(raw), local, current.ownerId); return true; });
    } catch { return refuse('invalid-conflict'); }
    const attempted = validateState(outbox.stop.attempted.payload, local, current.ownerId);
    const pending = outbox.pending ? validateState(outbox.pending.payload, local, current.ownerId) : null;
    const originalCloud = validateState(outbox.stop.result.cloudState, local, current.ownerId);
    if (syncConfigIdentity(attempted.supabaseConfig) !== current.configId
      || pending && syncConfigIdentity(pending.supabaseConfig) !== current.configId) return refuse('configuration');
    if (current.localRevision < Math.max(outbox.pending?.revision ?? 0, outbox.stop.attempted.revision)) return refuse('stale-review');
    if (freshCloud.snapshotUpdatedAt !== review.cloudTimestamp) return freeze({ status: 'changed-cloud',
      review: { ...review, cloudTimestamp: freshCloud.snapshotUpdatedAt }, cloud: semantic(cloud) });
    const maximum = Math.max(current.localRevision, outbox.pending?.revision ?? 0, outbox.stop.attempted.revision, outbox.acknowledgedRevision ?? 0);
    if (!revision(maximum + 1)) return refuse('revision-overflow');
    const nextRevision = maximum + 1;
    let candidate = { ...local };
    const selected = input.choice === 'keep-local' ? local : cloud;
    for (const key of COLLECTIONS) Object.defineProperty(candidate, key, { value: copy(selected[key]), enumerable: true, writable: true, configurable: true });
    if (cloud.financialAudit === undefined) delete candidate.financialAudit;
    else candidate.financialAudit = copy(cloud.financialAudit);
    if (input.choice === 'keep-local') {
      try {
        candidate = appendFinancialAudit(cloud, candidate, { ownerId: current.ownerId,
          action: 'conflict_resolution_keep_local', reason: input.reason.trim() });
        if (!sameFinancial(candidate, local)) return refuse('audit-reconciliation');
      } catch { return refuse('audit-reconciliation'); }
    }
    candidate = { ...candidate, localRevision: nextRevision, pendingCloudSync: input.choice === 'keep-local',
      lastModifiedAt: input.choice === 'keep-local' ? new Date().toISOString() : cloud.lastModifiedAt,
      supabaseConfig: { ...local.supabaseConfig, lastSyncedAt: freshCloud.snapshotUpdatedAt } };
    validateState(candidate, local, current.ownerId);
    const priorPrefix = cloud.financialAudit ?? [];
    if (JSON.stringify(canonical(candidate.financialAudit?.slice(0, priorPrefix.length) ?? [])) !== JSON.stringify(canonical(priorPrefix))) return refuse('audit-reconciliation');
    const blockedRecord: SyncOutbox<MaliState> = { ...outbox, syncedAt: freshCloud.snapshotUpdatedAt,
      pending: { revision: nextRevision, payload: copy(candidate) } };
    const readyRecord: SyncOutbox<MaliState> = { ...blockedRecord, attempts: 0, nextAttemptAt: Date.now(),
      pending: input.choice === 'keep-local' ? { revision: nextRevision, payload: copy(candidate) } : null,
      ...(input.choice === 'adopt-cloud' ? { acknowledgedRevision: nextRevision } : {}) };
    delete readyRecord.stop;
    const evidence: ConflictRecoveryEvidence = { version: 1, ownerId: current.ownerId,
      connection: { url: new URL(local.supabaseConfig.url).origin, workspaceKey: local.supabaseConfig.workspaceKey },
      choice: input.choice, reason: input.reason.trim(), sessionGeneration: current.sessionGeneration,
      reviewedTimestamp: review.cloudTimestamp, freshTimestamp: freshCloud.snapshotUpdatedAt,
      attempted: { revision: outbox.stop.attempted.revision, state: semantic(attempted) },
      pending: pending && outbox.pending ? { revision: outbox.pending.revision, state: semantic(pending) } : null,
      latestLocal: semantic(local), originalCloud: semantic(originalCloud), originalCloudTimestamp: outbox.stop.result.updatedAt,
      freshCloud: semantic(cloud), chosen: semantic(candidate),
      priorOutbox: { attempts: outbox.attempts, nextAttemptAt: outbox.nextAttemptAt, syncedAt: outbox.syncedAt, acknowledgedRevision: outbox.acknowledgedRevision } };
    if (JSON.stringify(evidence).length > MAX_CONFLICT_EVIDENCE_LENGTH) return refuse('evidence-too-large');
    return freeze({ status: 'prepared', candidate, revision: nextRevision, blockedRecord, readyRecord, evidence });
  } catch { return refuse('invalid-state'); }
}
