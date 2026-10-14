import type {
  ContactPerson,
  Currency,
  DealSale,
  DebtRecord,
  DebtSettlementType,
  MaliState,
  PaymentMethodType,
  Transaction,
  UsdDeal,
} from '../types/mali';
import { roundMoney } from './financialEngine.ts';
import {
  escapeHtml,
  formatMoney,
  formatRate,
  getPaymentMethodLabel,
  getTransactionTypeLabel,
  matchesContact,
} from '../utils/exportCore.ts';

export interface CurrencyPosition {
  currency: Currency;
  receivables: number;
  payables: number;
  netPosition: number;
  totalReceivables: number;
  totalPayables: number;
  settledReceivables: number;
  settledPayables: number;
  activeReceivablesCount: number;
  activePayablesCount: number;
}

export interface UsdDealsSummary {
  boughtUsdAmount: number;
  boughtLydCost: number;
  soldUsdAmount: number;
  soldLydRevenue: number;
  realizedProfitLyd: number;
  dealsCount: number;
  salesCount: number;
  matchedDeals: UsdDeal[];
  matchedSales: { deal: UsdDeal; sale: DealSale }[];
}

export interface CompiledDebtInstallment {
  id: string;
  debtId: string;
  debtDirection: 'receivable' | 'payable';
  debtPersonName: string;
  currency: Currency;
  amount: number;
  date: string;
  accountId?: string;
  accountName: string;
  paymentMethod: PaymentMethodType | string;
  paymentMethodLabel: string;
  settlementType?: DebtSettlementType;
  isNonCash: boolean;
  nonCashReason?: string;
  notes?: string;
}

export interface ContactTimelineEntry {
  id: string;
  date: string;
  type:
    | 'deal_buy'
    | 'deal_sell'
    | 'debt_receivable'
    | 'debt_payable'
    | 'debt_installment'
    | 'direct_transaction';
  typeLabel: string;
  description: string;
  amount: number;
  currency: Currency;
  secondaryAmount?: number;
  secondaryCurrency?: Currency;
  exchangeRate?: number;
  profitLyd?: number;
  accountId?: string;
  accountName: string;
  paymentMethod: PaymentMethodType | string;
  paymentMethodLabel: string;
  isNonCash: boolean;
  nonCashReason?: string;
  runningBalance: number;
  runningBalanceLyd: number;
  runningBalanceUsd: number;
  receivablesBalance?: number;
  payablesBalance?: number;
  refId: string;
  notes?: string;
}

export interface UnifiedContactProfile {
  contact: ContactPerson;
  currencies: {
    LYD: CurrencyPosition;
    USD: CurrencyPosition;
  };
  dealsSummary: UsdDealsSummary;
  usdDealsSummary: UsdDealsSummary;
  debts: {
    active: DebtRecord[];
    settled: DebtRecord[];
    all: DebtRecord[];
    installments: CompiledDebtInstallment[];
  };
  directTransactions: {
    items: Transaction[];
    summary: {
      lydExpenseTotal: number;
      lydIncomeTotal: number;
      usdExpenseTotal: number;
      usdIncomeTotal: number;
      count: number;
    };
  };
  timelineEntries: ContactTimelineEntry[];
}

export interface AmbiguousRecord {
  type: 'debt' | 'deal' | 'sale' | 'transaction' | 'contact';
  recordId: string;
  recordName?: string;
  recordPhone?: string;
  matchedContactId?: string;
  matchedContactName?: string;
  matchedContactPhone?: string;
  reason: string;
}

export interface DuplicateContactInfo {
  name: string;
  contactIds: string[];
  phones: string[];
  reason: string;
}

export interface LegacyContactAuditResult {
  updatedState: MaliState;
  linkedCounts: {
    debts: number;
    deals: number;
    sales: number;
    transactions: number;
  };
  ambiguousRecords: AmbiguousRecord[];
  duplicateContacts: DuplicateContactInfo[];
}

function normalizeText(text?: string): string {
  return (text || '').trim().toLowerCase();
}

function normalizePhone(phone?: string): string {
  return (phone || '').replace(/[\s\-\(\)\+\.]/g, '');
}

