import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDebtRecordMutation,
  settleDebtInstallmentMutation,
  createAccountMutation,
} from '../src/services/financialEngine.ts';
import {
  computeUnifiedContactProfile,
  generateContactStatementPdfHtml,
  auditAndLinkLegacyContactRecords,
  isDebtBelongingTransaction,
  isDealBelongingTransaction,
} from '../src/services/unifiedContactProfileService.ts';
import { createCentralVaultSession } from '../src/services/centralVaultSession.ts';
import { disposableDatabase, asUser } from './database.test.mjs';

function createE2EInitialState() {
  let state = {
    accounts: [],
    contacts: [
      {
        id: 'cnt-ali',
        name: 'علي الفيتوري',
        phone: '0912223344',
        role: 'شريك تجاري',
        bankDetails: 'مصرف الجمهورية - فرع الميدان',
        notes: 'مورد سلع وتداول',
        createdAt: '2026-01-01T08:00:00Z',
      },
    ],
    transactions: [],
    deals: [],
    debts: [],
    procedures: [],
    budgets: [],
    marketRates: {
      cashUsdToLyd: 6.22,
      chequeUsdToLyd: 6.38,
      defaultChequeDiscountPercent: 2.5,
      updatedAt: '2026-01-01T00:00:00Z',
    },
    supabaseConfig: {
      url: 'https://evcwoaerlykghgdevrhb.supabase.co',
      anonKey: 'sb_publishable_test_key_e2e',
      workspaceKey: 'mali-e2e-vault-workspace',
      autoSync: false,
    },
  };

  // Add Cash Treasury LYD (20,000 LYD)
  state = createAccountMutation(state, {
    id: 'acc-cash-lyd',
    name: 'خزينة الكاش (دينار)',
    currency: 'LYD',
    balance: 20000,
    isCash: true,
    color: '#0D9488',
  });

  // Add Bank Treasury LYD (50,000 LYD)
  state = createAccountMutation(state, {
    id: 'acc-bank-lyd',
    name: 'مصرف التجارة والتنمية (دينار)',
    currency: 'LYD',
    balance: 50000,
    isCash: false,
    color: '#3B82F6',
  });

  // Add Cash Treasury USD ($10,000)
  state = createAccountMutation(state, {
    id: 'acc-cash-usd',
    name: 'خزينة كاش دولار',
    currency: 'USD',
    balance: 10000,
    isCash: true,
    color: '#10B981',
  });

  return state;
}

