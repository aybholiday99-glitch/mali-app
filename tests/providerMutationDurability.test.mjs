import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
import { fakeSyncScheduler, settle } from './fakeSyncScheduler.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.maliTestPlatform = { OS: 'ios' };
const stored = new Map();
let write = async (key, value) => stored.set(key, value), pushes = [];
globalThis.maliTestStorage = {
  getItem: async key => stored.get(key) ?? null,
  setItem: (...args) => write(...args),
  getAllKeys: async () => [...stored.keys()], removeItem: async key => stored.delete(key),
};
globalThis.maliProviderAuth = {
  clearAuthSession: async () => {}, consumeOAuthRedirectIfPresent: async () => null,
  getPersistedSessionUser: async () => null, savePersistedSessionUser: async () => {}, subscribeToAuthIdentity: () => () => {},
};
let push = async payload => { pushes.push(payload); return { ok: false, success: false, failureKind: 'transient', message: 'offline' }; };
let pull = async () => ({ ok: false, success: false, isEmpty: true });
globalThis.maliProviderSync = { pull: (...args) => pull(...args), push: (...args) => push(...args) };
installNativeTestLoader({ provider: true });
const { MaliProvider, useMali } = await import('../src/context/MaliContext.tsx');
const { financialStorage } = await import('../src/services/financialStorage.ts');
const guest = { id: 'durable-guest', isLocalOnly: true, name: 'A', email: 'a@local.invalid', provider: 'email', createdAt: '2026-10-13' };
const cloud = { ...guest, id: '11111111-1111-4111-8111-111111111111', isLocalOnly: false };
const cash = { name: 'Cash', bankName: 'Cash', category: 'cash_lyd', currency: 'LYD', balance: 100, isCash: true, color: '#fff' };
let api;
function Probe() { api = useMali(); return null; }
async function mount(user = guest) {
  stored.clear(); pushes = []; write = async (key, value) => stored.set(key, value);
  push = async payload => { pushes.push(payload); return { ok: false, success: false, failureKind: 'transient', message: 'offline' }; };
  pull = async () => ({ ok: false, success: false, isEmpty: true });
  const clock = fakeSyncScheduler(); let tree;
  await act(async () => { tree = renderer.create(React.createElement(MaliProvider, { syncScheduler: clock.scheduler }, React.createElement(Probe))); });
  await act(async () => { api.loginUser(user); });
  await act(async () => { assert.equal(await api.addAccount(cash), true); });
  return { tree, clock };
}
const disk = async user => JSON.parse(await financialStorage.getItem('@mali_app_state_v2_' + user.id));
const expense = (amount = 5, key = 'durable-expense') => ({ title: 'Expense', type: 'expense', amount, currency: 'LYD', category: 'test', accountId: api.state.accounts[0].id, paymentMethod: 'cash', idempotencyKey: key });
function holdNextWrite() {
  let release, entered; const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  let once = true; write = async (key, value) => { if (once) { once = false; entered(); await held; } stored.set(key, value); };
  return { release, started };
}

test('financial acknowledgement is a Promise and neither balances nor audit publish before verified guest storage', async () => {
  const { tree } = await mount(), before = api.state, gate = holdNextWrite(); let result;
  await act(async () => { result = api.addTransaction(expense()); await gate.started; });
  assert.equal(typeof result?.then, 'function'); assert.equal(api.state, before); assert.equal(api.mutationStatus.phase, 'saving');
  await act(async () => { gate.release(); assert.equal(await result, true); });
  assert.equal(api.state.accounts[0].balance, 95); assert.equal((await disk(guest)).accounts[0].balance, 95);
  assert.deepEqual((await disk(guest)).financialAudit, api.state.financialAudit);
  await act(async () => { tree.unmount(); });
});

test('guest failed storage keeps accepted RAM unchanged and retry writes the same candidate without repeating IDs or audit', async () => {
  const { tree } = await mount(), before = api.state; let attempted;
  write = async (_key, value) => { if (value.includes('durable-expense')) attempted = JSON.parse(value); throw new Error('unavailable'); };
  await act(async () => { assert.equal(await api.addTransaction(expense()), false); });
  assert.equal(api.state, before); assert.equal((await disk(guest)).accounts[0].balance, 100); assert.equal(api.mutationStatus.phase, 'storage-error');
  assert.equal(attempted.localRevision, before.localRevision + 1);
  const originalCandidate = attempted;
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.retryPendingMutation(), true); });
  assert.deepEqual((await disk(guest)).transactions, originalCandidate.transactions);
  assert.deepEqual((await disk(guest)).financialAudit, originalCandidate.financialAudit);
  assert.equal(api.state.localRevision, originalCandidate.localRevision); assert.equal(api.state.accounts[0].balance, 95);
  await act(async () => { tree.unmount(); });
});

