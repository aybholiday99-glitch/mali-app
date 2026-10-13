import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
import { fakeSyncScheduler, settle } from './fakeSyncScheduler.mjs';
import { appendFinancialAudit } from '../src/services/financialAudit.ts';
import { recordExpenseOrIncomeMutation } from '../src/services/financialEngine.ts';
import { syncConfigIdentity } from '../src/services/syncOutboxValidation.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.maliTestPlatform = { OS: 'android' };
const stored = new Map();
let write, read, pull, pushes, pulls, identity;
globalThis.maliTestStorage = {
  getItem: key => read(key), setItem: (...args) => write(...args),
  getAllKeys: async () => [...stored.keys()], removeItem: async key => stored.delete(key),
};
globalThis.maliProviderAuth = {
  clearAuthSession: async () => {}, consumeOAuthRedirectIfPresent: async () => null,
  getPersistedSessionUser: async () => null, savePersistedSessionUser: async () => {},
  subscribeToAuthIdentity: callback => { identity = callback; return () => {}; },
};
globalThis.maliProviderSync = {
  pull: (...args) => { pulls.push(args); return pull(...args); },
  push: async (...args) => { pushes.push(args); return { ok: false, success: false, conflictDetected: true, updatedAt: FRESH, cloudState: server, message: 'conflict' }; },
};
installNativeTestLoader({ provider: true });
const { INITIAL_MALI_STATE } = await import('../src/data/initialData.ts');
const { MaliProvider, useMali } = await import('../src/context/MaliContext.tsx');
const { financialStorage } = await import('../src/services/financialStorage.ts');
const { createChunkedFinancialStorage } = await import('../src/services/chunkedFinancialStorage.ts');
const OWNER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const DATE = '2026-10-12T00:00:00.000Z', OLD = '2026-10-13T00:01:00.123456+00:00', FRESH = '2026-10-13T00:02:00.654321+00:00';
const user = { id: OWNER, isLocalOnly: false, name: 'Synthetic', email: 'synthetic@example.invalid', provider: 'email', createdAt: DATE };
const KEY = '@mali_app_state_v2_' + OWNER, HEAD = '@mali_financial_chunks_v1:' + encodeURIComponent(KEY) + ':head';
const config = { ...INITIAL_MALI_STATE.supabaseConfig, workspaceKey: 'mali-vault-' + OWNER, autoSync: false, lastSyncedAt: OLD };
const copy = value => JSON.parse(JSON.stringify(value));
function base() { return { accounts: [{ id: 'cash', name: 'Cash', bankName: 'Cash', category: 'cash_lyd', currency: 'LYD', balance: 100, isCash: true, color: '#000', updatedAt: DATE }], contacts: [], transactions: [], deals: [], debts: [], procedures: [], budgets: [], marketRates: { cashUsdToLyd: 6.2, chequeUsdToLyd: 6.3, defaultChequeDiscountPercent: 0, updatedAt: DATE }, supabaseConfig: config, lastModifiedAt: DATE, localRevision: 0 }; }
function spend(state, id, amount) { return copy(appendFinancialAudit(state, recordExpenseOrIncomeMutation(state, { id, idempotencyKey: id, title: id, type: 'expense', amount, currency: 'LYD', category: 'test', accountId: 'cash', paymentMethod: 'cash', date: DATE }), { ownerId: OWNER, action: 'financial_update', reason: 'Synthetic expense', operationId: id })); }
let api, server, source, original;
function Probe() { api = useMali(); return null; }
async function newTree(clock) {
  let tree; await act(async () => { tree = renderer.create(React.createElement(MaliProvider, { syncScheduler: clock.scheduler }, React.createElement(Probe))); });
  await act(async () => { api.loginUser(user); await settle(); });
  return tree;
}
async function mount() {
  stored.clear(); pushes = []; pulls = [];
  write = async (key, value) => stored.set(key, value); read = async key => stored.get(key) ?? null;
  const initial = base(), attempted = { ...spend(initial, 'attempted', 10), localRevision: 1, pendingCloudSync: true };
  source = { ...spend(attempted, 'latest', 5), localRevision: 2, pendingCloudSync: true };
  server = { ...spend(initial, 'cloud', 20), localRevision: 0 };
  const outbox = { version: 1, ownerId: OWNER, configId: syncConfigIdentity(config), pending: { revision: 2, payload: source }, attempts: 1, nextAttemptAt: 1, syncedAt: OLD, acknowledgedRevision: 0,
    stop: { reason: 'conflict', result: { ok: false, success: false, conflictDetected: true, message: 'conflict', updatedAt: FRESH, cloudState: server }, attempted: { revision: 1, payload: attempted } } };
  await financialStorage.setItem(KEY, JSON.stringify({ ...source, cloudOutbox: outbox }));
  original = await financialStorage.getItem(KEY);
  pull = async () => ({ ok: true, success: true, identityVerified: true, snapshotUpdatedAt: FRESH, updatedAt: FRESH, state: server, message: 'fresh' });
  const clock = fakeSyncScheduler(); let tree;
  await act(async () => { tree = renderer.create(React.createElement(MaliProvider, { syncScheduler: clock.scheduler }, React.createElement(Probe))); });
  await act(async () => { api.loginUser(user); await settle(); });
  assert.equal(api.cloudSyncStatus.outbox?.stop?.reason, 'conflict'); assert.equal(api.state.accounts[0].balance, 85);
  original = await financialStorage.getItem(KEY); pulls = []; return { tree, clock };
}
async function disk() { return JSON.parse(await financialStorage.getItem(KEY)); }
async function archives() {
  const reader = createChunkedFinancialStorage(globalThis.maliTestStorage);
  const heads = [...stored.keys()].filter(key => key.includes('_recovery_') && key.endsWith(':head'));
  return Promise.all(heads.map(async key => JSON.parse(await reader.getItem(decodeURIComponent(key.slice('@mali_financial_chunks_v1:'.length, -':head'.length))))));
}
const close = async tree => act(async () => tree.unmount());

