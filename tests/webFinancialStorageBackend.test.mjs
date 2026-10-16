import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { createChunkedFinancialStorage } from '../src/services/chunkedFinancialStorage.ts';
import { createWebFinancialStorageBackend } from '../src/services/webFinancialStorageBackend.ts';
import { createRecoveryArchiveReader } from '../src/services/recoveryArchiveReader.ts';
import { validateAndSanitizeBackupPayload } from '../src/services/financialEngine.ts';
import { appendFinancialAudit } from '../src/services/financialAudit.ts';

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const GUEST = 'local-offline-guest';
const KEY_A = '@mali_app_state_v2_' + OWNER_A;
const KEY_B = '@mali_app_state_v2_' + OWNER_B;
const KEY_GUEST = '@mali_app_state_v2_' + GUEST;
const LOCAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;

function createQuotaBoundedLocalStorage(initialEntries = []) {
  const map = new Map(initialEntries);
  let removeFail = false;
  const totalBytes = (candidateKey, candidateValue) => {
    let sum = 0;
    for (const [k, v] of map) {
      if (k === candidateKey) continue;
      sum += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8');
    }
    if (candidateKey !== undefined && candidateValue !== undefined) {
      sum += Buffer.byteLength(candidateKey, 'utf8') + Buffer.byteLength(candidateValue, 'utf8');
    }
    return sum;
  };
  return {
    map,
    setRemoveFail(flag) { removeFail = flag; },
    backend: {
      async getItem(key) { return map.get(key) ?? null; },
      async setItem(key, value) {
        if (totalBytes(key, value) > LOCAL_STORAGE_QUOTA_BYTES) {
          const err = new Error('QuotaExceededError: localStorage 5MB limit exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        map.set(key, String(value));
      },
      async removeItem(key) {
        if (removeFail) throw new Error('Simulated localStorage removeItem failure');
        map.delete(key);
      },
      async getAllKeys() { return [...map.keys()]; },
    },
  };
}

function createFakeIndexedDbFactory() {
  const databases = new Map();
  let writeCount = 0;
  let failAtWrite = Infinity;
  let failOpen = false;

  const factory = {
    databases,
    getWriteCount: () => writeCount,
    failOnWriteNumber: n => { failAtWrite = n; },
    failAfterWrites: delta => { failAtWrite = writeCount + delta; },
    clearWriteFailure: () => { failAtWrite = Infinity; },
    setFailOpen: flag => { failOpen = flag; },
    open(name) {
      const req = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (failOpen) {
          req.error = new Error('IndexedDB open blocked');
          req.onerror?.();
          return;
        }
        let dbState = databases.get(name);
        const isNew = !dbState;
        if (!dbState) {
          dbState = { stores: new Map() };
          databases.set(name, dbState);
        }
        const db = {
          onversionchange: null,
          onclose: null,
          objectStoreNames: {
            contains: storeName => dbState.stores.has(storeName),
          },
          createObjectStore(storeName) {
            if (!dbState.stores.has(storeName)) {
              dbState.stores.set(storeName, new Map());
            }
            return {};
          },
          transaction(storeName, mode) {
            const storeMap = dbState.stores.get(storeName);
            if (!storeMap) throw new Error('NotFoundError: Object store ' + storeName + ' not found');
            const tx = {
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                return {
                  get(key) {
                    const r = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      r.result = storeMap.get(key);
                      r.onsuccess?.();
                      queueMicrotask(() => tx.oncomplete?.());
                    });
                    return r;
                  },
                  put(value, key) {
                    const r = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      if (mode !== 'readwrite') {
                        const err = new Error('ReadOnlyError');
                        r.error = err;
                        tx.error = err;
                        r.onerror?.();
                        tx.onerror?.();
                        return;
                      }
                      writeCount++;
                      if (writeCount >= failAtWrite) {
                        const err = new Error('QuotaExceededError / Simulated IndexedDB write abort at write #' + writeCount);
                        r.error = err;
                        tx.error = err;
                        r.onerror?.();
                        tx.onabort?.();
                        return;
                      }
                      storeMap.set(key, value);
                      r.result = key;
                      r.onsuccess?.();
                      queueMicrotask(() => tx.oncomplete?.());
                    });
                    return r;
                  },
                  delete(key) {
                    const r = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      storeMap.delete(key);
                      r.onsuccess?.();
                      queueMicrotask(() => tx.oncomplete?.());
                    });
                    return r;
                  },
                  getAllKeys() {
                    const r = { result: [], error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      r.result = [...storeMap.keys()];
                      r.onsuccess?.();
                      queueMicrotask(() => tx.oncomplete?.());
                    });
                    return r;
                  },
                };
              },
            };
            return tx;
          },
          close() {},
        };
        req.result = db;
        if (isNew) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return factory;
}

