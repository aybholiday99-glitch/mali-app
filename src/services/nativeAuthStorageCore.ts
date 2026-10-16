/** Native-only token storage. No token value is written to ordinary storage. */
export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface NativeAuthStorageDependencies {
  secure: StringStorage;
  legacy: StringStorage & { getAllKeys?(): Promise<readonly string[]> };
  isAvailable(): Promise<boolean>;
}
type Slot = 'a' | 'b';
type Head = { version: 1; state: 'active'; epoch: number; slot: Slot; count: number; length: number }
  | { version: 1; state: 'deleted'; epoch: number };

// JSON escaping costs at most six ASCII bytes per UTF-16 unit. Even chunks
// ending inside a surrogate pair are escaped, then joined losslessly on read.
const CHUNK_UNITS = 256;
const MAX_CHUNKS = 512;
const unavailable = () => new Error('Secure authentication storage is unavailable or could not be verified.');
const validCount = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= MAX_CHUNKS;
const hex = (value: string) => [...value].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

/** Exact grammar of the pinned @supabase/auth-js SDK; no project-prefix match. */
export function isAuthStorageKey(namespace: string, key: string) {
  if (key === namespace) return true;
  const suffix = key.slice(namespace.length);
  return key.startsWith(namespace) && (['-user', '-code-verifier', '-flows-code-verifier'].includes(suffix)
    || /^-flow-[a-zA-Z0-9_-]{8,64}-code-verifier$/.test(suffix));
}

/** A custom project's base may equal another project's valid SDK suffix. */
export function mayRemoveLegacyAuthValue(namespace: string, key: string, value: string | null) {
  if (!isAuthStorageKey(namespace, key)) return false;
  if (key === namespace || value === null) return true;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && typeof parsed.access_token === 'string'
      && typeof parsed.refresh_token === 'string') return false;
  } catch { /* Raw PKCE verifiers are valid non-JSON strings. */ }
  return true;
}

