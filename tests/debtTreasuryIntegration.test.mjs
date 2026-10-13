import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDebtRecordMutation,
  createAccountMutation,
  deleteAccountMutation,
  deleteDebtMutation,
  deleteDebtInstallmentMutation,
  deleteTransactionMutation,
  settleDebtInstallmentMutation,
  canDisburseFromAccount,
  isDebtTransaction,
  reconcileDashboardSummary,
} from '../src/services/financialEngine.ts';

function createInitialState() {
  let state = {
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

  // Add Cash Treasury (10,000 LYD)
  state = createAccountMutation(state, {
    id: 'acc-cash-lyd',
    name: 'خزينة الكاش الرئيسي',
    currency: 'LYD',
    balance: 10000,
    isCash: true,
    color: '#0D9488',
  });

  // Add Bank Treasury (5,000 LYD)
  state = createAccountMutation(state, {
    id: 'acc-bank-lyd',
    name: 'حساب مصرف التجارة',
    bankName: 'مصرف التجارة والتنمية',
    currency: 'LYD',
    balance: 5000,
    isCash: false,
    color: '#3B82F6',
  });

  // Add USD Cash Treasury ($2,000)
  state = createAccountMutation(state, {
    id: 'acc-cash-usd',
    name: 'خزينة دولار كاش',
    currency: 'USD',
    balance: 2000,
    isCash: true,
    color: '#10B981',
  });

  return state;
}

test('Debt & Treasury Integration — Full Accounting Flow & Lifecycle', async (t) => {
  await t.test('1. Receivable debt creation deducts from chosen cash treasury and links transaction', () => {
    let state = createInitialState();
    const initialCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    assert.equal(initialCash, 10000);

    // Lend 2,500 LYD to Muhammad from Cash Treasury
    state = addDebtRecordMutation(state, {
      id: 'debt-rec-001',
      personName: 'محمد السنوسي',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 2500,
      accountId: 'acc-cash-lyd',
      dueDate: '2026-12-01',
      notes: 'سلفة مالية مستردة',
    });

    // Check account delta (-2,500 LYD)
    const updatedCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    assert.equal(updatedCash, 7500);

    // Check debt record
    const debt = state.debts.find((d) => d.id === 'debt-rec-001');
    assert.ok(debt);
    assert.equal(debt.totalAmount, 2500);
    assert.equal(debt.paidAmount, 0);
    assert.equal(debt.remainingAmount, 2500);
    assert.equal(debt.status, 'active');
    assert.equal(debt.accountId, 'acc-cash-lyd');

    // Check linked initial transaction
    const tx = state.transactions.find((tx) => tx.debtId === 'debt-rec-001');
    assert.ok(tx);
    assert.equal(tx.amount, 2500);
    assert.equal(tx.type, 'expense');
    assert.equal(tx.category, 'ديون وأمانات');
    assert.equal(tx.accountId, 'acc-cash-lyd');

    // Verify P&L Operating filter: Debt initial tx must NOT be counted as operating expense
    const operatingExpenses = state.transactions
      .filter((t) => t.type === 'expense' && !t.debtId && t.category !== 'ديون وأمانات')
      .reduce((sum, t) => sum + t.amount, 0);
    assert.equal(operatingExpenses, 0);
  });

  await t.test('2. Payable debt creation adds to chosen bank treasury and links transaction', () => {
    let state = createInitialState();
    const initialBank = state.accounts.find((a) => a.id === 'acc-bank-lyd').balance;
    assert.equal(initialBank, 5000);

    // Borrow / receive trust of 4,000 LYD into Bank Treasury
    state = addDebtRecordMutation(state, {
      id: 'debt-pay-001',
      personName: 'شركة الأمان',
      direction: 'payable',
      currency: 'LYD',
      totalAmount: 4000,
      accountId: 'acc-bank-lyd',
      dueDate: '2026-11-15',
      notes: 'أمانة مودعة بحساب المصرف',
    });

    // Check account delta (+4,000 LYD)
    const updatedBank = state.accounts.find((a) => a.id === 'acc-bank-lyd').balance;
    assert.equal(updatedBank, 9000);

    // Check debt record
    const debt = state.debts.find((d) => d.id === 'debt-pay-001');
    assert.ok(debt);
    assert.equal(debt.totalAmount, 4000);
    assert.equal(debt.paidAmount, 0);
    assert.equal(debt.remainingAmount, 4000);
    assert.equal(debt.status, 'active');
    assert.equal(debt.accountId, 'acc-bank-lyd');

    // Check linked initial transaction
    const tx = state.transactions.find((tx) => tx.debtId === 'debt-pay-001');
    assert.ok(tx);
    assert.equal(tx.amount, 4000);
    assert.equal(tx.type, 'income');
    assert.equal(tx.category, 'ديون وأمانات');
    assert.equal(tx.accountId, 'acc-bank-lyd');

    // Verify P&L Operating filter: Debt initial tx must NOT be counted as operating revenue
    const operatingIncome = state.transactions
      .filter((t) => t.type === 'income' && !t.debtId && t.category !== 'ديون وأمانات')
      .reduce((sum, t) => sum + t.amount, 0);
    assert.equal(operatingIncome, 0);
  });

  await t.test('3. Installments deposited into different treasuries update each treasury and debt balance', () => {
    let state = createInitialState();
    // 1. Create receivable debt of 3,000 LYD from cash treasury
    state = addDebtRecordMutation(state, {
      id: 'debt-rec-multi',
      personName: 'عمر المختار',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 3000,
      accountId: 'acc-cash-lyd',
    });
    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, 7000);

    // 2. Installment 1: 1,000 LYD received into Bank Treasury
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-1',
      debtId: 'debt-rec-multi',
      amount: 1000,
      accountId: 'acc-bank-lyd',
      paymentMethod: 'transfer',
      notes: 'تحويل مصرفي للدفعة الأولى',
    });

    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 6000);
    let debt = state.debts.find((d) => d.id === 'debt-rec-multi');
    assert.equal(debt.paidAmount, 1000);
    assert.equal(debt.remainingAmount, 2000);
    assert.equal(debt.status, 'active');
    assert.equal(debt.installments.length, 1);
    assert.equal(debt.installments[0].accountId, 'acc-bank-lyd');

    // 3. Installment 2: 500 LYD received into Cash Treasury
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-2',
      debtId: 'debt-rec-multi',
      amount: 500,
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
      notes: 'كاش نقدي للدفعة الثانية',
    });

    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, 7500);
    debt = state.debts.find((d) => d.id === 'debt-rec-multi');
    assert.equal(debt.paidAmount, 1500);
    assert.equal(debt.remainingAmount, 1500);
    assert.equal(debt.status, 'active');
    assert.equal(debt.installments.length, 2);

    // 4. Installment 3: Final 1,500 LYD received into Cash Treasury -> completed
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-3',
      debtId: 'debt-rec-multi',
      amount: 1500,
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
      notes: 'تسوية باقي الدين بالكامل',
    });

    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, 9000);
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 6000);
    debt = state.debts.find((d) => d.id === 'debt-rec-multi');
    assert.equal(debt.paidAmount, 3000);
    assert.equal(debt.remainingAmount, 0);
    assert.equal(debt.status, 'completed');
    assert.equal(debt.installments.length, 3);
  });

  await t.test('4. Installment amount exceeding remaining debt is strictly rejected', () => {
    let state = createInitialState();
    state = addDebtRecordMutation(state, {
      id: 'debt-bounds',
      personName: 'طارق',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 1000,
      accountId: 'acc-cash-lyd',
    });

    const beforeState = state;
    // Attempt to pay 1,000.01 when remaining is 1,000
    const afterState = settleDebtInstallmentMutation(state, {
      debtId: 'debt-bounds',
      amount: 1000.01,
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
    });

    assert.strictEqual(afterState, beforeState);
    assert.equal(afterState.debts.find((d) => d.id === 'debt-bounds').remainingAmount, 1000);
  });

  await t.test('5. Opening Balance Mode records debt without treasury impact', () => {
    let state = createInitialState();
    const initialCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    const initialBank = state.accounts.find((a) => a.id === 'acc-bank-lyd').balance;

    state = addDebtRecordMutation(state, {
      id: 'debt-opening',
      personName: 'سالم - دين قديم مرحل',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 5000,
      // No accountId provided: Opening balance mode
      notes: 'رصيد سابق مرحل من الدفاتر القديمة',
    });

    // Treasury balances must remain completely unchanged
    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, initialCash);
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, initialBank);

    // Debt record exists with no accountId
    const debt = state.debts.find((d) => d.id === 'debt-opening');
    assert.ok(debt);
    assert.equal(debt.accountId, undefined);
    assert.equal(debt.initialTransactionId, undefined);
    assert.equal(debt.remainingAmount, 5000);

    // No linked transaction created
    assert.equal(state.transactions.some((tx) => tx.debtId === 'debt-opening'), false);
  });

  await t.test('6. Atomic Reversal: Deleting installment restores debt balance and exact treasury delta', () => {
    let state = createInitialState();
    state = addDebtRecordMutation(state, {
      id: 'debt-rev-inst',
      personName: 'خالد',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 2000,
      accountId: 'acc-cash-lyd',
    });
    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, 8000);

    // Pay full 2,000 into bank treasury
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-to-reverse',
      debtId: 'debt-rev-inst',
      amount: 2000,
      accountId: 'acc-bank-lyd',
      paymentMethod: 'transfer',
    });
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 7000);
    assert.equal(state.debts.find((d) => d.id === 'debt-rev-inst').status, 'completed');

    // Find the installment settlement transaction
    const settleTx = state.transactions.find((tx) => tx.installmentId === 'inst-to-reverse');
    assert.ok(settleTx);

    // Delete the settlement transaction directly (reversal)
    state = deleteTransactionMutation(state, settleTx.id);

    // Bank treasury must decrease back to 5,000
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 5000);
    // Debt remaining must restore to 2,000 and status return to active
    const restoredDebt = state.debts.find((d) => d.id === 'debt-rev-inst');
    assert.equal(restoredDebt.remainingAmount, 2000);
    assert.equal(restoredDebt.paidAmount, 0);
    assert.equal(restoredDebt.status, 'active');
    assert.equal(restoredDebt.installments.length, 0);
  });

  await t.test('7. Atomic Reversal: Deleting debt reverses creation and all multi-treasury installments', () => {
    let state = createInitialState();
    // Cash: 10,000, Bank: 5,000
    // 1. Create payable debt of 2,000 received in Bank Treasury
    state = addDebtRecordMutation(state, {
      id: 'debt-pay-full-rev',
      personName: 'المورد التقني',
      direction: 'payable',
      currency: 'LYD',
      totalAmount: 2000,
      accountId: 'acc-bank-lyd',
    });
    // Bank becomes 7,000
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 7000);

    // 2. Pay 500 from Cash Treasury
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-p1',
      debtId: 'debt-pay-full-rev',
      amount: 500,
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
    });
    // Cash becomes 9,500
    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, 9500);

    // 3. Pay 500 from Bank Treasury
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-p2',
      debtId: 'debt-pay-full-rev',
      amount: 500,
      accountId: 'acc-bank-lyd',
      paymentMethod: 'transfer',
    });
    // Bank becomes 6,500
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 6500);

    // Now delete the debt entirely
    state = deleteDebtMutation(state, 'debt-pay-full-rev');

    // Both treasuries must return EXACTLY to their baseline:
    // Cash: 9,500 + 500 = 10,000
    // Bank: 6,500 + 500 - 2,000 = 5,000
    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, 10000);
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 5000);
    assert.equal(state.debts.some((d) => d.id === 'debt-pay-full-rev'), false);
    assert.equal(state.transactions.some((tx) => tx.debtId === 'debt-pay-full-rev'), false);
  });

  await t.test('8. Account deletion blocked when account is referenced by debt or installment', () => {
    let state = createInitialState();
    state = addDebtRecordMutation(state, {
      id: 'debt-ref-acc',
      personName: 'شخص',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 1000,
      accountId: 'acc-cash-lyd',
    });

    const beforeState = state;
    // Attempting to delete acc-cash-lyd should be rejected because debt references it
    const afterState = deleteAccountMutation(state, 'acc-cash-lyd');
    assert.strictEqual(afterState, beforeState);
    assert.ok(afterState.accounts.some((a) => a.id === 'acc-cash-lyd'));
  });

  await t.test('9. Prevent unauthorized negative balances: Lending blocked when treasury has insufficient funds', () => {
    let state = createInitialState();
    // Cash balance is 10,000 LYD
    const cashAcc = state.accounts.find((a) => a.id === 'acc-cash-lyd');
    assert.equal(cashAcc.balance, 10000);

    // Attempt to lend 15,000 LYD from Cash Treasury (exceeds balance)
    const before = state;
    const result = addDebtRecordMutation(state, {
      id: 'debt-rec-overdraw',
      personName: 'شخص مقترض',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 15000,
      accountId: 'acc-cash-lyd',
    });

    // Must be completely rejected without modifying state
    assert.strictEqual(result, before);
    assert.equal(state.debts.some((d) => d.id === 'debt-rec-overdraw'), false);
    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, 10000);

    // canDisburseFromAccount report check
    const check = canDisburseFromAccount(cashAcc, 15000);
    assert.equal(check.allowed, false);
    assert.equal(check.available, 10000);
    assert.equal(check.deficit, 5000);
  });

  await t.test('10. Authorized Overdraft: Bank accounts with allowOverdraft permitted up to overdraftLimit', () => {
    let state = createInitialState();
    // Bank balance is 5,000 LYD. Enable overdraft with 3,000 LYD limit
    state = {
      ...state,
      accounts: state.accounts.map((a) =>
        a.id === 'acc-bank-lyd'
          ? { ...a, allowOverdraft: true, overdraftLimit: 3000 }
          : a
      ),
    };

    const bankAcc = state.accounts.find((a) => a.id === 'acc-bank-lyd');
    // Max available is 5,000 + 3,000 = 8,000
    const checkAllowed = canDisburseFromAccount(bankAcc, 7500);
    assert.equal(checkAllowed.allowed, true);
    assert.equal(checkAllowed.available, 8000);
    assert.equal(checkAllowed.deficit, 0);

    // Exceeding limit (8,500) must be rejected
    const checkExceeded = canDisburseFromAccount(bankAcc, 8500);
    assert.equal(checkExceeded.allowed, false);
    assert.equal(checkExceeded.deficit, 500);

    // Lending 7,500 from bank with authorized overdraft succeeds
    const lent = addDebtRecordMutation(state, {
      id: 'debt-rec-overdraft-ok',
      personName: 'مقترض بنكي',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 7500,
      accountId: 'acc-bank-lyd',
    });
    assert.notStrictEqual(lent, state);
    assert.equal(lent.accounts.find((a) => a.id === 'acc-bank-lyd').balance, -2500);

    // Physical cash can NEVER overdraft even if flag was set
    const cashAcc = { ...state.accounts.find((a) => a.id === 'acc-cash-lyd'), allowOverdraft: true, overdraftLimit: 5000 };
    const cashCheck = canDisburseFromAccount(cashAcc, 12000);
    assert.equal(cashCheck.allowed, false);
    assert.equal(cashCheck.deficit, 2000);
  });

  await t.test('11. Prevent unauthorized negative balances on debt repayment (payable installment)', () => {
    let state = createInitialState();
    // Bank balance: 5,000 LYD
    // Create a payable debt of 8,000 LYD (opening balance mode)
    state = addDebtRecordMutation(state, {
      id: 'debt-payable-big',
      personName: 'دائن كبير',
      direction: 'payable',
      currency: 'LYD',
      totalAmount: 8000,
    });

    // Attempt to pay 6,000 LYD installment from Bank (balance only 5,000, no overdraft)
    const before = state;
    const result = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-overdraw',
      debtId: 'debt-payable-big',
      amount: 6000,
      accountId: 'acc-bank-lyd',
      paymentMethod: 'transfer',
    });
    // Must be rejected
    assert.strictEqual(result, before);
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 5000);
  });

  await t.test('12. Non-cash settlement (مقاصة / تنازل / عينية) updates debt without touching treasuries or transactions', () => {
    let state = createInitialState();
    const initialCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    const initialBank = state.accounts.find((a) => a.id === 'acc-bank-lyd').balance;
    const initialTxCount = state.transactions.length;

    // Create debt of 5,000 LYD
    state = addDebtRecordMutation(state, {
      id: 'debt-non-cash',
      personName: 'تاجر شريك',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 5000,
    });

    // Record non-cash settlement (مقاصة ديون) of 2,000 LYD
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-non-cash-1',
      debtId: 'debt-non-cash',
      amount: 2000,
      settlementType: 'non_cash',
      isNonCash: true,
      nonCashReason: 'مقاصة مقابل فاتورة بضاعة رقم 104',
    });

    // Check debt is updated
    const debt = state.debts.find((d) => d.id === 'debt-non-cash');
    assert.equal(debt.paidAmount, 2000);
    assert.equal(debt.remainingAmount, 3000);
    assert.equal(debt.status, 'active');
    assert.equal(debt.installments.length, 1);
    assert.equal(debt.installments[0].isNonCash, true);
    assert.equal(debt.installments[0].nonCashReason, 'مقاصة مقابل فاتورة بضاعة رقم 104');
    assert.equal(debt.installments[0].accountId, undefined);
    assert.equal(debt.installments[0].transactionId, undefined);

    // Treasuries and transactions MUST NOT be affected at all
    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, initialCash);
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, initialBank);
    assert.equal(state.transactions.length, initialTxCount);
  });

  await t.test('13. Strict rejection: Cash installment without account or non-cash without reason', () => {
    let state = createInitialState();
    state = addDebtRecordMutation(state, {
      id: 'debt-validate',
      personName: 'عميل اختبار',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 1000,
    });

    // Cash settlement without account MUST be rejected (never silently default to non-cash)
    const rejectNoAcc = settleDebtInstallmentMutation(state, {
      debtId: 'debt-validate',
      amount: 200,
      paymentMethod: 'cash',
    });
    assert.strictEqual(rejectNoAcc, state);

    // Non-cash settlement without reason MUST be rejected
    const rejectNoReason = settleDebtInstallmentMutation(state, {
      debtId: 'debt-validate',
      amount: 200,
      settlementType: 'non_cash',
      isNonCash: true,
      nonCashReason: '   ',
    });
    assert.strictEqual(rejectNoReason, state);
  });

  await t.test('14. Structural Isolation from P&L: Debt capital movements excluded from operating expenses and revenue', () => {
    let state = createInitialState();
    const beforeSummary = reconcileDashboardSummary(state);

    // Lend 1,000 LYD to Muhammad (receivable creation)
    state = addDebtRecordMutation(state, {
      id: 'debt-rec-iso',
      personName: 'محمد',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 1000,
      accountId: 'acc-cash-lyd',
    });

    // Borrow 2,000 LYD from Salem (payable creation)
    state = addDebtRecordMutation(state, {
      id: 'debt-pay-iso',
      personName: 'سالم',
      direction: 'payable',
      currency: 'LYD',
      totalAmount: 2000,
      accountId: 'acc-cash-lyd',
    });

    // Settle 500 LYD installment
    state = settleDebtInstallmentMutation(state, {
      debtId: 'debt-rec-iso',
      amount: 500,
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
    });

    // All linked transactions MUST test true for isDebtTransaction
    const debtTxs = state.transactions.filter((tx) => tx.debtId);
    assert.ok(debtTxs.length >= 3);
    for (const tx of debtTxs) {
      assert.equal(isDebtTransaction(tx), true);
    }

    // Monthly operating expenses in reconcileDashboardSummary MUST be exactly 0 (debt movements are balance sheet only)
    const afterSummary = reconcileDashboardSummary(state);
    assert.equal(afterSummary.currentMonthExpensesLyd, beforeSummary.currentMonthExpensesLyd);
    assert.equal(afterSummary.currentMonthExpensesLyd, 0);
  });

  await t.test('15. deleteDebtInstallmentMutation atomically reverses both cash and non-cash installments', () => {
    let state = createInitialState();
    // 1. Setup debt of 4,000 LYD
    state = addDebtRecordMutation(state, {
      id: 'debt-del-inst',
      personName: 'عميل أقساط',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 4000,
      accountId: 'acc-cash-lyd',
    });
    assert.equal(state.accounts.find((a) => a.id === 'acc-cash-lyd').balance, 6000);

    // 2. Add cash installment of 1,000 into Bank (bank becomes 6,000)
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-cash-del',
      debtId: 'debt-del-inst',
      amount: 1000,
      accountId: 'acc-bank-lyd',
      paymentMethod: 'transfer',
    });
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 6000);
    assert.equal(state.debts.find((d) => d.id === 'debt-del-inst').paidAmount, 1000);

    // 3. Add non-cash installment of 500 (bank stays 6,000)
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-nc-del',
      debtId: 'debt-del-inst',
      amount: 500,
      settlementType: 'non_cash',
      isNonCash: true,
      nonCashReason: 'مقاصة',
    });
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 6000);
    assert.equal(state.debts.find((d) => d.id === 'debt-del-inst').paidAmount, 1500);

    // 4. Delete non-cash installment directly
    state = deleteDebtInstallmentMutation(state, 'debt-del-inst', 'inst-nc-del');
    const afterNcDel = state.debts.find((d) => d.id === 'debt-del-inst');
    assert.equal(afterNcDel.paidAmount, 1000);
    assert.equal(afterNcDel.remainingAmount, 3000);
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 6000);

    // 5. Delete cash installment directly
    state = deleteDebtInstallmentMutation(state, 'debt-del-inst', 'inst-cash-del');
    const afterCashDel = state.debts.find((d) => d.id === 'debt-del-inst');
    assert.equal(afterCashDel.paidAmount, 0);
    assert.equal(afterCashDel.remainingAmount, 4000);
    // Bank must reverse by -1,000 back to 5,000
    assert.equal(state.accounts.find((a) => a.id === 'acc-bank-lyd').balance, 5000);
    // Linked transaction must be removed
    assert.equal(state.transactions.some((tx) => tx.installmentId === 'inst-cash-del'), false);
  });

  await t.test('16. FIN-CRITICAL-01 & FIN-CRITICAL-03: Hardened Installment Reversal, Conflict Detection & Non-Cash Isolation', () => {
    let state = createInitialState();
    // 1. Create debt
    state = addDebtRecordMutation(state, {
      id: 'debt-crit-rev',
      personName: 'عميل حماية العكس',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 3000,
      accountId: 'acc-cash-lyd',
    });

    // 2. Add legitimate cash installment
    state = settleDebtInstallmentMutation(state, {
      installmentId: 'inst-legit',
      debtId: 'debt-crit-rev',
      amount: 500,
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
    });

    const legitInst = state.debts.find((d) => d.id === 'debt-crit-rev').installments[0];
    assert.ok(legitInst.transactionId);

    // 3. Test missing linked transaction on modern installment (tampered ledger):
    // If transactionId is present on installment but transaction was removed, deletion must be REJECTED!
    const tamperedLedgerState = {
      ...state,
      transactions: state.transactions.filter((tx) => tx.id !== legitInst.transactionId),
    };
    const rejectMissingTx = deleteDebtInstallmentMutation(tamperedLedgerState, 'debt-crit-rev', 'inst-legit');
    assert.strictEqual(rejectMissingTx, tamperedLedgerState);

    // 4. Test conflicting/duplicate transactions:
    // If two transactions match the installment ID, deletion must be REJECTED!
    const duplicateTx = { ...state.transactions.find((tx) => tx.id === legitInst.transactionId), id: 'tx-dup-inst' };
    const duplicateTxState = {
      ...state,
      transactions: [...state.transactions, duplicateTx],
    };
    const rejectDuplicate = deleteDebtInstallmentMutation(duplicateTxState, 'debt-crit-rev', 'inst-legit');
    assert.strictEqual(rejectDuplicate, duplicateTxState);

    // 5. Test mismatched currency on linked transaction:
    const mismatchedTxState = {
      ...state,
      transactions: state.transactions.map((tx) =>
        tx.id === legitInst.transactionId ? { ...tx, currency: 'USD' } : tx
      ),
    };
    const rejectCurrencyMismatch = deleteDebtInstallmentMutation(mismatchedTxState, 'debt-crit-rev', 'inst-legit');
    assert.strictEqual(rejectCurrencyMismatch, mismatchedTxState);

    // 6. Test Legacy Installment (no transactionId and no transaction in ledger):
    // Should update remaining balance without modifying any treasury account!
    const legacyDebtId = 'debt-legacy';
    const legacyInstId = 'inst-legacy-1';
    const cashBalanceBefore = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    const legacyState = {
      ...state,
      debts: [
        {
          id: legacyDebtId,
          personName: 'عميل قديم',
          direction: 'receivable',
          currency: 'LYD',
          totalAmount: 1000,
          paidAmount: 200,
          remainingAmount: 800,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          installments: [
            {
              id: legacyInstId,
              amount: 200,
              date: new Date().toISOString(),
              paymentMethod: 'cash',
              // No transactionId (legacy)
            },
          ],
        },
        ...state.debts,
      ],
    };

    const cleanedLegacy = deleteDebtInstallmentMutation(legacyState, legacyDebtId, legacyInstId);
    const updatedLegacyDebt = cleanedLegacy.debts.find((d) => d.id === legacyDebtId);
    assert.equal(updatedLegacyDebt.paidAmount, 0);
    assert.equal(updatedLegacyDebt.remainingAmount, 1000);
    assert.equal(updatedLegacyDebt.installments.length, 0);
    // Treasury balance MUST NOT change (no phantom modification!)
    assert.equal(cleanedLegacy.accounts.find((a) => a.id === 'acc-cash-lyd').balance, cashBalanceBefore);

    // 7. Double-reversal prevention (Idempotency):
    const firstDeletion = deleteDebtInstallmentMutation(state, 'debt-crit-rev', 'inst-legit');
    assert.notStrictEqual(firstDeletion, state);
    const secondDeletion = deleteDebtInstallmentMutation(firstDeletion, 'debt-crit-rev', 'inst-legit');
    // Must return same state unchanged
    assert.strictEqual(secondDeletion, firstDeletion);

    // 8. Non-cash settlement with accountId provided (contradictory) MUST be rejected:
    const rejectConflictingNonCash = settleDebtInstallmentMutation(state, {
      debtId: 'debt-crit-rev',
      amount: 100,
      settlementType: 'non_cash',
      isNonCash: true,
      nonCashReason: 'مقاصة',
      accountId: 'acc-cash-lyd', // Cannot link treasury to non-cash settlement!
    });
    assert.strictEqual(rejectConflictingNonCash, state);

    // 9. Cash settlement with isNonCash flag MUST be rejected:
    const rejectConflictingCash = settleDebtInstallmentMutation(state, {
      debtId: 'debt-crit-rev',
      amount: 100,
      settlementType: 'cash',
      isNonCash: true,
      accountId: 'acc-cash-lyd',
    });
    assert.strictEqual(rejectConflictingCash, state);
  });

  await t.test('17. FIN-CRITICAL-02: Comprehensive Overdraft Matrix (Zero, Exact, Exceeding, Legacy Negative, Unlimited Rejection)', () => {
    let state = createInitialState();
    const cashAcc = state.accounts.find((a) => a.id === 'acc-cash-lyd'); // balance: 10,000, isCash: true

    // 1. Physical cash: exact balance -> allowed
    const exactCash = canDisburseFromAccount(cashAcc, 10000);
    assert.equal(exactCash.allowed, true);
    assert.equal(exactCash.deficit, 0);
    assert.equal(exactCash.available, 10000);

    // 2. Physical cash: exceeding by 0.01 -> deficit
    const exceedCash = canDisburseFromAccount(cashAcc, 10000.01);
    assert.equal(exceedCash.allowed, false);
    assert.equal(exceedCash.deficit, 0.01);

    // 3. Physical cash: zero balance account -> deficit
    const zeroCashAcc = { ...cashAcc, balance: 0 };
    const zeroCheck = canDisburseFromAccount(zeroCashAcc, 100);
    assert.equal(zeroCheck.allowed, false);
    assert.equal(zeroCheck.deficit, 100);
    assert.equal(zeroCheck.available, 0);

    // 4. Physical cash: legacy negative balance -> deficit (cannot worsen)
    const negCashAcc = { ...cashAcc, balance: -50 };
    const negCashCheck = canDisburseFromAccount(negCashAcc, 20);
    assert.equal(negCashCheck.allowed, false);
    assert.equal(negCashCheck.deficit, 70);
    assert.equal(negCashCheck.available, 0);

    // 5. Bank account with allowOverdraft = true but NO overdraftLimit (or undefined/0/NaN):
    // Must REJECT unlimited overdraft!
    const bankAcc = state.accounts.find((a) => a.id === 'acc-bank-lyd'); // balance: 5,000, isCash: false
    const unlimBank1 = { ...bankAcc, allowOverdraft: true, overdraftLimit: undefined };
    assert.equal(canDisburseFromAccount(unlimBank1, 5500).allowed, false);
    assert.equal(canDisburseFromAccount(unlimBank1, 5500).deficit, 500);

    const unlimBank2 = { ...bankAcc, allowOverdraft: true, overdraftLimit: 0 };
    assert.equal(canDisburseFromAccount(unlimBank2, 5500).allowed, false);

    const unlimBank3 = { ...bankAcc, allowOverdraft: true, overdraftLimit: -1000 };
    assert.equal(canDisburseFromAccount(unlimBank3, 5500).allowed, false);

    // 6. Bank account with valid overdraftLimit:
    const limBank = { ...bankAcc, allowOverdraft: true, overdraftLimit: 2000 }; // max 7,000
    // Exactly at limit
    const atLim = canDisburseFromAccount(limBank, 7000);
    assert.equal(atLim.allowed, true);
    assert.equal(atLim.available, 7000);
    assert.equal(atLim.deficit, 0);

    // Exceeding by 100
    const overLim = canDisburseFromAccount(limBank, 7100);
    assert.equal(overLim.allowed, false);
    assert.equal(overLim.deficit, 100);

    // 7. Bank account with existing legacy negative balance and overdraft limit:
    const negBank = { ...bankAcc, balance: -500, allowOverdraft: true, overdraftLimit: 2000 }; // max available = 1,500
    const negBankOk = canDisburseFromAccount(negBank, 1000);
    assert.equal(negBankOk.allowed, true);
    assert.equal(negBankOk.available, 1500);
    assert.equal(negBankOk.deficit, 0);

    const negBankFail = canDisburseFromAccount(negBank, 1600);
    assert.equal(negBankFail.allowed, false);
    assert.equal(negBankFail.deficit, 100);
  });
});