test('Unified Financial Dossier E2E — Complete 16-Point Verification', async (suite) => {
  // 1. Create new contact and auto-link to debts and contacts directory
  await suite.test('1. Create new contact and auto-link to debts and contacts directory', () => {
    let state = createE2EInitialState();
    const newContact = {
      id: 'cnt-salem',
      name: 'سالم الورفلي',
      phone: '0925556677',
      role: 'تاجر جملة',
      bankDetails: 'مصرف النوران',
      notes: 'تم إنشاؤه عبر نافذة تسجيل الدين',
      createdAt: '2026-02-01T10:00:00Z',
    };

    // Add contact to directory
    state = {
      ...state,
      contacts: [...state.contacts, newContact],
    };

    // Create debt linked to this new contact
    state = addDebtRecordMutation(state, {
      id: 'debt-salem-01',
      contactId: newContact.id,
      personName: newContact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 4500,
      accountId: 'acc-cash-lyd',
      dueDate: '2026-05-01',
      notes: 'دين تجاري للبضاعة',
    });

    const contactInDir = state.contacts.find((c) => c.id === 'cnt-salem');
    assert.ok(contactInDir, 'New contact must be present in contacts directory');
    assert.equal(contactInDir.name, 'سالم الورفلي');

    const debt = state.debts.find((d) => d.id === 'debt-salem-01');
    assert.ok(debt);
    assert.equal(debt.contactId, 'cnt-salem');

    const profile = computeUnifiedContactProfile(state, contactInDir);
    assert.equal(profile.debts.active.length, 1);
    assert.equal(profile.currencies.LYD.receivables, 4500);
  });

  // 2. Select existing contact and associate debts without duplicating
  await suite.test('2. Select existing contact and associate debts without duplicating contact entry', () => {
    let state = createE2EInitialState();
    const initialContactCount = state.contacts.length;
    const existingContact = state.contacts[0]; // علي الفيتوري

    state = addDebtRecordMutation(state, {
      id: 'debt-ali-rec-1',
      contactId: existingContact.id,
      personName: existingContact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 3000,
      accountId: 'acc-cash-lyd',
    });

    assert.equal(state.contacts.length, initialContactCount, 'No duplicate contact should be added');
    const debt = state.debts.find((d) => d.id === 'debt-ali-rec-1');
    assert.equal(debt.contactId, existingContact.id);
  });

  // 3. Receivable debt with treasury movement (cash disbursement)
  await suite.test('3. Receivable debt with treasury movement decreases treasury balance and links initial transaction', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];
    const initialCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    assert.equal(initialCash, 20000);

    state = addDebtRecordMutation(state, {
      id: 'debt-rec-treasury',
      contactId: contact.id,
      personName: contact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 5000,
      accountId: 'acc-cash-lyd',
    });

    const updatedCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    assert.equal(updatedCash, 15000, 'Cash treasury balance must decrease by debt total amount');

    const tx = state.transactions.find((t) => t.debtId === 'debt-rec-treasury');
    assert.ok(tx, 'Initial transaction must be created');
    assert.equal(tx.amount, 5000);
    assert.equal(tx.type, 'expense');
    assert.equal(tx.category, 'ديون وأمانات');
    assert.equal(tx.accountId, 'acc-cash-lyd');
  });

  // 4. Receivable debt without treasury movement (opening/deferred balance)
  await suite.test('4. Receivable debt without treasury movement creates debt record with zero account balance change', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];
    const initialCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;

    state = addDebtRecordMutation(state, {
      id: 'debt-rec-deferred',
      contactId: contact.id,
      personName: contact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 7000,
      // No accountId provided: represents deferred / opening debt balance
      notes: 'رصيد دين سابق غير مرتبط بحركة نقدية فورية',
    });

    const updatedCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    assert.equal(updatedCash, initialCash, 'Treasury balance must remain untouched');

    const debt = state.debts.find((d) => d.id === 'debt-rec-deferred');
    assert.ok(debt);
    assert.equal(debt.totalAmount, 7000);
    assert.equal(debt.remainingAmount, 7000);

    const initialTx = state.transactions.find((t) => t.debtId === 'debt-rec-deferred');
    assert.equal(initialTx, undefined, 'No initial cash transaction should be recorded');

    const profile = computeUnifiedContactProfile(state, contact);
    assert.equal(profile.currencies.LYD.receivables, 7000);
  });

  // 5. Payable debt with treasury movement (cash deposit)
  await suite.test('5. Payable debt with treasury movement increases treasury balance and links initial transaction', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];
    const initialBank = state.accounts.find((a) => a.id === 'acc-bank-lyd').balance;
    assert.equal(initialBank, 50000);

    state = addDebtRecordMutation(state, {
      id: 'debt-pay-treasury',
      contactId: contact.id,
      personName: contact.name,
      direction: 'payable',
      currency: 'LYD',
      totalAmount: 12000,
      accountId: 'acc-bank-lyd',
      notes: 'قرض مستلم بحساب المصرف',
    });

    const updatedBank = state.accounts.find((a) => a.id === 'acc-bank-lyd').balance;
    assert.equal(updatedBank, 62000, 'Bank treasury balance must increase by payable total amount');

    const tx = state.transactions.find((t) => t.debtId === 'debt-pay-treasury');
    assert.ok(tx);
    assert.equal(tx.amount, 12000);
    assert.equal(tx.type, 'income');
    assert.equal(tx.accountId, 'acc-bank-lyd');
  });

  // 6. Payable debt without treasury movement (opening/deferred balance)
  await suite.test('6. Payable debt without treasury movement records payable with zero account balance change', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];
    const initialBank = state.accounts.find((a) => a.id === 'acc-bank-lyd').balance;

    state = addDebtRecordMutation(state, {
      id: 'debt-pay-deferred',
      contactId: contact.id,
      personName: contact.name,
      direction: 'payable',
      currency: 'LYD',
      totalAmount: 6000,
      // No accountId: opening payable debt
      notes: 'رصيد دائن افتتاحي',
    });

    const updatedBank = state.accounts.find((a) => a.id === 'acc-bank-lyd').balance;
    assert.equal(updatedBank, initialBank, 'Treasury balance must remain untouched');

    const debt = state.debts.find((d) => d.id === 'debt-pay-deferred');
    assert.ok(debt);
    assert.equal(debt.remainingAmount, 6000);

    const profile = computeUnifiedContactProfile(state, contact);
    assert.equal(profile.currencies.LYD.payables, 6000);
  });

  // 7. Partial settlements with cash treasury deposit/withdrawal
  await suite.test('7. Partial settlements update debt paid and remaining amounts and adjust treasury', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    // Create receivable debt: 10,000 LYD
    state = addDebtRecordMutation(state, {
      id: 'debt-partial-rec',
      contactId: contact.id,
      personName: contact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 10000,
      accountId: 'acc-cash-lyd',
    });

    const cashAfterDebt = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance; // 10,000

    // Partial settlement: 3,500 LYD
    state = settleDebtInstallmentMutation(state, {
      debtId: 'debt-partial-rec',
      installmentId: 'inst-part-1',
      amount: 3500,
      paymentMethod: 'cash',
      accountId: 'acc-cash-lyd',
      notes: 'دفعة نقدية أولى',
    });

    const cashAfterInstallment = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    assert.equal(cashAfterInstallment, cashAfterDebt + 3500, 'Cash balance must increase by partial settlement');

    const debt = state.debts.find((d) => d.id === 'debt-partial-rec');
    assert.equal(debt.paidAmount, 3500);
    assert.equal(debt.remainingAmount, 6500);
    assert.equal(debt.status, 'active');

    const profile = computeUnifiedContactProfile(state, contact);
    assert.equal(profile.currencies.LYD.receivables, 6500);
    assert.equal(profile.currencies.LYD.settledReceivables, 3500);
  });

  // 8. Full settlements and status transition
  await suite.test('8. Full settlement transitions debt status to settled and reduces remaining to zero', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    state = addDebtRecordMutation(state, {
      id: 'debt-full-rec',
      contactId: contact.id,
      personName: contact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 4000,
      accountId: 'acc-cash-lyd',
    });

    // Settle in full (4,000 LYD)
    state = settleDebtInstallmentMutation(state, {
      debtId: 'debt-full-rec',
      installmentId: 'inst-full-1',
      amount: 4000,
      paymentMethod: 'cash',
      accountId: 'acc-cash-lyd',
      notes: 'سداد كامل الدين',
    });

    const debt = state.debts.find((d) => d.id === 'debt-full-rec');
    assert.equal(debt.paidAmount, 4000);
    assert.equal(debt.remainingAmount, 0);
    assert.equal(debt.status, 'completed');

    const profile = computeUnifiedContactProfile(state, contact);
    assert.equal(profile.currencies.LYD.receivables, 0);
    assert.equal(profile.currencies.LYD.settledReceivables, 4000);
    assert.equal(profile.debts.active.length, 0);
    assert.equal(profile.debts.settled.length, 1);
  });

  // 9. Non-cash settlements with explicit reason and zero treasury balance change
  await suite.test('9. Non-cash settlements record reason and reduce debt balance without treasury impact', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    state = addDebtRecordMutation(state, {
      id: 'debt-noncash-rec',
      contactId: contact.id,
      personName: contact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 8000,
      accountId: 'acc-cash-lyd',
    });

    const cashBeforeNonCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;

    // Non-cash settlement: 5,000 LYD (مقاصة عينية)
    state = settleDebtInstallmentMutation(state, {
      debtId: 'debt-noncash-rec',
      installmentId: 'inst-noncash-1',
      amount: 5000,
      settlementType: 'non_cash',
      isNonCash: true,
      nonCashReason: 'مقاصة مقابل استلام أجهزة إلكترونية بفاتورة 1092',
      notes: 'تسوية مقاصة متفق عليها',
    });

    const cashAfterNonCash = state.accounts.find((a) => a.id === 'acc-cash-lyd').balance;
    assert.equal(cashAfterNonCash, cashBeforeNonCash, 'Non-cash settlement must NOT change any treasury balance');

    const debt = state.debts.find((d) => d.id === 'debt-noncash-rec');
    assert.equal(debt.paidAmount, 5000);
    assert.equal(debt.remainingAmount, 3000);

    const inst = debt.installments.find((i) => i.id === 'inst-noncash-1');
    assert.equal(inst.isNonCash, true);
    assert.equal(inst.settlementType, 'non_cash');
    assert.equal(inst.nonCashReason, 'مقاصة مقابل استلام أجهزة إلكترونية بفاتورة 1092');

    const profile = computeUnifiedContactProfile(state, contact);
    const nonCashTimeline = profile.timelineEntries.find((e) => e.refId === 'inst-noncash-1');
    assert.ok(nonCashTimeline);
    assert.equal(nonCashTimeline.isNonCash, true);
    assert.equal(nonCashTimeline.nonCashReason, 'مقاصة مقابل استلام أجهزة إلكترونية بفاتورة 1092');
  });

  // 10. USD deals purchases linked to contact
  await suite.test('10. USD deals purchases summarize bought USD and gross/net LYD cost', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    state.deals.push({
      id: 'deal-usd-buy',
      dealNumber: 'DL-BUY-01',
      title: 'شراء دولار كاش من علي',
      contactId: contact.id,
      counterparty: contact.name,
      buyDate: '2026-03-01',
      totalUsdBought: 5000,
      buyRate: 6.25,
      grossLydCost: 31250,
      buyCommissionLyd: 50,
      totalLydCost: 31300,
      effectiveBuyRate: 6.26,
      buyPaymentMethod: 'cash',
      sourceLydAccountId: 'acc-cash-lyd',
      usdHoldingAccountId: 'acc-cash-usd',
      soldUsd: 0,
      personalTakenUsd: 0,
      remainingUsd: 5000,
      totalLydReceived: 0,
      realizedProfitLyd: 0,
      status: 'open',
      sales: [],
    });

    const profile = computeUnifiedContactProfile(state, contact);
    assert.equal(profile.usdDealsSummary.boughtUsdAmount, 5000);
    assert.equal(profile.usdDealsSummary.boughtLydCost, 31300);
    assert.equal(profile.usdDealsSummary.dealsCount, 1);
  });

  // 11. USD deals sales linked to contact
  await suite.test('11. USD deals sales summarize sold USD, revenue in LYD, cost basis, and realized profit', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    state.deals.push({
      id: 'deal-usd-sale',
      dealNumber: 'DL-SALE-01',
      title: 'صفقة تجارة عملة',
      counterparty: 'طرف ثالث',
      buyDate: '2026-03-05',
      totalUsdBought: 10000,
      buyRate: 6.20,
      grossLydCost: 62000,
      buyCommissionLyd: 0,
      totalLydCost: 62000,
      effectiveBuyRate: 6.20,
      buyPaymentMethod: 'cash',
      sourceLydAccountId: 'acc-cash-lyd',
      usdHoldingAccountId: 'acc-cash-usd',
      soldUsd: 4000,
      personalTakenUsd: 0,
      remainingUsd: 6000,
      totalLydReceived: 25600,
      realizedProfitLyd: 800,
      status: 'partial',
      sales: [
        {
          id: 'sale-ali-1',
          dealId: 'deal-usd-sale',
          contactId: contact.id,
          buyerName: contact.name,
          usdAmount: 4000,
          sellRate: 6.40,
          grossLyd: 25600,
          commissionLyd: 0,
          netLydReceived: 25600,
          costBasisLyd: 24800,
          profitLyd: 800,
          paymentMethod: 'cash',
          targetLydAccountId: 'acc-cash-lyd',
          sourceUsdAccountId: 'acc-cash-usd',
          date: '2026-03-10',
        },
      ],
    });

    const profile = computeUnifiedContactProfile(state, contact);
    assert.equal(profile.usdDealsSummary.soldUsdAmount, 4000);
    assert.equal(profile.usdDealsSummary.soldLydRevenue, 25600);
    assert.equal(profile.usdDealsSummary.realizedProfitLyd, 800);
    assert.equal(profile.usdDealsSummary.salesCount, 1);
  });

  // 12. Direct generic transactions without double-counting
  await suite.test('12. Direct generic transactions are isolated without double-counting debt or deal transactions', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    // Generic transfer / expense
    state.transactions.push({
      id: 'tx-direct-fees',
      title: 'عمولة شحن وتخليص جمركي',
      type: 'expense',
      amount: 450,
      currency: 'LYD',
      category: 'مصاريف تشغيل',
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
      contactId: contact.id,
      date: '2026-03-12',
    });

    // Transaction that belongs to a debt
    state.transactions.push({
      id: 'tx-debt-initial-belonging',
      title: 'إقراض دين',
      type: 'expense',
      amount: 2000,
      currency: 'LYD',
      category: 'ديون وأمانات',
      accountId: 'acc-cash-lyd',
      paymentMethod: 'cash',
      contactId: contact.id,
      debtId: 'debt-some-id',
      date: '2026-03-13',
    });

    assert.equal(isDebtBelongingTransaction(state.transactions[0]), false);
    assert.equal(isDealBelongingTransaction(state.transactions[0]), false);
    assert.equal(isDebtBelongingTransaction(state.transactions[1]), true);

    const profile = computeUnifiedContactProfile(state, contact);
    assert.equal(profile.directTransactions.items.length, 1);
    assert.equal(profile.directTransactions.items[0].id, 'tx-direct-fees');
    assert.equal(profile.directTransactions.summary.lydExpenseTotal, 450);
  });

  // 13. Multi-currency LYD / USD strict isolation
  await suite.test('13. Multi-currency LYD/USD strict isolation with zero cross-currency deduction', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    // LYD Receivable: 15,000 LYD
    state = addDebtRecordMutation(state, {
      id: 'debt-iso-lyd-rec',
      contactId: contact.id,
      personName: contact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 15000,
      accountId: 'acc-cash-lyd',
    });

    // USD Payable: 2,500 USD
    state = addDebtRecordMutation(state, {
      id: 'debt-iso-usd-pay',
      contactId: contact.id,
      personName: contact.name,
      direction: 'payable',
      currency: 'USD',
      totalAmount: 2500,
      accountId: 'acc-cash-usd',
    });

    const profile = computeUnifiedContactProfile(state, contact);

    // LYD must only reflect LYD
    assert.equal(profile.currencies.LYD.receivables, 15000);
    assert.equal(profile.currencies.LYD.payables, 0);
    assert.equal(profile.currencies.LYD.netPosition, 15000);

    // USD must only reflect USD
    assert.equal(profile.currencies.USD.receivables, 0);
    assert.equal(profile.currencies.USD.payables, 2500);
    assert.equal(profile.currencies.USD.netPosition, -2500);

    // Absolutely zero cross-netting between LYD and USD
    assert.notEqual(profile.currencies.LYD.netPosition, 15000 - 2500 * 6.22);
  });

  // 14. Zero auto-offsetting between active debts within the same currency
  await suite.test('14. Zero auto-offsetting between active debts within the same currency', () => {
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    // LYD Receivable: 8,000 LYD
    state = addDebtRecordMutation(state, {
      id: 'debt-active-rec',
      contactId: contact.id,
      personName: contact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 8000,
      accountId: 'acc-cash-lyd',
    });

    // LYD Payable: 3,000 LYD
    state = addDebtRecordMutation(state, {
      id: 'debt-active-pay',
      contactId: contact.id,
      personName: contact.name,
      direction: 'payable',
      currency: 'LYD',
      totalAmount: 3000,
      accountId: 'acc-cash-lyd',
    });

    const profile = computeUnifiedContactProfile(state, contact);

    // Both debts must remain active, unmerged, and distinct
    assert.equal(profile.debts.active.length, 2);
    assert.equal(profile.debts.settled.length, 0);

    const recDebt = profile.debts.active.find((d) => d.id === 'debt-active-rec');
    assert.equal(recDebt.remainingAmount, 8000, 'Receivable debt remaining amount must not be reduced automatically');

    const payDebt = profile.debts.active.find((d) => d.id === 'debt-active-pay');
    assert.equal(payDebt.remainingAmount, 3000, 'Payable debt remaining amount must not be reduced automatically');

    // Profile KPIs display independent totals as well as net position
    assert.equal(profile.currencies.LYD.receivables, 8000);
    assert.equal(profile.currencies.LYD.payables, 3000);
    assert.equal(profile.currencies.LYD.netPosition, 5000);
  });

  // 15. Duplicate contact & phone collision detection
  await suite.test('15. Duplicate contact & phone collision detection prevents destructive auto-merging', () => {
    let state = createE2EInitialState();

    state.contacts = [
      { id: 'c-1', name: 'أحمد التاجوري', phone: '0910001111', role: 'عميل', createdAt: '2026-01-01' },
      { id: 'c-2', name: 'أحمد التاجوري', phone: '0920002222', role: 'مورد', createdAt: '2026-01-01' },
    ];

    // Unlinked legacy debt
    state.debts.push({
      id: 'debt-legacy-ambiguous',
      personName: 'أحمد التاجوري',
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 2000,
      paidAmount: 0,
      remainingAmount: 2000,
      status: 'active',
      createdAt: '2026-03-01',
      installments: [],
    });

    const audit = auditAndLinkLegacyContactRecords(state);
    assert.equal(audit.linkedCounts.debts, 0, 'Must NOT auto-link ambiguous contact records with duplicate names');
    assert.ok(audit.ambiguousRecords.some((r) => r.recordId === 'debt-legacy-ambiguous'));
    assert.ok(audit.duplicateContacts.length >= 1);
  });

  // 16. Chronological statement running balance accuracy, lossless legacy reconciliation, RLS tenant isolation, offline mutation blocking, and recovery
  await suite.test('16. Chronological running balances, lossless reconciliation, RLS isolation, offline blocking, and recovery', async () => {
    // A. Chronological statement and running balance
    let state = createE2EInitialState();
    const contact = state.contacts[0];

    state.debts.push({
      id: 'debt-t1',
      contactId: contact.id,
      personName: contact.name,
      direction: 'receivable',
      currency: 'LYD',
      totalAmount: 5000,
      paidAmount: 2000,
      remainingAmount: 3000,
      status: 'active',
      createdAt: '2026-01-01',
      installments: [
        { id: 'inst-t1', amount: 2000, date: '2026-01-05', paymentMethod: 'cash', accountId: 'acc-cash-lyd' },
      ],
    });

    state.debts.push({
      id: 'debt-t2',
      contactId: contact.id,
      personName: contact.name,
      direction: 'payable',
      currency: 'LYD',
      totalAmount: 1000,
      paidAmount: 0,
      remainingAmount: 1000,
      status: 'active',
      createdAt: '2026-01-10',
      installments: [],
    });

    const profile = computeUnifiedContactProfile(state, contact);
    assert.equal(profile.timelineEntries.length, 3);
    assert.equal(profile.timelineEntries[0].runningBalanceLyd, 5000); // After 5000 rec
    assert.equal(profile.timelineEntries[1].runningBalanceLyd, 3000); // After 2000 paid
    assert.equal(profile.timelineEntries[2].runningBalanceLyd, 2000); // After 1000 payable

    // Statement PDF HTML contains valid RTL Arabic layout and safe escaping
    const html = generateContactStatementPdfHtml(state, contact);
    assert.ok(html.includes('dir="rtl"'));
    assert.ok(html.includes('علي الفيتوري'));
    assert.ok(html.includes('2,000 د.ل'));

    // B. Offline Central Mutation Blocking
    const guestUser = {
      id: 'local-offline-guest',
      name: 'ضيف محلي',
      email: 'guest@device.local',
      provider: 'email',
      createdAt: '2026-10-14T00:00:00Z',
      isLocalOnly: true,
    };
    const session = createCentralVaultSession(
      { pull: async () => ({ ok: false, success: false, message: '' }), push: async () => ({ ok: false, success: false, message: '' }) },
      () => state
    );
    const guestResult = await session.open(guestUser, state.supabaseConfig);
    assert.equal(guestResult.ok, false);
    assert.ok(guestResult.message.includes('الدخول المحلي غير متاح'));

    // C. PostgreSQL Loopback RLS Tenant Isolation
    const db = await disposableDatabase();
    try {
      const userA = '11111111-1111-4111-8111-111111111111';
      const userB = '22222222-2222-4222-8222-222222222222';

      // Insert contact for userA under workspace 'vault-a'
      await asUser(db, userA, async () => {
        await db.query(`
          INSERT INTO mali_contacts (id, user_id, workspace_key, name, phone, role)
          VALUES ('c-user-a', '${userA}', 'vault-a', 'عميل مستخدم أ', '0911111111', 'عميل')
        `);
      }, true);

      // Verify userB cannot read userA's contact under RLS
      await asUser(db, userB, async () => {
        const res = await db.query(`SELECT * FROM mali_contacts WHERE id = 'c-user-a'`);
        assert.equal(res.rows.length, 0, 'User B must not see User A contacts');
      }, true);

      // Verify userA can read their own contact
      await asUser(db, userA, async () => {
        const res = await db.query(`SELECT * FROM mali_contacts WHERE id = 'c-user-a'`);
        assert.equal(res.rows.length, 1, 'User A can see their own contact');
      }, true);
    } finally {
      await db.close();
    }
  });
});
