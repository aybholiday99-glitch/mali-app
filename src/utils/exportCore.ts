import type { ContactPerson, Currency, MaliState } from '../types/mali';

export function formatMoney(amount: number, currency: Currency = 'LYD'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = safe.toLocaleString('en-US', {
    minimumFractionDigits: safe % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency === 'USD' ? `$${formatted}` : `${formatted} د.ل`;
}

export function formatRate(rate: number): string {
  const safe = Number.isFinite(rate) ? rate : 0;
  return `${safe.toFixed(3)} د.ل`;
}

export function getPaymentMethodLabel(method: string): string {
  switch (method) {
    case 'cash': return 'نقدي (كاش)';
    case 'cheque': return 'صك مصرفي';
    case 'transfer': return 'تحويل مصرفي';
    case 'card': return 'بطاقة مصرفية';
    default: return method;
  }
}

export function getTransactionTypeLabel(type: string): string {
  switch (type) {
    case 'expense': return 'مصروف شخصي';
    case 'income': return 'إيراد / تغذية';
    case 'transfer': return 'تحويل بين الحسابات';
    case 'cheque_liquidation': return 'تسييل صك إلى كاش';
    case 'deal_buy': return 'شراء صفقة دولار';
    case 'deal_sell': return 'بيع صفقة دولار';
    case 'deal_personal_take': return 'سحب شخصي من صفقة';
    case 'debt_settlement': return 'دفعة دين / التزام';
    default: return type;
  }
}

/** Quote every text cell; spreadsheet formula protection is separate from CSV quoting. */
export function encodeCsvCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = value == null ? '' : String(value);
  // Ignore whitespace/control/bidi prefixes when detecting formulas. NFKC also
  // catches full-width prefixes without altering the exported text.
  const formulaPrefix = /^[\s\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]*[=+\-@]/u;
  const needsTextPrefix = formulaPrefix.test(text.normalize('NFKC')) || /^[ ]*[\t\r\n]/.test(text);
  const safe = needsTextPrefix ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function buildCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return '\uFEFF' + [header, ...rows].map((row) => row.map(encodeCsvCell).join(',')).join('\r\n');
}

/** Explicit identity takes precedence; names only recover legacy unlinked records. */
export function matchesContact(contact: ContactPerson, contactId?: string, name?: string): boolean {
  if (contactId) return contactId === contact.id;
  return Boolean(name?.trim() && name.trim().toLowerCase() === contact.name.trim().toLowerCase());
}

export function generateTransactionsCsv(state: MaliState, filterAccountId?: string): string {
  const accountMap = new Map(state.accounts.map((account) => [account.id, account.name]));
  return buildCsv([
    'التاريخ', 'البيان / العنوان', 'نوع الحركة', 'التصنيف', 'المبلغ', 'العملة',
    'طريقة الدفع', 'الحساب الأساسي', 'الحساب المقابل', 'العمولة / الخصم', 'سعر الصرف', 'ملاحظات',
  ], state.transactions
    .filter((tx) => !filterAccountId || tx.accountId === filterAccountId || tx.targetAccountId === filterAccountId)
    .map((tx) => [
      tx.date, tx.title || '', getTransactionTypeLabel(tx.type), tx.category, tx.amount, tx.currency,
      getPaymentMethodLabel(tx.paymentMethod), accountMap.get(tx.accountId) || tx.accountId,
      tx.targetAccountId ? accountMap.get(tx.targetAccountId) || '' : '',
      tx.feeAmount ?? 0, tx.exchangeRate ?? '', tx.notes || '',
    ]));
}

export function generateDealsCsv(state: MaliState): string {
  const accountMap = new Map(state.accounts.map((account) => [account.id, account.name]));
  return buildCsv([
    'رقم الصفقة', 'عنوان الصفقة', 'تاريخ الشراء', 'البائع (اشتريت منه)', 'هاتف البائع',
    'الكمية المشتراة ($)', 'سعر الشراء لحظتها', 'طريقة الشراء', 'حساب الشراء', 'التكلفة الكلية (د.ل)',
    'المباع ($)', 'المتبقي ($)', 'إجمالي المستلم (د.ل)', 'صافي الربح المحقق (د.ل)', 'الحالة',
  ], state.deals.map((deal) => [
    deal.dealNumber, deal.title || '', deal.buyDate, deal.counterparty || '', deal.counterpartyPhone || '',
    deal.totalUsdBought, deal.buyRate, getPaymentMethodLabel(deal.buyPaymentMethod),
    accountMap.get(deal.sourceLydAccountId) || '', deal.totalLydCost, deal.soldUsd, deal.remainingUsd,
    deal.totalLydReceived, deal.realizedProfitLyd,
    deal.status === 'open' ? 'مفتوحة' : deal.status === 'partial' ? 'بيع جزئي' : 'مغلقة',
  ]));
}

export function generateContactStatementCsv(state: MaliState, contact: ContactPerson): string {
  const accountMap = new Map(state.accounts.map((account) => [account.id, account.name]));
  const rows: [string, ...unknown[]][] = [];

  for (const deal of state.deals) {
    if (matchesContact(contact, deal.contactId, deal.counterparty)) {
      rows.push([
        deal.buyDate, 'شراء دولار منه', `صفقة ${deal.dealNumber}: ${deal.title}`,
        deal.totalUsdBought, deal.buyRate, deal.totalLydCost,
        getPaymentMethodLabel(deal.buyPaymentMethod), accountMap.get(deal.sourceLydAccountId) || '', 0,
      ]);
    }
    for (const sale of deal.sales) {
      if (!matchesContact(contact, sale.contactId, sale.buyerName)) continue;
      rows.push([
        sale.date, 'بيع دولار له',
        `بيع من الصفقة ${deal.dealNumber} (سعر الشراء ${deal.buyRate} ← سعر البيع ${sale.sellRate})`,
        sale.usdAmount, sale.sellRate, sale.netLydReceived,
        getPaymentMethodLabel(sale.paymentMethod), accountMap.get(sale.targetLydAccountId) || '', sale.profitLyd,
      ]);
    }
  }

  for (const debt of state.debts) {
    if (!matchesContact(contact, debt.contactId, debt.personName)) continue;
    rows.push([
      debt.createdAt, debt.direction === 'receivable' ? 'دين لي عنده' : 'دين/أمانة له عندي',
      `${debt.notes || 'سجل دين / التزام'} (المتبقي حالياً: ${debt.remainingAmount} ${debt.currency})`,
      debt.currency === 'USD' ? debt.totalAmount : 0, '', debt.currency === 'LYD' ? debt.totalAmount : 0,
      debt.initialPaymentMethod ? getPaymentMethodLabel(debt.initialPaymentMethod) : 'سجل التزامات',
      debt.accountId ? accountMap.get(debt.accountId) || '' : '', 0,
    ]);
    // Use canonical nested payments rather than counting linked wallet transactions again.
    for (const installment of debt.installments) {
      rows.push([
        installment.date, debt.direction === 'receivable' ? 'تحصيل قسط دين منه' : 'سداد قسط دين له',
        installment.notes || 'دفعة دين / التزام',
        debt.currency === 'USD' ? installment.amount : 0, '',
        debt.currency === 'LYD' ? installment.amount : 0,
        getPaymentMethodLabel(installment.paymentMethod),
        installment.accountId ? accountMap.get(installment.accountId) || '' : '', 0,
      ]);
    }
  }

  rows.sort((first, second) => {
    const firstTime = Date.parse(first[0]);
    const secondTime = Date.parse(second[0]);
    if (Number.isFinite(firstTime) && Number.isFinite(secondTime)) return firstTime - secondTime;
    if (Number.isFinite(firstTime)) return -1;
    if (Number.isFinite(secondTime)) return 1;
    return first[0].localeCompare(second[0]);
  });

  return buildCsv([
    'التاريخ', 'نوع المعاملة مع الشخص', 'البيان / التفاصيل', 'الكمية بالدولار ($)', 'سعر الصرف',
    'القيمة بالدينار الليبي (د.ل)', 'طريقة الدفع (كاش / تحويل)', 'الحساب المصرفي أو النقدي', 'صافي الربح المحقق (د.ل)',
  ], rows);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function htmlRow(values: readonly unknown[]): string {
  return `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`;
}

/** This document has no executable markup, including for imported untrusted text. */
export function generateFinancialStatementHtml(state: MaliState, issuedAt: Date = new Date()): string {
  const accountMap = new Map(state.accounts.map((account) => [account.id, account.name]));
  const totalCashLyd = state.accounts.filter((a) => a.currency === 'LYD' && a.isCash).reduce((sum, a) => sum + a.balance, 0);
  const totalBankLyd = state.accounts.filter((a) => a.currency === 'LYD' && !a.isCash).reduce((sum, a) => sum + a.balance, 0);
  const totalUsd = state.accounts.filter((a) => a.currency === 'USD').reduce((sum, a) => sum + a.balance, 0);
  const totalDealProfit = state.deals.reduce((sum, deal) => sum + deal.realizedProfitLyd, 0);
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>كشف الحساب والتقرير المالي - تطبيق مالي</title>
  <style>
    body { font-family: Tahoma, Arial, sans-serif; margin: 28px; color: #0f172a; direction: rtl; }
    h1 { color: #065f46; margin-bottom: 4px; }
    .sub { color: #64748b; margin-bottom: 20px; font-size: 13px; }
    .cards { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px 16px; min-width: 180px; background: #f8fafc; }
    .card-title { font-size: 12px; color: #475569; }
    .card-val { font-size: 18px; font-weight: bold; color: #0f172a; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 26px; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: right; overflow-wrap: anywhere; }
    th { background: #ecfdf5; color: #065f46; }
    .profit { color: #059669; font-weight: bold; }
  </style>
</head>
<body>
  <h1>تطبيق مالي (Mali) - كشف الحساب والتقرير المالي الشامل</h1>
  <div class="sub">تاريخ الإصدار: ${escapeHtml(issuedAt.toLocaleString('ar-LY'))} | سعر الدولار (كاش): ${escapeHtml(state.marketRates.cashUsdToLyd)} د.ل | سعر الدولار (صكوك/تحويل): ${escapeHtml(state.marketRates.chequeUsdToLyd)} د.ل</div>
  <div class="cards">
    <div class="card"><div class="card-title">إجمالي الكاش (دينار)</div><div class="card-val">${escapeHtml(formatMoney(totalCashLyd, 'LYD'))}</div></div>
    <div class="card"><div class="card-title">إجمالي المصارف والصكوك</div><div class="card-val">${escapeHtml(formatMoney(totalBankLyd, 'LYD'))}</div></div>
    <div class="card"><div class="card-title">إجمالي رصيد الدولار ($)</div><div class="card-val">${escapeHtml(formatMoney(totalUsd, 'USD'))}</div></div>
    <div class="card"><div class="card-title">صافي أرباح تداول الدولار</div><div class="card-val profit">${escapeHtml(formatMoney(totalDealProfit, 'LYD'))}</div></div>
  </div>
  <h3>1. أرصدة الحسابات والمحافظ</h3>
  <table>
    <thead><tr><th>اسم الحساب</th><th>المصرف / الجهة</th><th>النوع</th><th>الرصيد</th></tr></thead>
    <tbody>${state.accounts.map((a) => htmlRow([
      a.name, a.bankName, a.isCash ? 'سيولة نقدية (كاش)' : 'حساب مصرفي / صكوك', formatMoney(a.balance, a.currency),
    ])).join('')}</tbody>
  </table>
  <h3>2. سجل صفقات تداول الدولار (USD/LYD)</h3>
  <table>
    <thead><tr><th>رقم الصفقة</th><th>البيان</th><th>البائع</th><th>الكمية ($)</th><th>سعر الشراء</th><th>طريقة الشراء</th><th>التكلفة (د.ل)</th><th>المباع ($)</th><th>المتبقي ($)</th><th>الربح المحقق</th></tr></thead>
    <tbody>${state.deals.map((d) => htmlRow([
      d.dealNumber, d.title, d.counterparty || '-', `$${d.totalUsdBought}`, d.buyRate,
      getPaymentMethodLabel(d.buyPaymentMethod), formatMoney(d.totalLydCost, 'LYD'), `$${d.soldUsd}`,
      `$${d.remainingUsd}`, formatMoney(d.realizedProfitLyd, 'LYD'),
    ])).join('')}</tbody>
  </table>
  <h3>3. سجل الحركات المالية والمصرفية</h3>
  <table>
    <thead><tr><th>التاريخ</th><th>البيان</th><th>النوع</th><th>التصنيف</th><th>الحساب</th><th>طريقة الدفع</th><th>المبلغ</th></tr></thead>
    <tbody>${state.transactions.map((tx) => htmlRow([
      tx.date, tx.title, getTransactionTypeLabel(tx.type), tx.category, accountMap.get(tx.accountId) || '',
      getPaymentMethodLabel(tx.paymentMethod), formatMoney(tx.amount, tx.currency),
    ])).join('')}</tbody>
  </table>
</body>
</html>`;
}
