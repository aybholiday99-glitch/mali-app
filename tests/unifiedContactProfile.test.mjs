import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeUnifiedContactProfile,
  generateContactStatementPdfHtml,
  auditAndLinkLegacyContactRecords,
  isDebtBelongingTransaction,
  isDealBelongingTransaction,
} from '../src/services/unifiedContactProfileService.ts';

function createBaseState() {
  return {
    accounts: [
      { id: 'acc-cash-lyd', name: 'خزينة الكاش (دينار)', bankName: 'نقد', currency: 'LYD', balance: 50000, isCash: true, category: 'cash_lyd', color: '#0d9488', updatedAt: '2026-01-01' },
      { id: 'acc-bank-lyd', name: 'حساب مصرف التجارة (دينار)', bankName: 'مصرف التجارة', currency: 'LYD', balance: 100000, isCash: false, category: 'bank_lyd', color: '#3b82f6', updatedAt: '2026-01-01' },
      { id: 'acc-cash-usd', name: 'خزينة دولار كاش', bankName: 'نقد', currency: 'USD', balance: 20000, isCash: true, category: 'cash_usd', color: '#10b981', updatedAt: '2026-01-01' },
      { id: 'acc-bank-usd', name: 'حساب دولار مصرفي', bankName: 'الأمان', currency: 'USD', balance: 10000, isCash: false, category: 'bank_usd', color: '#6366f1', updatedAt: '2026-01-01' },
    ],
    contacts: [
      { id: 'cnt-1', name: 'عمر المختار', phone: '0912345678', role: 'شريك تجاري', bankDetails: 'مصرف الجمهورية - 012345', createdAt: '2026-01-01' },
      { id: 'cnt-2', name: 'طارق بن زياد', phone: '0922345678', role: 'تاجر عملة', bankDetails: 'مصرف الأمان - 987654', createdAt: '2026-01-01' },
    ],
    transactions: [],
    deals: [],
    debts: [],
    procedures: [],
    budgets: [],
    marketRates: { cashUsdToLyd: 6.22, chequeUsdToLyd: 6.38, defaultChequeDiscountPercent: 2.5, updatedAt: '2026-01-01' },
    supabaseConfig: { url: '', anonKey: '', workspaceKey: '', autoSync: false },
  };
}

