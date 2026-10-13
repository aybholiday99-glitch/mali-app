import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCentralVaultSession } from '../src/services/centralVaultSession.ts';

const config = { url: 'https://private-owner.supabase.co', anonKey: 'public-key',
  workspaceKey: 'managed', autoSync: true };
const owner = id => ({ id, name: id, email: id + '@example.com',
  provider: 'email', createdAt: '2026-10-13T00:00:00Z', isLocalOnly: false });
const guest = { ...owner('local-offline-guest'), isLocalOnly: true };
const empty = () => ({
  supabaseConfig: {...config}, accounts: [], contacts: [], transactions: [],
  deals: [], debts: [], procedures: [], budgets: [],
  marketRates: {}, financialAudit: [], pendingCloudSync: false,
});
const verified = (updatedAt, state = empty()) => ({
  ok: true, success: true, identityVerified: true,
  state, snapshotUpdatedAt: updatedAt, updatedAt,
});
const ack = updatedAt => ({ ok:true, success:true, updatedAt, snapshotUpdatedAt:updatedAt });
const rejected = {ok:false, success:false, message:'retry later'};
const first = '2026-10-13T08:00:00Z';
const second = '2026-10-13T08:01:00Z';

test('central-only finance refuses local guest without contacting cloud', async () => {
  let calls = 0;
  const session = createCentralVaultSession({
    pull: async () => { calls++; return verified(first); },
    push: async () => { calls++; return ack(second); },
  }, empty);
  const result = await session.open(guest, config);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session');
  assert.equal(calls, 0);
  assert.equal(session.snapshot(), null);
});
test('no customer financial data is available until an identity-verified server pull', async () => {
  const session = createCentralVaultSession({
    pull: async () => ({ok:false, success:false, message:'offline'}),
    push: async () => { throw Error('must not push'); },
  }, empty);
  assert.equal((await session.open(owner('client'), config)).ok, false);
  assert.equal(session.snapshot(), null);
  assert.equal((await session.update(s=>({...s,contacts:[{id:'x'}]}))).ok, false);
});
test('empty remote vault is trusted only when the owner is server-verified', async () => {
  const denied = createCentralVaultSession({
    pull: async () => ({isEmpty:true, ok:false, success:false, message:'empty'}),
    push: async () => ack(second),
  }, empty);
  assert.equal((await denied.open(owner('client'),config)).ok,false);
  const accepted = createCentralVaultSession({
    pull: async () => ({isEmpty:true, identityVerified:true, ok:false, success:false, message:'empty'}),
    push: async () => ack(second),
  }, empty);
  assert.equal((await accepted.open(owner('client'),config)).ok,true);
  assert.equal(accepted.snapshot().accounts.length,0);
});
test('remote acknowledgement is required BEFORE financial state is published', async () => {
  let finish;
  const waiter = new Promise(resolve => { finish = resolve; });
  const payloads = [];
  const session = createCentralVaultSession({
    pull: async () => verified(first),
    push: async (state, cfg, user) => {
      payloads.push({state,cfg,user});
      await waiter;
      return ack(second);
    },
  }, empty);
  assert.equal((await session.open(owner('client'),config)).ok,true);
  const pending = session.update(state=>({...state,contacts:[{id:'record-1'}]}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.snapshot().contacts.length,0);
  finish();
  const result = await pending;
  assert.equal(result.ok,true);
  assert.equal(session.snapshot().contacts[0].id,'record-1');
  assert.equal(session.snapshot().supabaseConfig.lastSyncedAt,second);
  assert.equal(payloads[0].cfg.lastSyncedAt,first);
  assert.equal(payloads[0].user.id,'client');
});
test('network timeout never approves local write; forces authoritative reload', async () => {
  const session = createCentralVaultSession({
    pull: async () => verified(first),
    push: async () => rejected,
  }, empty);
  await session.open(owner('client'),config);
  assert.equal((await session.update(s=>({...s,contacts:[{id:'u'}]}))).ok,false);
  assert.equal(session.snapshot(),null);
  assert.equal((await session.update(s=>({...s,contacts:[{id:'again'}]}))).ok,false);
});
test('conflicts lock writes; logout clears all financial objects held in memory', async () => {
  const session = createCentralVaultSession({
    pull: async () => verified(first),
    push: async () => ({...rejected,conflictDetected:true}),
  }, empty);
  await session.open(owner('client'),config);
  const result = await session.update(s=>({...s,debts:[{id:'debt'}]}));
  assert.equal(result.reason,'conflict');
  assert.equal(session.snapshot(),null);
  session.clear();
  assert.equal(session.snapshot(),null);
});
test('account changes during in-flight writes cannot publish old customer financial data', async () => {
  let release;
  const wait = new Promise(resolve=>{release=resolve});
  const session = createCentralVaultSession({
    pull: async (_cfg,user) => verified(first, {
      ...empty(), contacts:[{id:'profile-'+user.id}],
    }),
    push: async () => { await wait; return ack(second); },
  }, empty);
  await session.open(owner('alice'),config);
  const firstWrite = session.update(s=>({...s,contacts:[{id:'private-alice'}]}));
  await new Promise(resolve=>setImmediate(resolve));
  const secondLogin = await session.open(owner('bob'),config);
  release();
  assert.equal(secondLogin.ok,true);
  assert.equal((await firstWrite).ok,false);
  assert.deepEqual(session.snapshot().contacts,[{id:'profile-bob'}]);
});
test('two consecutive writes serialize server CAS revisions instead of writing stale baselines', async () => {
  const baselines=[];
  let number=0;
  const session=createCentralVaultSession({
    pull: async ()=>verified(first),
    push: async (_state,cfg)=>{ baselines.push(cfg.lastSyncedAt);
      return ack(new Date(Date.parse(second)+number++ * 60000).toISOString()); },
  },empty);
  await session.open(owner('client'),config);
  const edits=await Promise.all([
    session.update(s=>({...s,contacts:[...s.contacts,{id:'one'}]})),
    session.update(s=>({...s,contacts:[...s.contacts,{id:'two'}]})),
  ]);
  assert.deepEqual(edits.map(x=>x.ok),[true,true]);
  assert.deepEqual(baselines,[first,second]);
  assert.deepEqual(session.snapshot().contacts.map(x=>x.id),['one','two']);
});
