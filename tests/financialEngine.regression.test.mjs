import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as engine from '../src/services/financialEngine.ts';

const DATE = '2026-10-12T00:00:00.000Z';
test('operand-based UI quotes match persisted purchases, commissions and effective rates at decimal ties',()=>{
  assert.equal(engine.multiplyMoney(2.3,1.15),2.65);
  assert.equal(engine.proportionalMoney(100,2.65,100),2.65);
  assert.equal(engine.proportionalMoney(100000,0.12345,100),123.45);
  const chequeState=state();
  chequeState.accounts.find(account=>account.id==='bank').isCash=false;
  chequeState.accounts.find(account=>account.id==='bank').balance=100000;
  const liquidated=engine.liquidateChequeToCashMutation(chequeState,{title:'Precise fee',fromBankAccountId:'bank',toCashAccountId:'lyd',grossChequeAmountLyd:100000,discountPercent:0.12345});
  assert.equal(liquidated.transactions[0].feeAmount,engine.proportionalMoney(100000,0.12345,100));
  assert.equal(engine.subtractRates(1.1525,1.15),0.0025);
  for(const quantity of [2.3,10.075,0.03]) for(const rate of [1.15,6.2345]) for(const fee of [0,0.075]) {
    const qty=engine.roundMoney(quantity),commission=engine.roundMoney(fee);
    const persisted=buy(state(),{totalUsdBought:quantity,buyRate:rate,buyCommissionLyd:fee}).deals[0];
    const gross=engine.multiplyMoney(qty,engine.roundRate(rate));
    const total=engine.addMoney(gross,commission);
    assert.equal(gross,persisted.grossLydCost);
    assert.equal(total,persisted.totalLydCost);
    assert.equal(engine.calculateEffectiveRate(total,qty),persisted.effectiveBuyRate);
    assert.equal(engine.proportionalMoney(total,qty,qty),total);
  }
});
test('generated identities remain unique during same-clock same-random events',()=>{
  const clock=Date.now,random=Math.random;
  try {
    Date.now=()=>1;
    Math.random=()=>0;
    const ids=Array.from({length:20},()=>engine.generateId('cnt'));
    assert.equal(new Set(ids).size,20);
  } finally {Date.now=clock;Math.random=random;}
});
test('contact identities stay immutable and referenced financial history prevents deletion or orphan imports',()=>{
  const original=state();
  original.contacts=[{id:'contact',name:'Customer',phone:'',role:'تاجر عملة',createdAt:DATE}];
  for(const snapshot of [
    {...original,transactions:[{id:'t',title:'Income',type:'income',amount:1,currency:'LYD',category:'test',accountId:'lyd',paymentMethod:'cash',date:DATE,contactId:'contact'}]},
    engine.createUsdDealMutation(original,{id:'d',title:'Deal',totalUsdBought:1,buyRate:6,buyCommissionLyd:0,buyPaymentMethod:'cash',sourceLydAccountId:'lyd',usdHoldingAccountId:'usd',contactId:'contact'}),
    engine.addDebtRecordMutation(original,{id:'debt',personName:'Customer',contactId:'contact',direction:'receivable',currency:'LYD',totalAmount:1}),
  ]) {
    assert.equal(engine.deleteContactMutation(snapshot,'contact'),snapshot);
    assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify({...snapshot,contacts:[]}),original).valid,false);
  }
  const updated=engine.updateContactMutation(original,'contact',{id:'replacement',createdAt:'invalid',name:'Updated'});
  assert.equal(updated.contacts[0].id,'contact');
  assert.equal(updated.contacts[0].createdAt,DATE);
  assert.equal(updated.contacts[0].name,'Updated');
  assert.equal(engine.deleteContactMutation(original,'contact').contacts.length,0);
  assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify({...original,contacts:[...original.contacts,...original.contacts]}),original).valid,false);
});
test('market settings reject corrupt rates/discounts atomically and normalize supported decimal rates',()=>{
  const before=state();
  for(const value of [NaN,Infinity,-1,0,1e6+1,0.00001]) {
    assert.equal(engine.updateMarketRatesMutation(before,{cashUsdToLyd:value,chequeUsdToLyd:7}),before);
  }
  for(const value of [NaN,Infinity,-1,100,101]) assert.equal(engine.updateMarketRatesMutation(before,{defaultChequeDiscountPercent:value}),before);
  const updated=engine.updateMarketRatesMutation(before,{cashUsdToLyd:6.23456,chequeUsdToLyd:6.34567,defaultChequeDiscountPercent:0});
  assert.equal(updated.marketRates.cashUsdToLyd,6.2346);
  assert.equal(updated.marketRates.chequeUsdToLyd,6.3457);
  assert.equal(updated.marketRates.defaultChequeDiscountPercent,0);
  assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify(updated),before).valid,true);
  assert.deepEqual(updated.accounts,before.accounts);
});
function state() {
  return {
    accounts: [
      ['lyd', 'LYD', 100000], ['bank', 'LYD', 1000],
      ['usd', 'USD', 0], ['personal', 'USD', 0],
    ].map(([id, currency, balance]) => ({ id, name: id, bankName: id,
      currency, balance, category: currency === 'USD' ? 'cash_usd' : 'cash_lyd',
      isCash: true, color: '#000000', updatedAt: DATE })),
    contacts: [], transactions: [], deals: [], debts: [], procedures: [], budgets: [],
    marketRates: { cashUsdToLyd: 6.2, chequeUsdToLyd: 6.3,
      defaultChequeDiscountPercent: 2.5, updatedAt: DATE },
    supabaseConfig: { url: '', anonKey: '', workspaceKey: 'isolated-tests', autoSync: false },
  };
}
function buy(s = state(), extra = {}) {
  return engine.createUsdDealMutation(s, { id: 'deal', title: 'test',
    totalUsdBought: 100, buyRate: 6.2, buyCommissionLyd: 0,
    buyPaymentMethod: 'cash', sourceLydAccountId: 'lyd', usdHoldingAccountId: 'usd', ...extra });
}
function sale(s, extra = {}) {
  return engine.sellFromUsdDealMutation(s, { saleId: 'sale', dealId: 'deal',
    usdAmount: 10, sellRate: 6.3, commissionLyd: 0, paymentMethod: 'cash',
    sourceUsdAccountId: 'usd', targetLydAccountId: 'lyd', ...extra });
}
function debt(s = state(), extra = {}) {
  return engine.addDebtRecordMutation(s, { id: 'debt', personName: 'person',
    currency: 'LYD', direction: 'receivable', totalAmount: 500, ...extra });
}

