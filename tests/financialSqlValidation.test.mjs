import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import * as engine from '../src/services/financialEngine.ts';

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

test('real PostgreSQL connections and fixture cleanup have strict local-only boundaries',()=>{
  for (const raw of [
    'postgres://test@db.example/mali_test','postgres://test@127.0.0.1/production',
    'postgres://test@127.0.0.1/mali_test?host=db.example',
    'postgres://test@127.0.0.1/mali_test?options=-c%20search_path%3Dpublic',
    'postgres://test@127.0.0.1/mali_test#redirect','https://127.0.0.1/mali_test',
    'postgres://127.0.0.1/mali_test','not a URL',
  ]) assert.throws(()=>checkedTestUrl(raw));
  for (const host of ['127.0.0.1','localhost','[::1]']) {
    assert.equal(checkedTestUrl('postgres://test@'+host+'/mali_test').pathname,'/mali_test');
  }
  assert.equal(checkedTestUrl('postgres://test@localhost/mali_test').hostname,'127.0.0.1');
  for(const name of ['mali_test','production','mali_financial_test_bad','mali_financial_test_";DROP DATABASE mali_test;--']) {
    assert.throws(()=>fixtureIdentifier(name));
  }
  const name='mali_financial_test_'+randomUUID().replaceAll('-','');
  assert.equal(fixtureIdentifier(name),'"'+name+'"');
});
function initial() {
  return {
    accounts: [], contacts: [], transactions: [], deals: [], debts: [], procedures: [], budgets: [],
    marketRates: { cashUsdToLyd: 6.2, chequeUsdToLyd: 6.38,
      defaultChequeDiscountPercent: 2.5, updatedAt: DATE },
    supabaseConfig: { url: '', anonKey: '', workspaceKey: 'memory', autoSync: false },
    lastModifiedAt: DATE,
  };
}
function fixture(personalTarget) {
  let s = initial();
  for (const [id,currency,balance,isCash] of [
    ['cash','LYD',100000,true], ['bank','LYD',100000,false],
    ['usd','USD',0,true], ['personal','USD',0,true],
  ]) s = engine.createAccountMutation(s, { id, name: id, bankName: id, currency,
    balance, isCash, color:'#000000', category: isCash ? currency === 'USD' ? 'cash_usd' : 'cash_lyd' : 'bank_lyd' });
  s = engine.createUsdDealMutation(s, { id:'deal', title:'commission conservation',
    totalUsdBought:10, buyRate:6.2345, buyCommissionLyd:0.49, buyPaymentMethod:'cash',
    sourceLydAccountId:'cash', usdHoldingAccountId:'usd' });
  s = engine.sellFromUsdDealMutation(s, { saleId:'sale', dealId:'deal', usdAmount:3,
    sellRate:6.4355, commissionLyd:0.03, paymentMethod:'transfer',
    sourceUsdAccountId:'usd', targetLydAccountId:'bank' });
  s = engine.takePersonalFromUsdDealMutation(s, { saleId:'take', dealId:'deal',
    usdAmount:1, sourceUsdAccountId:'usd', targetPersonalUsdAccountId:personalTarget });
  s = engine.addDebtRecordMutation(s, { id:'debt', personName:'debtor', direction:'receivable',
    currency:'LYD', totalAmount:100, accountId:'cash' });
  s = engine.settleDebtInstallmentMutation(s, { installmentId:'installment', debtId:'debt',
    amount:25, accountId:'bank', paymentMethod:'transfer' });
  s = engine.settleDebtInstallmentMutation(s, { installmentId:'off-ledger', debtId:'debt',
    amount:5, paymentMethod:'cash' });
  return s;
}
function payload(s) { const { supabaseConfig, ...data } = s; return JSON.parse(JSON.stringify({ ...data, ownerId:USER })); }
async function invoke(db, revision, value, rollback = false) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[USER]);
    const result = (await db.query('select public.mali_sync_vault($1,$2,$3::jsonb) as result',
      [USER,revision,JSON.stringify(value)])).rows[0].result;
    await db.exec(rollback ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}

