import type { SyncOutbox } from './durableSyncWorker';
import type { MaliState, SupabaseConfig } from '../types/mali';

export const syncConfigIdentity = (config: SupabaseConfig) => JSON.stringify([config.url.trim().replace(/\/$/, ''), config.anonKey.trim(), config.workspaceKey]);

/** Cache metadata is untrusted; malformed outboxes lock recovery instead of uploading. */
export function validateSyncOutbox(value: unknown, ownerId: string, validate: (raw: string) => boolean): SyncOutbox<MaliState> | null {
  if (value === undefined) return null;
  const raw = value as SyncOutbox<MaliState>;
  const revision = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  const timestamp = (stamp: unknown) => stamp === undefined || (typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)));
  const payload = (item: any) => item && revision(item.revision) && item.payload && typeof item.payload === 'object'
    && (!item.payload.ownerId || item.payload.ownerId === ownerId) && validate(JSON.stringify(item.payload));
  if (!raw || raw.version !== 1 || raw.ownerId !== ownerId || typeof raw.configId !== 'string' || raw.configId.length > 8192
    || !revision(raw.attempts) || raw.attempts > 32 || !Number.isFinite(raw.nextAttemptAt) || raw.nextAttemptAt < 0
    || !timestamp(raw.syncedAt) || (raw.acknowledgedRevision !== undefined && !revision(raw.acknowledgedRevision))
    || (raw.pending !== null && !payload(raw.pending))) throw new Error('Invalid durable sync outbox.');
  if (raw.stop) {
    const { reason, result, attempted } = raw.stop;
    if (!['conflict', 'session', 'configuration', 'permanent'].includes(reason) || !result || result.ok !== false || result.success !== false
      || typeof result.message !== 'string' || (attempted && !payload(attempted))) throw new Error('Invalid durable sync stop.');
    if (reason === 'conflict' && (!attempted || !result.conflictDetected || !timestamp(result.updatedAt) || !result.updatedAt
      || !result.cloudState || ((result.cloudState as any).ownerId && (result.cloudState as any).ownerId !== ownerId)
      || !validate(JSON.stringify(result.cloudState)))) throw new Error('Invalid retained cloud conflict.');
  }
  return raw;
}
