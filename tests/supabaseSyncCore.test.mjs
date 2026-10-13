import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseSyncService } from '../src/services/supabaseSyncCore.ts';
import { validateAndSanitizeBackupPayload } from '../src/services/financialEngine.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const BASELINE = '2026-10-12T10:00:00.123456+00:00';
const SAVED = '2026-10-12T10:01:00.654321+00:00';
const user = { id: USER_ID, name: 'A', email: 'a@example.invalid', provider: 'email', createdAt: BASELINE };
function baseState() {
  return {
    accounts: [], contacts: [], transactions: [], deals: [], debts: [], procedures: [], budgets: [],
    marketRates: { cashUsdToLyd: 6.22, chequeUsdToLyd: 6.38, defaultChequeDiscountPercent: 2.5, updatedAt: BASELINE },
    supabaseConfig: { url: 'https://example.invalid', anonKey: 'publishable-test', workspaceKey: `mali-vault-${USER_ID}`, autoSync: false, lastSyncedAt: BASELINE },
    lastModifiedAt: BASELINE,
  };
}
function account() {
  return { id: 'acc-1', name: 'Cash', bankName: 'Cash', category: 'cash_lyd', currency: 'LYD', balance: 100, isCash: true, color: '#000000', updatedAt: BASELINE };
}
function snapshot(payload = baseState()) {
  const { supabaseConfig, ...safe } = payload;
  return { user_id: USER_ID, workspace_key: `mali-vault-${USER_ID}`, updated_at: BASELINE, payload: { ...safe, ownerId: USER_ID } };
}
function fixture(options = {}) {
  const queries = [], calls = [];
  let authCalls = 0;
  const client = {
    auth: {
      async getUser() {
        const id = (options.authUsers || [USER_ID])[Math.min(authCalls++, (options.authUsers || [USER_ID]).length - 1)];
        return { data: { user: id ? { id } : null }, error: options.authError || null };
      },
    },
    from(table) {
      const q = { table, filters: [],
        select() { return this; }, eq(key, value) { this.filters.push([key, value]); return this; },
        order() { return this; }, limit() { return this; },
        then(resolve, reject) {
          queries.push({ table: this.table, filters: this.filters });
          const result = options.responses?.[table] || { data: [], error: null };
          return Promise.resolve(structuredClone(result)).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return structuredClone(options.rpcResult || { data: { ok: true, updatedAt: SAVED }, error: null });
    },
  };
  const service = createSupabaseSyncService({ getClient: () => client, fallbackState: baseState(), validateBackup: validateAndSanitizeBackupPayload });
  return { service, queries, calls, client };
}

test('all sync transport failures redact raw server/request details while retaining typed failure categories',async()=>{
  const privateText='PRIVATE-JWT-EMAIL-ACCOUNT';
  const push=fixture({rpcResult:{data:null,error:{message:privateText,status:503}}});
  const pushed=await push.service.pushStateToSupabase(baseState(),undefined,user);
  assert.equal(pushed.failureKind,'transient');assert.ok(!pushed.message.includes(privateText));
  const pull=fixture({responses:{mali_vault_snapshots:{data:null,error:{message:privateText,status:401}}}});
  const pulled=await pull.service.pullStateFromSupabase(baseState().supabaseConfig,user);
  assert.equal(pulled.failureKind,'session');assert.ok(!pulled.message.includes(privateText));
  const connected=await pull.service.testSupabaseConnection(baseState().supabaseConfig,user);
  assert.equal(connected.ok,false);assert.ok(!connected.message.includes(privateText));
  pull.client.auth.getUser=async()=>{throw new Error(privateText);};
  assert.ok(!(await pull.service.pullStateFromSupabase(baseState().supabaseConfig,user)).message.includes(privateText));
});
test('cancelled pull does not begin identity verification or query another owner',async()=>{
  const f=fixture(),controller=new AbortController();let identities=0;
  f.client.auth.getUser=async()=>{identities++;return {data:{user:{id:USER_ID}},error:null};};
  controller.abort();const result=await f.service.pullStateFromSupabase(baseState().supabaseConfig,user,{signal:controller.signal});
  assert.equal(result.ok,false);assert.equal(identities,0);assert.equal(f.queries.length,0);
});
test('in-flight cloud snapshot pull is abortable and cannot return its late version',async()=>{
  const f=fixture(),controller=new AbortController();let release,started,seen;
  const pending=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  const query={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},abortSignal(signal){seen=signal;started();return this;},then(...args){return pending.then(...args);}};
  f.client.from=()=>query;
  const reading=f.service.pullStateFromSupabase(baseState().supabaseConfig,user,{signal:controller.signal});await entered;
  controller.abort();const result=await reading;assert.equal(result.ok,false);assert.equal(result.failureKind,'transient');assert.equal(seen,controller.signal);
  release({data:[snapshot()],error:null});await Promise.resolve();assert.equal(result.state,undefined);
});

test('typed write failure categories distinguish transient transport, session, validation and permanent rejection',async()=>{
  for(const [options,kind] of [
    [{authError:{message:'network',name:'AuthRetryableFetchError'}},'transient'],
    [{authError:{message:'invalid token',status:401}},'session'],
    [{rpcResult:{data:null,error:{message:'temporarily unavailable',status:503}}},'transient'],
    [{rpcResult:{data:null,error:{message:'permission denied',code:'42501',status:403}}},'permanent'],
    [{rpcResult:{data:{ok:false},error:null}},'permanent'],
  ]){const f=fixture(options);assert.equal((await f.service.pushStateToSupabase(baseState(),undefined,user)).failureKind,kind);}
  const f=fixture(),invalid=baseState();invalid.accounts=[account(),account()];
  assert.equal((await f.service.pushStateToSupabase(invalid,undefined,user)).failureKind,'validation');assert.equal(f.calls.length,0);
});

test('aborted identity verification releases the write and never issues a later RPC',async()=>{
  const f=fixture(),controller=new AbortController();let release;
  f.client.auth.getUser=()=>new Promise(resolve=>{release=resolve;});
  const pending=f.service.pushStateToSupabase(baseState(),undefined,user,{signal:controller.signal});controller.abort();
  assert.equal((await pending).failureKind,'transient');release({data:{user:{id:USER_ID}},error:null});await Promise.resolve();assert.equal(f.calls.length,0);
});

test('production RPC builder receives cancellation signal and late committed responses cannot be acknowledged',async()=>{
  const f=fixture(),controller=new AbortController();let release,seen;
  f.client.rpc=()=>({abortSignal:signal=>{seen=signal;return new Promise(resolve=>{release=resolve;});}});
  const pending=f.service.pushStateToSupabase(baseState(),undefined,user,{signal:controller.signal});
  for(let n=0;n<15;n++)await Promise.resolve();assert.equal(seen,controller.signal);controller.abort();assert.equal((await pending).ok,false);
  release({data:{ok:true,updatedAt:SAVED},error:null});await Promise.resolve();
});

test('cloud writes reject mismatched server user, missing caller and local guests', async () => {
  for (const [options, caller] of [[{ authUsers: [OTHER_ID] }, user], [{}, null], [{}, { ...user, isLocalOnly: true }]]) {
    const f = fixture(options);
    assert.equal((await f.service.pushStateToSupabase(baseState(), undefined, caller)).ok, false);
    assert.equal(f.calls.length, 0);
  }
});
test('server authentication errors fail closed even if a user object is returned', async () => {
  const f = fixture({ authError: { message: 'offline' } });
  assert.equal((await f.service.pushStateToSupabase(baseState(), undefined, user)).ok, false);
  assert.equal(f.calls.length, 0);
});
test('write uses a single atomic RPC with exact server baseline and no connection data', async () => {
  const f = fixture();
  const state = baseState(); state.accounts.push(account());
  const result = await f.service.pushStateToSupabase(state, undefined, user);
  assert.equal(result.ok, true);
  assert.equal(result.updatedAt, SAVED);
  assert.equal(result.snapshotUpdatedAt, SAVED);
  assert.equal(f.queries.length, 0);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.name, 'mali_sync_vault');
  assert.equal(call.args.p_expected_user_id, USER_ID);
  assert.equal(call.args.p_expected_updated_at, BASELINE);
  assert.equal(call.args.p_payload.ownerId, USER_ID);
  assert.equal('supabaseConfig' in call.args.p_payload, false);
  assert.equal('anonKey' in call.args.p_payload, false);
});
test('new vault sends a null baseline instead of manufacturing a device timestamp', async () => {
  const f = fixture(), state = baseState(); delete state.supabaseConfig.lastSyncedAt;
  assert.equal((await f.service.pushStateToSupabase(state, undefined, user)).ok, true);
  assert.equal(f.calls[0].args.p_expected_updated_at, null);
});
test('forceOverwrite never bypasses or replaces the expected server baseline', async () => {
  const f = fixture({ rpcResult: { data: { ok: false, conflictDetected: true, updatedAt: SAVED, cloudState: snapshot().payload }, error: null } });
  const result = await f.service.pushStateToSupabase(baseState(), undefined, user, { forceOverwrite: true });
  assert.equal(result.ok, false);
  assert.equal(result.conflictDetected, true);
  assert.equal(f.calls[0].args.p_expected_updated_at, BASELINE);
  assert.equal('forceOverwrite' in f.calls[0].args, false);
});
test('RPC failure and malformed acknowledgements are never partial success', async () => {
  for (const rpcResult of [{ data: null, error: { message: 'delete denied' } }, { data: { ok: true }, error: null }, { data: null, error: null }]) {
    const f = fixture({ rpcResult });
    assert.equal((await f.service.pushStateToSupabase(baseState(), undefined, user)).ok, false);
  }
});
test('account change while a write is in flight prevents adopting its acknowledgement', async () => {
  const f = fixture({ authUsers: [USER_ID, OTHER_ID] });
  assert.equal((await f.service.pushStateToSupabase(baseState(), undefined, user)).ok, false);
});
test('duplicate records and invalid baseline fail before any write', async () => {
  const f = fixture(), state = baseState(); state.accounts = [account(), account()];
  assert.equal((await f.service.pushStateToSupabase(state, undefined, user)).ok, false);
  state.accounts = []; state.supabaseConfig.lastSyncedAt = 'garbage';
  assert.equal((await f.service.pushStateToSupabase(state, undefined, user)).ok, false);
  assert.equal(f.calls.length, 0);
});
test('snapshot reads validate owner and preserve exact microsecond CAS token', async () => {
  const f = fixture({ responses: { mali_vault_snapshots: { data: [snapshot()], error: null } } });
  const result = await f.service.pullStateFromSupabase(baseState().supabaseConfig, user);
  assert.equal(result.ok, true);
  assert.equal(result.snapshotUpdatedAt, BASELINE);
  assert.deepEqual(f.queries[0].filters, [['user_id', USER_ID]]);
});
test('corrupt snapshot and cross-user payload fail without initializing a new vault', async () => {
  for (const corrupt of [{ ...snapshot(), payload: null }, { ...snapshot(), user_id: OTHER_ID }, { ...snapshot(), payload: { ...snapshot().payload, ownerId: OTHER_ID } }]) {
    const f = fixture({ responses: { mali_vault_snapshots: { data: [corrupt], error: null } } });
    const result = await f.service.pullStateFromSupabase(baseState().supabaseConfig, user);
    assert.equal(result.ok, false);
    assert.notEqual(result.isEmpty, true);
    assert.equal(f.calls.length, 0);
  }
});
test('each relational read failure remains an error, never an empty vault', async () => {
  for (const table of ['mali_accounts', 'mali_contacts', 'mali_usd_deals', 'mali_transactions', 'mali_debts']) {
    const f = fixture({ responses: { [table]: { data: null, error: { message: 'transient read failure' } } } });
    const result = await f.service.pullStateFromSupabase(baseState().supabaseConfig, user);
    assert.equal(result.ok, false);
    assert.notEqual(result.isEmpty, true);
  }
});
test('empty is reported only after all six reads and final identity check succeed', async () => {
  const f = fixture();
  const result = await f.service.pullStateFromSupabase(baseState().supabaseConfig, user);
  assert.equal(result.isEmpty, true);
  assert.equal(f.queries.length, 6);
  const switched = fixture({ authUsers: [USER_ID, OTHER_ID] });
  assert.notEqual((await switched.service.pullStateFromSupabase(baseState().supabaseConfig, user)).isEmpty, true);
});
test('relational-only fallback preserves operation metadata and has no snapshot baseline', async () => {
  const acc = account();
  const debt = { id: 'debt-1', personName: 'A', direction: 'receivable', currency: 'LYD', totalAmount: 10, paidAmount: 0, remainingAmount: 10,
    createdAt: BASELINE, status: 'active', installments: [], accountId: acc.id, initialPaymentMethod: 'cash', initialTransactionId: 'tx-1', idempotencyKey: 'operation-1' };
  const transaction = { id: 'tx-1', title: 'Loan', type: 'expense', amount: 10, currency: 'LYD', category: 'ديون وأمانات',
    accountId: acc.id, paymentMethod: 'cash', debtId: debt.id, date: BASELINE, idempotencyKey: 'operation-1:init' };
  const row = (id, payload) => ({ id, user_id: USER_ID, workspace_key: `mali-vault-${USER_ID}`, updated_at: BASELINE, sync_payload: payload });
  const f = fixture({ responses: { mali_accounts: { data: [row(acc.id, acc)], error: null }, mali_debts: { data: [row(debt.id, debt)], error: null },
    mali_transactions: { data: [row(transaction.id, transaction)], error: null } } });
  const result = await f.service.pullStateFromSupabase(baseState().supabaseConfig, user);
  assert.equal(result.ok, true);
  assert.equal(result.snapshotUpdatedAt, null);
  assert.equal(result.state.debts[0].initialTransactionId, 'tx-1');
  assert.equal(result.state.debts[0].idempotencyKey, 'operation-1');
});
test('multiple legacy workspaces and orphan financial rows require repair', async () => {
  const accRow = { id: 'acc-1', user_id: USER_ID, workspace_key: 'workspace-A', updated_at: BASELINE, sync_payload: account() };
  const scenarios = [
    { mali_accounts: { data: [accRow], error: null }, mali_contacts: { data: [{ user_id: USER_ID, workspace_key: 'workspace-B' }], error: null } },
    { mali_debts: { data: [{ user_id: USER_ID, workspace_key: 'workspace-A' }], error: null } },
  ];
  for (const responses of scenarios) {
    const f = fixture({ responses });
    const result = await f.service.pullStateFromSupabase(baseState().supabaseConfig, user);
    assert.equal(result.ok, false);
    assert.notEqual(result.isEmpty, true);
  }
});