test('offline inspection freezes all retained versions without exposing config or making a cloud call', async () => {
  const { tree } = await mount(), review = api.inspectCloudConflict();
  assert.equal(review.local.accounts[0].balance, 85); assert.equal(review.attempted.accounts[0].balance, 90); assert.equal(review.cloud.accounts[0].balance, 80);
  assert.equal(pulls.length, 0); assert.ok(Object.isFrozen(review.local.accounts[0])); assert.equal(review.local.supabaseConfig, undefined);
  assert.ok(!JSON.stringify({ ...review, token: undefined }).includes(config.anonKey));
  await close(tree);
});

test('keep-local commits candidate/outbox together after full archive, preserves latest rows, then normal CAS can stop again', async () => {
  const { tree, clock } = await mount(), review = api.inspectCloudConflict(); let result;
  await act(async () => { result = await api.resolveCloudConflict(review.token, 'keep-local', 'Keep both local changes'); });
  assert.equal(result.ok, true); assert.equal(api.state.accounts[0].balance, 85); assert.equal(api.state.localRevision, 3);
  const saved = await disk(); assert.deepEqual(saved.cloudOutbox.pending.payload.transactions, source.transactions); assert.equal(saved.cloudOutbox.stop, undefined);
  assert.deepEqual(api.state.financialAudit.slice(0, server.financialAudit.length), server.financialAudit);
  assert.equal(api.state.financialAudit.at(-1).action, 'conflict_resolution_keep_local'); assert.equal(pushes.length, 0);
  const evidence = (await archives())[0]; assert.equal(evidence.incoming, JSON.stringify(saved));
  assert.ok(evidence.originals.some(row => row.key === HEAD));
  const versions = JSON.parse(evidence.sourceEvidence); assert.equal(versions.attempted.state.accounts[0].balance, 90);
  assert.equal(versions.latestLocal.accounts[0].balance, 85); assert.equal(versions.originalCloud.accounts[0].balance, 80);
  assert.ok(!evidence.sourceEvidence.includes(config.anonKey));
  await act(async () => { await api.syncToCloud(); await clock.advance(120000); });
  assert.equal(pushes.length, 1); assert.equal(pushes[0][0].supabaseConfig.lastSyncedAt, FRESH);
  assert.equal(api.cloudSyncStatus.outbox.stop.reason, 'conflict'); assert.equal(api.state.accounts[0].balance, 85);
  await close(tree);
});

