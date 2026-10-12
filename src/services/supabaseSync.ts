import { INITIAL_MALI_STATE } from '../data/initialData';
import { getSharedSupabaseClient } from './authService';
import { validateAndSanitizeBackupPayload } from './financialEngine';
import { createSupabaseSyncService, type SyncClient } from './supabaseSyncCore';

export type { PullResult, SyncResult } from './supabaseSyncCore';
export const SUPABASE_SQL_SCHEMA = `-- See supabase/schema.sql and ordered migrations.
-- Apply 20261012221600_atomic_vault_sync.sql before using this app version.
-- mali_sync_vault commits the snapshot and five financial tables atomically.
`;

const service = createSupabaseSyncService({
  getClient: (config) => getSharedSupabaseClient(config) as unknown as SyncClient,
  fallbackState: INITIAL_MALI_STATE,
  validateBackup: validateAndSanitizeBackupPayload,
});

export const testSupabaseConnection = service.testSupabaseConnection;
export const pushStateToSupabase = service.pushStateToSupabase;
export const pullStateFromSupabase = service.pullStateFromSupabase;
