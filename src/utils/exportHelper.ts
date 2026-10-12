import { Platform, Share } from 'react-native';
import { ContactPerson, Currency, MaliState } from '../types/mali';

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
    case 'cash':
      return 'نقدي (كاش)';
    case 'cheque':
      return 'صك مصرفي';
    case 'transfer':
      return 'تحويل مصرفي';
    case 'card':
      return 'بطاقة مصرفية';
    default:
      return method;
  }
}

export function getTransactionTypeLabel(type: string): string {
  switch (type) {
    case 'expense':
      return 'مصروف شخصي';
    case 'income':
      return 'إيراد / تغذية';
    case 'transfer':
      return 'تحويل بين الحسابات';
    case 'cheque_liquidation':
      return 'تسييل صك إلى كاش';
    case 'deal_buy':
      return 'شراء صفقة دولار';
    case 'deal_sell':
      return 'بيع صفقة دولار';
    case 'deal_personal_take':
      return 'سحب شخصي من صفقة';
    case 'debt_settlement':
      return 'دفعة دين / التزام';
    default:
      return type;
  }
}

export function generateTransactionsCsv(state: MaliState, filterAccountId?: string): string {
  const accountMap = new Map(state.accounts.map((a) => [a.id, a.name]));
  const rows = state.transactions.filter((tx) =>
    filterAccountId ? tx.accountId === filterAccountId || tx.targetAccountId === filterAccountId : true
  );

  const header = [
    'التاريخ',
    'البيان / العنوان',
    'نوع الحركة',
    'التصنيف',
    'المبلغ',
    'العملة',
    'طريقة الدفع',
    'الحساب الأساسي',
    'الحساب المقابل',
    'العمولة / الخصم',
    'سعر الصرف',
    'ملاحظات',
  ];

  const lines = [
    header.join(','),
    ...rows.map((tx) =>
      [
        tx.date,
        `"${(tx.title || '').replace(/"/g, '""')}"`,
        `"${getTransactionTypeLabel(tx.type)}"`,
        `"${tx.category}"`,
        tx.amount,
        tx.currency,
        `"${getPaymentMethodLabel(tx.paymentMethod)}"`,
        `"${accountMap.get(tx.accountId) || tx.accountId}"`,
        `"${tx.targetAccountId ? accountMap.get(tx.targetAccountId) || '' : ''}"`,
        tx.feeAmount || 0,
        tx.exchangeRate || '',
        `"${(tx.notes || '').replace(/"/g, '""')}"`,
      ].join(',')
    ),
  ];

  return '\uFEFF' + lines.join('\n');
}

export function generateDealsCsv(state: MaliState): string {
  const accountMap = new Map(state.accounts.map((a) => [a.id, a.name]));
  const header = [
    'رقم الصفقة',
    'عنوان الصفقة',
    'تاريخ الشراء',
    'البائع (اشتريت منه)',
    'هاتف البائع',
    'الكمية المشتراة ($)',
    'سعر الشراء لحظتها',
    'طريقة الشراء',
    'حساب الشراء',
    'التكلفة الكلية (د.ل)',
    'المباع ($)',
    'المتبقي ($)',
    'إجمالي المستلم (د.ل)',
    'صافي الربح المحقق (د.ل)',
    'الحالة',
  ];

  const lines = [
    header.join(','),
    ...state.deals.map((d) =>
      [
        d.dealNumber,
        `"${(d.title || '').replace(/"/g, '""')}"`,
        d.buyDate,
        `"${(d.counterparty || '').replace(/"/g, '""')}"`,
        `"${(d.counterpartyPhone || '').replace(/"/g, '""')}"`,
        d.totalUsdBought,
        d.buyRate,
        `"${getPaymentMethodLabel(d.buyPaymentMethod)}"`,
        `"${accountMap.get(d.sourceLydAccountId) || ''}"`,
        d.totalLydCost,
        d.soldUsd,
        d.remainingUsd,
        d.totalLydReceived,
        d.realizedProfitLyd,
        d.status === 'open' ? 'مفتوحة' : d.status === 'partial' ? 'بيع جزئي' : 'مغلقة',
      ].join(',')
    ),
  ];

  return '\uFEFF' + lines.join('\n');
}