test('1. Exact LYD and USD separation and net calculation without auto-offsetting', () => {
  let state = createBaseState();
  const contact = state.contacts[0]; // عمر المختار

  // Add 1 LYD Receivable Debt: 10,000 LYD
  state.debts.push({
    id: 'debt-lyd-rec',
    contactId: contact.id,
    personName: contact.name,
    direction: 'receivable',
    currency: 'LYD',
    totalAmount: 10000,
    paidAmount: 2000,
    remainingAmount: 8000,
    status: 'active',
    createdAt: '2026-01-10',
    installments: [
      { id: 'inst-lyd-1', amount: 2000, date: '2026-01-15', paymentMethod: 'cash', accountId: 'acc-cash-lyd' },
    ],
  });

  // Add 1 LYD Payable Debt: 3,000 LYD
  state.debts.push({
    id: 'debt-lyd-pay',
    contactId: contact.id,
    personName: contact.name,
    direction: 'payable',
    currency: 'LYD',
    totalAmount: 3000,
    paidAmount: 500,
    remainingAmount: 2500,
    status: 'active',
    createdAt: '2026-01-20',
    installments: [
      { id: 'inst-lyd-2', amount: 500, date: '2026-01-25', paymentMethod: 'transfer', accountId: 'acc-bank-lyd' },
    ],
  });

  // Add 1 USD Receivable Debt: 5,000 USD
  state.debts.push({
    id: 'debt-usd-rec',
    contactId: contact.id,
    personName: contact.name,
    direction: 'receivable',
    currency: 'USD',
    totalAmount: 5000,
    paidAmount: 1000,
    remainingAmount: 4000,
    status: 'active',
    createdAt: '2026-02-01',
    installments: [
      { id: 'inst-usd-1', amount: 1000, date: '2026-02-05', paymentMethod: 'cash', accountId: 'acc-cash-usd' },
    ],
  });

  // Add 1 USD Payable Debt: 1,200 USD
  state.debts.push({
    id: 'debt-usd-pay',
    contactId: contact.id,
    personName: contact.name,
    direction: 'payable',
    currency: 'USD',
    totalAmount: 1200,
    paidAmount: 200,
    remainingAmount: 1000,
    status: 'active',
    createdAt: '2026-02-10',
    installments: [
      { id: 'inst-usd-2', amount: 200, date: '2026-02-15', paymentMethod: 'cash', accountId: 'acc-cash-usd' },
    ],
  });

  const profile = computeUnifiedContactProfile(state, contact);

  // LYD Assertions
  assert.equal(profile.currencies.LYD.receivables, 8000, 'LYD receivables must be 8,000');
  assert.equal(profile.currencies.LYD.payables, 2500, 'LYD payables must be 2,500');
  assert.equal(profile.currencies.LYD.netPosition, 5500, 'LYD net must be 8,000 - 2,500 = 5,500');
  assert.equal(profile.currencies.LYD.totalReceivables, 10000);
  assert.equal(profile.currencies.LYD.totalPayables, 3000);
  assert.equal(profile.currencies.LYD.settledReceivables, 2000);
  assert.equal(profile.currencies.LYD.settledPayables, 500);

  // USD Assertions
  assert.equal(profile.currencies.USD.receivables, 4000, 'USD receivables must be 4,000');
  assert.equal(profile.currencies.USD.payables, 1000, 'USD payables must be 1,000');
  assert.equal(profile.currencies.USD.netPosition, 3000, 'USD net must be 4,000 - 1,000 = 3,000');
  assert.equal(profile.currencies.USD.totalReceivables, 5000);
  assert.equal(profile.currencies.USD.totalPayables, 1200);
  assert.equal(profile.currencies.USD.settledReceivables, 1000);
  assert.equal(profile.currencies.USD.settledPayables, 200);

  // Zero Cross-Currency Bleed
  assert.notEqual(profile.currencies.LYD.netPosition, profile.currencies.USD.netPosition);
  assert.equal(typeof profile.currencies.LYD.netPosition, 'number');
  assert.equal(typeof profile.currencies.USD.netPosition, 'number');

  // Active debts are not auto-merged or extinguished
  assert.equal(profile.debts.active.length, 4, 'All 4 debts remain active separate records');
  assert.equal(profile.debts.settled.length, 0);
});

