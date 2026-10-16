// Synthetic full-database rehearsal. This script cannot connect to a production database.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import * as engine from '../src/services/financialEngine.ts';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TABLES = ['mali_vault_snapshots','mali_accounts','mali_contacts','mali_usd_deals','mali_transactions','mali_debts'];
export function checkedRehearsalUrl(raw) {
  const url = new URL(raw);
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
      url.pathname !== '/mali_test' || !url.username || url.search || url.hash) {
    throw new Error('Restore rehearsal requires a disposable loopback mali_test URL without overrides.');
  }
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}
export function checkedFixtureName(name) {
  if (!/^mali_restore_test_[0-9a-f]{32}_(source|restored)$/.test(name)) throw new Error('Unsafe restore fixture name.');
  return '"'+name+'"';
}
export function checkedContainerId(value) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Restore tools require the exact CI PostgreSQL service container ID.');
  return value;
}
function pgTool(tool, name, url, input) {
  checkedFixtureName(name);
  const container = process.env.MALI_TEST_PG_CONTAINER;
  const environment = {
    ...process.env, PGHOST:container ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g,''),
    PGPORT:container ? '5432' : (url.port || '5432'), PGUSER:decodeURIComponent(url.username),
    PGPASSWORD:decodeURIComponent(url.password), PGDATABASE:name,
    PGOPTIONS:'', PGSSLMODE:'disable',
    PGHOSTADDR:container ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g,''), PGCONNECT_TIMEOUT:'10',
  };
  delete environment.PGSERVICE;delete environment.PGSERVICEFILE;delete environment.PGPASSFILE;
  // Preserve owner identities as well as ACLs: stripping ownership would silently
  // elevate the private journal trigger from its dedicated writer to the restore admin.
  const args = tool === 'pg_dump' ? ['--format=custom'] : ['--exit-on-error','--single-transaction','--dbname',name];
  const command = container ? 'docker' : tool;
  const commandArgs = container ? ['exec','-i',...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGOPTIONS','PGHOSTADDR','PGCONNECT_TIMEOUT'].flatMap(key=>['-e',key]),
    checkedContainerId(container),tool,...args] : args;
  const result = spawnSync(command,commandArgs,{env:environment,input,encoding:null,maxBuffer:32*1024*1024,timeout:120000});
  // Do not echo tool stderr: restored SQL and connection diagnostics can contain sensitive material.
  if (result.error || result.status !== 0) throw new Error(tool+' failed during isolated restore rehearsal.',
    {cause:{code:result.error?.code,status:result.status,stderr:result.stderr?.toString()}});
  return result.stdout;
}
async function asOwner(db, owner, action) {
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL ROLE authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    const result=await action();
    await db.query('COMMIT');
    return result;
  } catch(error) { await db.query('ROLLBACK');throw error; }
}
async function sync(db,owner,expected,payload) {
  return asOwner(db,owner,async()=> (await db.query('select public.mali_sync_vault($1,$2,$3::jsonb) result',
    [owner,expected,JSON.stringify({...payload,ownerId:owner})])).rows[0].result);
}
function fixtureState() {
  let state={accounts:[],contacts:[],transactions:[],deals:[],debts:[],procedures:[],budgets:[],
    marketRates:{cashUsdToLyd:6,chequeUsdToLyd:6.2,defaultChequeDiscountPercent:2,updatedAt:'2026-10-13T00:00:00Z'},
    supabaseConfig:{url:'',anonKey:'',workspaceKey:'synthetic',autoSync:false},lastModifiedAt:'2026-10-13T00:00:00Z'};
  state=engine.createAccountMutation(state,{id:'cash',name:'Synthetic cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:10000,isCash:true,color:'#000'});
  state=engine.createAccountMutation(state,{id:'usd',name:'Synthetic USD',bankName:'Cash',category:'cash_usd',currency:'USD',balance:0,isCash:true,color:'#000'});
  state=engine.createUsdDealMutation(state,{id:'deal',title:'Synthetic deal',totalUsdBought:100,buyRate:6.1234,buyCommissionLyd:0.49,
    buyPaymentMethod:'cash',sourceLydAccountId:'cash',usdHoldingAccountId:'usd',buyReceiptImages:['data:image/jpeg;base64,c3ludGhldGlj']});
  state=engine.sellFromUsdDealMutation(state,{saleId:'sale',dealId:'deal',usdAmount:23,sellRate:6.2345,commissionLyd:0.03,
    paymentMethod:'cash',sourceUsdAccountId:'usd',targetLydAccountId:'cash'});
  state=engine.recordExpenseOrIncomeMutation(state,{id:'expense',title:'Synthetic expense',type:'expense',amount:10.075,
    currency:'LYD',category:'fixture',accountId:'cash',paymentMethod:'cash'});
  assert.equal(state.deals.length,1);assert.equal(state.deals[0].sales.length,1);
  assert.equal(state.transactions.find(row=>row.id==='expense')?.amount,10.08);
  const {supabaseConfig: _config,...payload}=state;
  return payload;
}
async function seedSource(db) {
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreatedb OR rolcreaterole)) THEN
        RAISE EXCEPTION 'Unsafe fixture roles'; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[] NOT NULL);
  `);
  const directory=new URL('../supabase/migrations/',import.meta.url);
  for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()) {
    const sql=await readFile(new URL(file,directory),'utf8');
    await db.query(sql);
    await db.query('insert into supabase_migrations.schema_migrations values($1,$2)',[file.split('_')[0],[sql]]);
    if (file.startsWith('20261012185100_')) {
      // Exactly 21 unowned originals; migration must preserve them and their archive copies.
      await db.query("insert into public.mali_vault_snapshots(workspace_key,user_id,payload) values('legacy-unowned',null,'{\"synthetic\":true}')");
      await db.query("insert into public.mali_accounts(id,workspace_key,user_id,name,bank_name,category,currency,balance,is_cash) select 'legacy-'||i,'legacy-unowned',null,'Synthetic','Cash','cash_lyd','LYD',i,true from generate_series(1,10) i");
      await db.query("insert into public.mali_contacts(id,workspace_key,user_id,name,phone,role) select 'legacy-'||i,'legacy-unowned',null,'Synthetic','','شخصي / عميل' from generate_series(1,5) i");
      await db.query("insert into public.mali_transactions(id,workspace_key,user_id,title,type,amount,currency,category,account_id,payment_method,tx_date) select 'legacy-'||i,'legacy-unowned',null,'Synthetic','expense',i,'LYD','fixture','legacy-1','cash','2026-10-13' from generate_series(1,5) i");
    }
  }
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[OWNER,'owner@test.invalid',OTHER,'other@test.invalid']);
  const payload=fixtureState();
  const result=await sync(db,OWNER,null,payload);assert.equal(result.ok,true);
  const other={...payload,accounts:payload.accounts.map(row=>({...row,balance:row.balance+5}))};
  assert.equal((await sync(db,OTHER,null,other)).ok,true);
  return {payload,baseline:result.updatedAt};
}
async function inspect(db) {
  const tables=(await db.query(`select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by 1,2`)).rows;
  const data={};
  for(const {schema,name} of tables) {
    // Names are selected from a synthetic schema, still quote identifiers defensively.
    const table='"'+schema.replaceAll('"','""')+'"."'+name.replaceAll('"','""')+'"';
    const rows=(await db.query('select to_jsonb(t) data from '+table+' t order by to_jsonb(t)::text')).rows.map(row=>row.data);
    data[schema+'.'+name]={count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
  const security=(await db.query(`select c.relname,c.relrowsecurity,c.relforcerowsecurity,
    has_table_privilege('anon',c.oid,'select,insert,update,delete') anon_dml,
    has_table_privilege('authenticated',c.oid,'select') owner_read
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`)).rows;
  const policies=(await db.query(`select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by 1,2,3`)).rows;
  const functions=(await db.query(`select p.proname,p.proowner::regrole::text owner,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition,
    has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') owner_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by n.nspname,p.proname,p.oid::regprocedure::text`)).rows;
  const triggers=(await db.query(`select c.relname,t.tgname,pg_get_triggerdef(t.oid) definition from pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by 1,2`)).rows;
  const constraints=(await db.query(`select c.relname,p.conname,pg_get_constraintdef(p.oid) definition from pg_constraint p
    join pg_class c on c.oid=p.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by n.nspname,c.relname,p.conname`)).rows;
  return {data,security,policies,functions,triggers,constraints};
}
export async function rehearseDatabaseRestore(raw) {
  const url=checkedRehearsalUrl(raw);
  if(process.env.MALI_TEST_PG_CONTAINER) checkedContainerId(process.env.MALI_TEST_PG_CONTAINER);
  const id=randomUUID().replaceAll('-','');
  const names=['source','restored'].map(suffix=>'mali_restore_test_'+id+'_'+suffix);
  const admin=new Client({connectionString:url.href});
  const databases=[],created=[];
  try {
    await admin.connect();
    assert.equal((await admin.query('select current_database() name')).rows[0].name,'mali_test');
    const version=Number((await admin.query('show server_version_num')).rows[0].server_version_num);
    if(version<170000 || version>=180000) throw new Error('Restore rehearsal requires PostgreSQL 17.');
    for(const name of names) {
      await admin.query('CREATE DATABASE '+checkedFixtureName(name)+' TEMPLATE template0');created.push(name);
      const child=new URL(url.href);child.pathname='/'+name;
      const client=new Client({connectionString:child.href});databases.push(client);await client.connect();
      assert.equal((await client.query('select current_database() name')).rows[0].name,name);
    }
    const [source,restored]=databases;
    const {payload,baseline}=await seedSource(source);
    const original=await inspect(source);
    assert.equal(original.data['public.mali_legacy_unowned_archive'].count,21);
    let originalUnowned=0;
    for(const table of TABLES) originalUnowned+=Number((await source.query('select count(*) n from public.'+table+' where user_id is null')).rows[0].n);
    assert.equal(originalUnowned,21);
    const dump=pgTool('pg_dump',names[0],url);
    assert.equal(dump.subarray(0,5).toString(),'PGDMP');
    pgTool('pg_restore',names[1],url,dump);
    const recovered=await inspect(restored);
    assert.deepEqual(recovered,original,'Restored data, migrations, functions, grants and owner policies must exactly match.');
    for(const table of TABLES) {
      const rows=await asOwner(restored,OWNER,()=>restored.query('select user_id from public.'+table));
      assert.ok(rows.rows.every(row=>row.user_id===OWNER));
    }
    await assert.rejects(asOwner(restored,OWNER,()=>restored.query('select * from public.mali_legacy_unowned_archive')),/permission denied/i);
    assert.equal((await asOwner(restored,OTHER,()=>restored.query("update public.mali_accounts set balance=999 where user_id=$1 returning id",[OWNER]))).rows.length,0);
    await assert.rejects(asOwner(restored,OWNER,()=>restored.query("update public.mali_accounts set balance=999 where user_id=$1",[OWNER])),/must use mali_sync_vault/);
    const stale=await sync(restored,OWNER,null,{...payload,accounts:[]});assert.equal(stale.conflictDetected,true);
    const same=await sync(restored,OWNER,baseline,payload);assert.equal(same.ok,true);assert.equal(same.updatedAt,baseline);
    const changed={...payload,accounts:payload.accounts.map(row=>row.id==='cash'?{...row,balance:row.balance+1}:row)};
    assert.equal((await sync(restored,OWNER,baseline,changed)).ok,true);
    assert.equal((await sync(restored,OWNER,baseline,payload)).conflictDetected,true);
    // Source remains untouched throughout restore and subsequent target-only mutations.
    assert.deepEqual(await inspect(source),original);
    return {postgresMajor:17,tables:Object.keys(original.data).length,legacyOriginals:21,legacyArchiveCopies:21,
      dumpSha256:createHash('sha256').update(dump).digest('hex'),bytes:dump.length,restore:'PASS',ownerIsolation:'PASS',casRecovery:'PASS'};
  } finally {
    await Promise.allSettled(databases.map(db=>db.end()));
    try { for(const name of created.reverse()) await admin.query('DROP DATABASE '+checkedFixtureName(name)); }
    finally {await admin.end();}
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await rehearseDatabaseRestore(process.env.MALI_TEST_DB_URL))); }
  catch { console.error('Isolated PostgreSQL 17 backup/restore rehearsal FAILED; no production operation performed.');process.exitCode=1; }
}
