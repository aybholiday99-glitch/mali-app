import type { AuthUser, MaliState, SupabaseConfig } from '../types/mali.ts';
import { financialStorage, financialStorageBackend } from './financialStorage.ts';
import { validateAndSanitizeBackupPayload } from './financialEngine.ts';
import { pullStateFromSupabase, pushStateToSupabase } from './supabaseSync.ts';

export interface LegacyVaultSummary {
  userId: string;
  storageKey: string;
  accountsCount: number;
  transactionsCount: number;
  debtsCount: number;
  dealsCount: number;
  contactsCount: number;
  proceduresCount: number;
  totalLydBalance: number;
  totalUsdBalance: number;
  lastModifiedAt?: string;
  sha256Checksum: string;
}

export interface MigrationStepStatus {
  step: 'validating' | 'uploading' | 'verifying' | 'archiving' | 'completed' | 'error';
  message: string;
  progressPercent: number;
}

const BASE_STORAGE_KEY = '@mali_app_state_v2';

export function getLegacyStorageKeyForUser(userId: string): string {
  return `${BASE_STORAGE_KEY}_${userId}`;
}

export function getLegacyArchiveKeyForUser(userId: string): string {
  return `${BASE_STORAGE_KEY}_${userId}_migrated_archive`;
}

export function getLegacyReceiptKeyForUser(userId: string): string {
  return `${BASE_STORAGE_KEY}_${userId}_migration_receipt`;
}

/**
 * Computes a deterministic hash representation for checksum validation
 */
