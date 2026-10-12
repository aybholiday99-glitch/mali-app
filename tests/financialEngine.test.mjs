import assert from 'node:assert/strict';
import './financialEngine.regression.test.mjs';
import {
  addDebtRecordMutation,
  createAccountMutation,
  createUsdDealMutation,
  deleteAccountMutation,
  deleteDebtMutation,
  deleteTransactionMutation,
  deleteUsdDealMutation,
  liquidateChequeToCashMutation,
  reconcileDashboardSummary,
  recordExpenseOrIncomeMutation,
  recordTransferMutation,
  roundMoney,
  roundRate,
  sellFromUsdDealMutation,
  settleDebtInstallmentMutation,
  takePersonalFromUsdDealMutation,
  updateAccountBalanceMutation,
  validateAndSanitizeBackupPayload,
} from '../src/services/financialEngine.ts';

function makeEmptyState() {
  return {
    accounts: [],
    contacts: [],
    transactions: [],
    deals: [],
    debts: [],
    procedures: [],
    budgets: [],
    marketRates: {
      cashUsdToLyd: 6.22,
      chequeUsdToLyd: 6.38,
      defaultChequeDiscountPercent: 2.5,
      updatedAt: '2026-10-12T00:00:00.000Z',
    },
    supabaseConfig: {
      url: 'https://evcwoaerlykghgdevrhb.supabase.co',
      anonKey: 'sb_publishable_thjoIAP26oAUvYPMPUJoJQ_uhex9L6s',
      workspaceKey: 'mali-test-vault',
      autoSync: false,
    },
  };
}