test('2. USD Deals Summary — Purchases, Sales, Revenue and Realized Profit', () => {
  let state = createBaseState();
  const contact = state.contacts[1]; // طارق بن زياد (تاجر عملة)

  // Deal 1: Bought 10,000 USD from Tariq
  state.deals.push({
    id: 'deal-1',
    dealNumber: 'DL-001',
    title: 'شراء دولار كاش من طارق',
    contactId: contact.id,
    counterparty: contact.name,
    buyDate: '2026-03-01',
    totalUsdBought: 10000,
    buyRate: 6.20,
    grossLydCost: 62000,
    buyCommissionLyd: 100,
    totalLydCost: 62100,
    effectiveBuyRate: 6.21,
    buyPaymentMethod: 'cash',
    sourceLydAccountId: 'acc-cash-lyd',
    usdHoldingAccountId: 'acc-cash-usd',
    soldUsd: 4000,
    personalTakenUsd: 0,
    remainingUsd: 6000,
    totalLydReceived: 25600,
    realizedProfitLyd: 760,
    status: 'partial',
    sales: [
      // Sale 1 to someone else (not Tariq)
      {
        id: 'sale-other',
        dealId: 'deal-1',
        usdAmount: 1000,
        sellRate: 6.40,
        grossLyd: 6400,
        commissionLyd: 0,
        netLydReceived: 6400,
        costBasisLyd: 6210,
        profitLyd: 190,
        paymentMethod: 'cash',
        targetLydAccountId: 'acc-cash-lyd',
        sourceUsdAccountId: 'acc-cash-usd',
        buyerName: 'شخص آخر',
        date: '2026-03-05',
      },
      // Sale 2 to Tariq (3,000 USD sold back to Tariq)
      {
        id: 'sale-tariq',
        dealId: 'deal-1',
        usdAmount: 3000,
        sellRate: 6.40,
        grossLyd: 19200,
        commissionLyd: 0,
        netLydReceived: 19200,
        costBasisLyd: 18630,
        profitLyd: 570,
        paymentMethod: 'transfer',
        targetLydAccountId: 'acc-bank-lyd',
        sourceUsdAccountId: 'acc-cash-usd',
        contactId: contact.id,
        buyerName: contact.name,
        date: '2026-03-10',
      },
    ],
  });

  const profile = computeUnifiedContactProfile(state, contact);

  assert.equal(profile.usdDealsSummary.boughtUsdAmount, 10000, 'Bought 10,000 USD from Tariq');
  assert.equal(profile.usdDealsSummary.boughtLydCost, 62100, 'Cost in LYD 62,100');
  assert.equal(profile.usdDealsSummary.soldUsdAmount, 3000, 'Sold 3,000 USD to Tariq (excluding sale to other)');
  assert.equal(profile.usdDealsSummary.soldLydRevenue, 19200, 'Revenue from Tariq 19,200 LYD');
  assert.equal(profile.usdDealsSummary.realizedProfitLyd, 570, 'Realized profit from Tariq 570 LYD');
  assert.equal(profile.usdDealsSummary.dealsCount, 1);
  assert.equal(profile.usdDealsSummary.salesCount, 1);
});

