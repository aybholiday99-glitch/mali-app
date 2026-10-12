import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import * as engine from '../src/services/financialEngine.ts';
import { appendFinancialAudit } from '../src/services/financialAudit.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const DATE = '2026-10-12T22:00:00.000Z';
function checkedTestUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid disposable PostgreSQL test URL.'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) ||
    !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
    url.pathname !== '/mali_test' || !url.username || url.search || url.hash) {
    throw new Error('SQL tests require a loopback database named mali_test without connection overrides.');
  }
  // Pin localhost to a literal loopback address, rather than relying on DNS.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}
function fixtureIdentifier(name) {
  if (!/^mali_financial_test_[0-9a-f]{32}$/.test(name)) throw new Error('Unsafe fixture database name.');
  return '"'+name+'"';
}
async function disposableConnection() {
  if (!process.env.MALI_TEST_DB_URL) return new PGlite();
  const url = checkedTestUrl(process.env.MALI_TEST_DB_URL);
  const { Client } = await import('pg');
  const admin = new Client({ connectionString:url.href });
  const name = 'mali_financial_test_'+randomUUID().replaceAll('-','');
  const identifier = fixtureIdentifier(name);
  let client, created=false, closed=false;
  const close = async () => {
    if (closed) return;
    closed=true;
    try { if (client) await client.end(); }
    finally {
      try {
        // Only the exact fresh database created by this connection is removed.
        // No resets, drops, or forced connection termination target mali_test.
        if (created) await admin.query('DROP DATABASE '+fixtureIdentifier(name));
      } finally { await admin.end(); }
    }
  };
  try {
    await admin.connect();
    const version=Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
    if (version < 170000 || version >= 180000) throw new Error('Real SQL regression tests require PostgreSQL 17.');
    if ((await admin.query('SELECT current_database() AS name')).rows[0].name !== 'mali_test') {
      throw new Error('Unexpected PostgreSQL test database.');
    }
    await admin.query('CREATE DATABASE '+identifier+' TEMPLATE template0');
    created=true;
    const childUrl=new URL(url.href);childUrl.pathname='/'+name;
    client=new Client({ connectionString:childUrl.href });
    await client.connect();
    if ((await client.query('SELECT current_database() AS name')).rows[0].name !== name) {
      throw new Error('Unexpected fixture database connection.');
    }
    return { exec:sql=>client.query(sql),query:(...args)=>client.query(...args),close };
  } catch (error) { await close();throw error; }
}
async function fixtureDatabase() {
  const db=await disposableConnection();
  try {
    await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated')
                 AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreatedb OR rolcreaterole)) THEN
        RAISE EXCEPTION 'Unsafe SQL fixture role attributes';
      END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
    `);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(name, directory), 'utf8'));
    }
    await db.query('insert into auth.users(id,email) values ($1,$2)', [USER,'fixture@test.invalid']);
    return db;
  } catch (error) { await db.close();throw error; }
}

function state(){return {accounts:[{id:'cash',name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#000',updatedAt:DATE}],contacts:[],transactions:[],deals:[],debts:[],procedures:[],budgets:[],marketRates:{cashUsdToLyd:6.2,chequeUsdToLyd:6.3,defaultChequeDiscountPercent:0,updatedAt:DATE},supabaseConfig:{url:'',anonKey:'',workspaceKey:'',autoSync:false},lastModifiedAt:DATE};}
const metadata=(action,id)=>({ownerId:USER,action,reason:'Independent SQL correction reason',operationId:id});
function payload(s){const {supabaseConfig,...financial}=s;return {...financial,ownerId:USER};}
async function asUser(db,owner,operation){
  await db.exec('BEGIN');
  try{await db.exec('SET LOCAL ROLE authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);const result=await operation();await db.exec('COMMIT');return result;}
  catch(error){await db.exec('ROLLBACK');throw error;}
}
async function invoke(db,revision,s){return asUser(db,USER,async()=>
  (await db.query('select public.mali_sync_vault($1,$2,$3::jsonb) as result',[USER,revision,JSON.stringify(payload(s))])).rows[0].result);}
const history=db=>asUser(db,USER,()=>db.query('select * from public.mali_financial_history order by history_id'));

test('immutable server audit keeps legacy baseline, manual corrections and deleted evidence atomic and owner-scoped',async t=>{
  const db=await fixtureDatabase();
  try{
    const before=state();const initial=await invoke(db,null,before);assert.equal(initial.ok,true);
    const observed=(await history(db)).rows;
    assert.equal(observed[0].event_type,'observed_baseline');assert.equal(observed[0].observed_state.accounts[0].balance,100);
    assert.equal(observed[0].actor_id,USER);assert.equal(observed[0].user_id,USER);assert.equal(observed[0].client_events.length,0);
    const adjusted=appendFinancialAudit(before,engine.updateAccountBalanceMutation(before,'cash',75.25),metadata('manual_balance','adjust-once'));
    const saved=await invoke(db,initial.updatedAt,adjusted);assert.equal(saved.ok,true);
    const correction=(await history(db)).rows.at(-1),account=correction.changes.find(c=>c.collection==='accounts');
    assert.equal(account.before.balance,100);assert.equal(account.after.balance,75.25);
    assert.equal(correction.client_events[0].action,'observed_baseline');assert.ok(correction.accepted_at);
    const expense=engine.recordExpenseOrIncomeMutation(adjusted,{id:'expense',title:'Expense',type:'expense',amount:10,currency:'LYD',category:'test',accountId:'cash',paymentMethod:'cash',date:DATE});
    const spent=appendFinancialAudit(adjusted,expense,metadata('financial_update','expense-once'));
    const spentSave=await invoke(db,saved.updatedAt,spent);
    const reversed=appendFinancialAudit(spent,engine.deleteTransactionMutation(spent,'expense'),metadata('reversal','reverse-once'));
    const reversedSave=await invoke(db,spentSave.updatedAt,reversed);
    const evidence=(await history(db)).rows.at(-1).changes.find(c=>c.collection==='transactions');
    assert.equal(evidence.before.id,'expense');assert.equal(evidence.before.amount,10);assert.equal(evidence.after,null);
    const count=(await history(db)).rows.length;
    const repeated=await invoke(db,reversedSave.updatedAt,reversed);assert.equal(repeated.updatedAt,reversedSave.updatedAt);assert.equal((await history(db)).rows.length,count);
    const stale=await invoke(db,saved.updatedAt,reversed);assert.equal(stale.conflictDetected,true);assert.equal((await history(db)).rows.length,count);

    const variants=[
      ['removed accepted audit',s=>{delete s.financialAudit;}],
      ['empty accepted audit',s=>{s.financialAudit=[];}],
      ['rewritten accepted reason',s=>{s.financialAudit[0].reason='Changed old claim';}],
      ['truncated accepted suffix',s=>{s.financialAudit=s.financialAudit.slice(0,-1);}],
      ['duplicate audit event',s=>{s.financialAudit.push({...s.financialAudit.at(-1),sequence:s.financialAudit.length+1});}],
      ['foreign claimed owner',s=>{s.financialAudit[0].ownerId='22222222-2222-4222-8222-222222222222';}],
      ['malformed audit changes',s=>{s.financialAudit[0].changes=[null];}],
      ['bad evidence identity',s=>{s.financialAudit[0].changes[0].after.id='different';}],
      ['invalid timestamp',s=>{s.financialAudit[0].recordedAt='infinity';}],
      ['invalid calendar',s=>{s.financialAudit[0].recordedAt='2026-02-30T00:00:00.000Z';}],
      ['duplicate operation identity',s=>{s.financialAudit[2].operationId=s.financialAudit[1].operationId;}],
    ];
    for(const [name,mutate] of variants)await t.test(name,async()=>{
      const bad=structuredClone(reversed);mutate(bad);await assert.rejects(invoke(db,reversedSave.updatedAt,bad));
      assert.equal((await history(db)).rows.length,count);
      assert.equal((await db.query('select payload from public.mali_vault_snapshots where user_id=$1',[USER])).rows[0].payload.accounts[0].balance,75.25);
    });
    await t.test('owner cannot insert, change, delete or truncate history or invoke private capture',async()=>{
      for(const sql of [
        "insert into public.mali_financial_history(user_id,workspace_key,snapshot_updated_at,event_type,changes) values ('"+USER+"','fake',now(),'cloud_commit','[]')",
        "update public.mali_financial_history set changes='[]'",
        'delete from public.mali_financial_history','truncate public.mali_financial_history',
        'select mali_audit.capture_snapshot()',
      ])await assert.rejects(asUser(db,USER,()=>db.exec(sql)),/permission|immutable/i);
      for(const sql of ["update public.mali_financial_history set changes='[]'",'delete from public.mali_financial_history','truncate public.mali_financial_history'])await assert.rejects(db.exec(sql),/immutable/i,'row trigger also refuses ordinary privileged DML');
      assert.equal((await history(db)).rows.length,count);
    });
    await t.test('other authenticated owner cannot read or forge the original owner evidence',async()=>{
      const other='22222222-2222-4222-8222-222222222222';
      assert.equal((await asUser(db,other,()=>db.query('select * from public.mali_financial_history'))).rows.length,0);
      await assert.rejects(asUser(db,other,()=>db.query('select public.mali_sync_vault($1,$2,$3::jsonb)',[USER,reversedSave.updatedAt,JSON.stringify(payload(reversed))])),/authenticated user/i);
    });
    await t.test('audit insertion failure rolls back balances, projections, snapshot and evidence together',async()=>{
      await db.exec("create function public.audit_fixture_failure() returns trigger language plpgsql as $$ begin raise exception 'isolated audit insertion failure'; end $$; create trigger audit_fixture_failure before insert on public.mali_financial_history for each row execute function public.audit_fixture_failure();");
      const adjustedAgain=appendFinancialAudit(reversed,engine.updateAccountBalanceMutation(reversed,'cash',90),metadata('correction','second-correction'));
      await assert.rejects(invoke(db,reversedSave.updatedAt,adjustedAgain),/isolated audit insertion failure/);
      assert.equal((await history(db)).rows.length,count);
      assert.equal(Number((await db.query('select balance from public.mali_accounts where user_id=$1',[USER])).rows[0].balance),75.25);
      const snapshot=(await db.query('select payload,updated_at from public.mali_vault_snapshots where user_id=$1',[USER])).rows[0];
      assert.equal(snapshot.payload.accounts[0].balance,75.25);
      await db.exec('drop trigger audit_fixture_failure on public.mali_financial_history; drop function public.audit_fixture_failure();');
    });
    await t.test('conflict/import replacement preserves accepted prefix and exact chosen records',async()=>{
      const chosen={...reversed,financialAudit:undefined,accounts:reversed.accounts.map(a=>({...a,balance:80}))};
      const resolved=appendFinancialAudit(reversed,chosen,metadata('conflict_resolution','resolve-once'));
      assert.deepEqual(resolved.financialAudit.slice(0,-1),reversed.financialAudit);
      const result=await invoke(db,reversedSave.updatedAt,resolved);assert.equal(result.ok,true);
      assert.equal((await history(db)).rows.at(-1).client_events[0].action,'conflict_resolution');
    });
    await t.test('internal writer has no login, bypass, API membership or arbitrary history mutation privileges',async()=>{
      const role=(await db.query("select rolcanlogin,rolinherit,rolbypassrls,rolsuper,rolcreatedb,rolcreaterole from pg_roles where rolname='mali_history_writer'")).rows[0];
      assert.deepEqual(Object.values(role),Array(6).fill(false));
      assert.equal((await db.query("select pg_has_role('authenticated','mali_history_writer','MEMBER') as member")).rows[0].member,false);
      const owner=(await db.query("select r.rolname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='mali_audit' and p.proname='capture_snapshot'")).rows[0].rolname;
      assert.equal(owner,'mali_history_writer');
      await assert.rejects(db.query('delete from public.mali_vault_snapshots where user_id=$1',[USER]),/Audit owner mismatch/);
      assert.equal((await db.query('select payload from public.mali_vault_snapshots where user_id=$1',[USER])).rows[0].payload.accounts[0].balance,80);
      await db.exec('begin; set local role mali_history_writer;');
      try{
        assert.equal((await db.query('select user_id from public.mali_financial_history')).rows.length,0);
        await assert.rejects(db.exec("insert into public.mali_financial_history(user_id,workspace_key,snapshot_updated_at,event_type,changes) values ('"+USER+"','forged',now(),'cloud_commit','[]')"),/row.level security/i);
      }finally{await db.exec('rollback');}
    });
  }finally{await db.close();}
});


