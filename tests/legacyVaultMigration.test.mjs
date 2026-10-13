import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

globalThis.maliTestPlatform = { OS: 'android' };
const testStorageMap = new Map();
globalThis.maliTestStorage = {
  getItem: async key => testStorageMap.get(key) ?? null,
  setItem: async (key, value) => { testStorageMap.set(key, value); },
  removeItem: async key => { testStorageMap.delete(key); },
  getAllKeys: async () => [...testStorageMap.keys()],
};

let syncPullResponse = { ok: false, success: false, isEmpty: true, message: 'empty' };
let syncPushResponse = { ok: true, success: true, updatedAt: '2026-10-13T20:00:00.000Z', message: 'saved' };

globalThis.maliProviderSync = {
  pull: async () => syncPullResponse,
  push: async () => syncPushResponse,
};

globalThis.maliProviderAuth = {
  clearAuthSession: async () => {},
  consumeOAuthRedirectIfPresent: async () => null,
  getPersistedSessionUser: async () => null,
  savePersistedSessionUser: async () => {},
  subscribeToAuthIdentity: () => () => {},
};

installNativeTestLoader({ provider: true });

const {
  computeVaultChecksum,
  getLegacyStorageKeyForUser,
  getLegacyArchiveKeyForUser,
  getLegacyReceiptKeyForUser,
  inspectLegacyVault,
  executeLegacyVaultMigration,
} = await import('../src/services/legacyVaultMigrationService.ts');

const { emptyFinancialState } = await import('../src/services/sessionScope.ts');
const { INITIAL_MALI_STATE } = await import('../src/data/initialData.ts');
const { financialStorage } = await import('../src/services/financialStorage.ts');

test('computeVaultChecksum returns deterministic hex hash', () => {
  const base = emptyFinancialState(INITIAL_MALI_STATE);
  const hash1 = computeVaultChecksum(base);
  const hash2 = computeVaultChecksum(base);
  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 8);
  assert.equal(hash1, hash2);

  const modified = {
    ...base,
    accounts: [
      { id: 'acc-1', name: 'خزينة نقدية', bankName: 'نقدي', category: 'cash', currency: 'LYD', balance: 500, isCash: true, updatedAt: new Date().toISOString() },
    ],
  };
  const hash3 = computeVaultChecksum(modified);
  assert.notEqual(hash1, hash3);
});

test('inspectLegacyVault returns null when no key exists or user is guest', async () => {
  const template = emptyFinancialState(INITIAL_MALI_STATE);
  const guestResult = await inspectLegacyVault('local-offline-guest', template);
  assert.equal(guestResult, null);

  const missingResult = await inspectLegacyVault('usr-non-existent-99', template);
  assert.equal(missingResult, null);
});

test('inspectLegacyVault computes correct records summary from valid legacy payload', async () => {
  const template = emptyFinancialState(INITIAL_MALI_STATE);
  const userId = 'usr-inspect-summary-test';
  const key = getLegacyStorageKeyForUser(userId);

  const sampleVault = {
    ...template,
    accounts: [
      { id: 'acc-1', name: 'خزينة نقدية دينار', bankName: 'نقدي', category: 'cash', currency: 'LYD', balance: 1500, isCash: true, updatedAt: '2026-10-12T10:00:00Z' },
      { id: 'acc-2', name: 'خزينة دولار', bankName: 'نقدي', category: 'cash', currency: 'USD', balance: 400, isCash: true, updatedAt: '2026-10-12T10:00:00Z' },
    ],
    transactions: [
      { id: 'tx-1', title: 'إيداع نقدي', type: 'income', amount: 1500, currency: 'LYD', category: 'capital', accountId: 'acc-1', paymentMethod: 'cash', date: '2026-10-12T10:00:00Z', updatedAt: '2026-10-12T10:00:00Z' },
    ],
    debts: [
      { id: 'debt-1', personName: 'محمد التاجر', direction: 'receivable', currency: 'LYD', totalAmount: 1000, paidAmount: 0, remainingAmount: 1000, createdAt: '2026-10-12T10:00:00Z', status: 'active', installments: [], updatedAt: '2026-10-12T10:00:00Z' },
    ],
    deals: [],
    contacts: [],
    procedures: [],
    lastModifiedAt: '2026-10-12T10:05:00Z',
  };

  await financialStorage.setItem(key, JSON.stringify(sampleVault));

  const summary = await inspectLegacyVault(userId, template);
  assert.ok(summary);
  assert.equal(summary.userId, userId);
  assert.equal(summary.accountsCount, 2);
  assert.equal(summary.transactionsCount, 1);
  assert.equal(summary.debtsCount, 1);
  assert.equal(summary.dealsCount, 0);
  assert.equal(summary.totalLydBalance, 1500);
  assert.equal(summary.totalUsdBalance, 400);
  assert.equal(typeof summary.sha256Checksum, 'string');
});