test('3. No double counting between deals, debts, and generic direct transactions', () => {
  let state = createBaseState();
  const contact = state.contacts[0];

  // 1. Debt and its transactions
  const debtId = 'debt-isolated';
  const instId = 'inst-isolated';
  state.debts.push({
    id: debtId,
    contactId: contact.id,
    personName: contact.name,
    direction: 'receivable',
    currency: 'LYD',
    totalAmount: 5000,
    paidAmount: 2000,
    remainingAmount: 3000,
    status: 'active',
    createdAt: '2026-04-01',
    initialTransactionId: 'tx-debt-init',
    installments: [
      { id: instId, amount: 2000, date: '2026-04-05', paymentMethod: 'cash', accountId: 'acc-cash-lyd', transactionId: 'tx-debt-settle' },
    ],
  });

  // Mirror transaction created by debt creation
  state.transactions.push({
    id: 'tx-debt-init',
    title: 'إقراض دين',
    type: 'expense',
    amount: 5000,
    currency: 'LYD',
    category: 'ديون وأمانات',
    accountId: 'acc-cash-lyd',
    paymentMethod: 'cash',
    contactId: contact.id,
    debtId: debtId,
    date: '2026-04-01',
  });

  // Mirror transaction created by debt settlement
  state.transactions.push({
    id: 'tx-debt-settle',
    title: 'سداد دفعة دين',
    type: 'debt_settlement',
    amount: 2000,
    currency: 'LYD',
    category: 'ديون وأمانات',
    accountId: 'acc-cash-lyd',
    paymentMethod: 'cash',
    contactId: contact.id,
    debtId: debtId,
    installmentId: instId,
    date: '2026-04-05',
  });

  // 2. Deal and its transactions
  const dealId = 'deal-isolated';
  state.deals.push({
    id: dealId,
    dealNumber: 'DL-ISO',
    title: 'شراء دولار',
    contactId: contact.id,
    counterparty: contact.name,
    buyDate: '2026-04-10',
    totalUsdBought: 1000,
    buyRate: 6.2,
    grossLydCost: 6200,
    buyCommissionLyd: 0,
    totalLydCost: 6200,
    effectiveBuyRate: 6.2,
    buyPaymentMethod: 'cash',
    sourceLydAccountId: 'acc-cash-lyd',
    usdHoldingAccountId: 'acc-cash-usd',
    soldUsd: 0,
    personalTakenUsd: 0,
    remainingUsd: 1000,
    totalLydReceived: 0,
    realizedProfitLyd: 0,
    status: 'open',
    sales: [],
  });

  state.transactions.push({
    id: 'tx-deal-buy',
    title: 'شراء صفقة دولار',
    type: 'deal_buy',
    amount: 6200,
    currency: 'LYD',
    category: 'تداول عملات',
    accountId: 'acc-cash-lyd',
    paymentMethod: 'cash',
    contactId: contact.id,
    dealId: dealId,
    date: '2026-04-10',
  });

  // 3. Direct generic transactions (NOT linked to debt or deal)
  state.transactions.push({
    id: 'tx-direct-expense',
    title: 'أتعاب استشارة وتنسيق',
    type: 'expense',
    amount: 350,
    currency: 'LYD',
    category: 'خدمات',
    accountId: 'acc-cash-lyd',
    paymentMethod: 'cash',
    contactId: contact.id,
    date: '2026-04-12',
  });

  state.transactions.push({
    id: 'tx-direct-income',
    title: 'استرداد مصاريف مباشرة',
    type: 'income',
    amount: 150,
    currency: 'LYD',
    category: 'إيرادات',
    accountId: 'acc-cash-lyd',
    paymentMethod: 'cash',
    contactId: contact.id,
    date: '2026-04-15',
  });

  // Verify helper detectors
  assert.equal(isDebtBelongingTransaction(state.transactions[0]), true);
  assert.equal(isDebtBelongingTransaction(state.transactions[1]), true);
  assert.equal(isDealBelongingTransaction(state.transactions[2]), true);
  assert.equal(isDebtBelongingTransaction(state.transactions[3]), false);
  assert.equal(isDealBelongingTransaction(state.transactions[3]), false);

  const profile = computeUnifiedContactProfile(state, contact);

  // Direct transactions must isolate ONLY generic ones (exactly 2)
  assert.equal(profile.directTransactions.items.length, 2, 'Must contain exactly 2 generic transactions');
  const directIds = profile.directTransactions.items.map((t) => t.id);
  assert.ok(directIds.includes('tx-direct-expense'));
  assert.ok(directIds.includes('tx-direct-income'));
  assert.equal(directIds.includes('tx-debt-init'), false);
  assert.equal(directIds.includes('tx-debt-settle'), false);
  assert.equal(directIds.includes('tx-deal-buy'), false);

  assert.equal(profile.directTransactions.summary.lydExpenseTotal, 350);
  assert.equal(profile.directTransactions.summary.lydIncomeTotal, 150);

  // Check timeline entries count:
  // 1 debt creation + 1 debt installment + 1 deal buy + 2 direct tx = 5 timeline entries.
  // Neither tx-debt-init, tx-debt-settle, nor tx-deal-buy should duplicate rows!
  assert.equal(profile.timelineEntries.length, 5, 'Timeline must contain exactly 5 canonical events');
});