test('decimal half rounding is symmetric and finite at monetary boundaries', () => {
  assert.equal(engine.roundMoney(10.075), 10.08);
  assert.equal(engine.roundMoney(-10.075), -10.08);
  assert.equal(engine.roundMoney(0.1 + 0.2), 0.3);
  assert.equal(engine.roundMoney(NaN), 0);
  assert.ok(Number.isFinite(engine.roundMoney(1e308)));
});

test('invalid/unsafe amounts and fees never mutate balances or append records', () => {
  const s = state();
  for (const amount of [NaN, Infinity, -Infinity, 1e308, Number.MAX_SAFE_INTEGER]) {
    assert.equal(engine.recordExpenseOrIncomeMutation(s, { title: 'unsafe',
      type: 'income', amount, currency: 'LYD', category: 'general',
      accountId: 'lyd', paymentMethod: 'cash' }), s);
  }
  for (const feeAmount of [NaN, Infinity, -1]) {
    assert.equal(engine.recordTransferMutation(s, { title: 'unsafe fee', amount: 10,
      fromAccountId: 'lyd', toAccountId: 'bank', paymentMethod: 'cash', feeAmount }), s);
  }
});

test('every monetary operation enforces account currencies and references', () => {
  const s = state();
  assert.equal(engine.recordExpenseOrIncomeMutation(s, { title: 'wrong currency',
    type: 'income', amount: 10, currency: 'LYD', category: 'general',
    accountId: 'usd', paymentMethod: 'cash' }), s);
  assert.equal(engine.liquidateChequeToCashMutation(s, { title: 'wrong currency',
    fromBankAccountId: 'usd', toCashAccountId: 'lyd', grossChequeAmountLyd: 10,
    discountPercent: 1 }), s);
  assert.equal(debt(s, { accountId: 'missing' }), s);
  assert.equal(debt(s, { accountId: 'usd' }), s);
  const d = debt(s);
  assert.equal(engine.settleDebtInstallmentMutation(d, { debtId: 'debt', amount: 10,
    accountId: 'usd', paymentMethod: 'cash' }), d);
  const b = buy();
  assert.equal(sale(b, { targetLydAccountId: 'personal' }), b);
  assert.equal(sale(b, { sourceUsdAccountId: 'lyd' }), b);
});

