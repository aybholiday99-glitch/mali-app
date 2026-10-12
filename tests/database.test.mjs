import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const tables = ['mali_vault_snapshots','mali_accounts','mali_contacts','mali_usd_deals','mali_transactions','mali_debts'];
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

export async function disposableDatabase() {
  let db;
  if (process.env.MALI_TEST_DB_URL) {
    const url = new URL(process.env.MALI_TEST_DB_URL);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.pathname !== '/mali_test') {
      throw new Error('SQL integration tests require a disposable loopback database named mali_test.');
    }
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url.href });
    await client.connect();
    db = { exec: sql => client.query(sql), query: (...args) => client.query(...args), close: () => client.end() };
  } else {
    db = new PGlite();
  }
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
  `);
  for (const file of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
  }
  await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4)', [userA,'a@test.invalid',userB,'b@test.invalid']);
  return db;
}

export async function asUser(db, userId, action, isolateRls = false) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    // Unit-isolate the RLS matrix from the independent atomic-write guard.
    // The guard is exercised separately through the exact public RPC below.
    if (isolateRls) await db.query("select set_config('mali.atomic_sync_user',$1,true)", [userId]);
    const result = await action();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

test('ordered migrations disable automatic confirmation and enforce all owner CRUD policies', async t => {
  const db = await disposableDatabase();
  try {
    await t.test('new user remains unconfirmed; legacy function is not publicly executable', async () => {
      assert.equal((await db.query('select email_confirmed_at from auth.users where id=$1',[userA])).rows[0].email_confirmed_at,null);
      assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgname='trg_mali_auto_confirm_user'")).rows[0].n,0);
      assert.equal((await db.query("select prosecdef from pg_proc where proname='handle_mali_auto_confirm_user'")).rows[0].prosecdef,false);
      for (const role of ['anon','authenticated']) {
        assert.equal((await db.query("select has_function_privilege($1,'public.handle_mali_auto_confirm_user()','execute') as allowed",[role])).rows[0].allowed,false);
      }
    });
    for (const table of tables) {
      await t.test(table + ' grants, RLS and cross-user SELECT/INSERT/UPDATE/DELETE', async () => {
        const meta = (await db.query("select relrowsecurity,relforcerowsecurity,has_table_privilege('anon',oid,'select,insert,update,delete') as anon_dml from pg_class where oid=$1::regclass",[table])).rows[0];
        assert.equal(meta.relrowsecurity,true);
        assert.equal(meta.relforcerowsecurity,true);
        assert.equal(meta.anon_dml,false);
        const policies = (await db.query('select polcmd,polroles::text,pg_get_expr(polqual,polrelid) as qual,pg_get_expr(polwithcheck,polrelid) as check from pg_policy where polrelid=$1::regclass',[table])).rows;
        assert.equal(policies.length,4);
        assert.deepEqual(new Set(policies.map(p=>p.polcmd)),new Set(['r','a','w','d']));
        // Valid rows satisfy every table constraint so rejection proves ownership, not malformed data.
        const common = {workspace_key:'vault-a',user_id:userA,id:'row-a'};
        const rows = {
          mali_vault_snapshots:{workspace_key:'vault-a',user_id:userA,payload:{private:'A'}},
          mali_accounts:{...common,name:'A',bank_name:'Cash',category:'cash_lyd',currency:'LYD',balance:100,is_cash:true},
          mali_contacts:{...common,name:'A',phone:'',role:'شخصي / عميل'},
          mali_usd_deals:{...common,deal_number:'A',title:'A',counterparty:'A',buy_date:'2026-10-12',usd_amount:10,buy_rate:6,effective_buy_rate:6,total_lyd_cost:60,buy_method:'cash',source_lyd_account_id:'lyd',target_usd_account_id:'usd',status:'open'},
          mali_transactions:{...common,title:'A',type:'income',amount:10,currency:'LYD',category:'test',account_id:'lyd',payment_method:'cash',tx_date:'2026-10-12'},
          mali_debts:{...common,person_name:'A',direction:'receivable',currency:'LYD',total_amount:10,paid_amount:0,remaining_amount:10,created_at:'2026-10-12',status:'active'},
        };
        const row=rows[table], fields=Object.keys(row), values=Object.values(row);
        const insert = vals => db.query(`insert into public.${table} (${fields.join(',')}) values (${fields.map((_,i)=>'$'+(i+1)).join(',')})`, vals);
        await assert.rejects(asUser(db,userA,()=>insert(values)), /must use mali_sync_vault/);
        await asUser(db,userA,()=>insert(values),true);
        assert.equal((await asUser(db,userA,()=>db.query(`select * from public.${table}`))).rows.length,1);
        assert.equal((await asUser(db,userB,()=>db.query(`select * from public.${table}`))).rows.length,0);
        const spoof={...row,workspace_key:'vault-b',id:'spoof'};
        await assert.rejects(asUser(db,userB,()=>insert(fields.map(f=>spoof[f])),true), /row-level security/i);
        const nullOwner={...spoof,user_id:null};
        await assert.rejects(asUser(db,userB,()=>insert(fields.map(f=>nullOwner[f])),true), /row-level security|not-null/i);
        for (const command of [
          `update public.${table} set workspace_key='stolen' where workspace_key='vault-a' returning *`,
          `delete from public.${table} where workspace_key='vault-a' returning *`,
        ]) assert.equal((await asUser(db,userB,()=>db.query(command))).rows.length,0);
        await assert.rejects(asUser(db,userA,()=>db.query(`update public.${table} set user_id=$1 where workspace_key='vault-a'`,[userB]),true),/row-level security/i);
        assert.equal((await asUser(db,userA,()=>db.query(`update public.${table} set workspace_key='vault-a-updated' where workspace_key='vault-a' returning *`),true)).rows.length,1);
        assert.equal((await asUser(db,userA,()=>db.query(`delete from public.${table} where workspace_key='vault-a-updated' returning *`),true)).rows.length,1);
      });
    }
    await t.test('archive has no public or authenticated data access', async () => {
      for (const role of ['anon','authenticated']) {
        assert.equal((await db.query("select has_table_privilege($1,'public.mali_legacy_unowned_archive','select,insert,update,delete') as allowed",[role])).rows[0].allowed,false);
      }
    });
    const payload = {
      ownerId: userA, accounts: [{id:'cash',name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#fff',updatedAt:'2026-10-12T20:00:00Z'}],
      contacts: [], transactions: [], deals: [], debts: [], procedures: [], budgets: [],
      marketRates:{cashUsdToLyd:6,chequeUsdToLyd:6,defaultChequeDiscountPercent:0,updatedAt:'2026-10-12T20:00:00Z'},
      lastModifiedAt:'2026-10-12T20:00:00Z',
    };
    const sync = (user, expected, value, claimedOwner=user) => asUser(db,user,async () =>
      (await db.query('select public.mali_sync_vault($1,$2,$3::jsonb) as result',[claimedOwner,expected,JSON.stringify(value)])).rows[0].result);
    let revision;
    await t.test('RPC commits an empty-user vault and all balances with a server timestamp', async () => {
      const result=await sync(userA,null,payload);
      assert.equal(result.ok,true);
      revision=result.updatedAt;
      assert.ok(Number.isFinite(Date.parse(revision)));
      assert.equal(Number((await asUser(db,userA,()=>db.query('select balance from public.mali_accounts'))).rows[0].balance),100);
      assert.equal((await asUser(db,userB,()=>db.query('select * from public.mali_accounts'))).rows.length,0);
    });
    await t.test('stale device CAS and lost acknowledgement retries cannot overwrite or duplicate', async () => {
      const retry=await sync(userA,null,payload);
      assert.equal(retry.ok,false);
      assert.equal(retry.conflictDetected,true);
      const changed={...payload,accounts:[{...payload.accounts[0],balance:120}]};
      const first=await sync(userA,revision,changed);
      assert.equal(first.ok,true);
      const stale=await sync(userA,revision,{...changed,accounts:[{...changed.accounts[0],balance:999}]});
      assert.equal(stale.conflictDetected,true);
      assert.equal(Number((await asUser(db,userA,()=>db.query('select balance from public.mali_accounts'))).rows[0].balance),120);
      revision=first.updatedAt;
    });
    await t.test('a relational write failure rolls back balances, deletions and snapshot revision', async () => {
      await db.exec("CREATE FUNCTION public.fail_test_contact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated relational failure'; END; $$; CREATE TRIGGER fail_test_contact BEFORE INSERT ON public.mali_contacts FOR EACH ROW EXECUTE FUNCTION public.fail_test_contact();");
      const changed={...payload,accounts:[{...payload.accounts[0],balance:250}],contacts:[{id:'contact',name:'Test',phone:'',role:'شخصي / عميل',createdAt:'2026-10-12'}]};
      await assert.rejects(sync(userA,revision,changed),/simulated relational failure/);
      assert.equal(Number((await asUser(db,userA,()=>db.query('select balance from public.mali_accounts'))).rows[0].balance),120);
      const snapshot=(await asUser(db,userA,()=>db.query('select payload from public.mali_vault_snapshots'))).rows[0].payload;
      assert.equal(snapshot.accounts[0].balance,120);
      const cas=await sync(userA,revision,{...payload,accounts:[{...payload.accounts[0],balance:120}]});
      assert.equal(cas.updatedAt,revision);
      await db.exec('DROP TRIGGER fail_test_contact ON public.mali_contacts; DROP FUNCTION public.fail_test_contact();');
    });
    await t.test('RPC rejects impersonation and direct owned DML without leaking the write flag', async () => {
      await assert.rejects(sync(userB,null,payload,userA),/does not match/);
      for(const command of [
        'update public.mali_accounts set balance=999 where id=\'cash\'',
        'delete from public.mali_accounts where id=\'cash\'',
        "update public.mali_vault_snapshots set payload='{}'::jsonb",
      ]) await assert.rejects(asUser(db,userA,()=>db.query(command)),/must use mali_sync_vault/);
      assert.equal((await db.query("select has_function_privilege('anon','public.mali_sync_vault(uuid,timestamptz,jsonb)','execute') as allowed")).rows[0].allowed,false);
    });
    await t.test('RPC prunes removed records and snapshot together, preserving the other user', async () => {
      const bPayload={...payload,ownerId:userB,accounts:[{...payload.accounts[0],balance:800}]};
      assert.equal((await sync(userB,null,bPayload)).ok,true);
      const emptied={...payload,accounts:[]};
      assert.equal((await sync(userA,revision,emptied)).ok,true);
      assert.equal((await asUser(db,userA,()=>db.query('select * from public.mali_accounts'))).rows.length,0);
      assert.equal(Number((await asUser(db,userB,()=>db.query('select balance from public.mali_accounts'))).rows[0].balance),800);
    });
    await t.test('legacy relational vault cannot be overwritten when a snapshot baseline is absent', async () => {
      const legacy='33333333-3333-4333-8333-333333333333';
      await db.query('insert into auth.users(id) values($1)',[legacy]);
      await db.query("insert into public.mali_accounts(id,workspace_key,user_id,name,bank_name,category,currency,balance,is_cash) values('legacy','legacy-vault',$1,'Legacy','Cash','cash_lyd','LYD',777,true)",[legacy]);
      await assert.rejects(sync(legacy,null,{...payload,ownerId:legacy}),/verified migration/);
      assert.equal(Number((await asUser(db,legacy,()=>db.query('select balance from public.mali_accounts'))).rows[0].balance),777);
    });
  } finally { await db.close(); }
});
