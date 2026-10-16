import type { FinancialStorageBackend } from './chunkedFinancialStorage.ts';

const DEFAULT_DB_NAME = 'mali_financial_vault_v1';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const MIGRATION_MARKER_KEY = '@mali_financial_idb_v1:migrated';

export interface IndexedDbRequestLike<T = unknown> {
  readonly result: T;
  readonly error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

export interface IndexedDbOpenRequestLike extends IndexedDbRequestLike<IndexedDbDatabaseLike> {
  onupgradeneeded: (() => void) | null;
  onblocked?: (() => void) | null;
}

export interface IndexedDbObjectStoreLike {
  get(key: string): IndexedDbRequestLike<unknown>;
  put(value: string, key: string): IndexedDbRequestLike<unknown>;
  delete(key: string): IndexedDbRequestLike<unknown>;
  getAllKeys(): IndexedDbRequestLike<readonly unknown[]>;
}

export interface IndexedDbTransactionLike {
  readonly error: unknown;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  objectStore(name: string): IndexedDbObjectStoreLike;
}

export interface IndexedDbDatabaseLike {
  readonly objectStoreNames: { contains(name: string): boolean };
  onversionchange?: (() => void) | null;
  onclose?: (() => void) | null;
  createObjectStore(name: string): unknown;
  transaction(storeName: string, mode: 'readonly' | 'readwrite'): IndexedDbTransactionLike;
  close(): void;
}

export interface IndexedDbFactoryLike {
  open(name: string, version?: number): IndexedDbOpenRequestLike;
}

export function isFinancialStorageKey(key: string): boolean {
  return typeof key === 'string' && (
    key.startsWith('@mali_app_state_v2_') ||
    key.startsWith('@mali_financial_chunks_v1:')
  );
}

function defaultIdbFactory(): IndexedDbFactoryLike | undefined {
  return typeof indexedDB !== 'undefined' ? (indexedDB as unknown as IndexedDbFactoryLike) : undefined;
}

export function createWebFinancialStorageBackend(options: {
  idbFactory?: () => IndexedDbFactoryLike | undefined;
  legacyStorage?: FinancialStorageBackend;
  dbName?: string;
} = {}): FinancialStorageBackend {
  const getFactory = options.idbFactory ?? defaultIdbFactory;
  const legacy = options.legacyStorage;
  const dbName = options.dbName ?? DEFAULT_DB_NAME;

  let activeFactory: IndexedDbFactoryLike | null = null;
  let dbPromise: Promise<IndexedDbDatabaseLike> | null = null;
  let migrationPromise: Promise<void> | null = null;
  let migrated = false;

  function resetConnection() {
    dbPromise = null;
    migrationPromise = null;
    migrated = false;
  }

  function openDb(factory: IndexedDbFactoryLike): Promise<IndexedDbDatabaseLike> {
    if (factory !== activeFactory) {
      activeFactory = factory;
      resetConnection();
    }
    if (dbPromise) return dbPromise;
    const currentPromise = new Promise<IndexedDbDatabaseLike>((resolve, reject) => {
      let req: IndexedDbOpenRequestLike;
      try {
        req = factory.open(dbName, DB_VERSION);
      } catch (error) {
        resetConnection();
        reject(error);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          try { db.close(); } catch {}
          if (dbPromise === currentPromise) resetConnection();
        };
        db.onclose = () => {
          if (dbPromise === currentPromise) resetConnection();
        };
        resolve(db);
      };
      req.onerror = () => {
        if (dbPromise === currentPromise) resetConnection();
        reject(req.error || new Error('Failed to open IndexedDB financial vault.'));
      };
      req.onblocked = () => {
        if (dbPromise === currentPromise) resetConnection();
        reject(new Error('IndexedDB financial vault upgrade is blocked.'));
      };
    });
    dbPromise = currentPromise;
    return currentPromise;
  }