test('RPC rejects malformed financial snapshots before any write', async t => {
  const db = await fixtureDatabase();
  try {
    const original = payload(fixture('personal'));
    const accepted = await invoke(db,null,original);
    assert.equal(accepted.ok,true);
    const revision = accepted.updatedAt;
    const sale = s => s.deals[0].sales.find(x => !x.isPersonalTake);
    const take = s => s.deals[0].sales.find(x => x.isPersonalTake);
    const variants = [
      ['negative physical cash',s => { s.accounts[0].balance=-1; }],
      ['money exceeds supported range',s => { s.accounts[0].balance=2e12; }],
      ['snapshot/projection precision split',s => { s.accounts[0].balance=1.005; }],
      ['missing transaction account',s => { s.transactions.find(x=>x.type==='deal_sell').accountId='missing'; }],
      ['wrong transaction currency',s => { s.transactions.find(x=>x.type==='deal_sell').currency='USD'; }],
      ['debt installments do not reconcile',s => { s.debts[0].installments=[]; }],
      ['deal sales do not reconcile',s => { s.deals[0].sales=[]; }],
      ['malformed nested sale',s => { s.deals[0].sales=[null]; }],
      ['100 percent default cheque discount',s => { s.marketRates.defaultChequeDiscountPercent=100; }],
      ['exchange rate exceeds supported range',s => { s.marketRates.cashUsdToLyd=1000001; }],
      ['exchange rate exceeds four decimal places',s => { s.marketRates.cashUsdToLyd=6.12345; }],
      ['missing account currency enum',s => { delete s.accounts[0].currency; }],
      ['invalid account category enum',s => { s.accounts[0].category='anything'; }],
      ['invalid transaction method enum',s => { s.transactions[0].paymentMethod='anything'; }],
      ['missing transaction type enum',s => { delete s.transactions[0].type; }],
      ['wrong sale target currency',s => { sale(s).targetLydAccountId='usd'; }],
      ['wrong personal target currency',s => { take(s).targetLydAccountId='cash'; }],
      ['personal allocation cannot generate profit',s => { take(s).profitLyd=1; }],
      ['personal allocation cannot generate proceeds',s => { take(s).netLydReceived=1; }],
      ['sale gross does not match quantity and rate',s => { sale(s).grossLyd+=1; }],
      ['sale profit does not match net minus cost',s => { sale(s).profitLyd+=1; }],
      ['nested sale duplicate identity',s => { s.deals[0].sales.push({...sale(s)}); }],
      ['nested installment duplicate identity',s => { s.debts[0].installments.push({...s.debts[0].installments[0]}); }],
      ['installment amount has fractional cents',s => { s.debts[0].installments[0].amount=1.005; }],
      ['dangling installment transaction',s => { s.debts[0].installments[0].transactionId='missing'; }],
      ['dangling initial debt transaction',s => { s.debts[0].initialTransactionId='missing'; }],
      ['mismatched debt status',s => { s.debts[0].status='completed'; }],
      ['mismatched deal status',s => { s.deals[0].status='closed'; }],
      ['dangling sale transaction reference',s => { s.transactions.find(x=>x.type==='deal_sell').saleId='missing'; }],
      ['dangling contact reference',s => { sale(s).contactId='missing'; }],
      ['duplicate request keys',s => { s.transactions[0].idempotencyKey='same';s.transactions[1].idempotencyKey='same'; }],
      ['malformed receipt array',s => { sale(s).receiptImages=[null]; }],
      ['nested optional text cannot change projection type',s => { sale(s).notes={bad:true}; }],
      ['effective purchase rate does not match cost',s => { s.deals[0].effectiveBuyRate=1; }],
      ['duplicate sale journals with distinct IDs',s => { s.transactions.push({...s.transactions.find(x=>x.type==='deal_sell'),id:'duplicate-sale-journal'}); }],
      ['personal journal cannot charge a fee',s => { s.transactions.find(x=>x.type==='deal_personal_take').feeAmount=0.01; }],
      ['expense linked to principal must match the initial journal',s => { s.transactions.push({id:'wrong-initial',title:'wrong',type:'expense',amount:1,currency:'LYD',category:'test',accountId:'cash',debtId:'debt',paymentMethod:'cash',date:DATE}); }],
      ['malformed procedure stages',s => { s.procedures=[{id:'p',title:'p',procedureType:'إجراء مصرفي عام',bankOrEntity:'bank',status:'pending',createdAt:DATE,stages:[null]}]; }],
      ['invalid budget limit',s => { s.budgets=[{id:'b',category:'general',monthlyLimitLyd:-1,color:'#000',icon:'cash'}]; }],
    ];
    for(const invalid of ['infinity','-infinity','now','today','tomorrow','yesterday','epoch',
      'next Monday','2026-10-12 22:00:00','2026-10-12T22:00:00','2026-02-30',
      '2026-04-31T00:00:00Z','2026-10-12T24:00:00Z','2026-10-12T23:59:60Z',
      '10000-01-01T00:00:00Z','0000-01-01','9999-12-31T23:59:59-02:00']) {
      variants.push(['unsupported absolute timestamp '+invalid,s=>{s.lastModifiedAt=invalid;}]);
    }
    // The sentinel proves invalid payloads fail validation before account writes.
    await db.exec("CREATE FUNCTION public.fail_if_validation_reaches_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'validation reached a write'; END; $$; CREATE TRIGGER financial_validation_sentinel BEFORE INSERT OR UPDATE ON public.mali_accounts FOR EACH ROW EXECUTE FUNCTION public.fail_if_validation_reaches_write();");
    for (const [name, mutate] of variants) {
      await t.test(name, async () => {
        const value=structuredClone(original); mutate(value);
        await assert.rejects(invoke(db,revision,value,true), error => error.code==='22023',
          'Financial validation must reject before reaching any projection write');
        const saved=(await db.query('select payload,updated_at from public.mali_vault_snapshots')).rows[0];
        assert.deepEqual(saved.payload,original);
        assert.equal(new Date(saved.updated_at).getTime(),new Date(revision).getTime());
      });
    }
  } finally { await db.close(); }
});