test('adopt-cloud commits exactly its finances and journal, retains local config, and never sends a cloud write', async () => {
  const { tree, clock } = await mount(), review = api.inspectCloudConflict();
  await act(async () => { assert.equal((await api.resolveCloudConflict(review.token, 'adopt-cloud', 'Verified cloud is correct')).ok, true); await clock.advance(120000); });
  assert.deepEqual(api.state.transactions, server.transactions); assert.deepEqual(api.state.marketRates, server.marketRates); assert.deepEqual(api.state.financialAudit, server.financialAudit);
  assert.equal(api.state.supabaseConfig.anonKey, config.anonKey); assert.equal(api.state.pendingCloudSync, false); assert.equal(pushes.length, 0);
  assert.equal((await disk()).cloudOutbox.pending, null); assert.equal((await disk()).cloudOutbox.acknowledgedRevision, 3);
  assert.equal(JSON.parse((await archives())[0].sourceEvidence).latestLocal.accounts[0].balance, 85);
  await close(tree);
});

test('changed cloud CAS requires a new explicit choice without saving or unblocking the original conflict', async () => {
  const { tree } = await mount(), review = api.inspectCloudConflict(), later = '2026-10-13T00:03:00.000001+00:00';
  pull = async () => ({ ok: true, success: true, identityVerified: true, snapshotUpdatedAt: later, state: server, message: 'changed' });
  let result; await act(async () => { result = await api.resolveCloudConflict(review.token, 'adopt-cloud', 'Choose cloud'); });
  assert.equal(result.ok, false); assert.equal(result.review.token.cloudTimestamp, later);
  assert.equal(await financialStorage.getItem(KEY), original); assert.equal((await archives()).length, 0); assert.equal(pushes.length, 0);
  await act(async () => { assert.equal((await api.resolveCloudConflict(result.review.token, 'adopt-cloud', 'Review completed again')).ok, true); });
  assert.equal(api.state.accounts[0].balance, 80); await close(tree);
});

for (const fault of ['archive-quota', 'head-failure', 'head-noop', 'unknown-head-ack']) test(fault + ' retains blocked RAM, stops writes, and preserves cold originals before any uncertain replacement', async () => {
  const { tree, clock } = await mount(), before = api.state, review = api.inspectCloudConflict();
  const realWrite = write, realRead = read; let uncertain = false;
  read = async key => { if (uncertain && key === HEAD) throw new Error('read unavailable'); return realRead(key); };
  write = async (key, value) => {
    if (fault === 'archive-quota' && key.includes('_recovery_')) throw new Error('quota');
    if (key === HEAD) {
      if (fault === 'head-failure') throw new Error('head failure');
      if (fault === 'head-noop') return;
      if (fault === 'unknown-head-ack') { await realWrite(key, value); uncertain = true; throw new Error('unknown acknowledgement'); }
    }
    await realWrite(key, value);
  };
  await act(async () => { assert.equal((await api.resolveCloudConflict(review.token, 'keep-local', 'Review decision')).ok, false); await clock.advance(120000); });
  assert.equal(api.state, before); assert.equal(api.cloudSyncStatus.outbox.stop.reason, 'conflict'); assert.equal(pushes.length, 0);
  await act(async () => { assert.equal(await api.updateAccountBalance('cash', 25), false); assert.equal((await api.syncToCloud()).ok, false); });
  write = realWrite; read = realRead;
  if (fault !== 'archive-quota') {
    const evidence = (await archives())[0]; assert.ok(evidence.originals.some(row => row.key === HEAD));
    assert.equal(JSON.parse(evidence.incoming).accounts[0].balance, 85);
  }
  if (fault === 'unknown-head-ack') {
    assert.equal((await disk()).cloudOutbox.stop, undefined); await close(tree);
    const reload = await newTree(clock); assert.equal(api.state.localRevision, 3); assert.equal(api.state.financialAudit.at(-1).action, 'conflict_resolution_keep_local'); await close(reload);
  } else { assert.equal(await financialStorage.getItem(KEY), original); await close(tree); }
});