export function createNativeAuthStorage(namespace: string, deps: NativeAuthStorageDependencies) {
  let tail: Promise<unknown> = Promise.resolve();
  const ownerPrefix = 'mali_auth_secure_v1.' + hex(namespace);
  const epochKey = ownerPrefix + '.epoch';
  // Contains no credentials. A failed native cleanup cannot permit restore
  // after restart just because SecureStore becomes available again.
  const fenceKey = '@mali_auth_logout_fence_v1_' + hex(namespace);
  const observed = new Set<string>([namespace, namespace + '-user', namespace + '-code-verifier', namespace + '-flows-code-verifier']);

  function ownedKey(key: string) {
    if (!isAuthStorageKey(namespace, key) || !/^[A-Za-z0-9_.-]+$/.test(key)) throw unavailable();
    observed.add(key);
    // Hex avoids ambiguous separators and unsupported SecureStore key characters.
    return ownerPrefix + '.' + hex(key);
  }
  const slotKey = (base: string, slot: Slot, index: number) => `${base}.${slot}.${index}`;
  const metaKey = (base: string, slot: Slot) => `${base}.${slot}.metadata`;

  function run<T>(operation: () => Promise<T>, mode: 'read' | 'write' | 'cleanup' = 'write'): Promise<T> {
    const result = tail.then(async () => {
      try {
        if (mode !== 'cleanup') {
          if (await deps.legacy.getItem(fenceKey) !== null) {
            if (mode === 'read') return null as T;
            throw unavailable();
          }
          if (!await deps.isAvailable()) throw unavailable();
        }
        return await operation();
      } catch {
        // Native error strings may contain stored values. Never expose them.
        throw unavailable();
      }
    });
    tail = result.catch(() => {});
    return result;
  }
  async function verifiedSet(key: string, value: string) {
    await deps.secure.setItem(key, value);
    if (await deps.secure.getItem(key) !== value) throw unavailable();
  }
  async function verifiedDelete(key: string) {
    await deps.secure.removeItem(key);
    if (await deps.secure.getItem(key) !== null) throw unavailable();
  }
  async function clearOrdinaryKey(key: string) {
    await deps.legacy.removeItem(key);
    if (await deps.legacy.getItem(key) !== null) throw unavailable();
  }
  async function clearLegacy(key: string) {
    if (mayRemoveLegacyAuthValue(namespace, key, await deps.legacy.getItem(key))) await clearOrdinaryKey(key);
  }
  async function epoch() {
    const raw = await deps.secure.getItem(epochKey);
    if (raw === null) return 0;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Number.isSafeInteger(parsed.epoch) || parsed.epoch < 0) throw unavailable();
    return parsed.epoch as number;
  }
  async function readHead(base: string): Promise<Head | null> {
    const raw = await deps.secure.getItem(base + '.head');
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) throw unavailable();
    // Undefined epoch supports a pre-release v1 pointer as generation zero.
    const generation = parsed.epoch ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) throw unavailable();
    if (parsed.state === 'deleted') return { version: 1, state: 'deleted', epoch: generation };
    if (parsed.state !== 'active' || !['a', 'b'].includes(parsed.slot) || !validCount(parsed.count)
      || !Number.isSafeInteger(parsed.length) || parsed.length < 0 || parsed.length > MAX_CHUNKS * CHUNK_UNITS
      || parsed.count !== Math.ceil(parsed.length / CHUNK_UNITS)) throw unavailable();
    return { ...parsed, epoch: generation } as Head;
  }
  async function slotCount(base: string, slot: Slot): Promise<number> {
    const raw = await deps.secure.getItem(metaKey(base, slot));
    if (raw === null) return 0;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !validCount(parsed.count)) throw unavailable();
    return parsed.count;
  }
  async function readActive(base: string, head: Extract<Head, { state: 'active' }>) {
    if (await slotCount(base, head.slot) !== head.count) throw unavailable();
    const chunks: string[] = [];
    for (let i = 0; i < head.count; i++) {
      const raw = await deps.secure.getItem(slotKey(base, head.slot, i));
      if (raw === null) throw unavailable();
      const chunk = JSON.parse(raw);
      if (typeof chunk !== 'string' || chunk.length !== Math.min(CHUNK_UNITS, head.length - i * CHUNK_UNITS)) throw unavailable();
      chunks.push(chunk);
    }
    const value = chunks.join('');
    if (value.length !== head.length) throw unavailable();
    return value;
  }
  async function cleanupSlot(base: string, slot: Slot) {
    const count = await slotCount(base, slot);
    for (let i = 0; i < count; i++) await verifiedDelete(slotKey(base, slot, i));
    await verifiedDelete(metaKey(base, slot));
  }
  async function writeValue(key: string, value: string) {
    const base = ownedKey(key);
    if (typeof value !== 'string' || value.length > MAX_CHUNKS * CHUNK_UNITS) throw unavailable();
    const old = await readHead(base);
    const generation = await epoch();
    const slot: Slot = old?.state === 'active' && old.slot === 'a' ? 'b' : 'a';
    const count = Math.ceil(value.length / CHUNK_UNITS);
    const stagedCount = Math.max(count, await slotCount(base, slot));
    // Record the cleanup extent BEFORE staging, including interrupted writes.
    await verifiedSet(metaKey(base, slot), JSON.stringify({ version: 1, count: stagedCount }));
    for (let i = 0; i < count; i++) {
      await verifiedSet(slotKey(base, slot, i), JSON.stringify(value.slice(i * CHUNK_UNITS, (i + 1) * CHUNK_UNITS)));
    }
    for (let i = count; i < stagedCount; i++) await verifiedDelete(slotKey(base, slot, i));
    await verifiedSet(metaKey(base, slot), JSON.stringify({ version: 1, count }));
    const head: Extract<Head, { state: 'active' }> = { version: 1, state: 'active', epoch: generation, slot, count, length: value.length };
    if (await readActive(base, head) !== value) throw unavailable();
    // Only this small pointer is replaced; the previous active slot survives
    // every staging interruption until all new chunks are verified.
    await verifiedSet(base + '.head', JSON.stringify(head));
    const committed = await readHead(base);
    if (committed?.state !== 'active' || committed.epoch !== generation || committed.slot !== slot || await readActive(base, committed) !== value) throw unavailable();
    await clearLegacy(key); // Exact committed read-back precedes plaintext removal.
    await cleanupSlot(base, slot === 'a' ? 'b' : 'a');
  }
  async function readValue(key: string): Promise<string | null> {
    const base = ownedKey(key);
    const generation = await epoch();
    const head = await readHead(base);
    if (head?.state === 'deleted' || (head && head.epoch !== generation)) {
      await clearLegacy(key);
      return null;
    }
    if (head?.state === 'active') {
      const value = await readActive(base, head);
      await clearLegacy(key);
      return value;
    }
    // Plaintext migration is permanently disabled after namespace revocation.
    if (generation > 0) { await clearLegacy(key); return null; }
    const legacy = await deps.legacy.getItem(key);
    if (legacy === null) return null;
    if (!mayRemoveLegacyAuthValue(namespace, key, legacy)) return null;
    await writeValue(key, legacy);
    return legacy;
  }
  async function removeValue(key: string) {
    const base = ownedKey(key);
    // Persist revocation first. A crash or failed cleanup can never activate
    // the legacy copy on a later read, even after process restart.
    await verifiedSet(base + '.head', JSON.stringify({ version: 1, state: 'deleted', epoch: await epoch() }));
    let failed = false;
    for (const operation of [() => clearLegacy(key), () => cleanupSlot(base, 'a'), () => cleanupSlot(base, 'b')]) {
      try { await operation(); } catch { failed = true; }
    }
    if (failed) throw unavailable();
  }
  return {
    getItem: (key: string) => {
      try { ownedKey(key); } catch { return Promise.reject(unavailable()); }
      return run(() => readValue(key), 'read');
    },
    setItem: (key: string, value: string) => run(() => writeValue(key, value)),
    removeItem: (key: string) => run(() => removeValue(key)),
    clearAll: () => run(async () => {
      await deps.legacy.setItem(fenceKey, 'logout-pending');
      if (await deps.legacy.getItem(fenceKey) !== 'logout-pending') throw unavailable();
      if (!await deps.isAvailable()) throw unavailable();
      let failed = false;
      try {
        for (const key of await deps.legacy.getAllKeys?.() || []) {
          if (isAuthStorageKey(namespace, key)) ownedKey(key);
        }
      } catch { failed = true; }
      // Persistently revoke every old key, including a verifier whose SDK index
      // was never committed. Snapshot indexed keys before advancing the epoch.
      try {
        const index = await readValue(namespace + '-flows-code-verifier');
        if (index !== null) {
          const flows = JSON.parse(index);
          if (!Array.isArray(flows) || flows.length > 100 || flows.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(id))) throw unavailable();
          for (const id of flows) ownedKey(`${namespace}-flow-${id}-code-verifier`);
        }
      } catch { failed = true; }
      const generation = await epoch();
      if (generation >= Number.MAX_SAFE_INTEGER) throw unavailable();
      await verifiedSet(epochKey, JSON.stringify({ version: 1, epoch: generation + 1 }));
      // Snapshot observed keys because each cleanup also registers its key.
      for (const key of [...observed]) {
        try { await removeValue(key); } catch { failed = true; }
      }
      if (failed) throw unavailable();
      await clearOrdinaryKey(fenceKey);
    }, 'cleanup'),
  };
}