function runFinancialEngineTests() {
  console.log('=== Starting Financial Engine & Edge-Case Tests ===');

  // 1. Floating-point & Decimal Precision Tests
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(10000 * 0.025), 250);
  assert.equal(roundMoney(1234.567), 1234.57);
  assert.equal(roundMoney(NaN), 0);
  assert.equal(roundRate(31175 / 5000), 6.235);
  console.log('[PASS] 1. Exact decimal rounding (roundMoney / roundRate) verified.');

  // 2. Account Creation, Update, and Safe Deletion
  let state = makeEmptyState();
  state = createAccountMutation(state, {
    id: 'acc-lyd-cash',
    name: 'خزينة الكاش ليبي',
    bankName: 'كاش',
    category: 'cash_lyd',
    currency: 'LYD',
    balance: 100000,
    isCash: true,
    color: '#0D9488',
  });
  state = createAccountMutation(state, {
    id: 'acc-lyd-bank',
    name: 'مصرف الجمهورية صكوك',
    bankName: 'مصرف الجمهورية',
    category: 'bank_lyd',
    currency: 'LYD',
    balance: 50000,
    isCash: false,
    color: '#2563EB',
  });
  state = createAccountMutation(state, {
    id: 'acc-usd-cash',
    name: 'خزينة الدولار',
    bankName: 'كاش دولار',
    category: 'cash_usd',
    currency: 'USD',
    balance: 0,
    isCash: true,
    color: '#16A34A',
  });
  state = createAccountMutation(state, {
    id: 'acc-usd-personal',
    name: 'محفظة الدولار الشخصية',
    bankName: 'ادخار',
    category: 'cash_usd',
    currency: 'USD',
    balance: 0,
    isCash: true,
    color: '#7C3AED',
  });
  assert.equal(state.accounts.length, 4);

  // Reject duplicate account ID
  const dupState = createAccountMutation(state, {
    id: 'acc-lyd-cash',
    name: 'Duplicate',
    bankName: 'Dup',
    category: 'cash_lyd',
    currency: 'LYD',
    balance: 999,
    isCash: true,
    color: '#000',
  });
  assert.equal(dupState.accounts.length, 4);
  console.log('[PASS] 2. Account creation & duplicate ID protection verified.');

  // 3. Income, Expense, Transfer & Idempotency Deduplication
  state = recordExpenseOrIncomeMutation(state, {
    id: 'tx-exp-1',
    idempotencyKey: 'idem-exp-1',
    title: 'إيجار المكتب',
    type: 'expense',
    amount: 1500.55,
    currency: 'LYD',
    category: 'مصاريف تشغيلية',
    accountId: 'acc-lyd-cash',
    paymentMethod: 'cash',
  });
  assert.equal(
    state.accounts.find((a) => a.id === 'acc-lyd-cash').balance,
    98499.45
  );

  // Retry same expense with same idempotencyKey -> must NOT deduct again
  state = recordExpenseOrIncomeMutation(state, {
    idempotencyKey: 'idem-exp-1',
    title: 'إيجار المكتب (إعادة محاولة)',
    type: 'expense',
    amount: 1500.55,
    currency: 'LYD',
    category: 'مصاريف تشغيلية',
    accountId: 'acc-lyd-cash',
    paymentMethod: 'cash',
  });
  assert.equal(
    state.accounts.find((a) => a.id === 'acc-lyd-cash').balance,
    98499.45,
    'Idempotency key must prevent duplicate expense deduction'
  );

  // Reject negative/zero expense
  state = recordExpenseOrIncomeMutation(state, {
    title: 'قيمة سالبة غير صالحة',
    type: 'expense',
    amount: -500,
    currency: 'LYD',
    category: 'عام',
    accountId: 'acc-lyd-cash',
    paymentMethod: 'cash',
  });
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 98499.45);

  // Reject cross-currency internal transfer (LYD -> USD)
  state = recordTransferMutation(state, {
    title: 'تحويل خاطئ بين عملتين',
    fromAccountId: 'acc-lyd-cash',
    toAccountId: 'acc-usd-cash',
    amount: 1000,
    paymentMethod: 'transfer',
  });
  assert.equal(state.accounts.find((a) => a.id === 'acc-usd-cash').balance, 0);

  // Valid transfer with fee (Bank LYD -> Cash LYD)
  state = recordTransferMutation(state, {
    id: 'tx-trf-1',
    idempotencyKey: 'idem-trf-1',
    title: 'سحب من المصرف إلى الكاش',
    fromAccountId: 'acc-lyd-bank',
    toAccountId: 'acc-lyd-cash',
    amount: 5000,
    feeAmount: 15,
    paymentMethod: 'transfer',
  });
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-bank').balance, 44985);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 103499.45);

  // Reverse transfer via deleteTransactionMutation
  state = deleteTransactionMutation(state, 'tx-trf-1');
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-bank').balance, 50000);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 98499.45);
  // Reverse expense via deleteTransactionMutation
  state = deleteTransactionMutation(state, 'tx-exp-1');
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 100000);
  console.log('[PASS] 3. Income, Expense, Transfer, Idempotency & Reversal verified.');

  // 4. Cheque Liquidation & Reversal
  state = liquidateChequeToCashMutation(state, {
    id: 'tx-liq-1',
    idempotencyKey: 'idem-liq-1',
    title: 'تسييل صك 10,000 بخصم 2.5%',
    fromBankAccountId: 'acc-lyd-bank',
    toCashAccountId: 'acc-lyd-cash',
    grossChequeAmountLyd: 10000,
    discountPercent: 2.5,
  });
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-bank').balance, 40000);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 109750);

  state = deleteTransactionMutation(state, 'tx-liq-1');
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-bank').balance, 50000);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 100000);
  console.log('[PASS] 4. Cheque liquidation discount calculation and reversal verified.');

  // 5. USD Deal Lifecycle (Buy -> Partial Sales -> Personal Take -> Oversell Block -> Delete Reversal)
  state = createUsdDealMutation(state, {
    id: 'deal-test-1',
    idempotencyKey: 'idem-deal-1',
    title: 'شراء 10,000 دولار',
    totalUsdBought: 10000,
    buyRate: 6.20,
    buyCommissionLyd: 100, // Effective rate = 62,100 / 10,000 = 6.2100
    buyPaymentMethod: 'cash',
    sourceLydAccountId: 'acc-lyd-cash',
    usdHoldingAccountId: 'acc-usd-cash',
  });
  const createdDeal = state.deals.find((d) => d.id === 'deal-test-1');
  assert.equal(createdDeal.totalLydCost, 62100);
  assert.equal(createdDeal.effectiveBuyRate, 6.21);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 37900);
  assert.equal(state.accounts.find((a) => a.id === 'acc-usd-cash').balance, 10000);

  // Cannot delete account referenced by open deal
  const blockedDeleteAcc = deleteAccountMutation(state, 'acc-usd-cash');
  assert.equal(blockedDeleteAcc.accounts.length, 4, 'Must block deleting account with open USD deal');

  // Partial Sale 1: Sell 4,000 USD at 6.35 with 40 LYD commission
  // Gross = 25,400, Net = 25,360, CostBasis = 4000 * 6.21 = 24,840, Profit = +520 LYD
  state = sellFromUsdDealMutation(state, {
    saleId: 'sale-1',
    idempotencyKey: 'idem-sale-1',
    dealId: 'deal-test-1',
    usdAmount: 4000,
    sellRate: 6.35,
    commissionLyd: 40,
    paymentMethod: 'cash',
    targetLydAccountId: 'acc-lyd-cash',
    sourceUsdAccountId: 'acc-usd-cash',
  });
  let dealAfterSale1 = state.deals.find((d) => d.id === 'deal-test-1');
  assert.equal(dealAfterSale1.soldUsd, 4000);
  assert.equal(dealAfterSale1.remainingUsd, 6000);
  assert.equal(dealAfterSale1.realizedProfitLyd, 520);
  assert.equal(dealAfterSale1.status, 'partial');
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 63260);
  assert.equal(state.accounts.find((a) => a.id === 'acc-usd-cash').balance, 6000);

  // Personal Take: Take 1,000 USD to personal USD wallet -> profit must stay 520 LYD, remainingUsd = 5000
  state = takePersonalFromUsdDealMutation(state, {
    saleId: 'ptake-1',
    idempotencyKey: 'idem-ptake-1',
    dealId: 'deal-test-1',
    usdAmount: 1000,
    sourceUsdAccountId: 'acc-usd-cash',
    targetPersonalUsdAccountId: 'acc-usd-personal',
  });
  let dealAfterPtake = state.deals.find((d) => d.id === 'deal-test-1');
  assert.equal(dealAfterPtake.personalTakenUsd, 1000);
  assert.equal(dealAfterPtake.remainingUsd, 5000);
  assert.equal(dealAfterPtake.realizedProfitLyd, 520);
  assert.equal(state.accounts.find((a) => a.id === 'acc-usd-cash').balance, 5000);
  assert.equal(state.accounts.find((a) => a.id === 'acc-usd-personal').balance, 1000);

  // Reject overselling (trying to sell 6,000 USD when only 5,000 USD remains)
  const oversellAttempt = sellFromUsdDealMutation(state, {
    dealId: 'deal-test-1',
    usdAmount: 6000,
    sellRate: 6.40,
    commissionLyd: 0,
    paymentMethod: 'cash',
    targetLydAccountId: 'acc-lyd-cash',
    sourceUsdAccountId: 'acc-usd-cash',
  });
  assert.equal(
    oversellAttempt.deals.find((d) => d.id === 'deal-test-1').remainingUsd,
    5000,
    'Overselling beyond remainingUsd must be rejected'
  );

  // Delete entire USD deal -> must atomically restore all accounts to pre-deal balances (100,000 LYD, 0 USD, 0 Personal USD)
  state = deleteUsdDealMutation(state, 'deal-test-1');
  assert.equal(state.deals.length, 0);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 100000);
  assert.equal(state.accounts.find((a) => a.id === 'acc-usd-cash').balance, 0);
  assert.equal(state.accounts.find((a) => a.id === 'acc-usd-personal').balance, 0);
  assert.equal(state.transactions.length, 0);
  console.log('[PASS] 5. USD Deal buy, partial sale, personal take, oversell block, and full atomic reversal verified.');

  // 6. Debts Lifecycle & FIN-01 / FIN-02 Bug Fix Verification
  // Create a receivable debt of 5,000 LYD lent out from 'acc-lyd-cash' (balance becomes 95,000 LYD)
  state = addDebtRecordMutation(state, {
    id: 'debt-rec-1',
    idempotencyKey: 'idem-debt-1',
    personName: 'أحمد الورفلي',
    direction: 'receivable',
    currency: 'LYD',
    totalAmount: 5000,
    accountId: 'acc-lyd-cash',
    paymentMethod: 'cash',
  });
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 95000);
  assert.equal(state.debts[0].remainingAmount, 5000);

  // Settle installment 1: Receive 2,000 LYD into 'acc-lyd-cash' (balance becomes 97,000 LYD, remaining = 3,000 LYD)
  state = settleDebtInstallmentMutation(state, {
    installmentId: 'inst-1',
    idempotencyKey: 'idem-inst-1',
    debtId: 'debt-rec-1',
    amount: 2000,
    accountId: 'acc-lyd-cash',
    paymentMethod: 'cash',
  });
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 97000);
  assert.equal(state.debts[0].paidAmount, 2000);
  assert.equal(state.debts[0].remainingAmount, 3000);

  // Settle installment 2: Receive remaining 3,000 LYD into 'acc-lyd-bank' (bank becomes 53,000 LYD, debt status = 'completed')
  state = settleDebtInstallmentMutation(state, {
    installmentId: 'inst-2',
    idempotencyKey: 'idem-inst-2',
    debtId: 'debt-rec-1',
    amount: 3000,
    accountId: 'acc-lyd-bank',
    paymentMethod: 'transfer',
  });
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-bank').balance, 53000);
  assert.equal(state.debts[0].paidAmount, 5000);
  assert.equal(state.debts[0].remainingAmount, 0);
  assert.equal(state.debts[0].status, 'completed');

  // Verify FIN-02 Fix: Delete the 3,000 LYD debt_settlement transaction -> must reverse bank balance to 50,000 AND restore debt remainingAmount to 3,000 ('active')!
  const inst2Tx = state.transactions.find((t) => t.installmentId === 'inst-2');
  assert.ok(inst2Tx, 'Installment 2 transaction must exist');
  state = deleteTransactionMutation(state, inst2Tx.id);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-bank').balance, 50000);
  assert.equal(state.debts[0].paidAmount, 2000);
  assert.equal(state.debts[0].remainingAmount, 3000);
  assert.equal(state.debts[0].status, 'active');
  assert.equal(state.debts[0].installments.length, 1);
  console.log('[PASS] 6a. FIN-02 Fix verified: Deleting debt_settlement transaction recalculates DebtRecord & reverses account balance.');

  // Verify FIN-01 Fix: Delete the DebtRecord -> must reverse remaining installment (-2,000 from cash) and initial loan (+5,000 to cash), restoring cash to 100,000 LYD and removing all linked transactions!
  state = deleteDebtMutation(state, 'debt-rec-1');
  assert.equal(state.debts.length, 0);
  assert.equal(state.transactions.length, 0);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-cash').balance, 100000);
  assert.equal(state.accounts.find((a) => a.id === 'acc-lyd-bank').balance, 50000);
  console.log('[PASS] 6b. FIN-01 Fix verified: Deleting DebtRecord atomically reverses all account impacts and removes linked transactions.');

  // 7. Dashboard Reconciliation & Backup Validation
  const summary = reconcileDashboardSummary(state);
  assert.equal(summary.totalCashLyd, 100000);
  assert.equal(summary.totalBankLyd, 50000);
  assert.equal(summary.totalLyd, 150000);
  assert.equal(summary.totalUsd, 0);

  const invalidBackup = validateAndSanitizeBackupPayload('{bad json', state);
  assert.equal(invalidBackup.valid, false);

  const missingTablesBackup = validateAndSanitizeBackupPayload(JSON.stringify({ foo: 'bar' }), state);
  assert.equal(missingTablesBackup.valid, false);

  const validBackup = validateAndSanitizeBackupPayload(JSON.stringify(state), state);
  assert.equal(validBackup.valid, true);
  assert.equal(validBackup.state.accounts.length, 4);
  console.log('[PASS] 7. Dashboard reconciliation & JSON backup validation verified.');

  console.log('=== ALL FINANCIAL ENGINE TESTS PASSED ===');
}

runFinancialEngineTests();