test('executeLegacyVaultMigration preserves local vault intact if remote push fails', async () => {
  const template = emptyFinancialState(INITIAL_MALI_STATE);
  const userId = 'usr-fail-preserve-test';
  const key = getLegacyStorageKeyForUser(userId);

  const sampleVault = {
    ...template,
    accounts: [
      { id: 'acc-1', name: 'خزينة نقدية دينار', bankName: 'نقدي', category: 'cash', currency: 'LYD', balance: 800, isCash: true, updatedAt: '2026-10-12T10:00:00Z' },
    ],
    transactions: [],
    debts: [],
    deals: [],
  };
  const rawOriginal = JSON.stringify(sampleVault);
  await financialStorage.setItem(key, rawOriginal);

  syncPushResponse = { ok: false, success: false, message: 'Supabase network error' };

  const invalidConfig = {
    url: 'https://test.supabase.co',
    anonKey: 'invalid-key',
    workspaceKey: 'mali-vault-usr-fail-preserve-test',
    autoSync: true,
  };

  const steps = [];
  const result = await executeLegacyVaultMigration({
    userId,
    user: { id: userId, email: 'fail@test.ly', name: 'مستخدم تجريبي', isLocalOnly: false },
    config: invalidConfig,
    emptyTemplate: template,
    onProgress: s => steps.push(s.step),
  });

  assert.equal(result.ok, false);
  assert.ok(result.message.includes('فشل رفع البيانات إلى الخادم'));

  // Local storage MUST remain completely untouched
  const preservedRaw = await financialStorage.getItem(key);
  assert.equal(preservedRaw, rawOriginal);

  // Archive and receipt keys should NOT be created
  const archiveRaw = await financialStorage.getItem(getLegacyArchiveKeyForUser(userId));
  assert.equal(archiveRaw, null);
});

test('executeLegacyVaultMigration uploads, verifies on server, archives copy and clears active key on success', async () => {
  const template = emptyFinancialState(INITIAL_MALI_STATE);
  const userId = 'usr-success-migration-test';
  const key = getLegacyStorageKeyForUser(userId);

  const sampleVault = {
    ...template,
    accounts: [
      { id: 'acc-10', name: 'خزينة تجارة', bankName: 'نقدي', category: 'cash', currency: 'LYD', balance: 3500, isCash: true, updatedAt: '2026-10-12T12:00:00Z' },
    ],
    transactions: [
      { id: 'tx-10', title: 'مبيعات', type: 'income', amount: 3500, currency: 'LYD', category: 'sales', accountId: 'acc-10', paymentMethod: 'cash', date: '2026-10-12T12:00:00Z', updatedAt: '2026-10-12T12:00:00Z' },
    ],
    debts: [],
    deals: [],
  };
  const rawOriginal = JSON.stringify(sampleVault);
  await financialStorage.setItem(key, rawOriginal);

  syncPushResponse = {
    ok: true,
    success: true,
    updatedAt: '2026-10-13T20:30:00.000Z',
    snapshotUpdatedAt: '2026-10-13T20:30:00.000Z',
    message: 'saved',
  };

  syncPullResponse = {
    ok: true,
    success: true,
    identityVerified: true,
    state: sampleVault,
    updatedAt: '2026-10-13T20:30:00.000Z',
    snapshotUpdatedAt: '2026-10-13T20:30:00.000Z',
  };

  const validConfig = {
    url: 'https://evcwoaerlykghgdevrhb.supabase.co',
    anonKey: 'valid-anon-key',
    workspaceKey: 'mali-vault-usr-success-migration-test',
    autoSync: true,
  };

  const steps = [];
  const result = await executeLegacyVaultMigration({
    userId,
    user: { id: userId, email: 'success@test.ly', name: 'مستخدم ناجح', isLocalOnly: false },
    config: validConfig,
    emptyTemplate: template,
    onProgress: s => steps.push(s.step),
  });

  if (!result.ok) {
    console.error('Migration failed with message:', result.message);
  }
  assert.equal(result.ok, true);
  assert.ok(result.message.includes('تم ترحيل الخزنة واعتمادها بنجاح'));
  assert.deepEqual(steps, ['validating', 'uploading', 'verifying', 'archiving', 'completed']);

  // Active key is removed
  const activeRemaining = await financialStorage.getItem(key);
  assert.equal(activeRemaining, null);

  // Local archive is preserved with full original JSON
  const archived = await financialStorage.getItem(getLegacyArchiveKeyForUser(userId));
  assert.equal(archived, rawOriginal);

  // Migration receipt is saved
  const receiptRaw = await financialStorage.getItem(getLegacyReceiptKeyForUser(userId));
  assert.ok(receiptRaw);
  const receipt = JSON.parse(receiptRaw);
  assert.equal(receipt.userId, userId);
  assert.equal(receipt.accountsCount, 1);
  assert.equal(receipt.transactionsCount, 1);
});