export function generateContactStatementCsv(
  state: MaliState,
  contact: ContactPerson
): string {
  const accountMap = new Map(state.accounts.map((a) => [a.id, a.name]));
  const matchName = (n?: string) =>
    Boolean(n && n.trim().toLowerCase() === contact.name.trim().toLowerCase());

  const header = [
    'التاريخ',
    'نوع المعاملة مع الشخص',
    'البيان / التفاصيل',
    'الكمية بالدولار ($)',
    'سعر الصرف',
    'القيمة بالدينار الليبي (د.ل)',
    'طريقة الدفع (كاش / تحويل)',
    'الحساب المصرفي أو النقدي',
    'صافي الربح المحقق (د.ل)',
  ];

  const rows: string[] = [];

  // 1. Deals bought from this contact
  state.deals
    .filter((d) => d.contactId === contact.id || matchName(d.counterparty))
    .forEach((d) => {
      rows.push(
        [
          d.buyDate,
          '"شراء دولار منه"',
          `"صفقة ${d.dealNumber}: ${d.title.replace(/"/g, '""')}"`,
          d.totalUsdBought,
          d.buyRate,
          d.totalLydCost,
          `"${getPaymentMethodLabel(d.buyPaymentMethod)}"`,
          `"${accountMap.get(d.sourceLydAccountId) || ''}"`,
          0,
        ].join(',')
      );
    });

  // 2. Sales sold to this contact
  state.deals.forEach((d) => {
    d.sales
      .filter((s) => s.contactId === contact.id || matchName(s.buyerName))
      .forEach((s) => {
        rows.push(
          [
            s.date,
            '"بيع دولار له"',
            `"بيع من الصفقة ${d.dealNumber} (سعر الشراء ${d.buyRate} ← سعر البيع ${s.sellRate})"`,
            s.usdAmount,
            s.sellRate,
            s.netLydReceived,
            `"${getPaymentMethodLabel(s.paymentMethod)}"`,
            `"${accountMap.get(s.targetLydAccountId) || ''}"`,
            s.profitLyd,
          ].join(',')
        );
      });
  });

  // 3. Debts with this contact
  state.debts
    .filter((db) => db.contactId === contact.id || matchName(db.personName))
    .forEach((db) => {
      rows.push(
        [
          db.createdAt,
          db.direction === 'receivable' ? '"دين لي عنده"' : '"دين/أمانة له عندي"',
          `"${(db.notes || 'سجل دين / التزام').replace(/"/g, '""')} (المتبقي: ${db.remainingAmount} ${db.currency})"`,
          db.currency === 'USD' ? db.totalAmount : 0,
          '',
          db.currency === 'LYD' ? db.totalAmount : 0,
          '"سجل التزامات"',
          '""',
          0,
        ].join(',')
      );
    });

  return '\uFEFF' + [header.join(','), ...rows].join('\n');
}

export async function exportFileOrShare(
  filename: string,
  content: string,
  mimeType: string = 'text/csv;charset=utf-8;'
): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } else {
    await Share.share({
      title: filename,
      message: content,
    });
    return true;
  }
}