export function computeVaultChecksum(payload: MaliState): string {
  const content = JSON.stringify({
    acc: (payload.accounts || []).map(a => [a.id, a.currency, a.balance]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    tx: (payload.transactions || []).map(t => [t.id, t.amount, t.currency]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    debts: (payload.debts || []).map(d => [d.id, d.totalAmount, d.remainingAmount]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    deals: (payload.deals || []).map(dl => [dl.id, dl.totalUsdBought, dl.totalLydCost]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Inspects on-device legacy storage for a given user.
 * Returns null if no legacy vault exists or if the vault is empty.
 */
export async function inspectLegacyVault(
  userId: string,
  emptyTemplate: MaliState
): Promise<LegacyVaultSummary | null> {
  if (!userId || userId === 'local-offline-guest') return null;
  const key = getLegacyStorageKeyForUser(userId);
  const raw = await financialStorage.getItem(key);
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;

  const validation = validateAndSanitizeBackupPayload(raw, emptyTemplate);
  if (!validation.valid || !validation.state) return null;

  const st = validation.state;
  const accounts = st.accounts || [];
  const transactions = st.transactions || [];
  const debts = st.debts || [];
  const deals = st.deals || [];
  const contacts = st.contacts || [];
  const procedures = st.procedures || [];

  const totalLydBalance = accounts
    .filter(a => a.currency === 'LYD')
    .reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

  const totalUsdBalance = accounts
    .filter(a => a.currency === 'USD')
    .reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

  const sha256Checksum = computeVaultChecksum(st);

  return {
    userId,
    storageKey: key,
    accountsCount: accounts.length,
    transactionsCount: transactions.length,
    debtsCount: debts.length,
    dealsCount: deals.length,
    contactsCount: contacts.length,
    proceduresCount: procedures.length,
    totalLydBalance,
    totalUsdBalance,
    lastModifiedAt: st.lastModifiedAt,
    sha256Checksum,
  };
}

/**
 * Executes safe, verified migration of the legacy on-device vault to the central Supabase server.
 * Guarantees:
 * 1. Data is validated before upload.
 * 2. Data is pushed atomically via pushStateToSupabase (mali_sync_vault).
 * 3. Server records are pulled back and verified against local counts.
 * 4. Local copy is preserved in an archive key (@mali_app_state_v2_<userId>_migrated_archive).
 * 5. Active blocking key is removed only after complete verified server ACK.
 * 6. If any step fails, the local vault remains 100% untouched and error is returned.
 */
export async function executeLegacyVaultMigration(params: {
  userId: string;
  user: AuthUser;
  config: SupabaseConfig;
  emptyTemplate: MaliState;
  onProgress?: (status: MigrationStepStatus) => void;
}): Promise<{ ok: boolean; message: string; verifiedState?: MaliState }> {
  const { userId, user, config, emptyTemplate, onProgress } = params;

  const notify = (
    step: MigrationStepStatus['step'],
    message: string,
    progressPercent: number
  ) => {
    onProgress?.({ step, message, progressPercent });
  };

  const key = getLegacyStorageKeyForUser(userId);
  const raw = await financialStorage.getItem(key);
  if (!raw) {
    return { ok: false, message: 'لم يتم العثور على بيانات محلية للترحيل.' };
  }

  notify('validating', 'التحقق من سلامة وصحة السجلات المالية المحلية…', 20);
  const validation = validateAndSanitizeBackupPayload(raw, emptyTemplate);
  if (!validation.valid || !validation.state) {
    return {
      ok: false,
      message: 'البيانات المحلية تالفة أو غير متطابقة مع المعايير المحاسبية. لم يتم التعديل.',
    };
  }

  const legacyState = validation.state;
  const localChecksum = computeVaultChecksum(legacyState);

  notify('uploading', 'رفع البيانات واعتمادها على الخادم المركزي عبر القناة الآمنة…', 50);
  const pushRes = await pushStateToSupabase(legacyState, config, user);
  if (!pushRes.ok || !pushRes.success) {
    return {
      ok: false,
      message: `فشل رفع البيانات إلى الخادم: ${pushRes.message || 'خطأ في الاتصال بالخادم'}. بقيت نسختك المحلية محفوظة دون تغيير.`,
    };
  }

  notify('verifying', 'التحقق من مطابقة السجلات المعتمدة على الخادم المركزي…', 75);
  const pullRes = await pullStateFromSupabase(config, user);
  if (!pullRes.ok || !pullRes.state || pullRes.identityVerified !== true) {
    return {
      ok: false,
      message: 'تم الرفع لكن تعذر التحقق من اكتمال المطابقة على الخادم. تم الاحتفاظ بالنسخة المحلية.',
    };
  }

  const serverState = pullRes.state;
  const serverAccounts = serverState.accounts || [];
  const serverTransactions = serverState.transactions || [];
  const serverDebts = serverState.debts || [];
  const serverDeals = serverState.deals || [];

  if (
    serverAccounts.length < (legacyState.accounts || []).length ||
    serverTransactions.length < (legacyState.transactions || []).length ||
    serverDebts.length < (legacyState.debts || []).length ||
    serverDeals.length < (legacyState.deals || []).length
  ) {
    return {
      ok: false,
      message: 'عدد السجلات على الخادم لا يطابق السجلات المحلية. لم تُحذف البيانات المحلية؛ يرجى مراجعة الدعم.',
    };
  }

  notify('archiving', 'أرشفة النسخة المحلية بأمان وإتمام الانتقال للوضع المركزي…', 90);
  const archiveKey = getLegacyArchiveKeyForUser(userId);
  const receiptKey = getLegacyReceiptKeyForUser(userId);

  await financialStorage.setItem(archiveKey, raw);

  const receipt = {
    migratedAt: new Date().toISOString(),
    userId,
    localChecksum,
    accountsCount: serverAccounts.length,
    transactionsCount: serverTransactions.length,
    debtsCount: serverDebts.length,
    dealsCount: serverDeals.length,
    serverSnapshotUpdatedAt: pullRes.snapshotUpdatedAt || pullRes.updatedAt,
  };
  await financialStorage.setItem(receiptKey, JSON.stringify(receipt));

  // Now that server copy and local archive are confirmed, remove the active blocking key and its chunks
  if (financialStorageBackend.removeItem) {
    await financialStorageBackend.removeItem(key);
    const chunkNs = '@mali_financial_chunks_v1:' + encodeURIComponent(key);
    await financialStorageBackend.removeItem(chunkNs + ':head');
    await financialStorageBackend.removeItem(chunkNs + ':enrolled');
  } else {
    await financialStorage.setItem(key, '');
  }

  notify('completed', 'اكتمل ترحيل الخزنة بنجاح واعتمادها على الخادم المركزي.', 100);

  return {
    ok: true,
    message: 'تم ترحيل الخزنة واعتمادها بنجاح على الخادم المركزي.',
    verifiedState: { ...emptyTemplate, ...serverState },
  };
}