test('4. Non-cash settlements vs cash installments distinction and reasoning', () => {
  let state = createBaseState();
  const contact = state.contacts[0];

  state.debts.push({
    id: 'debt-mixed-settle',
    contactId: contact.id,
    personName: contact.name,
    direction: 'receivable',
    currency: 'LYD',
    totalAmount: 8000,
    paidAmount: 5000,
    remainingAmount: 3000,
    status: 'active',
    createdAt: '2026-05-01',
    installments: [
      // Cash installment: 2,000 LYD
      {
        id: 'inst-cash',
        amount: 2000,
        date: '2026-05-05',
        paymentMethod: 'cash',
        accountId: 'acc-cash-lyd',
        notes: 'دفعة نقدية باليد',
      },
      // Non-cash installment: 3,000 LYD (مقاصة)
      {
        id: 'inst-noncash',
        amount: 3000,
        date: '2026-05-10',
        paymentMethod: 'cash', // Legacy or fallback method
        settlementType: 'non_cash',
        isNonCash: true,
        nonCashReason: 'مقاصة مقابل تسليم سيارة بضائع وفاتورة توريد رقم 882',
        notes: 'تسوية عينية متفق عليها',
      },
    ],
  });

  const profile = computeUnifiedContactProfile(state, contact);
  assert.equal(profile.debts.installments.length, 2);

  const cashInst = profile.debts.installments.find((i) => i.id === 'inst-cash');
  assert.ok(cashInst);
  assert.equal(cashInst.isNonCash, false);
  assert.equal(cashInst.accountId, 'acc-cash-lyd');
  assert.equal(cashInst.paymentMethodLabel, 'نقدي (كاش)');

  const nonCashInst = profile.debts.installments.find((i) => i.id === 'inst-noncash');
  assert.ok(nonCashInst);
  assert.equal(nonCashInst.isNonCash, true);
  assert.equal(nonCashInst.settlementType, 'non_cash');
  assert.equal(nonCashInst.nonCashReason, 'مقاصة مقابل تسليم سيارة بضائع وفاتورة توريد رقم 882');
  assert.equal(nonCashInst.accountName, 'تسوية غير نقدية (بدون حركة خزينة)');
  assert.equal(nonCashInst.paymentMethodLabel, 'تسوية غير نقدية (مقاصة)');

  // Verify timeline labels
  const timelineCash = profile.timelineEntries.find((e) => e.refId === 'inst-cash');
  assert.ok(timelineCash);
  assert.equal(timelineCash.typeLabel, 'تحصيل قسط دين منه');

  const timelineNonCash = profile.timelineEntries.find((e) => e.refId === 'inst-noncash');
  assert.ok(timelineNonCash);
  assert.equal(timelineNonCash.typeLabel, 'تسوية دين غير نقدية (مقاصة/تنازل)');
  assert.equal(timelineNonCash.isNonCash, true);
  assert.equal(timelineNonCash.nonCashReason, 'مقاصة مقابل تسليم سيارة بضائع وفاتورة توريد رقم 882');
});

test('5. Chronological timeline sorting and running balances computation', () => {
  let state = createBaseState();
  const contact = state.contacts[0];

  // Intentionally added in scrambled chronological order
  state.debts.push({
    id: 'debt-pay-later',
    contactId: contact.id,
    personName: contact.name,
    direction: 'payable',
    currency: 'LYD',
    totalAmount: 4000,
    paidAmount: 1000,
    remainingAmount: 3000,
    status: 'active',
    createdAt: '2026-06-15',
    installments: [
      { id: 'inst-pay-1', amount: 1000, date: '2026-06-20', paymentMethod: 'transfer', accountId: 'acc-bank-lyd' },
    ],
  });

  state.debts.push({
    id: 'debt-rec-early',
    contactId: contact.id,
    personName: contact.name,
    direction: 'receivable',
    currency: 'LYD',
    totalAmount: 10000,
    paidAmount: 5000,
    remainingAmount: 5000,
    status: 'active',
    createdAt: '2026-06-01',
    installments: [
      { id: 'inst-rec-2', amount: 2000, date: '2026-06-10', paymentMethod: 'cash', isNonCash: true, nonCashReason: 'مقاصة' },
      { id: 'inst-rec-1', amount: 3000, date: '2026-06-05', paymentMethod: 'cash', accountId: 'acc-cash-lyd' },
    ],
  });

  const profile = computeUnifiedContactProfile(state, contact);

  // Timeline must be sorted ascending by date:
  // 1. 2026-06-01: debt-rec-early creation (+10,000) -> running: 10,000
  // 2. 2026-06-05: inst-rec-1 (-3,000) -> running: 7,000
  // 3. 2026-06-10: inst-rec-2 (-2,000) -> running: 5,000
  // 4. 2026-06-15: debt-pay-later creation (-4,000) -> running: 1,000
  // 5. 2026-06-20: inst-pay-1 (+1,000 paid towards our debt) -> running: 2,000
  const dates = profile.timelineEntries.map((e) => e.date);
  assert.deepEqual(dates, [
    '2026-06-01',
    '2026-06-05',
    '2026-06-10',
    '2026-06-15',
    '2026-06-20',
  ]);

  const runningLyd = profile.timelineEntries.map((e) => e.runningBalanceLyd);
  assert.deepEqual(runningLyd, [
    10000,
    7000,
    5000,
    1000,
    2000,
  ]);

  // Terminal running balance matches net position
  assert.equal(profile.currencies.LYD.netPosition, 2000);
  assert.equal(profile.timelineEntries[profile.timelineEntries.length - 1].runningBalanceLyd, 2000);
  assert.equal(profile.currencies.LYD.receivables, 5000);
  assert.equal(profile.currencies.LYD.payables, 3000);
});