export function printFinancialStatementWeb(state: MaliState): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  const accountMap = new Map(state.accounts.map((a) => [a.id, a.name]));
  const totalCashLyd = state.accounts
    .filter((a) => a.currency === 'LYD' && a.isCash)
    .reduce((s, a) => s + a.balance, 0);
  const totalBankLyd = state.accounts
    .filter((a) => a.currency === 'LYD' && !a.isCash)
    .reduce((s, a) => s + a.balance, 0);
  const totalUsd = state.accounts
    .filter((a) => a.currency === 'USD')
    .reduce((s, a) => s + a.balance, 0);
  const totalDealProfit = state.deals.reduce((s, d) => s + d.realizedProfitLyd, 0);

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
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
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: right; }
    th { background: #ecfdf5; color: #065f46; }
    .profit { color: #059669; font-weight: bold; }
  </style>
</head>
<body>
  <h1>تطبيق مالي (Mali) - كشف الحساب والتقرير المالي الشامل</h1>
  <div class="sub">تاريخ الإصدار: ${new Date().toLocaleString('ar-LY')} | سعر الدولار (كاش): ${state.marketRates.cashUsdToLyd} د.ل | سعر الدولار (صكوك/تحويل): ${state.marketRates.chequeUsdToLyd} د.ل</div>

  <div class="cards">
    <div class="card"><div class="card-title">إجمالي الكاش (دينار)</div><div class="card-val">${formatMoney(totalCashLyd, 'LYD')}</div></div>
    <div class="card"><div class="card-title">إجمالي المصارف والصكوك</div><div class="card-val">${formatMoney(totalBankLyd, 'LYD')}</div></div>
    <div class="card"><div class="card-title">إجمالي رصيد الدولار ($)</div><div class="card-val">${formatMoney(totalUsd, 'USD')}</div></div>
    <div class="card"><div class="card-title">صافي أرباح تداول الدولار</div><div class="card-val profit">+${formatMoney(totalDealProfit, 'LYD')}</div></div>
  </div>

  <h3>1. أرصدة الحسابات والمحافظ</h3>
  <table>
    <thead>
      <tr><th>اسم الحساب</th><th>المصرف / الجهة</th><th>النوع</th><th>الرصيد</th></tr>
    </thead>
    <tbody>
      ${state.accounts
        .map(
          (a) =>
            `<tr><td>${a.name}</td><td>${a.bankName}</td><td>${
              a.isCash ? 'سيولة نقدية (كاش)' : 'حساب مصرفي / صكوك'
            }</td><td><strong>${formatMoney(a.balance, a.currency)}</strong></td></tr>`
        )
        .join('')}
    </tbody>
  </table>

  <h3>2. سجل صفقات تداول الدولار (USD/LYD)</h3>
  <table>
    <thead>
      <tr><th>رقم الصفقة</th><th>البيان</th><th>البائع</th><th>الكمية ($)</th><th>سعر الشراء</th><th>طريقة الشراء</th><th>التكلفة (د.ل)</th><th>المباع ($)</th><th>المتبقي ($)</th><th>الربح المحقق</th></tr>
    </thead>
    <tbody>
      ${state.deals
        .map(
          (d) =>
            `<tr><td>${d.dealNumber}</td><td>${d.title}</td><td>${d.counterparty || '-'}</td><td>$${d.totalUsdBought}</td><td>${d.buyRate}</td><td>${getPaymentMethodLabel(d.buyPaymentMethod)}</td><td>${formatMoney(
              d.totalLydCost,
              'LYD'
            )}</td><td>$${d.soldUsd}</td><td>$${d.remainingUsd}</td><td class="profit">${formatMoney(
              d.realizedProfitLyd,
              'LYD'
            )}</td></tr>`
        )
        .join('')}
    </tbody>
  </table>

  <h3>3. سجل الحركات المالية والمصرفية</h3>
  <table>
    <thead>
      <tr><th>التاريخ</th><th>البيان</th><th>النوع</th><th>التصنيف</th><th>الحساب</th><th>طريقة الدفع</th><th>المبلغ</th></tr>
    </thead>
    <tbody>
      ${state.transactions
        .map(
          (t) =>
            `<tr><td>${t.date}</td><td>${t.title}</td><td>${getTransactionTypeLabel(
              t.type
            )}</td><td>${t.category}</td><td>${accountMap.get(t.accountId) || ''}</td><td>${getPaymentMethodLabel(
              t.paymentMethod
            )}</td><td><strong>${formatMoney(t.amount, t.currency)}</strong></td></tr>`
        )
        .join('')}
    </tbody>
  </table>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

  const printWin = window.open('', '_blank', 'width=960,height=720');
  if (printWin) {
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
    return true;
  }
  return false;
}
