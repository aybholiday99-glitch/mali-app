import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDebtRecordMutation,
  createAccountMutation,
  deleteAccountMutation,
  deleteDebtMutation,
  deleteTransactionMutation,
  settleDebtInstallmentMutation,
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
});