test('6. Legacy record reconciliation and duplicate detection', () => {
  let state = createBaseState();

  // Populate contacts directory with edge cases:
  state.contacts = [
    { id: 'c-unique', name: 'سالم قذافي', phone: '0910000001', role: 'شخصي / عميل', createdAt: '2026-01-01' },
    { id: 'c-conflict-phone', name: 'فتحي المبروك', phone: '0910000002', role: 'شريك تجاري', createdAt: '2026-01-01' },
    // Duplicate name in directory
    { id: 'c-dup-1', name: 'محمد الصادق', phone: '0910000003', role: 'تاجر عملة', createdAt: '2026-01-01' },
    { id: 'c-dup-2', name: 'محمد الصادق', phone: '0910000004', role: 'تاجر عملة', createdAt: '2026-01-01' },
    // Duplicate phone with different names
    { id: 'c-phone-share-1', name: 'علي الزروق', phone: '0929999999', role: 'شخصي / عميل', createdAt: '2026-01-01' },
    { id: 'c-phone-share-2', name: 'خالد الزروق', phone: '0929999999', role: 'شخصي / عميل', createdAt: '2026-01-01' },
  ];

  // 1. Unlinked debt that has a unique exact name match & matching phone -> MUST LINK SAFELY
  state.debts.push({
    id: 'debt-legacy-1',
    personName: 'سالم قذافي',
    phone: '091-000-0001',
    direction: 'receivable',
    currency: 'LYD',
    totalAmount: 1500,
    paidAmount: 0,
    remainingAmount: 1500,
    status: 'active',
    createdAt: '2026-07-01',
    installments: [],
  });

  // 2. Unlinked debt matching 'فتحي المبروك' but with conflicting phone -> MUST FLAG AS AMBIGUOUS (DO NOT AUTO-LINK)
  state.debts.push({
    id: 'debt-legacy-conflict',
    personName: 'فتحي المبروك',
    phone: '092-555-5555', // Conflicts with 0910000002
    direction: 'payable',
    currency: 'LYD',
    totalAmount: 2500,
    paidAmount: 0,
    remainingAmount: 2500,
    status: 'active',
    createdAt: '2026-07-02',
    installments: [],
  });

  // 3. Unlinked debt matching duplicate name 'محمد الصادق' -> MUST FLAG AS AMBIGUOUS (DO NOT AUTO-LINK)
  state.debts.push({
    id: 'debt-legacy-dupname',
    personName: 'محمد الصادق',
    direction: 'receivable',
    currency: 'USD',
    totalAmount: 500,
    paidAmount: 0,
    remainingAmount: 500,
    status: 'active',
    createdAt: '2026-07-03',
    installments: [],
  });

  // 4. Unlinked Deal with unique name match -> MUST LINK SAFELY
  state.deals.push({
    id: 'deal-legacy-1',
    dealNumber: 'DL-LEGACY',
    title: 'صفقة تراثية',
    counterparty: 'سالم قذافي',
    counterpartyPhone: '0910000001',
    buyDate: '2026-07-05',
    totalUsdBought: 2000,
    buyRate: 6.2,
    grossLydCost: 12400,
    buyCommissionLyd: 0,
    totalLydCost: 12400,
    effectiveBuyRate: 6.2,
    buyPaymentMethod: 'cash',
    sourceLydAccountId: 'acc-cash-lyd',
    usdHoldingAccountId: 'acc-cash-usd',
    soldUsd: 0,
    personalTakenUsd: 0,
    remainingUsd: 2000,
    totalLydReceived: 0,
    realizedProfitLyd: 0,
    status: 'open',
    sales: [],
  });

  // 5. Unlinked transaction belonging to debt-legacy-1 -> MUST LINK VIA DEBT
  state.transactions.push({
    id: 'tx-legacy-for-debt',
    title: 'إقراض لسالم',
    type: 'expense',
    amount: 1500,
    currency: 'LYD',
    category: 'ديون وأمانات',
    accountId: 'acc-cash-lyd',
    paymentMethod: 'cash',
    debtId: 'debt-legacy-1',
    date: '2026-07-01',
  });

  const auditResult = auditAndLinkLegacyContactRecords(state);

  // Verification of links
  assert.equal(auditResult.linkedCounts.debts, 1, 'Exactly 1 debt should be safely linked');
  assert.equal(auditResult.linkedCounts.deals, 1, 'Exactly 1 deal should be safely linked');
  assert.equal(auditResult.linkedCounts.transactions, 1, 'Transaction linked to debt-legacy-1 should be linked');

  const linkedDebt = auditResult.updatedState.debts.find((d) => d.id === 'debt-legacy-1');
  assert.equal(linkedDebt.contactId, 'c-unique');

  const unlinkedConflictDebt = auditResult.updatedState.debts.find((d) => d.id === 'debt-legacy-conflict');
  assert.equal(unlinkedConflictDebt.contactId, undefined, 'Conflicting phone debt must remain unlinked');

  const unlinkedDupDebt = auditResult.updatedState.debts.find((d) => d.id === 'debt-legacy-dupname');
  assert.equal(unlinkedDupDebt.contactId, undefined, 'Duplicate name debt must remain unlinked');

  const linkedTx = auditResult.updatedState.transactions.find((t) => t.id === 'tx-legacy-for-debt');
  assert.equal(linkedTx.contactId, 'c-unique');

  // Verification of ambiguity and duplicate flags
  assert.ok(auditResult.duplicateContacts.length >= 2, 'Should detect duplicate names and phone collisions in directory');
  assert.ok(auditResult.ambiguousRecords.some((r) => r.recordId === 'debt-legacy-conflict' && r.reason.includes('رقم الهاتف مختلف')));
  assert.ok(auditResult.ambiguousRecords.some((r) => r.recordId === 'debt-legacy-dupname' && r.reason.includes('مكرر')));

  // State immutability check
  assert.notStrictEqual(auditResult.updatedState, state);
  assert.equal(state.debts[0].contactId, undefined, 'Original state must not be mutated');
});

