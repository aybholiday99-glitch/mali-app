import assert from 'node:assert/strict';
import test from 'node:test';
import * as engine from '../src/services/financialEngine.ts';
import { appendFinancialAudit, validateFinancialAudit, MAX_FINANCIAL_AUDIT_BYTES } from '../src/services/financialAudit.ts';

const OWNER='11111111-1111-4111-8111-111111111111',DATE='2026-10-12T00:00:00.000Z';
const metadata=(action,id)=>({ownerId:OWNER,action,reason:'Independent test reason',operationId:id});
function state(){return {accounts:[{id:'cash',name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#000',updatedAt:DATE}],contacts:[],transactions:[],deals:[],debts:[],procedures:[],budgets:[],marketRates:{cashUsdToLyd:6.2,chequeUsdToLyd:6.3,defaultChequeDiscountPercent:0,updatedAt:DATE},supabaseConfig:{url:'https://example.invalid',anonKey:'',workspaceKey:'',autoSync:false},lastModifiedAt:DATE};}
function spend(s){return engine.recordExpenseOrIncomeMutation(s,{id:'expense',idempotencyKey:'spend-once',title:'Expense',type:'expense',amount:10,currency:'LYD',category:'test',accountId:'cash',paymentMethod:'cash',date:DATE});}

test('new audit observes legacy records honestly and preserves exact deleted transaction evidence',()=>{
  const before=state(),spent=appendFinancialAudit(before,spend(before),metadata('expense','spend-once'));
  assert.equal(spent.financialAudit[0].action,'observed_baseline');
  assert.equal(spent.financialAudit[0].changes[0].before,null);
  assert.equal(spent.financialAudit[0].changes.some(c=>c.collection==='transactions'),false);
  const deleted=appendFinancialAudit(spent,engine.deleteTransactionMutation(spent,'expense'),metadata('reversal','reverse-once'));
  assert.equal(deleted.accounts[0].balance,100);
  assert.equal(deleted.transactions.length,0);
  const evidence=deleted.financialAudit.at(-1).changes.find(c=>c.collection==='transactions');
  assert.equal(evidence.before.id,'expense');assert.equal(evidence.before.amount,10);assert.equal(evidence.after,null);
  assert.deepEqual(deleted.financialAudit.slice(0,-1),spent.financialAudit);
  validateFinancialAudit(deleted.financialAudit,deleted,OWNER);
  assert.equal(appendFinancialAudit(deleted,spend(deleted),metadata('expense','spend-once')),deleted,'deleted operations remain idempotent');
});

test('manual balances are explicit corrections with old/new images, never invented income entries',()=>{
  const before=state(),next=appendFinancialAudit(before,engine.updateAccountBalanceMutation(before,'cash',75.25),metadata('manual_balance','balance-once'));
  assert.equal(next.transactions.length,0);
  const change=next.financialAudit.at(-1).changes.find(c=>c.collection==='accounts');
  assert.equal(change.before.balance,100);assert.equal(change.after.balance,75.25);
  assert.equal(next.financialAudit.at(-1).ownerId,OWNER);
  validateFinancialAudit(next.financialAudit,next,OWNER);
  before.accounts[0].name='changed later';assert.equal(change.before.name,'Cash','evidence is detached');
});

test('rejected/no-op mutations do not invent audit events and blank reasons/foreign owners fail',()=>{
  const before=state();assert.equal(appendFinancialAudit(before,before,metadata('expense','noop')),before);
  assert.throws(()=>appendFinancialAudit(before,spend(before),{ownerId:OWNER,action:'expense',reason:''}));
  const next=appendFinancialAudit(before,spend(before),metadata('expense','spend-once'));
  assert.throws(()=>appendFinancialAudit(next,engine.updateAccountBalanceMutation(next,'cash',95),{ownerId:'other',action:'manual_balance',reason:'why'}));
});

test('backup round trips audited evidence and rejects mutation, truncation and duplicate events',()=>{
  const before=state(),next=appendFinancialAudit(before,spend(before),metadata('expense','spend-once'));
  const restored=engine.validateAndSanitizeBackupPayload(JSON.stringify(next),before);
  assert.equal(restored.valid,true);assert.deepEqual(restored.state.financialAudit,next.financialAudit);
  for(const corrupt of [
    {...next,financialAudit:next.financialAudit.slice(0,1)},
    {...next,financialAudit:[...next.financialAudit,next.financialAudit.at(-1)]},
    {...next,financialAudit:next.financialAudit.map((e,i)=>i?{...e,changes:e.changes.map(c=>c.collection==='accounts'?{...c,after:{...c.after,balance:999}}:c)}:e)},
  ])assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify(corrupt),before).valid,false);
  const legacy=engine.validateAndSanitizeBackupPayload(JSON.stringify(before),before);assert.equal(legacy.valid,true);assert.equal(legacy.state.financialAudit,undefined);
});

test('audit size is bounded without deleting prior evidence',()=>{
  const before=state(),next=spend(before);next.transactions[0].notes='x'.repeat(MAX_FINANCIAL_AUDIT_BYTES);
  assert.throws(()=>appendFinancialAudit(before,next,metadata('expense','oversize')));
  assert.equal(before.financialAudit,undefined);assert.equal(before.accounts[0].balance,100);
});

test('whole deal and debt reversals retain every linked record and nested installment image',()=>{
  let before=state();
  before=engine.createAccountMutation(before,{id:'usd',name:'USD',bankName:'Cash',category:'cash_usd',currency:'USD',balance:0,isCash:true,color:'#000'});
  const purchased=appendFinancialAudit(before,engine.createUsdDealMutation(before,{id:'deal',title:'Deal',totalUsdBought:10,buyRate:6,buyCommissionLyd:0,buyPaymentMethod:'cash',sourceLydAccountId:'cash',usdHoldingAccountId:'usd'}),metadata('financial_update','buy'));
  const sold=appendFinancialAudit(purchased,engine.sellFromUsdDealMutation(purchased,{saleId:'sale',dealId:'deal',usdAmount:2,sellRate:7,commissionLyd:0,paymentMethod:'cash',targetLydAccountId:'cash',sourceUsdAccountId:'usd'}),metadata('financial_update','sale'));
  const removed=appendFinancialAudit(sold,engine.deleteUsdDealMutation(sold,'deal'),metadata('reversal','reverse-deal'));
  const images=removed.financialAudit.at(-1).changes;
  assert.equal(images.find(c=>c.collection==='deals').before.sales[0].id,'sale');
  assert.equal(images.filter(c=>c.collection==='transactions'&&c.after===null).length,2);
  assert.equal(removed.accounts.find(a=>a.id==='cash').balance,100);
  validateFinancialAudit(removed.financialAudit,removed,OWNER);
  const debt=appendFinancialAudit(removed,engine.addDebtRecordMutation(removed,{id:'debt',personName:'Customer',direction:'receivable',currency:'LYD',totalAmount:20,accountId:'cash'}),metadata('financial_update','debt'));
  const settled=appendFinancialAudit(debt,engine.settleDebtInstallmentMutation(debt,{debtId:'debt',amount:5,accountId:'cash',paymentMethod:'cash'}),metadata('financial_update','installment'));
  const reversed=appendFinancialAudit(settled,engine.deleteDebtMutation(settled,'debt'),metadata('reversal','reverse-debt'));
  assert.equal(reversed.financialAudit.at(-1).changes.find(c=>c.collection==='debts').before.installments[0].amount,5);
  assert.equal(reversed.financialAudit.at(-1).changes.filter(c=>c.collection==='transactions').length,2);
  assert.equal(reversed.accounts.find(a=>a.id==='cash').balance,100);
  validateFinancialAudit(reversed.financialAudit,reversed,OWNER);
});

test('replacement/import keeps original prefix and evidence, rejecting supplied alternate journals',()=>{
  const before=state(),spent=appendFinancialAudit(before,spend(before),metadata('financial_update','spend'));
  const chosen={...spent,financialAudit:undefined,transactions:[],accounts:spent.accounts.map(a=>({...a,balance:85}))};
  const resolved=appendFinancialAudit(spent,chosen,metadata('conflict_resolution','resolve'));
  assert.deepEqual(resolved.financialAudit.slice(0,-1),spent.financialAudit);
  assert.equal(resolved.financialAudit.at(-1).changes.find(c=>c.collection==='transactions').before.id,'expense');
  assert.throws(()=>appendFinancialAudit(spent,{...chosen,financialAudit:[]},metadata('import','import')));
});