test('cloud no-op storage acknowledgement publishes nothing, makes no network request, and matching submission retries exact outbox', async () => {
  const { tree, clock } = await mount(cloud), before = api.state, input = expense(); write = async () => {};
  await act(async () => { assert.equal(await api.addTransaction(input), false); await clock.advance(120000); });
  assert.equal(api.state, before); assert.equal(pushes.length, 0); assert.equal((await disk(cloud)).accounts[0].balance, 100);
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.addTransaction(input), true); });
  const saved = await disk(cloud); assert.equal(saved.accounts[0].balance, 95); assert.equal(saved.cloudOutbox.pending.payload.accounts[0].balance, 95);
  assert.equal(saved.localRevision, saved.cloudOutbox.pending.revision); assert.deepEqual(saved.financialAudit, saved.cloudOutbox.pending.payload.financialAudit);
  await act(async () => { tree.unmount(); });
});

test('concurrent financial requests compute serially from the last durable commit', async () => {
  const { tree } = await mount(), gate = holdNextWrite(); let first, second;
  await act(async () => { first = api.addTransaction(expense(60, 'first')); second = api.addTransaction(expense(60, 'second')); await gate.started; });
  assert.equal(api.state.accounts[0].balance, 100);
  await act(async () => { gate.release(); assert.equal(await first, true); assert.equal(await second, false); });
  assert.equal(api.state.accounts[0].balance, 40); assert.equal(api.state.transactions.length, 1); assert.equal((await disk(guest)).accounts[0].balance, 40);
  await act(async () => { tree.unmount(); });
});

test('session switch during storage cannot acknowledge or publish the old owner candidate', async () => {
  const { tree } = await mount(), gate = holdNextWrite(); let result;
  await act(async () => { result = api.addTransaction(expense()); await gate.started; });
  await act(async () => { await api.logoutUser(); api.loginUser({ ...guest, id: 'durable-other' }); gate.release(); assert.equal(await result, false); await settle(); });
  assert.equal(api.currentUser.id, 'durable-other'); assert.equal(api.state.accounts.length, 0); assert.equal(api.mutationStatus.phase, 'idle');
  await act(async () => { tree.unmount(); });
});

test('a failed candidate blocks a different request and config change until explicit retry', async () => {
  const { tree } = await mount(), before = api.state; write = async () => { throw new Error('unavailable'); };
  await act(async () => { assert.equal(await api.addTransaction(expense()), false); });
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.addTransaction(expense(1, 'different')), false); assert.equal(await api.updateSupabaseConfig({ url: 'https://other.example.invalid' }), false); });
  assert.equal(api.state, before);
  await act(async () => { assert.equal(await api.retryPendingMutation(), true); });
  assert.equal(api.state.transactions.length, 1); assert.equal(api.state.transactions[0].idempotencyKey, 'durable-expense');
  await act(async () => { tree.unmount(); });
});

test('an older in-flight ACK merges only metadata while a newer candidate is being verified', async () => {
  let acknowledge;
  const { tree, clock } = await mount(cloud);
  push = async payload => { pushes.push(payload); return new Promise(resolve => { acknowledge = resolve; }); };
  await act(async () => { await clock.advance(0); }); assert.equal(pushes.length, 1);
  const gate = holdNextWrite(); let result;
  await act(async () => { result = api.addTransaction(expense()); await gate.started; });
  const timestamp = '2026-10-13T00:01:00.123456+00:00';
  await act(async () => { acknowledge({ ok: true, success: true, updatedAt: timestamp, message: 'saved' }); await settle(); });
  assert.equal(api.state.accounts[0].balance, 100);
  await act(async () => { gate.release(); assert.equal(await result, true); await settle(); });
  const saved = await disk(cloud);
  assert.equal(api.state.accounts[0].balance, 95); assert.equal(api.state.transactions.length, 1); assert.equal(api.state.pendingCloudSync, true);
  assert.equal(saved.accounts[0].balance, 95); assert.equal(saved.cloudOutbox.pending.payload.accounts[0].balance, 95);
  assert.equal(saved.localRevision, saved.cloudOutbox.pending.revision); assert.equal(saved.cloudOutbox.syncedAt, timestamp);
  assert.equal(api.state.supabaseConfig.lastSyncedAt, timestamp); assert.notEqual(api.cloudSyncStatus.phase, 'storage-error');
  await act(async () => { tree.unmount(); });
});