test('logout during held fresh pull aborts it and ignores late success, including A to logout to A', async () => {
  const { tree } = await mount(), review = api.inspectCloudConflict(); let release, signal;
  pull = async (_config, _user, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); };
  let result; await act(async () => { result = api.resolveCloudConflict(review.token, 'adopt-cloud', 'Choose'); await settle(); });
  await act(async () => { await api.logoutUser(); api.loginUser(user); await settle(); });
  assert.equal(signal.aborted, true);
  await act(async () => { release({ ok: true, success: true, identityVerified: true, snapshotUpdatedAt: FRESH, state: server }); assert.equal((await result).ok, false); });
  assert.equal((await archives()).length, 0); assert.equal(await financialStorage.getItem(KEY), original); await close(tree);
});

test('session expiry during verified archive cancels head publication and does not touch the other owner', async () => {
  const { tree } = await mount(), review = api.inspectCloudConflict(), realWrite = write; let release, entered;
  const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; }); let once = true;
  write = async (key, value) => { if (once && key.includes('_recovery_')) { once = false; entered(); await held; } await realWrite(key, value); };
  let result; await act(async () => { result = api.resolveCloudConflict(review.token, 'keep-local', 'Choose'); await started; });
  pull = async () => ({ ok: false, success: false, isEmpty: true, identityVerified: true, message: 'Other empty owner' });
  await act(async () => { identity(null); api.loginUser({ ...user, id: OTHER }); release(); assert.equal((await result).ok, false); await settle(); });
  assert.equal(api.currentUser.id, OTHER); assert.equal(api.state.accounts.length, 0); assert.equal(await financialStorage.getItem(KEY), original);
  assert.equal(pushes.length, 0); await close(tree);
});

for (const operation of ['conflict', 'backup']) test(operation + ' cancels after archive verification while candidate chunks are still writing', async () => {
  const { tree } = await mount(), review = api.inspectCloudConflict(), realWrite = write;
  let release, entered; const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  let once = true;
  write = async (key, value) => {
    if (once && key.startsWith(HEAD.slice(0, -4)) && /:[01]:\d+$/.test(key)) { once = false; entered(); await held; }
    await realWrite(key, value);
  };
  const imported = copy(source); delete imported.financialAudit; imported.accounts[0].balance = 120;
  let result;
  await act(async () => { result = operation === 'conflict' ? api.resolveCloudConflict(review.token, 'adopt-cloud', 'Reviewed cloud') : api.importStateJson(JSON.stringify(imported)); await started; });
  assert.ok((await archives()).length > 0, 'all prior evidence precedes candidate chunks');
  await act(async () => { identity(null); release(); const outcome = await result; assert.equal(operation === 'conflict' ? outcome.ok : outcome, false); await settle(); });
  assert.equal(api.currentUser, null); assert.equal(await financialStorage.getItem(KEY), original); assert.equal(pushes.length, 0);
  await close(tree);
});