test('7. generateContactStatementPdfHtml produces valid, safe RTL HTML with summary and statement', () => {
  let state = createBaseState();
  const contact = state.contacts[0];

  state.debts.push({
    id: 'debt-html-rec',
    contactId: contact.id,
    personName: contact.name,
    direction: 'receivable',
    currency: 'LYD',
    totalAmount: 12000,
    paidAmount: 4000,
    remainingAmount: 8000,
    status: 'active',
    createdAt: '2026-08-01',
    installments: [
      { id: 'inst-html-1', amount: 4000, date: '2026-08-05', paymentMethod: 'cash', accountId: 'acc-cash-lyd', notes: 'دفعة أولى' },
    ],
  });

  const html = generateContactStatementPdfHtml(state, contact, new Date('2026-08-10T12:00:00Z'));

  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('dir="rtl"'));
  assert.ok(html.includes('lang="ar"'));
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('عمر المختار'));
  assert.ok(html.includes('8,000 د.ل')); // Remaining receivable
  assert.ok(html.includes('كشف حساب مالي تفصيلي'));
  assert.ok(html.includes('دفعة أولى'));

  // XSS protection check
  const contactWithXss = {
    ...contact,
    id: 'cnt-xss',
    name: '<script>alert(1)</script>',
    notes: '<img src=x onerror=alert(1)>',
  };
  const safeHtml = generateContactStatementPdfHtml(state, contactWithXss);
  assert.ok(!safeHtml.includes('<script>alert(1)</script>'));
  assert.ok(safeHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