  function idbGet(db: IndexedDbDatabaseLike, key: string): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      let tx: IndexedDbTransactionLike;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
      } catch (error) {
        resetConnection();
        reject(error);
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      let value: string | null = null;
      let valid = true;
      req.onsuccess = () => {
        if (req.result === undefined || req.result === null) {
          value = null;
        } else if (typeof req.result === 'string') {
          value = req.result;
        } else {
          valid = false;
          reject(new Error('Corrupt non-string IndexedDB financial record.'));
        }
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed.'));
      tx.oncomplete = () => { if (valid) resolve(value); };
      tx.onerror = () => reject(tx.error || req.error || new Error('IndexedDB read transaction failed.'));
      tx.onabort = () => reject(tx.error || req.error || new Error('IndexedDB read transaction aborted.'));
    });
  }

  function idbSet(db: IndexedDbDatabaseLike, key: string, value: string): Promise<void> {
    if (typeof key !== 'string' || !key || typeof value !== 'string') {
      return Promise.reject(new Error('Invalid IndexedDB financial key or value.'));
    }
    return new Promise<void>((resolve, reject) => {
      let tx: IndexedDbTransactionLike;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (error) {
        resetConnection();
        reject(error);
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onerror = () => reject(req.error || new Error('IndexedDB write failed.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || req.error || new Error('IndexedDB write transaction failed.'));
      tx.onabort = () => reject(tx.error || req.error || new Error('IndexedDB write transaction aborted.'));
    });
  }

  function idbRemove(db: IndexedDbDatabaseLike, key: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let tx: IndexedDbTransactionLike;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (error) {
        resetConnection();
        reject(error);
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onerror = () => reject(req.error || new Error('IndexedDB delete failed.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || req.error || new Error('IndexedDB delete transaction failed.'));
      tx.onabort = () => reject(tx.error || req.error || new Error('IndexedDB delete transaction aborted.'));
    });
  }

  function idbGetAllKeys(db: IndexedDbDatabaseLike): Promise<readonly string[]> {
    return new Promise<readonly string[]>((resolve, reject) => {
      let tx: IndexedDbTransactionLike;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
      } catch (error) {
        resetConnection();
        reject(error);
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();
      let keys: string[] = [];
      req.onsuccess = () => {
        const raw = Array.isArray(req.result) ? req.result : [];
        keys = raw.filter((k): k is string => typeof k === 'string' && k !== MIGRATION_MARKER_KEY);
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB key scan failed.'));
      tx.oncomplete = () => resolve(keys);
      tx.onerror = () => reject(tx.error || req.error || new Error('IndexedDB key scan transaction failed.'));
      tx.onabort = () => reject(tx.error || req.error || new Error('IndexedDB key scan transaction aborted.'));
    });
  }

  async function ensureLegacyMigrated(db: IndexedDbDatabaseLike): Promise<void> {
    if (migrated) return;
    if (migrationPromise) return migrationPromise;
    const runMigration = async () => {
      const marker = await idbGet(db, MIGRATION_MARKER_KEY);
      if (marker === 'committed-v1') {
        migrated = true;
        return;
      }
      const financialKeys: string[] = [];
      if (legacy && typeof legacy.getAllKeys === 'function') {
        const keys = await legacy.getAllKeys();
        for (const key of keys) {
          if (isFinancialStorageKey(key)) financialKeys.push(key);
        }
      }
      for (const key of financialKeys) {
        const legacyValue = await legacy!.getItem(key);
        if (legacyValue === null) continue;
        const existing = await idbGet(db, key);
        if (existing === null) {
          await idbSet(db, key, legacyValue);
        }
        const verified = await idbGet(db, key);
        if (verified !== (existing ?? legacyValue)) {
          throw new Error('Unverified legacy financial storage migration.');
        }
      }
      await idbSet(db, MIGRATION_MARKER_KEY, 'committed-v1');
      if ((await idbGet(db, MIGRATION_MARKER_KEY)) !== 'committed-v1') {
        throw new Error('Unverified financial storage migration marker.');
      }
      if (legacy && typeof legacy.removeItem === 'function') {
        for (const key of financialKeys) {
          try { await legacy.removeItem(key); } catch {}
        }
      }
      migrated = true;
    };
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const currentMigration = (locks
      ? locks.request('mali-financial-cache:idb-migration:' + dbName, { mode: 'exclusive' }, runMigration)
      : runMigration()
    ).finally(() => {
      if (migrationPromise === currentMigration) migrationPromise = null;
    });
    migrationPromise = currentMigration;
    return currentMigration;
  }

  async function withReadyDb<T>(operation: (db: IndexedDbDatabaseLike) => Promise<T>): Promise<T> {
    const factory = getFactory();
    if (!factory) {
      throw new Error('IndexedDB is unavailable in this environment.');
    }
    const db = await openDb(factory);
    await ensureLegacyMigrated(db);
    return operation(db);
  }

  return {
    async getItem(key: string): Promise<string | null> {
      if (!getFactory()) {
        if (!legacy) throw new Error('No financial storage backend available.');
        return legacy.getItem(key);
      }
      return withReadyDb(db => idbGet(db, key));
    },
    async setItem(key: string, value: string): Promise<void> {
      if (!getFactory()) {
        if (!legacy) throw new Error('No financial storage backend available.');
        return legacy.setItem(key, value);
      }
      return withReadyDb(db => idbSet(db, key, value));
    },
    get removeItem(): ((key: string) => Promise<void>) | undefined {
      if (!getFactory()) {
        return typeof legacy?.removeItem === 'function' ? (key: string) => legacy.removeItem!(key) : undefined;
      }
      return (key: string) => withReadyDb(db => idbRemove(db, key));
    },
    get getAllKeys(): (() => Promise<readonly string[]>) | undefined {
      if (!getFactory()) {
        return typeof legacy?.getAllKeys === 'function' ? () => legacy.getAllKeys!() : undefined;
      }
      return () => withReadyDb(db => idbGetAllKeys(db));
    },
  };
}