test('stale review after local edit and simultaneous review/config/restore submissions are rejected', async () => {
  const { tree } = await mount(), stale = api.inspectCloudConflict();
  await act(async () => { assert.equal(await api.updateAccountBalance('cash', 86), true); });
  await act(async () => { assert.equal((await api.resolveCloudConflict(stale.token, 'keep-local', 'Stale')).ok, false); }); assert.equal(pulls.length, 0);
  const review = api.inspectCloudConflict(); let release;
  pull = async () => new Promise(resolve => { release = resolve; }); let result;
  await act(async () => { result = api.resolveCloudConflict(review.token, 'keep-local', 'First'); await settle(); });
  await act(async () => {
    assert.equal((await api.resolveCloudConflict(review.token, 'adopt-cloud', 'Second')).ok, false);
    assert.equal(await api.updateSupabaseConfig({ autoSync: true }), false);
    assert.equal(await api.importStateJson(JSON.stringify(source)), false);
    assert.equal(await api.updateAccountBalance('cash', 50), false);
    assert.equal((await api.pullFromCloud()).ok, false);
  });
  await act(async () => { release({ ok: true, success: true, identityVerified: true, snapshotUpdatedAt: FRESH, state: server }); assert.equal((await result).ok, true); });
  assert.equal(api.state.accounts[0].balance, 86); await close(tree);
});

test('backup restore commits new pending payload atomically while preserving the original CAS stop', async () => {
  const { tree, clock } = await mount(); const imported = copy(source); delete imported.financialAudit; imported.accounts[0].balance = 120;
  await act(async () => { assert.equal(await api.importStateJson(JSON.stringify(imported)), true); await clock.advance(120000); });
  const saved = await disk(); assert.equal(saved.accounts[0].balance, 120); assert.equal(saved.cloudOutbox.pending.payload.accounts[0].balance, 120);
  assert.equal(saved.cloudOutbox.pending.revision, saved.localRevision); assert.equal(saved.cloudOutbox.stop.reason, 'conflict'); assert.equal(pushes.length, 0);
  assert.equal(saved.cloudOutbox.stop.attempted.payload.accounts[0].balance, 90);
  await close(tree);
});

test('backup uncertain head acknowledgement never publishes success or lets old RAM overwrite a restored candidate', async () => {
  const { tree, clock } = await mount(), before = api.state, realWrite = write, realRead = read; let uncertain = false;
  const imported = copy(source); delete imported.financialAudit; imported.accounts[0].balance = 120;
  write = async (key, value) => { await realWrite(key, value); if (key === HEAD) { uncertain = true; throw new Error('unknown head acknowledgement'); } };
  read = async key => { if (uncertain && key === HEAD) throw new Error('read unavailable'); return realRead(key); };
  await act(async () => { assert.equal(await api.importStateJson(JSON.stringify(imported)), false); await clock.advance(120000); });
  assert.equal(api.state, before); write = realWrite; read = realRead;
  await act(async () => { assert.equal(await api.updateAccountBalance('cash', 40), false); assert.equal((await api.syncToCloud()).ok, false); });
  assert.equal((await disk()).accounts[0].balance, 120); assert.equal((await disk()).cloudOutbox.pending.payload.accounts[0].balance, 120); assert.equal(pushes.length, 0);
  await close(tree);
});

test('independent: ordinary pull cannot overwrite uncertain import from clean cloud state', async () => {
  const {tree}=await mount();
  await act(async()=>{assert.equal((await api.resolveCloudConflict(api.inspectCloudConflict().token,'adopt-cloud','Prepare clean state')).ok,true);});
  assert.equal(api.state.pendingCloudSync,false);
  const realWrite=write,realRead=read;
  const imported=copy(api.state);delete imported.financialAudit; imported.accounts[0].balance=120;
  let uncertain=false;
  write=async(key,value)=>{await realWrite(key,value);if(key===HEAD){uncertain=true;throw new Error('unknown acknowledgement');}};
  read=async key=>{if(uncertain && key===HEAD)throw new Error('unavailable read'); return realRead(key);};
  await act(async()=>{assert.equal(await api.importStateJson(JSON.stringify(imported)),false);});
  write=realWrite;read=realRead;
  assert.equal((await disk()).accounts[0].balance,120);
  assert.equal(api.state.accounts[0].balance,80);
  let result;await act(async()=>{result=await api.pullFromCloud();});
  const after=await disk();
  await close(tree);
  assert.equal(result.ok,false,'ordinary pull must refuse while recovery required');
  assert.equal(after.accounts[0].balance,120,'unknown restored commit must remain untouched');
});