function parseTimestamp(dateStr?: string): number {
  if (!dateStr) return 0;
  const parsed = Date.parse(dateStr);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Checks whether a transaction belongs directly or indirectly to a debt.
 */
export function isDebtBelongingTransaction(tx: Partial<Transaction> | null | undefined): boolean {
  if (!tx) return false;
  if (tx.debtId || tx.installmentId) return true;
  if (tx.type === 'debt_settlement') return true;
  return false;
}

/**
 * Checks whether a transaction belongs directly or indirectly to a USD deal or sale.
 */
export function isDealBelongingTransaction(tx: Partial<Transaction> | null | undefined): boolean {
  if (!tx) return false;
  if (tx.dealId || tx.saleId) return true;
  if (tx.type === 'deal_buy' || tx.type === 'deal_sell' || tx.type === 'deal_personal_take') return true;
  return false;
}

/**
 * Computes the unified, comprehensive financial profile of a single contact.
 *
 * Rules:
 * 1. Strict Currency Separation (LYD vs USD). No cross-currency offset.
 * 2. Receivables (مستحقات لي) and Payables (مستحقات عليّ) computed per currency.
 * 3. Net Financial Position (صافي المركز المالي = مستحقات لي - مستحقات عليّ) per currency
 *    without auto-offsetting or mutating debts unless explicitly settled.
 * 4. USD deals summary (bought USD, cost LYD, sold USD, revenue LYD, profit LYD).
 * 5. Full active and settled debts compilation with cash vs non-cash installments.
 * 6. Direct transactions (transfers, expenses, income) linked to contact.id
 *    without double-counting transactions belonging to debts or deals.
 * 7. Chronological timeline with running balances per currency.
 */
export function computeUnifiedContactProfile(
  state: MaliState,
  contact: ContactPerson
): UnifiedContactProfile {
  const accountMap = new Map<string, string>(
    state.accounts.map((account) => [account.id, account.name])
  );

  // 1. Matched debts
  const matchedDebts = state.debts.filter((debt) =>
    matchesContact(contact, debt.contactId, debt.personName)
  );

  const activeDebts: DebtRecord[] = [];
  const settledDebts: DebtRecord[] = [];

  for (const debt of matchedDebts) {
    if (debt.status === 'active' && debt.remainingAmount > 0) {
      activeDebts.push(debt);
    } else {
      settledDebts.push(debt);
    }
  }

  // 2. Currencies Position Calculation (LYD and USD strictly separated)
  const currencyKeys: Currency[] = ['LYD', 'USD'];
  const currencies: Record<Currency, CurrencyPosition> = {
    LYD: {
      currency: 'LYD',
      receivables: 0,
      payables: 0,
      netPosition: 0,
      totalReceivables: 0,
      totalPayables: 0,
      settledReceivables: 0,
      settledPayables: 0,
      activeReceivablesCount: 0,
      activePayablesCount: 0,
    },
    USD: {
      currency: 'USD',
      receivables: 0,
      payables: 0,
      netPosition: 0,
      totalReceivables: 0,
      totalPayables: 0,
      settledReceivables: 0,
      settledPayables: 0,
      activeReceivablesCount: 0,
      activePayablesCount: 0,
    },
  };

  const compiledInstallments: CompiledDebtInstallment[] = [];

  for (const debt of matchedDebts) {
    const cur = debt.currency;
    if (!currencies[cur]) continue;

    const isReceivable = debt.direction === 'receivable';
    if (isReceivable) {
      currencies[cur].totalReceivables = roundMoney(
        currencies[cur].totalReceivables + debt.totalAmount
      );
      currencies[cur].settledReceivables = roundMoney(
        currencies[cur].settledReceivables + debt.paidAmount
      );
      currencies[cur].receivables = roundMoney(
        currencies[cur].receivables + debt.remainingAmount
      );
      if (debt.status === 'active' && debt.remainingAmount > 0) {
        currencies[cur].activeReceivablesCount++;
      }
    } else {
      currencies[cur].totalPayables = roundMoney(
        currencies[cur].totalPayables + debt.totalAmount
      );
      currencies[cur].settledPayables = roundMoney(
        currencies[cur].settledPayables + debt.paidAmount
      );
      currencies[cur].payables = roundMoney(
        currencies[cur].payables + debt.remainingAmount
      );
      if (debt.status === 'active' && debt.remainingAmount > 0) {
        currencies[cur].activePayablesCount++;
      }
    }

    for (const inst of debt.installments) {
      const isNonCash = Boolean(inst.isNonCash || inst.settlementType === 'non_cash');
      compiledInstallments.push({
        id: inst.id,
        debtId: debt.id,
        debtDirection: debt.direction,
        debtPersonName: debt.personName,
        currency: debt.currency,
        amount: inst.amount,
        date: inst.date,
        accountId: inst.accountId,
        accountName: isNonCash
          ? 'تسوية غير نقدية (بدون حركة خزينة)'
          : inst.accountId
          ? accountMap.get(inst.accountId) || inst.accountId
          : 'غير محدد',
        paymentMethod: inst.paymentMethod,
        paymentMethodLabel: isNonCash
          ? 'تسوية غير نقدية (مقاصة)'
          : getPaymentMethodLabel(inst.paymentMethod),
        settlementType: inst.settlementType || (isNonCash ? 'non_cash' : 'cash'),
        isNonCash,
        nonCashReason: inst.nonCashReason,
        notes: inst.notes,
      });
    }
  }

  // Calculate Net Financial Position per currency (receivables - payables)
  for (const cur of currencyKeys) {
    currencies[cur].netPosition = roundMoney(
      currencies[cur].receivables - currencies[cur].payables
    );
  }

  // Sort compiled installments chronologically
  compiledInstallments.sort((a, b) => parseTimestamp(a.date) - parseTimestamp(b.date));

  // 3. USD Deals Summary
  let boughtUsdAmount = 0;
  let boughtLydCost = 0;
  let soldUsdAmount = 0;
  let soldLydRevenue = 0;
  let realizedProfitLyd = 0;
  let dealsCount = 0;
  let salesCount = 0;

  const matchedDeals: UsdDeal[] = [];
  const matchedSales: { deal: UsdDeal; sale: DealSale }[] = [];

  for (const deal of state.deals) {
    const isDealSeller = matchesContact(contact, deal.contactId, deal.counterparty);
    if (isDealSeller) {
      matchedDeals.push(deal);
      boughtUsdAmount = roundMoney(boughtUsdAmount + deal.totalUsdBought);
      boughtLydCost = roundMoney(boughtLydCost + deal.totalLydCost);
      dealsCount++;
    }

    for (const sale of deal.sales) {
      const isSaleBuyer = matchesContact(contact, sale.contactId, sale.buyerName);
      if (isSaleBuyer) {
        matchedSales.push({ deal, sale });
        soldUsdAmount = roundMoney(soldUsdAmount + sale.usdAmount);
        soldLydRevenue = roundMoney(soldLydRevenue + sale.netLydReceived);
        realizedProfitLyd = roundMoney(realizedProfitLyd + sale.profitLyd);
        salesCount++;
      }
    }
  }

  const usdDealsSummary: UsdDealsSummary = {
    boughtUsdAmount,
    boughtLydCost,
    soldUsdAmount,
    soldLydRevenue,
    realizedProfitLyd,
    dealsCount,
    salesCount,
    matchedDeals,
    matchedSales,
  };

  // 4. Direct transactions (transfers, income, expenses)
  // CRITICAL ACCOUNTING RULE: No double counting with transactions created for debts or deals!
  const directTxItems = state.transactions.filter((tx) => {
    const isContactTx = matchesContact(contact, tx.contactId, undefined) || tx.contactId === contact.id;
    if (!isContactTx) return false;
    if (isDebtBelongingTransaction(tx)) return false;
    if (isDealBelongingTransaction(tx)) return false;
    return true;
  });

  let directLydExpense = 0;
  let directLydIncome = 0;
  let directUsdExpense = 0;
  let directUsdIncome = 0;

  for (const tx of directTxItems) {
    if (tx.currency === 'LYD') {
      if (tx.type === 'expense') directLydExpense = roundMoney(directLydExpense + tx.amount);
      if (tx.type === 'income') directLydIncome = roundMoney(directLydIncome + tx.amount);
    } else if (tx.currency === 'USD') {
      if (tx.type === 'expense') directUsdExpense = roundMoney(directUsdExpense + tx.amount);
      if (tx.type === 'income') directUsdIncome = roundMoney(directUsdIncome + tx.amount);
    }
  }

  const directTransactions = {
    items: directTxItems,
    summary: {
      lydExpenseTotal: directLydExpense,
      lydIncomeTotal: directLydIncome,
      usdExpenseTotal: directUsdExpense,
      usdIncomeTotal: directUsdIncome,
      count: directTxItems.length,
    },
  };

  // 5. Timeline Entries Compilation
  type RawTimelineEntry = Omit<
    ContactTimelineEntry,
    'runningBalance' | 'runningBalanceLyd' | 'runningBalanceUsd' | 'receivablesBalance' | 'payablesBalance'
  > & {
    orderPriority: number;
    parentDebtDirection?: 'receivable' | 'payable';
  };

  const rawEntries: RawTimelineEntry[] = [];

  // 5a. Debt initial records
  for (const debt of matchedDebts) {
    const isReceivable = debt.direction === 'receivable';
    rawEntries.push({
      id: `timeline-debt-${debt.id}`,
      date: debt.createdAt,
      type: isReceivable ? 'debt_receivable' : 'debt_payable',
      typeLabel: isReceivable ? 'دين لي عنده (إقراض)' : 'دين/أمانة له عندي (استلام)',
      description: debt.notes || (isReceivable ? `تسجيل دين لي على ${debt.personName}` : `تسجيل أمانة/دين عليّ لـ ${debt.personName}`),
      amount: debt.totalAmount,
      currency: debt.currency,
      accountId: debt.accountId,
      accountName: debt.accountId ? accountMap.get(debt.accountId) || debt.accountId : 'سجل التزامات / غير محدد',
      paymentMethod: debt.initialPaymentMethod || 'cash',
      paymentMethodLabel: getPaymentMethodLabel(debt.initialPaymentMethod || 'cash'),
      isNonCash: false,
      refId: debt.id,
      notes: debt.notes,
      orderPriority: 1, // Creation comes first on the same timestamp
      parentDebtDirection: debt.direction,
    });

    // 5b. Debt installments
    for (const inst of debt.installments) {
      const isNonCash = Boolean(inst.isNonCash || inst.settlementType === 'non_cash');
      const label = isNonCash
        ? isReceivable
          ? 'تسوية دين غير نقدية (مقاصة/تنازل)'
          : 'سداد دين غير نقدي (مقاصة/تنازل)'
        : isReceivable
        ? 'تحصيل قسط دين منه'
        : 'سداد قسط دين له';

      rawEntries.push({
        id: `timeline-inst-${inst.id}`,
        date: inst.date,
        type: 'debt_installment',
        typeLabel: label,
        description: inst.notes || (isNonCash ? (inst.nonCashReason || 'تسوية دين غير نقدية') : 'دفعة دين / التزام'),
        amount: inst.amount,
        currency: debt.currency,
        accountId: inst.accountId,
        accountName: isNonCash
          ? 'تسوية غير نقدية (بدون حركة خزينة)'
          : inst.accountId
          ? accountMap.get(inst.accountId) || inst.accountId
          : '-',
        paymentMethod: isNonCash ? 'non_cash' : inst.paymentMethod,
        paymentMethodLabel: isNonCash
          ? 'تسوية غير نقدية (مقاصة)'
          : getPaymentMethodLabel(inst.paymentMethod),
        isNonCash,
        nonCashReason: inst.nonCashReason,
        refId: inst.id,
        notes: inst.notes,
        orderPriority: 3, // Installments come after creations
        parentDebtDirection: debt.direction,
      });
    }
  }

  // 5c. USD Deal Buys
  for (const deal of matchedDeals) {
    rawEntries.push({
      id: `timeline-dbuy-${deal.id}`,
      date: deal.buyDate,
      type: 'deal_buy',
      typeLabel: 'شراء دولار منه',
      description: deal.title ? `صفقة ${deal.dealNumber}: ${deal.title}` : `صفقة ${deal.dealNumber}: شراء دولار منه`,
      amount: deal.totalUsdBought,
      currency: 'USD',
      secondaryAmount: deal.totalLydCost,
      secondaryCurrency: 'LYD',
      exchangeRate: deal.buyRate,
      accountId: deal.sourceLydAccountId,
      accountName: accountMap.get(deal.sourceLydAccountId) || deal.sourceLydAccountId,
      paymentMethod: deal.buyPaymentMethod,
      paymentMethodLabel: getPaymentMethodLabel(deal.buyPaymentMethod),
      isNonCash: false,
      refId: deal.id,
      notes: deal.notes,
      orderPriority: 2,
    });
  }

  // 5d. USD Deal Sales
  for (const { deal, sale } of matchedSales) {
    rawEntries.push({
      id: `timeline-dsell-${sale.id}`,
      date: sale.date,
      type: 'deal_sell',
      typeLabel: 'بيع دولار له',
      description: `بيع من الصفقة ${deal.dealNumber} (سعر الشراء ${deal.buyRate} ← سعر البيع ${sale.sellRate})`,
      amount: sale.usdAmount,
      currency: 'USD',
      secondaryAmount: sale.netLydReceived,
      secondaryCurrency: 'LYD',
      exchangeRate: sale.sellRate,
      profitLyd: sale.profitLyd,
      accountId: sale.targetLydAccountId,
      accountName: accountMap.get(sale.targetLydAccountId) || sale.targetLydAccountId,
      paymentMethod: sale.paymentMethod,
      paymentMethodLabel: getPaymentMethodLabel(sale.paymentMethod),
      isNonCash: false,
      refId: sale.id,
      notes: sale.notes,
      orderPriority: 2,
    });
  }

  // 5e. Direct Transactions
  for (const tx of directTxItems) {
    rawEntries.push({
      id: `timeline-tx-${tx.id}`,
      date: tx.date,
      type: 'direct_transaction',
      typeLabel: getTransactionTypeLabel(tx.type),
      description: tx.title || tx.category || 'معاملة مالية مباشرة',
      amount: tx.amount,
      currency: tx.currency,
      exchangeRate: tx.exchangeRate,
      accountId: tx.accountId,
      accountName: accountMap.get(tx.accountId) || tx.accountId,
      paymentMethod: tx.paymentMethod,
      paymentMethodLabel: getPaymentMethodLabel(tx.paymentMethod),
      isNonCash: false,
      refId: tx.id,
      notes: tx.notes,
      orderPriority: 4,
    });
  }

  // 5f. Chronological sort
  rawEntries.sort((first, second) => {
    const timeDiff = parseTimestamp(first.date) - parseTimestamp(second.date);
    if (timeDiff !== 0) return timeDiff;
    if (first.orderPriority !== second.orderPriority) {
      return first.orderPriority - second.orderPriority;
    }
    return first.id.localeCompare(second.id);
  });

  // 5g. Running Balances Computation (Strictly separated per currency)
  let runningLyd = 0;
  let runningUsd = 0;
  let runningRecLyd = 0;
  let runningPayLyd = 0;
  let runningRecUsd = 0;
  let runningPayUsd = 0;

  const timelineEntries: ContactTimelineEntry[] = [];

  for (const entry of rawEntries) {
    const cur = entry.currency;

    if (cur === 'LYD') {
      if (entry.type === 'debt_receivable') {
        runningRecLyd = roundMoney(runningRecLyd + entry.amount);
        runningLyd = roundMoney(runningLyd + entry.amount);
      } else if (entry.type === 'debt_payable') {
        runningPayLyd = roundMoney(runningPayLyd + entry.amount);
        runningLyd = roundMoney(runningLyd - entry.amount);
      } else if (entry.type === 'debt_installment') {
        if (entry.parentDebtDirection === 'receivable') {
          runningRecLyd = roundMoney(runningRecLyd - entry.amount);
          runningLyd = roundMoney(runningLyd - entry.amount);
        } else {
          runningPayLyd = roundMoney(runningPayLyd - entry.amount);
          runningLyd = roundMoney(runningLyd + entry.amount);
        }
      }
      // Spot deals and direct operational transactions do not alter outstanding debt balance
    } else if (cur === 'USD') {
      if (entry.type === 'debt_receivable') {
        runningRecUsd = roundMoney(runningRecUsd + entry.amount);
        runningUsd = roundMoney(runningUsd + entry.amount);
      } else if (entry.type === 'debt_payable') {
        runningPayUsd = roundMoney(runningPayUsd + entry.amount);
        runningUsd = roundMoney(runningUsd - entry.amount);
      } else if (entry.type === 'debt_installment') {
        if (entry.parentDebtDirection === 'receivable') {
          runningRecUsd = roundMoney(runningRecUsd - entry.amount);
          runningUsd = roundMoney(runningUsd - entry.amount);
        } else {
          runningPayUsd = roundMoney(runningPayUsd - entry.amount);
          runningUsd = roundMoney(runningUsd + entry.amount);
        }
      }
    }

    const currentRunningBalance = cur === 'LYD' ? runningLyd : runningUsd;
    const currentRecBalance = cur === 'LYD' ? runningRecLyd : runningRecUsd;
    const currentPayBalance = cur === 'LYD' ? runningPayLyd : runningPayUsd;

    const { orderPriority: _unusedPriority, parentDebtDirection: _unusedDir, ...rest } = entry;

    timelineEntries.push({
      ...rest,
      runningBalance: currentRunningBalance,
      runningBalanceLyd: runningLyd,
      runningBalanceUsd: runningUsd,
      receivablesBalance: currentRecBalance,
      payablesBalance: currentPayBalance,
    });
  }

  return {
    contact,
    currencies,
    dealsSummary: usdDealsSummary,
    usdDealsSummary,
    debts: {
      active: activeDebts,
      settled: settledDebts,
      all: matchedDebts,
      installments: compiledInstallments,
    },
    directTransactions,
    timelineEntries,
  };
}

/**
 * Generates an RTL HTML document styled for high-resolution PDF printing of the contact statement.
 */
export function generateContactStatementPdfHtml(
  state: MaliState,
  contact: ContactPerson,
  issuedAt: Date = new Date()
): string {
  const profile = computeUnifiedContactProfile(state, contact);
  const lyd = profile.currencies.LYD;
  const usd = profile.currencies.USD;
  const deals = profile.usdDealsSummary;

  const lydNetClass = lyd.netPosition > 0 ? 'pos-green' : lyd.netPosition < 0 ? 'pos-red' : 'pos-neutral';
  const usdNetClass = usd.netPosition > 0 ? 'pos-green' : usd.netPosition < 0 ? 'pos-red' : 'pos-neutral';

  const rowsHtml = profile.timelineEntries.map((entry) => {
    const isLyd = entry.currency === 'LYD';
    const amountFormatted = formatMoney(entry.amount, entry.currency);
    const balanceLydFormatted = formatMoney(entry.runningBalanceLyd, 'LYD');
    const balanceUsdFormatted = formatMoney(entry.runningBalanceUsd, 'USD');

    let badgeClass = 'badge-neutral';
    if (entry.type === 'debt_receivable' || entry.typeLabel.includes('تحصيل')) {
      badgeClass = 'badge-rec';
    } else if (entry.type === 'debt_payable' || entry.typeLabel.includes('سداد قسط')) {
      badgeClass = 'badge-pay';
    } else if (entry.type === 'deal_buy' || entry.type === 'deal_sell') {
      badgeClass = 'badge-deal';
    } else if (entry.isNonCash) {
      badgeClass = 'badge-noncash';
    }

    const secondaryText = entry.secondaryAmount
      ? `<br><small class="sub-amt">${formatMoney(entry.secondaryAmount, entry.secondaryCurrency || (isLyd ? 'USD' : 'LYD'))} ${entry.exchangeRate ? `(@ ${formatRate(entry.exchangeRate)})` : ''}</small>`
      : '';

    const notesText = entry.isNonCash
      ? `<strong class="noncash-tag">تسوية غير نقدية:</strong> ${escapeHtml(entry.nonCashReason || entry.notes || '-')}`
      : escapeHtml(entry.notes || '-');

    return `<tr>
      <td class="date-cell">${escapeHtml(entry.date)}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(entry.typeLabel)}</span></td>
      <td>${escapeHtml(entry.description)}${secondaryText}</td>
      <td class="num-cell"><strong>${escapeHtml(amountFormatted)}</strong></td>
      <td>${escapeHtml(entry.paymentMethodLabel)}</td>
      <td>${escapeHtml(entry.accountName)}</td>
      <td class="num-cell ${entry.runningBalanceLyd < 0 ? 'text-red' : ''}">${escapeHtml(balanceLydFormatted)}</td>
      <td class="num-cell ${entry.runningBalanceUsd < 0 ? 'text-red' : ''}">${escapeHtml(balanceUsdFormatted)}</td>
      <td class="notes-cell">${notesText}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>كشف حساب موحد - ${escapeHtml(contact.name)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Tahoma, Arial, sans-serif;
      margin: 0;
      padding: 16px;
      color: #0f172a;
      direction: rtl;
      background: #ffffff;
      font-size: 12px;
      line-height: 1.4;
    }
    .header {
      border-bottom: 2px solid #0d9488;
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header h1 {
      margin: 0 0 4px 0;
      color: #0f766e;
      font-size: 20px;
    }
    .header .meta {
      font-size: 11px;
      color: #64748b;
    }
    .contact-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px 16px;
    }
    .contact-field {
      font-size: 11px;
    }
    .contact-field strong {
      color: #475569;
      display: inline-block;
      min-width: 80px;
    }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }
    .card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 10px 12px;
      text-align: right;
    }
    .card-title {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      margin-bottom: 4px;
    }
    .card-val {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
    }
    .pos-green { color: #047857; background: #ecfdf5; border-color: #a7f3d0; }
    .pos-red { color: #b91c1c; background: #fef2f2; border-color: #fecaca; }
    .pos-neutral { color: #334155; background: #f8fafc; border-color: #e2e8f0; }
    .text-red { color: #b91c1c; }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-rec { background: #dcfce7; color: #15803d; }
    .badge-pay { background: #fee2e2; color: #b91c1c; }
    .badge-deal { background: #e0e7ff; color: #4338ca; }
    .badge-noncash { background: #f3e8ff; color: #7e22ce; }
    .badge-neutral { background: #f1f5f9; color: #475569; }
    .noncash-tag { color: #7e22ce; }
    .sub-amt { color: #64748b; }
    h2 {
      color: #0f766e;
      font-size: 14px;
      margin: 18px 0 8px 0;
      border-right: 4px solid #0d9488;
      padding-right: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 11px;
      page-break-inside: auto;
    }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: right;
      vertical-align: top;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 600;
      white-space: nowrap;
    }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .date-cell { white-space: nowrap; font-size: 10px; color: #475569; }
    .num-cell { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .notes-cell { font-size: 10px; color: #334155; }
    .footer {
      border-top: 1px solid #cbd5e1;
      padding-top: 10px;
      margin-top: 24px;
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { padding: 0; }
      .card { break-inside: avoid; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>تطبيق مالي (Mali) — كشف حساب مالي تفصيلي</h1>
      <div class="meta">تاريخ التقرير: ${escapeHtml(issuedAt.toLocaleString('ar-LY'))} | العملات: فصل تام بين الدينار الليبي (LYD) والدولار الأمريكي (USD)</div>
    </div>
  </div>

  <div class="contact-card">
    <div class="contact-field"><strong>اسم الطرف:</strong> ${escapeHtml(contact.name)}</div>
    <div class="contact-field"><strong>الصفة / الدور:</strong> ${escapeHtml(contact.role)}</div>
    <div class="contact-field"><strong>رقم الهاتف:</strong> ${escapeHtml(contact.phone || '-')}</div>
    <div class="contact-field"><strong>تفاصيل المصرف:</strong> ${escapeHtml(contact.bankDetails || 'غير مسجل')}</div>
  </div>

  <div class="cards-grid">
    <div class="card ${lydNetClass}">
      <div class="card-title">صافي المركز المالي (LYD)</div>
      <div class="card-val">${escapeHtml(formatMoney(lyd.netPosition, 'LYD'))}</div>
    </div>
    <div class="card">
      <div class="card-title">مستحقات لي (دينار)</div>
      <div class="card-val">${escapeHtml(formatMoney(lyd.receivables, 'LYD'))}</div>
    </div>
    <div class="card">
      <div class="card-title">مستحقات عليّ (دينار)</div>
      <div class="card-val">${escapeHtml(formatMoney(lyd.payables, 'LYD'))}</div>
    </div>
    <div class="card ${usdNetClass}">
      <div class="card-title">صافي المركز المالي ($)</div>
      <div class="card-val">${escapeHtml(formatMoney(usd.netPosition, 'USD'))}</div>
    </div>
    <div class="card">
      <div class="card-title">مستحقات لي (دولار)</div>
      <div class="card-val">${escapeHtml(formatMoney(usd.receivables, 'USD'))}</div>
    </div>
    <div class="card">
      <div class="card-title">مستحقات عليّ (دولار)</div>
      <div class="card-val">${escapeHtml(formatMoney(usd.payables, 'USD'))}</div>
    </div>
  </div>

  ${(deals.dealsCount > 0 || deals.salesCount > 0) ? `
  <div class="cards-grid">
    <div class="card">
      <div class="card-title">إجمالي المشتريات بالدولار منه</div>
      <div class="card-val">$${escapeHtml(deals.boughtUsdAmount.toLocaleString('en-US'))} <small style="font-size:11px;font-weight:normal;color:#64748b">(${escapeHtml(formatMoney(deals.boughtLydCost, 'LYD'))})</small></div>
    </div>
    <div class="card">
      <div class="card-title">إجمالي المبيعات بالدولار له</div>
      <div class="card-val">$${escapeHtml(deals.soldUsdAmount.toLocaleString('en-US'))} <small style="font-size:11px;font-weight:normal;color:#64748b">(${escapeHtml(formatMoney(deals.soldLydRevenue, 'LYD'))})</small></div>
    </div>
    <div class="card ${deals.realizedProfitLyd >= 0 ? 'pos-green' : 'pos-red'}">
      <div class="card-title">صافي أرباح التداول معه (د.ل)</div>
      <div class="card-val">${escapeHtml(formatMoney(deals.realizedProfitLyd, 'LYD'))}</div>
    </div>
  </div>
  ` : ''}

  <h2>سجل كشف الحساب الزمني الموحد (Timeline Statement)</h2>
  <table>
    <thead>
      <tr>
        <th>التاريخ</th>
        <th>نوع المعاملة</th>
        <th>البيان والتفاصيل</th>
        <th>المبلغ</th>
        <th>طريقة السداد</th>
        <th>الخزينة / الحساب</th>
        <th>الرصيد التراكمي (د.ل)</th>
        <th>الرصيد التراكمي ($)</th>
        <th>ملاحظات / تسوية غير نقدية</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml.length > 0 ? rowsHtml : '<tr><td colspan="9" style="text-align:center;color:#64748b;padding:16px;">لا توجد معاملات مسجلة مع هذا الطرف حتى الآن</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    <div>تم استخراج هذا الكشف آلياً بواسطة تطبيق مالي للمحاسبة المالية.</div>
    <div>الصفحة 1 من 1</div>
  </div>
</body>
</html>`;
}

/**
 * Audits existing unlinked debts, deals, sales, and transactions,
 * safely reconciling them with contacts based on exact name match or contactId.
 *
 * Safety Guarantees:
 * 1. Checks contacts directory for duplicate names or conflicting phones.
 * 2. Unlinked records with ambiguous names (multiple contacts) are NEVER auto-linked and are flagged.
 * 3. Records with matching names but conflicting phones are NEVER auto-linked and are flagged.
 * 4. Existing contact data is never destructively merged or deleted.
 * 5. Returns updated MaliState and detailed audit reports.
 */
export function auditAndLinkLegacyContactRecords(state: MaliState): LegacyContactAuditResult {
  const linkedCounts = {
    debts: 0,
    deals: 0,
    sales: 0,
    transactions: 0,
  };
  const ambiguousRecords: AmbiguousRecord[] = [];
  const duplicateContacts: DuplicateContactInfo[] = [];

  // Step 1: Analyze Contact Directory for duplicate names and phone collisions
  const contactsByName = new Map<string, ContactPerson[]>();
  const contactsByPhone = new Map<string, ContactPerson[]>();

  for (const contact of state.contacts) {
    const normName = normalizeText(contact.name);
    if (normName) {
      const list = contactsByName.get(normName) || [];
      list.push(contact);
      contactsByName.set(normName, list);
    }

    const normPhone = normalizePhone(contact.phone);
    if (normPhone) {
      const list = contactsByPhone.get(normPhone) || [];
      list.push(contact);
      contactsByPhone.set(normPhone, list);
    }
  }

  // Flag duplicate contact names
  for (const contacts of contactsByName.values()) {
    if (contacts.length > 1) {
      duplicateContacts.push({
        name: contacts[0].name,
        contactIds: contacts.map((c) => c.id),
        phones: contacts.map((c) => c.phone || ''),
        reason: `تكرار الاسم لعدد ${contacts.length} جهات اتصال مختلفة في الدليل`,
      });
    }
  }

  // Flag phone collisions with different names
  for (const contacts of contactsByPhone.values()) {
    if (contacts.length > 1) {
      const distinctNames = new Set(contacts.map((c) => normalizeText(c.name)));
      if (distinctNames.size > 1) {
        duplicateContacts.push({
          name: contacts.map((c) => c.name).join(' / '),
          contactIds: contacts.map((c) => c.id),
          phones: [contacts[0].phone],
          reason: `اشتراك جهات اتصال ذات أسماء مختلفة في نفس رقم الهاتف (${contacts[0].phone})`,
        });
      }
    }
  }

  // Step 2: Reconcile unlinked Debts
  let debtsChanged = false;
  const updatedDebts = state.debts.map((debt) => {
    if (debt.contactId) {
      // Already linked, verify contact exists
      const exists = state.contacts.some((c) => c.id === debt.contactId);
      if (!exists) {
        ambiguousRecords.push({
          type: 'debt',
          recordId: debt.id,
          recordName: debt.personName,
          recordPhone: debt.phone,
          matchedContactId: debt.contactId,
          reason: 'معرف جهة الاتصال المسجل بالدين غير موجود بدليل جهات الاتصال',
        });
      }
      return debt;
    }

    // Unlinked debt: attempt safe reconciliation by name
    const normName = normalizeText(debt.personName);
    if (!normName) return debt;

    const matchedContacts = contactsByName.get(normName);
    if (!matchedContacts || matchedContacts.length === 0) {
      return debt;
    }

    if (matchedContacts.length > 1) {
      ambiguousRecords.push({
        type: 'debt',
        recordId: debt.id,
        recordName: debt.personName,
        recordPhone: debt.phone,
        reason: 'اسم المدين مكرر لأكثر من جهة اتصال، يتطلب اختياراً يدوياً',
      });
      return debt;
    }

    const targetContact = matchedContacts[0];
    const normDebtPhone = normalizePhone(debt.phone);
    const normContactPhone = normalizePhone(targetContact.phone);

    // Conflict check: if both have phones and they disagree, DO NOT auto-link!
    if (normDebtPhone && normContactPhone && normDebtPhone !== normContactPhone) {
      ambiguousRecords.push({
        type: 'debt',
        recordId: debt.id,
        recordName: debt.personName,
        recordPhone: debt.phone,
        matchedContactId: targetContact.id,
        matchedContactName: targetContact.name,
        matchedContactPhone: targetContact.phone,
        reason: 'تطابق الاسم مع جهة اتصال ولكن رقم الهاتف مختلف',
      });
      return debt;
    }

    // Safe link
    debtsChanged = true;
    linkedCounts.debts++;
    return {
      ...debt,
      contactId: targetContact.id,
    };
  });

  // Step 3: Reconcile unlinked Deals and Sales
  let dealsChanged = false;
  const updatedDeals = state.deals.map((deal) => {
    let currentDeal = deal;
    let dealModified = false;

    // Check deal counterparty
    if (!currentDeal.contactId && currentDeal.counterparty) {
      const normName = normalizeText(currentDeal.counterparty);
      const matchedContacts = contactsByName.get(normName);

      if (matchedContacts && matchedContacts.length === 1) {
        const targetContact = matchedContacts[0];
        const normDealPhone = normalizePhone(currentDeal.counterpartyPhone);
        const normContactPhone = normalizePhone(targetContact.phone);

        if (normDealPhone && normContactPhone && normDealPhone !== normContactPhone) {
          ambiguousRecords.push({
            type: 'deal',
            recordId: currentDeal.id,
            recordName: currentDeal.counterparty,
            recordPhone: currentDeal.counterpartyPhone,
            matchedContactId: targetContact.id,
            matchedContactName: targetContact.name,
            matchedContactPhone: targetContact.phone,
            reason: 'تطابق اسم بائع الصفقة مع جهة اتصال ولكن رقم الهاتف مختلف',
          });
        } else {
          currentDeal = {
            ...currentDeal,
            contactId: targetContact.id,
          };
          dealModified = true;
          linkedCounts.deals++;
        }
      } else if (matchedContacts && matchedContacts.length > 1) {
        ambiguousRecords.push({
          type: 'deal',
          recordId: currentDeal.id,
          recordName: currentDeal.counterparty,
          recordPhone: currentDeal.counterpartyPhone,
          reason: 'اسم بائع الصفقة مكرر لأكثر من جهة اتصال في الدليل',
        });
      }
    }

    // Check deal sales
    let salesModified = false;
    const updatedSales = currentDeal.sales.map((sale) => {
      if (!sale.contactId && sale.buyerName) {
        const normName = normalizeText(sale.buyerName);
        const matchedContacts = contactsByName.get(normName);

        if (matchedContacts && matchedContacts.length === 1) {
          const targetContact = matchedContacts[0];
          const normSalePhone = normalizePhone(sale.buyerPhone);
          const normContactPhone = normalizePhone(targetContact.phone);

          if (normSalePhone && normContactPhone && normSalePhone !== normContactPhone) {
            ambiguousRecords.push({
              type: 'sale',
              recordId: sale.id,
              recordName: sale.buyerName,
              recordPhone: sale.buyerPhone,
              matchedContactId: targetContact.id,
              matchedContactName: targetContact.name,
              matchedContactPhone: targetContact.phone,
              reason: 'تطابق اسم مشتري صفقة الدولار مع جهة اتصال ولكن رقم الهاتف مختلف',
            });
            return sale;
          }

          salesModified = true;
          linkedCounts.sales++;
          return {
            ...sale,
            contactId: targetContact.id,
          };
        } else if (matchedContacts && matchedContacts.length > 1) {
          ambiguousRecords.push({
            type: 'sale',
            recordId: sale.id,
            recordName: sale.buyerName,
            recordPhone: sale.buyerPhone,
            reason: 'اسم مشتري صفقة الدولار مكرر لأكثر من جهة اتصال في الدليل',
          });
        }
      }
      return sale;
    });

    if (dealModified || salesModified) {
      dealsChanged = true;
      return {
        ...currentDeal,
        sales: salesModified ? updatedSales : currentDeal.sales,
      };
    }
    return currentDeal;
  });

  // Step 4: Reconcile unlinked Transactions via their linked debt or deal/sale
  const debtContactMap = new Map<string, string>();
  for (const d of updatedDebts) {
    if (d.contactId) debtContactMap.set(d.id, d.contactId);
  }

  const dealContactMap = new Map<string, string>();
  const saleContactMap = new Map<string, string>();
  for (const d of updatedDeals) {
    if (d.contactId) dealContactMap.set(d.id, d.contactId);
    for (const s of d.sales) {
      if (s.contactId) saleContactMap.set(s.id, s.contactId);
    }
  }

  let txChanged = false;
  const updatedTransactions = state.transactions.map((tx) => {
    if (tx.contactId) return tx;

    let targetContactId: string | undefined;

    if (tx.debtId && debtContactMap.has(tx.debtId)) {
      targetContactId = debtContactMap.get(tx.debtId);
    } else if (tx.saleId && saleContactMap.has(tx.saleId)) {
      targetContactId = saleContactMap.get(tx.saleId);
    } else if (tx.dealId && dealContactMap.has(tx.dealId)) {
      targetContactId = dealContactMap.get(tx.dealId);
    }

    if (targetContactId) {
      txChanged = true;
      linkedCounts.transactions++;
      return {
        ...tx,
        contactId: targetContactId,
      };
    }

    return tx;
  });

  const updatedState: MaliState = (debtsChanged || dealsChanged || txChanged)
    ? {
        ...state,
        debts: debtsChanged ? updatedDebts : state.debts,
        deals: dealsChanged ? updatedDeals : state.deals,
        transactions: txChanged ? updatedTransactions : state.transactions,
      }
    : state;

  return {
    updatedState,
    linkedCounts,
    ambiguousRecords,
    duplicateContacts,
  };
}