test('personal allocation only accepts existing USD source/target accounts', () => {
  const s = buy();
  for (const targetPersonalUsdAccountId of ['lyd', 'missing']) {
    assert.equal(engine.takePersonalFromUsdDealMutation(s, { dealId: 'deal', usdAmount: 10,
      sourceUsdAccountId: 'usd', targetPersonalUsdAccountId }), s);
  }
  assert.equal(engine.takePersonalFromUsdDealMutation(s, { dealId: 'deal', usdAmount: 10,
    sourceUsdAccountId: 'missing' }), s);
});

for (const target of [undefined, 'usd', 'personal']) {
  test(`personal allocation/reversal conserves every balance (target=${target})`, () => {
    const before = buy();
    let s = engine.takePersonalFromUsdDealMutation(before, { saleId: 'personal-take',
      dealId: 'deal', usdAmount: 10, sourceUsdAccountId: 'usd', targetPersonalUsdAccountId: target });
    assert.equal(s.deals[0].realizedProfitLyd, 0);
    s = engine.deleteTransactionMutation(s, s.transactions.find(t => t.type === 'deal_personal_take').id);
    assert.deepEqual(s.accounts.map(a => a.balance), before.accounts.map(a => a.balance));
    assert.equal(s.deals[0].remainingUsd, 100);
    assert.equal(s.deals[0].personalTakenUsd, 0);
    assert.equal(s.deals[0].sales.length, 0);
    assert.equal(s.deals[0].status, 'open');
  });
}

test('individual USD sale reversal restores accounts and derived deal totals', () => {
  const before = buy();
  let s = sale(before);
  const tx = s.transactions.find(t => t.type === 'deal_sell');
  s = engine.deleteTransactionMutation(s, tx.id);
  assert.deepEqual(s.accounts.map(a => a.balance), before.accounts.map(a => a.balance));
  assert.equal(s.deals[0].remainingUsd, 100);
  assert.equal(s.deals[0].realizedProfitLyd, 0);
  assert.equal(s.deals[0].totalLydReceived, 0);
  assert.equal(engine.deleteTransactionMutation(s, tx.id), s);
});

test('full and fragmented sales conserve the complete original purchase cost', () => {
  const full = sale(buy(state(), { totalUsdBought: 10000, buyCommissionLyd: 0.49 }),
    { usdAmount: 10000 });
  assert.equal(full.deals[0].realizedProfitLyd, 999.51);
  for (const commission of [0.01, 0.02, 0.49, 1.07]) {
    let s = buy(state(), { totalUsdBought: 3, buyCommissionLyd: commission });
    for (let i = 0; i < 3; i++) s = sale(s, { saleId: `s-${i}`, usdAmount: 1 });
    const d = s.deals[0];
    assert.equal(engine.roundMoney(d.sales.reduce((total, x) => total + x.costBasisLyd, 0)), d.totalLydCost);
    assert.equal(d.realizedProfitLyd, engine.roundMoney(d.totalLydReceived - d.totalLydCost));
  }
});

test('cost conservation survives personal allocations and an earlier sale reversal', () => {
  let s = buy(state(), { totalUsdBought: 3, buyCommissionLyd: 0.02 });
  s = sale(s, { saleId: 'first', usdAmount: 1 });
  s = engine.takePersonalFromUsdDealMutation(s, { saleId: 'personal', dealId: 'deal',
    usdAmount: 1, sourceUsdAccountId: 'usd' });
  s = sale(s, { saleId: 'last', usdAmount: 1 });
  s = engine.deleteTransactionMutation(s, s.transactions.find(t => t.saleId === 'first').id);
  s = sale(s, { saleId: 'replacement', usdAmount: 1 });
  const d = s.deals[0];
  assert.equal(d.remainingUsd, 0);
  assert.equal(engine.roundMoney(d.sales.reduce((sum, x) => sum + x.costBasisLyd, 0)), d.totalLydCost);
  assert.equal(d.sales.find(x => x.isPersonalTake).profitLyd, 0);
});