test('independent: an already-running pull refuses after import commit acknowledgement becomes unknown',async()=>{
  const {tree}=await mount();
  await act(async()=>{assert.equal((await api.resolveCloudConflict(api.inspectCloudConflict().token,'adopt-cloud','Prepare clean state')).ok,true);});
  let release,entered; const started=new Promise(r=>entered=r);
  pull=async()=>{entered();return new Promise(r=>release=r);};
  let pendingPull;await act(async()=>{pendingPull=api.pullFromCloud();await started;});
  const realWrite=write,realRead=read,imported=copy(api.state);delete imported.financialAudit;imported.accounts[0].balance=120;
  let uncertain=false;write=async(key,value)=>{await realWrite(key,value);if(key===HEAD){uncertain=true;throw new Error('unknown acknowledgement');}};
  read=async key=>{if(uncertain&&key===HEAD)throw new Error('unavailable read');return realRead(key);};
  await act(async()=>{assert.equal(await api.importStateJson(JSON.stringify(imported)),false);});
  write=realWrite;read=realRead;assert.equal((await disk()).accounts[0].balance,120);
  let result;await act(async()=>{release({ok:true,success:true,identityVerified:true,snapshotUpdatedAt:FRESH,updatedAt:FRESH,state:server,message:'late read'});result=await pendingPull;});
  const after=await disk();
  await close(tree);
  assert.equal(result.ok,false);assert.equal(after.accounts[0].balance,120);
});

test('independent: an old pull cannot queue a stale save behind an active backup recovery',async()=>{
  const {tree}=await mount();
  await act(async()=>{assert.equal((await api.resolveCloudConflict(api.inspectCloudConflict().token,'adopt-cloud','Prepare clean state')).ok,true);});
  let releasePull,enteredPull; const pullStarted=new Promise(r=>enteredPull=r);
  pull=async()=>{enteredPull();return new Promise(r=>releasePull=r);};
  let pendingPull;await act(async()=>{pendingPull=api.pullFromCloud();await pullStarted;});
  const realWrite=write,imported=copy(api.state);delete imported.financialAudit;imported.accounts[0].balance=120;
  let releaseArchive,enteredArchive,once=true;const archiveStarted=new Promise(r=>enteredArchive=r),held=new Promise(r=>releaseArchive=r);
  write=async(key,value)=>{if(once&&key.includes('_recovery_')){once=false;enteredArchive();await held;}await realWrite(key,value);};
  let pendingImport;await act(async()=>{pendingImport=api.importStateJson(JSON.stringify(imported));await archiveStarted;});
  await act(async()=>{releasePull({ok:true,success:true,identityVerified:true,snapshotUpdatedAt:FRESH,updatedAt:FRESH,state:server,message:'late read'});await settle();});
  await act(async()=>{assert.equal(await api.importStateJson(JSON.stringify(imported)),false,'refused old pull must not release the active import lock');});
  let importResult,pullResult;await act(async()=>{releaseArchive();importResult=await pendingImport;pullResult=await pendingPull;});
  write=realWrite;const after=await disk();
  assert.equal(api.state.accounts[0].balance,120);
  await close(tree);
  assert.equal(importResult,true);assert.equal(pullResult.ok,false);assert.equal(after.accounts[0].balance,120);
});