test('PostgreSQL validates explicit non-cash settlements and overdraft metadata before writing', async t => {
  const db = await fixtureDatabase();
  try {
    let state = fixture('personal');
    state = engine.settleDebtInstallmentMutation(state, {
      debtId: 'debt', installmentId: 'sql-noncash', amount: 10,
      settlementType: 'non_cash', isNonCash: true,
      nonCashReason: 'مقاصة بمستند موثق',
    });
    const original = payload(state);
    const noncash = s => s.debts[0].installments.find(i => i.id === 'sql-noncash');
    assert.ok(noncash(original), 'The financial engine must actually create the non-cash installment');
    const accepted = await invoke(db, null, original);
    assert.equal(accepted.ok, true);
    const revision = accepted.updatedAt;
    const saved = (await db.query('SELECT payload FROM public.mali_vault_snapshots')).rows[0].payload;
    assert.deepEqual(saved, original);

    const variants = [
      ['non-cash with treasury', s => { noncash(s).accountId = 'bank'; }],
      ['non-cash with journal identity', s => { noncash(s).transactionId = 'forged'; }],
      ['non-cash false boolean marker', s => { noncash(s).isNonCash = false; }],
      ['non-cash missing boolean marker', s => { delete noncash(s).isNonCash; }],
      ['non-cash invalid boolean marker', s => { noncash(s).isNonCash = 'yes'; }],
      ['non-cash missing settlement type', s => { delete noncash(s).settlementType; }],
      ['non-cash invalid type', s => { noncash(s).settlementType = 'gift'; }],
      ['non-cash declared cash', s => { noncash(s).settlementType = 'cash'; }],
      ['non-cash missing reason', s => { delete noncash(s).nonCashReason; }],
      ['non-cash whitespace reason', s => { noncash(s).nonCashReason = '   '; }],
      ['non-cash object reason', s => { noncash(s).nonCashReason = { forged: true }; }],
      ['cash marked non-cash', s => {
        const cash = s.debts[0].installments.find(i => i.id === 'installment');
        cash.settlementType = 'cash'; cash.isNonCash = true;
      }],
      ['cash explicit without treasury', s => {
        const cash = s.debts[0].installments.find(i => i.id === 'installment');
        cash.settlementType = 'cash'; cash.isNonCash = false;
        delete cash.accountId;
      }],
      ['cash explicit without transaction', s => {
        const cash = s.debts[0].installments.find(i => i.id === 'installment');
        cash.settlementType = 'cash'; cash.isNonCash = false;
        delete cash.transactionId;
      }],
      ['unbounded overdraft flag', s => { s.accounts.find(a => a.id === 'bank').allowOverdraft = true; }],
      ['overdraft invalid limit', s => {
        const bank = s.accounts.find(a => a.id === 'bank');
        bank.allowOverdraft = true; bank.overdraftLimit = 0;
      }],
      ['overdraft on physical cash', s => {
        const cash = s.accounts.find(a => a.id === 'cash');
        cash.allowOverdraft = true; cash.overdraftLimit = 100;
      }],
      ['overdraft flag of wrong type', s => { s.accounts.find(a => a.id === 'bank').allowOverdraft = 'true'; }],
    ];
    for (const [name, mutate] of variants) {
      await t.test(name, async () => {
        const invalid = structuredClone(original);
        mutate(invalid);
        await assert.rejects(invoke(db, revision, invalid, true), err => err.code === '22023');
        const stillSaved = (await db.query('SELECT payload FROM public.mali_vault_snapshots')).rows[0].payload;
        assert.deepEqual(stillSaved, original);
      });
    }

    await t.test('bounded bank overdraft metadata is accepted intact', async () => {
      const valid = structuredClone(original);
      const bank = valid.accounts.find(a => a.id === 'bank');
      bank.allowOverdraft = true;
      bank.overdraftLimit = 250;
      const result = await invoke(db, revision, valid, true);
      assert.equal(result.ok, true);
    });
  } finally {
    await db.close();
  }
});