test('independent cent oracle validates 80 quantity/rate/commission combinations', () => {
  const roundedQuotient = (n, d) => (n + d / 2n) / d;
  for (const qtyCents of [1n, 3n, 123n, 1701n, 1000000n]) {
    for (const rateUnits of [20001n, 62000n, 62345n, 99876n]) {
      for (const commissionCents of [0n, 1n, 49n, 107n]) {
        let s = buy(state(), { totalUsdBought: Number(qtyCents) / 100,
          buyRate: Number(rateUnits) / 10000, buyCommissionLyd: Number(commissionCents) / 100 });
        assert.equal(s.deals.length, 1);
        const expectedCost = roundedQuotient(qtyCents * rateUnits, 10000n) + commissionCents;
        assert.equal(s.deals[0].totalLydCost, Number(expectedCost) / 100);
        let left = qtyCents;
        let proceeds = 0n;
        let index = 0;
        while (left > 0n) {
          const piece = left > 2n ? left / 2n : left;
          proceeds += roundedQuotient(piece * (rateUnits + 2000n), 10000n);
          s = sale(s, { saleId: `oracle-${index++}`, usdAmount: Number(piece) / 100,
            sellRate: Number(rateUnits + 2000n) / 10000 });
          left -= piece;
        }
        const d = s.deals[0];
        assert.equal(d.remainingUsd, 0);
        assert.equal(d.realizedProfitLyd, Number(proceeds - expectedCost) / 100);
        assert.equal(engine.roundMoney(d.sales.reduce((sum, x) => sum + x.costBasisLyd, 0)), Number(expectedCost) / 100);
      }
    }
  }
});

test('no-account non-cash settlement uses the same idempotency contract without cash movement', () => {
  const before = debt();
  const input = {
    debtId: 'debt',
    amount: 100,
    settlementType: 'non_cash',
    isNonCash: true,
    nonCashReason: 'مقاصة ديون',
    idempotencyKey: 'same-submit',
  };
  const paid = engine.settleDebtInstallmentMutation(before, input);
  assert.equal(paid.debts[0].paidAmount, 100);
  assert.equal(engine.settleDebtInstallmentMutation(paid, input), paid);
  assert.deepEqual(paid.accounts, before.accounts);
  assert.deepEqual(paid.transactions, before.transactions);
});

test('cash settlement without treasury account is strictly rejected', () => {
  const before = debt();
  const input = { debtId: 'debt', amount: 100, paymentMethod: 'cash', idempotencyKey: 'no-acc-submit' };
  const rejected = engine.settleDebtInstallmentMutation(before, input);
  assert.equal(rejected, before);
});

test('cash outflows and fees cannot overdraw the account', () => {
  const s = state();
  assert.equal(engine.recordExpenseOrIncomeMutation(s, { title: 'overdraft', type: 'expense',
    amount: 1001, currency: 'LYD', category: 'general', accountId: 'bank', paymentMethod: 'cash' }), s);
  assert.equal(engine.recordTransferMutation(s, { title: 'overdraft', amount: 1000, feeAmount: 0.01,
    fromAccountId: 'bank', toAccountId: 'lyd', paymentMethod: 'cash' }), s);
  assert.equal(buy(s, { sourceLydAccountId: 'bank', totalUsdBought: 1000 }), s);
});

test('duplicate operation identities are rejected independently of retry keys', () => {
  let s = state();
  const input = { id: 'same', title: 'transfer', amount: 10, fromAccountId: 'lyd',
    toAccountId: 'bank', paymentMethod: 'cash' };
  s = engine.recordTransferMutation(s, input);
  assert.equal(engine.recordTransferMutation(s, input), s);
  const b = buy();
  assert.equal(buy(b), b);
  const sold = sale(b);
  assert.equal(sale(sold), sold);
  const d = debt();
  assert.equal(debt(d), d);
  const p = { installmentId: 'i', debtId: 'debt', amount: 10, accountId: 'lyd', paymentMethod: 'cash' };
  const paid = engine.settleDebtInstallmentMutation(d, p);
  assert.equal(engine.settleDebtInstallmentMutation(paid, p), paid);
});

for (const direction of ['receivable', 'payable']) {
  test(`deleting initial ${direction} transaction cannot reverse the principal twice`, () => {
    const before = state();
    let s = debt(before, { accountId: 'bank', direction, totalAmount: 100 });
    s = engine.deleteTransactionMutation(s, s.debts[0].initialTransactionId);
    s = engine.deleteDebtMutation(s, 'debt');
    assert.deepEqual(s.accounts.map(a => a.balance), before.accounts.map(a => a.balance));
    assert.equal(s.debts.length, 0);
  });
}