function buildDataset(recordCount, ownerId = OWNER_A) {
  const date = '2026-10-12T12:00:00.000Z';
  const accounts = [
    {
      id: 'acc-cash-lyd',
      name: 'الخزنة النقدية الرئيسية',
      bankName: 'كاش',
      category: 'cash_lyd',
      currency: 'LYD',
      balance: 1000000 + recordCount * 10,
      isCash: true,
      color: '#0D9488',
      updatedAt: date,
    },
    {
      id: 'acc-usd-1',
      name: 'خزنة الدولار',
      bankName: 'كاش دولار',
      category: 'cash_usd',
      currency: 'USD',
      balance: 50000,
      isCash: true,
      color: '#2563EB',
      updatedAt: date,
    },
  ];
  const contacts = [
    {
      id: 'cnt-1',
      name: 'شركة المتوسط للتجارة',
      phone: '0910000001',
      role: 'تاجر عملة',
      createdAt: '2026-10-12',
    },
  ];
  const transactions = new Array(recordCount);
  for (let i = 0; i < recordCount; i++) {
    transactions[i] = {
      id: `tx-bulk-${i + 1}`,
      idempotencyKey: `idem-bulk-${ownerId}-${i + 1}`,
      title: `حركة مالية تشغيلية رقم ${i + 1}`,
      type: i % 2 === 0 ? 'income' : 'expense',
      amount: 25.5,
      currency: 'LYD',
      category: i % 2 === 0 ? 'مبيعات' : 'مشتريات تشغيلية',
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
      contactId: 'cnt-1',
      date: '2026-10-12',
      updatedAt: date,
      notes: `بيان تفصيلي للحركة رقم ${i + 1}`,
    };
  }
  return {
    accounts,
    contacts,
    transactions,
    deals: [],
    debts: [],
    procedures: [],
    budgets: [],
    marketRates: {
      cashUsdToLyd: 6.25,
      chequeUsdToLyd: 6.45,
      defaultChequeDiscountPercent: 2.5,
      updatedAt: date,
    },
    supabaseConfig: {
      url: 'https://evcwoaerlykghgdevrhb.supabase.co',
      anonKey: 'anon-test',
      workspaceKey: `mali-vault-${ownerId}`,
      autoSync: false,
    },
    lastModifiedAt: date,
  };
}

test('lossless migration moves legacy unchunked and chunked localStorage keys into IndexedDB while preserving auth and theme keys', async () => {
  const local = createQuotaBoundedLocalStorage([
    ['sb-evcwoaerlykghgdevrhb-auth-token', '{"access_token":"secret-session-jwt"}'],
    ['@mali_app_theme_v1', 'dark'],
    [KEY_GUEST, JSON.stringify(buildDataset(15, GUEST))],
  ]);
  const legacyChunked = createChunkedFinancialStorage(local.backend);
  const stateA = JSON.stringify(buildDataset(120, OWNER_A));
  await legacyChunked.setItem(KEY_A, stateA);
  assert.ok([...local.map.keys()].some(k => k.startsWith('@mali_financial_chunks_v1:')));

  const idb = createFakeIndexedDbFactory();
  const webBackend = createWebFinancialStorageBackend({
    idbFactory: () => idb,
    legacyStorage: local.backend,
  });
  const webStore = createChunkedFinancialStorage(webBackend);

  // Reading both migrated chunked vault and migrated unchunked guest vault succeeds losslessly
  assert.equal(await webStore.getItem(KEY_A), stateA);
  assert.equal(await webStore.getItem(KEY_GUEST), JSON.stringify(buildDataset(15, GUEST)));

  // Financial keys were cleaned from localStorage after verified IndexedDB migration, freeing the 5MB quota
  assert.equal([...local.map.keys()].some(k => k.startsWith('@mali_app_state_v2_') || k.startsWith('@mali_financial_chunks_v1:')), false);
  // Auth and theme keys in localStorage were never touched
  assert.equal(local.map.get('sb-evcwoaerlykghgdevrhb-auth-token'), '{"access_token":"secret-session-jwt"}');
  assert.equal(local.map.get('@mali_app_theme_v1'), 'dark');
});