test('engine-generated personal allocations and exact cost/profit survive RPC round trips', async t => {
  const db=await fixtureDatabase();
  try {
    let revision=null;
    for (const personalTarget of [undefined,'usd','personal']) {
      await t.test('personal target '+String(personalTarget),async()=>{
        const s=fixture(personalTarget);
        const value=payload(s);
        const result=await invoke(db,revision,value);
        assert.equal(result.ok,true);revision=result.updatedAt;
        const saved=(await db.query('select payload from public.mali_vault_snapshots')).rows[0].payload;
        assert.deepEqual(saved,value);
        const restored=engine.validateAndSanitizeBackupPayload(JSON.stringify(saved),initial());
        assert.equal(restored.valid,true);
        assert.deepEqual(restored.state.accounts.map(x=>x.balance),s.accounts.map(x=>x.balance));
        assert.deepEqual(restored.state.deals.map(x=>x.realizedProfitLyd),s.deals.map(x=>x.realizedProfitLyd));
        for(const a of s.accounts){const row=(await db.query('select balance,sync_payload from public.mali_accounts where id=$1',[a.id])).rows[0];assert.equal(Number(row.balance),a.balance);assert.deepEqual(row.sync_payload,a);}
      });
    }
    await t.test('closed fragmented sales conserve commission cents',async()=>{
      let s=fixture();
      s=engine.sellFromUsdDealMutation(s,{saleId:'final',dealId:'deal',usdAmount:6,
        sellRate:6.5555,commissionLyd:0.02,paymentMethod:'cash',sourceUsdAccountId:'usd',targetLydAccountId:'cash'});
      assert.equal(s.deals[0].status,'closed');
      const result=await invoke(db,revision,payload(s));assert.equal(result.ok,true);revision=result.updatedAt;
      const d=(await db.query('select sync_payload from public.mali_usd_deals')).rows[0].sync_payload;
      assert.equal(engine.roundMoney(d.sales.reduce((sum,x)=>sum+x.costBasisLyd,0)),d.totalLydCost);
      const wrong=payload(s);
      wrong.deals[0].sales[0].costBasisLyd=engine.roundMoney(wrong.deals[0].sales[0].costBasisLyd-0.01);
      wrong.deals[0].sales[0].profitLyd=engine.roundMoney(wrong.deals[0].sales[0].profitLyd+0.01);
      wrong.deals[0].realizedProfitLyd=engine.roundMoney(wrong.deals[0].realizedProfitLyd+0.01);
      await assert.rejects(invoke(db,revision,wrong,true),error=>error.code==='22023');
    });
    await t.test('whole-deal and debt reversals can be synchronized together',async()=>{
      let s=fixture('personal');s=engine.deleteUsdDealMutation(s,'deal');s=engine.deleteDebtMutation(s,'debt');
      const result=await invoke(db,revision,payload(s));assert.equal(result.ok,true);
      assert.equal((await db.query('select count(*)::int as n from public.mali_transactions')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int as n from public.mali_usd_deals')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int as n from public.mali_debts')).rows[0].n,0);
      revision=result.updatedAt;
    });
    await t.test('80 engine quantity/rate/commission combinations preserve exact financial values',async()=>{
      for(const quantity of [0.01,0.03,1.23,17.01,10000]) {
        for(const rate of [2.0001,6.2,6.2345,9.9876]) {
          for(const commission of [0,0.01,0.49,1.07]) {
            let s=fixture();s=engine.deleteUsdDealMutation(s,'deal');s=engine.deleteDebtMutation(s,'debt');
            s=engine.createUsdDealMutation(s,{id:'range-deal',title:'range',totalUsdBought:quantity,
              buyRate:rate,buyCommissionLyd:commission,buyPaymentMethod:'cash',sourceLydAccountId:'cash',usdHoldingAccountId:'usd'});
            assert.equal(s.deals.length,1);
            s=engine.sellFromUsdDealMutation(s,{saleId:'range-sale',dealId:'range-deal',usdAmount:quantity,
              sellRate:rate,commissionLyd:0,paymentMethod:'cash',sourceUsdAccountId:'usd',targetLydAccountId:'cash'});
            assert.equal(s.deals[0].remainingUsd,0);
            const result=await invoke(db,revision,payload(s));assert.equal(result.ok,true);revision=result.updatedAt;
            const saved=(await db.query('select sync_payload from public.mali_usd_deals')).rows[0].sync_payload;
            assert.equal(saved.realizedProfitLyd,commission === 0 ? 0 : -commission);
            assert.equal(saved.sales[0].costBasisLyd,saved.totalLydCost);
          }
        }
      }
    });
    await t.test('documented money boundary and signed bank balances round trip unchanged',async()=>{
      const s=initial();
      s.accounts=[{id:'cash',name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:1e12,isCash:true,color:'#000',updatedAt:DATE},
        {id:'bank',name:'Bank',bankName:'Bank',category:'bank_lyd',currency:'LYD',balance:-0.01,isCash:false,color:'#000',updatedAt:DATE}];
      const result=await invoke(db,revision,payload(s));assert.equal(result.ok,true);
      revision=result.updatedAt;
      assert.equal(Number((await db.query("select balance from public.mali_accounts where id='cash'")).rows[0].balance),1e12);
      assert.equal(Number((await db.query("select balance from public.mali_accounts where id='bank'")).rows[0].balance),-0.01);
      for(const role of ['anon','authenticated']) {
        assert.equal((await db.query("select has_schema_privilege($1,'mali_validation','CREATE') as allowed",[role])).rows[0].allowed,false);
      }
      assert.equal((await db.query("select has_schema_privilege('anon','mali_validation','USAGE') as allowed")).rows[0].allowed,false);
      assert.equal((await db.query("select bool_or(p.prosecdef) as elevated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='mali_validation'")).rows[0].elevated,false);
    });
    await t.test('absolute calendar and zoned timestamps are finite and calendar-valid',async()=>{
      for(const absolute of ['2026-10-12','2024-02-29','2026-10-12T22:00:00.123Z',
        '2026-10-12T22:00:00.123456+02:00','9999-12-31T23:59:59Z']) {
        const s=initial();s.lastModifiedAt=absolute;
        const result=await invoke(db,revision,payload(s));assert.equal(result.ok,true);revision=result.updatedAt;
      }
      await db.exec("SET TIME ZONE 'Africa/Tripoli'");
      const value=(await db.query("select mali_validation.require_timestamp($1::jsonb,'date') as value",[JSON.stringify('2026-10-12')])).rows[0].value;
      assert.equal(new Date(value).toISOString(),'2026-10-12T00:00:00.000Z');
    });
  } finally { await db.close(); }
});