test('installment reversal resolves exact identity before equal-amount fallbacks', () => {
  let s = debt();
  for (const id of ['old', 'new']) s = engine.settleDebtInstallmentMutation(s,
    { installmentId: id, debtId: 'debt', amount: 100, accountId: 'lyd', paymentMethod: 'cash' });
  s = engine.deleteTransactionMutation(s, s.transactions.find(t => t.installmentId === 'old').id);
  assert.equal(s.debts[0].installments[0].id, 'new');
  assert.ok(s.transactions.some(t => t.id === s.debts[0].installments[0].transactionId));
  assert.equal(s.debts[0].paidAmount, 100);
});

test('account deletion blocks every retained financial reference', () => {
  let s = engine.recordTransferMutation(state(), { title: 'transfer', amount: 10,
    fromAccountId: 'lyd', toAccountId: 'bank', paymentMethod: 'cash' });
  assert.equal(engine.deleteAccountMutation(s, 'bank'), s);
  s = debt(state(), { accountId: 'bank' });
  assert.equal(engine.deleteAccountMutation(s, 'bank'), s);
  s = sale(buy(), { usdAmount: 100, targetLydAccountId: 'bank' });
  assert.equal(engine.deleteAccountMutation(s, 'bank'), s);
});

test('backup validation rejects duplicated IDs, broken references and inconsistent totals', () => {
  const base = state();
  const variants = [
    { ...base, accounts: [base.accounts[0], base.accounts[0]] },
    { ...debt(base), debts: [{ ...debt(base).debts[0], paidAmount: 999 }] },
    { ...base, transactions: [{ id: 'bad', type: 'income', amount: 100,
      currency: 'LYD', accountId: 'missing', paymentMethod: 'cash', date: DATE }] },
    { ...buy(), deals: [{ ...buy().deals[0], remainingUsd: 999 }] },
  ];
  for (const malformed of variants) {
    assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify(malformed), base).valid, false);
  }
  const valid = buy();
  assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify(valid), base).valid, true);
});

test('dashboard aggregates supported account balances without resetting large totals', () => {
  const s = state();
  s.accounts = s.accounts.filter(a => a.currency === 'LYD').map(a => ({ ...a, balance: 1e12 }));
  assert.equal(engine.reconcileDashboardSummary(s).totalLyd, 2e12);
  const loan = debt(state(), { accountId: 'bank', createdAt: DATE, totalAmount: 100 });
  assert.equal(engine.reconcileDashboardSummary(loan, new Date(DATE)).currentMonthExpensesLyd, 0);
});


test('backup imports enforce non-cash settlement contract and linked cash currency', () => {
  const empty = state();
  let snapshot = debt(empty);
  snapshot = engine.settleDebtInstallmentMutation(snapshot, {
    debtId: 'debt', installmentId: 'backup-noncash', amount: 100,
    settlementType: 'non_cash', isNonCash: true,
    nonCashReason: 'مقاصة بموافقة الطرفين',
  });
  assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify(snapshot), empty).valid, true);
  const mutate = (change) => {
    const forged = structuredClone(snapshot);
    const installment = forged.debts[0].installments[0];
    change(installment);
    assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify(forged), empty).valid, false);
  };
  mutate(i => { i.accountId = 'lyd'; });
  mutate(i => { i.transactionId = 'forged-cash-journal'; });
  mutate(i => { i.isNonCash = false; });
  mutate(i => { delete i.settlementType; });
  mutate(i => { i.nonCashReason = '   '; });
  mutate(i => { i.nonCashReason = { unsafe: true }; });
  mutate(i => { i.settlementType = 'cash'; });

  let cash = debt(empty, { accountId: 'lyd' });
  cash = engine.settleDebtInstallmentMutation(cash, {
    debtId: 'debt', installmentId: 'backup-cash', amount: 100,
    accountId: 'lyd', paymentMethod: 'cash',
  });
  assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify(cash), empty).valid, true);
  const tampered = structuredClone(cash);
  const cashTx = tampered.transactions.find(tx => tx.installmentId === 'backup-cash');
  cashTx.currency = 'USD';
  assert.equal(engine.validateAndSanitizeBackupPayload(JSON.stringify(tampered), empty).valid, false);
});