test('unkeyed contact creation retries the original generated contact and returns its durable identity', async () => {
  const { tree } = await mount(), before = api.state; let original;
  write = async (_key, value) => { if (value.includes('Pending contact')) original = JSON.parse(value); throw new Error('unavailable'); };
  const input = { name: 'Pending contact', phone: '0910000000', role: 'شريك تجاري' };
  await act(async () => { assert.equal(await api.addContact(input), null); });
  assert.equal(api.state, before); assert.equal(api.state.contacts.length, 0);
  write = async (key, value) => stored.set(key, value); let contact;
  await act(async () => { contact = await api.addContact(input); });
  assert.equal(contact.id, original.contacts[0].id); assert.deepEqual((await disk(guest)).contacts, original.contacts);
  assert.deepEqual((await disk(guest)).financialAudit, original.financialAudit);
  assert.equal(api.state.localRevision, original.localRevision);
  await act(async () => { tree.unmount(); });
});

test('no-op mutation does not write, append audit evidence, advance revision, or leave the mutation queue locked', async () => {
  const { tree } = await mount(), before = api.state; let writes = 0;
  write = async () => { writes++; throw new Error('no-op must not write'); };
  await act(async () => { assert.equal(await api.updateAccountBalance(before.accounts[0].id, 100), false); });
  assert.equal(api.state, before); assert.equal(writes, 0); assert.equal(api.mutationStatus.phase, 'idle');
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.addTransaction(expense()), true); });
  assert.equal(api.state.localRevision, before.localRevision + 1);
  await act(async () => { tree.unmount(); });
});

test('delayed cloud pull cannot replace accepted state while a local candidate is still awaiting storage', async () => {
  const { tree } = await mount(); const before = api.state; let releasePull, pulled;
  pull = async () => new Promise(resolve => { releasePull = resolve; });
  await act(async () => { pulled = api.pullFromCloud(); await settle(); });
  const gate = holdNextWrite(); let saved;
  await act(async () => { saved = api.addTransaction(expense()); await gate.started; });
  await act(async () => { releasePull({ ok: true, success: true, state: { ...before, accounts: [] }, updatedAt: '2026-10-13T01:00:00Z' });
    assert.equal((await pulled).conflictDetected, true); });
  assert.equal(api.state, before);
  await act(async () => { gate.release(); assert.equal(await saved, true); });
  assert.equal(api.state.accounts[0].balance, 95); assert.equal((await disk(guest)).accounts[0].balance, 95);
  await act(async () => { tree.unmount(); });
});

test('successful cloud replacement and its CAS baseline publish together only after verified storage', async () => {
  const { tree } = await mount(cloud), before = api.state;
  // Seed a clean accepted acknowledgement without contacting any real service.
  push = async () => ({ ok: true, success: true, updatedAt: '2026-10-13T00:01:00Z', message: 'saved' });
  await act(async () => { assert.equal((await api.syncToCloud()).ok, true); });
  const clean = api.state, timestamp = '2026-10-13T02:00:00Z';
  const { appendFinancialAudit } = await import('../src/services/financialAudit.ts');
  const remote = appendFinancialAudit(clean, { ...clean, accounts: clean.accounts.map(row => ({ ...row, balance: 80 })) }, { ownerId: cloud.id, action: 'balance_correction', reason: 'isolated remote correction' });
  pull = async () => ({ ok: true, success: true, state: remote, updatedAt: timestamp, snapshotUpdatedAt: timestamp, message: 'loaded' });
  const gate = holdNextWrite(); let result;
  await act(async () => { result = api.pullFromCloud(); await gate.started; });
  assert.equal(api.state.accounts[0].balance, before.accounts[0].balance);
  await act(async () => { gate.release(); assert.equal((await result).ok, true); });
  const saved = await disk(cloud); assert.equal(api.state.accounts[0].balance, 80); assert.equal(saved.accounts[0].balance, 80);
  assert.equal(saved.supabaseConfig.lastSyncedAt, timestamp); assert.equal(saved.cloudOutbox.syncedAt, timestamp);
  await act(async () => { tree.unmount(); });
});