test('interrupted localStorage-to-IndexedDB migration preserves all localStorage keys and completes on retry', async () => {
  const local = createQuotaBoundedLocalStorage([
    ['sb-evcwoaerlykghgdevrhb-auth-token', '{"access_token":"keep-me"}'],
  ]);
  const legacyChunked = createChunkedFinancialStorage(local.backend);
  const stateA = JSON.stringify(buildDataset(500, OWNER_A));
  await legacyChunked.setItem(KEY_A, stateA);
  const snapshotBefore = new Map(local.map);

  const idb = createFakeIndexedDbFactory();
  // Fail on the 2nd write during migration (before marker can be written)
  idb.failOnWriteNumber(2);
  const webBackend = createWebFinancialStorageBackend({
    idbFactory: () => idb,
    legacyStorage: local.backend,
  });
  const webStore = createChunkedFinancialStorage(webBackend);

  await assert.rejects(webStore.getItem(KEY_A));
  // Every single original key in localStorage is still intact!
  assert.deepEqual(local.map, snapshotBefore);

  // Now clear the write failure and retry: migration completes and verifies
  idb.clearWriteFailure();
  assert.equal(await webStore.getItem(KEY_A), stateA);
  assert.equal(local.map.get('sb-evcwoaerlykghgdevrhb-auth-token'), '{"access_token":"keep-me"}');
});

for (const count of [1_000, 10_000, 50_000]) {
  test(`web IndexedDB storage durably commits, audits, archives and exports ${count.toLocaleString('en-US')} financial records while localStorage stays under 5MB`, async () => {
    const local = createQuotaBoundedLocalStorage([
      ['@mali_app_theme_v1', 'light'],
    ]);
    const idb = createFakeIndexedDbFactory();
    const webBackend = createWebFinancialStorageBackend({
      idbFactory: () => idb,
      legacyStorage: local.backend,
    });
    const webStore = createChunkedFinancialStorage(webBackend);

    const initial = buildDataset(5, OWNER_A);
    await webStore.setItem(KEY_A, JSON.stringify(initial));

    const largeBackupObj = buildDataset(count, OWNER_A);
    const largeBackupRaw = JSON.stringify(largeBackupObj);
    const validated = validateAndSanitizeBackupPayload(largeBackupRaw, initial);
    assert.equal(validated.valid, true);

    const audited = appendFinancialAudit(initial, validated.state, {
      ownerId: OWNER_A,
      action: 'backup_import',
      reason: `Automated ${count}-record capacity verification`,
    });
    assert.equal(audited.transactions.length, count);
    const candidateRaw = JSON.stringify(audited);

    if (count >= 10_000) {
      // Confirm that this dataset genuinely exceeds the 5MB localStorage budget
      await assert.rejects(
        createChunkedFinancialStorage(createQuotaBoundedLocalStorage().backend).recoverItem(KEY_A, candidateRaw, largeBackupRaw),
        /QuotaExceededError/
      );
    }

    // Recover & commit on IndexedDB-backed web storage
    const archiveKey = await webStore.recoverItem(KEY_A, candidateRaw, largeBackupRaw);
    const readBack = await webStore.getItem(KEY_A);
    assert.equal(readBack, candidateRaw);

    // Verify cold recovery archive reader can list, inspect, and export both prior and incoming versions
    const reader = createRecoveryArchiveReader(webBackend, OWNER_A, () => true);
    const listed = await reader.list();
    assert.equal(listed.rows.length, 1);
    assert.equal(listed.rows[0].id, archiveKey);
    const details = await reader.inspect(archiveKey);
    assert.equal(details.source, 'backup');
    assert.ok(details.versions.every(v => v.readable));
    const exportedIncoming = JSON.parse(await reader.exportVersion(archiveKey, 'incoming'));
    assert.equal(exportedIncoming.transactions.length, count);

    // Verify localStorage was not polluted with financial chunks
    assert.deepEqual([...local.map.keys()], ['@mali_app_theme_v1']);
  });
}

