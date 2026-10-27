import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeCsvCell,
  escapeHtml,
  generateContactStatementCsv,
  generateDealsCsv,
  generateFinancialStatementHtml,
  generateTransactionsCsv,
  matchesContact,
} from '../src/utils/exportCore.ts';

// Parse exported records independently, including quoted newlines and doubled quotes.
function parseCsv(csv) {
  const input = csv.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && character === ',') {
      row.push(field);
      field = '';
    } else if (!quoted && (character === '\r' || character === '\n')) {
      if (character === '\r' && input[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  assert.equal(quoted, false, 'CSV must close every quoted field');
  row.push(field);
  rows.push(row);
  return rows;
}

const contact = { id: 'person-a', name: 'محمود', phone: '0911111111', role: 'تاجر عملة', createdAt: '2026-01-01' };

function makeState() {
  return {
    accounts: [
      { id: 'cash', name: 'خزينة', bankName: 'نقد', balance: 100, currency: 'LYD', isCash: true, category: 'cash_lyd', color: '#000', updatedAt: '2026-01-01' },
      { id: 'bank', name: 'مصرف', bankName: 'بنك', balance: 50, currency: 'LYD', isCash: false, category: 'bank_lyd', color: '#000', updatedAt: '2026-01-01' },
      { id: 'usd', name: 'دولار', bankName: 'نقد', balance: 2, currency: 'USD', isCash: true, category: 'cash_usd', color: '#000', updatedAt: '2026-01-01' },
    ],
    contacts: [contact, { ...contact, id: 'person-b' }],
    transactions: [{ id: 'tx', date: '2026-03-01', title: 'بيع', type: 'deal_sell', category: 'عملات', amount: 65.25, currency: 'LYD', paymentMethod: 'transfer', accountId: 'bank', targetAccountId: 'cash', feeAmount: 0.5, exchangeRate: 6.525, notes: 'ملاحظة' }],
    deals: [{
      id: 'deal-a', dealNumber: 'USD-1', title: 'شراء دولار', buyDate: '2026-02-01', contactId: 'person-a', counterparty: 'اسم قديم', counterpartyPhone: '0912345678',
      totalUsdBought: 100, buyRate: 6, grossLydCost: 600, buyCommissionLyd: 0, totalLydCost: 600, effectiveBuyRate: 6,
      buyPaymentMethod: 'cash', sourceLydAccountId: 'cash', usdHoldingAccountId: 'usd', soldUsd: 10, personalTakenUsd: 0,
      remainingUsd: 90, totalLydReceived: 65.25, realizedProfitLyd: 5.25, status: 'partial',
      sales: [{ id: 'sale-a', dealId: 'deal-a', date: '2026-03-01', contactId: 'person-a', buyerName: 'اسم جديد', usdAmount: 10, sellRate: 6.525, grossLyd: 65.25, commissionLyd: 0, netLydReceived: 65.25, costBasisLyd: 60, profitLyd: 5.25, paymentMethod: 'transfer', targetLydAccountId: 'bank', sourceUsdAccountId: 'usd' }],
    }],
    debts: [{ id: 'debt-a', createdAt: '2026-01-01', contactId: 'person-a', personName: 'اسم مختلف', direction: 'receivable', currency: 'LYD', totalAmount: 300, paidAmount: 100, remainingAmount: 200, accountId: 'cash', initialPaymentMethod: 'cash', status: 'active', notes: 'دين',
      installments: [
        { id: 'payment-late', date: '2026-03-04', amount: 60, accountId: 'bank', paymentMethod: 'transfer', notes: 'القسط الثاني', transactionId: 'linked-tx' },
        { id: 'payment-early', date: '2026-01-02', amount: 40, accountId: 'cash', paymentMethod: 'cash', notes: 'القسط الأول' },
      ],
    }],
    budgets: [], procedures: [],
    marketRates: { cashUsdToLyd: 6, chequeUsdToLyd: 6.5, defaultChequeDiscountPercent: 0, updatedAt: '2026-01-01' },
    supabaseConfig: { url: '', anonKey: '', workspaceKey: 'local', autoSync: false },
  };
}

test('CSV cells neutralize formulas and control prefixes without changing numeric money', () => {
  const unsafeText = ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', ' \t=1', '\r\n=1', '\ttext', '\u200f=1', '＝1+1', '＋SUM(A1)', '\u0000=1'];
  for (const value of unsafeText) {
    assert.equal(parseCsv(encodeCsvCell(value))[0][0], `'${value}`);
  }
  for (const value of ['شرح = قيمة', 'محمود', '2026-01-02', 'a,"b"\r\nc', "'already text"]) {
    assert.equal(parseCsv(encodeCsvCell(value))[0][0], value);
  }
  assert.equal(encodeCsvCell(-25.5), '-25.5');
  assert.equal(encodeCsvCell(0), '0');
  assert.equal(encodeCsvCell(1.25), '1.25');
});

test('transaction CSV escapes every text column and round-trips delimiters and multiline Arabic', () => {
  const state = makeState();
  state.accounts[0].name = 'خزينة,"رئيسية"\nفرع';
  state.accounts[1].name = '=HYPERLINK("https://example.invalid")';
  Object.assign(state.transactions[0], {
    title: '=SUM(A1)', category: 'تصنيف,"آخر"\nجديد', notes: '@formula', date: '+date',
    type: '-kind', currency: '=currency', paymentMethod: '@method',
  });
  const csv = generateTransactionsCsv(state);
  assert.ok(csv.startsWith('\uFEFF'));
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 12);
  assert.deepEqual(rows[1], [
    "'+date", "'=SUM(A1)", "'-kind", 'تصنيف,"آخر"\nجديد', '65.25', "'=currency", "'@method",
    "'=HYPERLINK(\"https://example.invalid\")", 'خزينة,"رئيسية"\nفرع', '0.5', '6.525', "'@formula",
  ]);
});

test('account CSV includes both sides of transfers and excludes unrelated accounts', () => {
  const state = makeState();
  state.transactions.push({ ...state.transactions[0], id: 'unrelated', accountId: 'usd', targetAccountId: undefined });
  assert.equal(parseCsv(generateTransactionsCsv(state, 'cash')).length, 2);
  assert.equal(parseCsv(generateTransactionsCsv(state, 'bank')).length, 2);
  assert.equal(parseCsv(generateTransactionsCsv(state, 'missing')).length, 1);
});

test('deal CSV protects number/title/date/seller/phone/account/method while retaining negative profit', () => {
  const state = makeState();
  state.accounts[0].name = 'خزينة,"نقد"';
  Object.assign(state.deals[0], {
    dealNumber: '=deal', title: 'شراء,"دولار"\nاختبار', buyDate: '@date', counterparty: '+seller',
    counterpartyPhone: '+218911111111', buyPaymentMethod: '-method', realizedProfitLyd: -12.5,
  });
  const row = parseCsv(generateDealsCsv(state))[1];
  assert.equal(row.length, 15);
  assert.deepEqual(row.slice(0, 9), ["'=deal", 'شراء,"دولار"\nاختبار', "'@date", "'+seller", "'+218911111111", '100', '6', "'-method", 'خزينة,"نقد"']);
  assert.equal(row[13], '-12.5');
});

test('contact identity wins over same-name matching; legacy unlinked names remain readable', () => {
  assert.equal(matchesContact(contact, 'person-a', 'اسم قديم'), true);
  assert.equal(matchesContact(contact, 'person-b', contact.name), false);
  assert.equal(matchesContact(contact, undefined, ` ${contact.name} `), true);
  assert.equal(matchesContact(contact, undefined, 'شخص مختلف'), false);
  assert.equal(matchesContact(contact, undefined, undefined), false);
});

test('contact statement excludes same-name IDs and lists canonical installments once in chronological order', () => {
  const state = makeState();
  const otherDeal = structuredClone(state.deals[0]);
  Object.assign(otherDeal, { id: 'deal-b', dealNumber: 'OTHER', contactId: 'person-b', counterparty: contact.name, buyDate: '2026-01-03' });
  Object.assign(otherDeal.sales[0], { contactId: 'person-b', buyerName: contact.name });
  const legacyDeal = { ...state.deals[0], id: 'legacy', dealNumber: 'LEGACY', contactId: undefined, counterparty: contact.name, buyDate: '2026-01-15', sales: [] };
  state.deals.push(otherDeal, legacyDeal);
  state.debts.push({ ...state.debts[0], id: 'other-debt', contactId: 'person-b', personName: contact.name, notes: 'OTHER DEBT' });
  state.transactions.push({ ...state.transactions[0], id: 'linked-tx', type: 'debt_settlement', debtId: 'debt-a', amount: 60 });
  const before = structuredClone(state);
  const rows = parseCsv(generateContactStatementCsv(state, contact));
  assert.deepEqual(rows.slice(1).map((row) => row[0]), ['2026-01-01', '2026-01-02', '2026-01-15', '2026-02-01', '2026-03-01', '2026-03-04']);
  assert.ok(rows.every((row) => row.length === 9));
  assert.equal(rows.filter((row) => row[1] === 'تحصيل قسط دين منه').length, 2);
  assert.equal(rows.at(-1)[5], '60');
  assert.equal(rows.at(-1)[6], 'تحويل مصرفي');
  assert.equal(rows.at(-1)[7], 'مصرف');
  assert.ok(!rows.some((row) => row.join(' ').includes('OTHER')));
  assert.deepEqual(state, before, 'exporting must not modify financial state');
});

test('USD payable installments preserve currency, direction and safe notes/account cells', () => {
  const state = makeState();
  state.deals = [];
  state.accounts[1].name = '=unsafe account';
  Object.assign(state.debts[0], { currency: 'USD', direction: 'payable', notes: '=unsafe debt', installments: [
    { id: 'usd-payment', date: '2026-01-04', amount: 60.25, accountId: 'bank', paymentMethod: 'cheque', notes: '+unsafe installment' },
  ] });
  const rows = parseCsv(generateContactStatementCsv(state, contact));
  assert.ok(rows[1][2].startsWith("'=unsafe debt"));
  assert.equal(rows[2][1], 'سداد قسط دين له');
  assert.equal(rows[2][2], "'+unsafe installment");
  assert.equal(rows[2][3], '60.25');
  assert.equal(rows[2][5], '0');
  assert.equal(rows[2][6], 'صك مصرفي');
  assert.equal(rows[2][7], "'=unsafe account");
});

test('HTML report treats every dynamic value as text and includes a restrictive content policy', () => {
  assert.equal(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
  const state = makeState();
  const attack = '</td><script>globalThis.stolen=1</script><img src=x onerror=alert(1)><td>"&';
  state.accounts[0].name = attack;
  state.accounts[0].bankName = attack;
  Object.assign(state.deals[0], { dealNumber: attack, title: attack, counterparty: attack, buyPaymentMethod: attack });
  Object.assign(state.transactions[0], { date: attack, title: attack, category: attack, type: attack, paymentMethod: attack });
  state.marketRates.cashUsdToLyd = attack;
  const html = generateFinancialStatementHtml(state, new Date('2026-10-12T10:30:00Z'));
  assert.equal(html.includes(attack), false);
  assert.equal(/<script\b|<img\b|<iframe\b|<a\b|<form\b/i.test(html), false);
  assert.ok(html.includes('&lt;script&gt;globalThis.stolen=1&lt;/script&gt;'));
  assert.ok(html.includes('&quot;&amp;'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("base-uri 'none'"));
  assert.ok(html.includes('<html dir="rtl" lang="ar">'));
  assert.ok(html.includes('100 د.ل'));
  assert.ok(html.includes('50 د.ل'));
  assert.ok(html.includes('$2'));
  assert.ok(html.includes('5.25 د.ل'));
});

test('HTML report displays a loss with a single minus sign', () => {
  const state = makeState();
  state.deals[0].realizedProfitLyd = -12.5;
  const html = generateFinancialStatementHtml(state);
  assert.ok(html.includes('-12.50 د.ل'));
  assert.ok(!html.includes('+-12.50'));
});