test('mid-write failure during large vault replacement or recovery preserves the prior committed vault and isolates owners', async () => {
  const local = createQuotaBoundedLocalStorage();
  const idb = createFakeIndexedDbFactory();
  const webBackend = createWebFinancialStorageBackend({
    idbFactory: () => idb,
    legacyStorage: local.backend,
  });
  const webStore = createChunkedFinancialStorage(webBackend);

  const originalA = JSON.stringify(buildDataset(200, OWNER_A));
  const originalB = JSON.stringify(buildDataset(100, OWNER_B));
  await webStore.setItem(KEY_A, originalA);
  await webStore.setItem(KEY_B, originalB);

  const replacementA = JSON.stringify(buildDataset(2500, OWNER_A));
  // Fail halfway through writing the ~10 chunks of replacementA
  idb.failAfterWrites(4);
  await assert.rejects(webStore.setItem(KEY_A, replacementA));

  // Prior committed vault for A and B must remain 100% intact and readable
  idb.clearWriteFailure();
  assert.equal(await webStore.getItem(KEY_A), originalA);
  assert.equal(await webStore.getItem(KEY_B), originalB);

  // Fail halfway through recoverItem after archive write starts
  idb.failAfterWrites(3);
  await assert.rejects(webStore.recoverItem(KEY_A, replacementA, replacementA));
  idb.clearWriteFailure();
  assert.equal(await webStore.getItem(KEY_A), originalA);

  // Owner B cannot see Owner A's archives
  await webStore.recoverItem(KEY_A, replacementA, replacementA);
  assert.equal(await webStore.getItem(KEY_A), replacementA);
  assert.equal(await webStore.getItem(KEY_B), originalB);
  const readerB = createRecoveryArchiveReader(webBackend, OWNER_B, () => true);
  assert.equal((await readerB.list()).rows.length, 0);
});

test('financialStorage routes web operations to IndexedDB while keeping native Android/iOS on AsyncStorage', async () => {
  const { installNativeTestLoader } = await import('./nativeModuleTestLoader.mjs');
  const nativeStored = new Map();
  globalThis.maliTestStorage = {
    getItem: async k => nativeStored.get(k) ?? null,
    setItem: async (k, v) => { nativeStored.set(k, v); },
    removeItem: async k => { nativeStored.delete(k); },
    getAllKeys: async () => [...nativeStored.keys()],
  };
  globalThis.maliTestPlatform = { OS: 'android' };
  installNativeTestLoader();
  const { financialStorage, financialStorageBackend } = await import('../src/services/financialStorage.ts');

  const nativePayload = JSON.stringify(buildDataset(10, OWNER_A));
  await financialStorage.setItem(KEY_A, nativePayload);
  assert.equal(await financialStorage.getItem(KEY_A), nativePayload);
  assert.ok((await financialStorageBackend.getAllKeys()).some(k => k.startsWith('@mali_financial_chunks_v1:')));

  // Switch to web with IndexedDB and navigator.locks
  const idb = createFakeIndexedDbFactory();
  globalThis.indexedDB = idb;
  globalThis.maliTestPlatform.OS = 'web';
  const lockDesc = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: { request: (_name, _opts, action) => action() },
  });

  try {
    // Existing keys in AsyncStorage migrate automatically into IndexedDB on first web access
    assert.equal(await financialStorage.getItem(KEY_A), nativePayload);
    // Subsequent large web writes go to IndexedDB, not AsyncStorage
    const webPayload = JSON.stringify(buildDataset(500, OWNER_B));
    await financialStorage.setItem(KEY_B, webPayload);
    assert.equal(await financialStorage.getItem(KEY_B), webPayload);
    assert.equal(nativeStored.size, 0);
    assert.ok((await financialStorageBackend.getAllKeys()).some(k => k.includes(OWNER_B)));
  } finally {
    delete globalThis.indexedDB;
    globalThis.maliTestPlatform.OS = 'android';
    if (lockDesc) Object.defineProperty(globalThis.navigator, 'locks', lockDesc);
    else delete globalThis.navigator.locks;
  }
});

