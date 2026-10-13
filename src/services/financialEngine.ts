import { financialDate } from './financialDate.ts';
import { validateFinancialAudit } from './financialAudit.ts';
import type {
  Account,
  ContactPerson,
  Currency,
  DealSale,
  DebtInstallment,
  DebtRecord,
  DebtSettlementType,
  MaliState,
  MarketRates,
  PaymentMethodType,
  Transaction,
  UsdDeal,
} from '../types/mali';

// Persisted values remain JSON numbers. All monetary arithmetic uses integer cents
// and decimal rational intermediates; the cap preserves cent precision on conversion.
export const MAX_MONEY_AMOUNT = 1_000_000_000_000;
export const MAX_EXCHANGE_RATE = 1_000_000;

/** Display arithmetic shares the same decimal rounding as persisted money. */
export function roundFinancialPreview(value: number, decimalPlaces = 2): number {
  if (!Number.isFinite(value) || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 10) return 0;
  const scale = 10 ** decimalPlaces;
  if (Math.abs(value) > MAX_MONEY_AMOUNT || Math.abs(value) * scale > Number.MAX_SAFE_INTEGER) return 0;
  return Number(scaledInteger(value, scale, MAX_MONEY_AMOUNT)) / scale;
}

export function updateMarketRatesMutation(state: MaliState, input: Partial<MarketRates>): MaliState {
  const cash = input.cashUsdToLyd ?? state.marketRates.cashUsdToLyd;
  const cheque = input.chequeUsdToLyd ?? state.marketRates.chequeUsdToLyd;
  const discount = input.defaultChequeDiscountPercent ?? state.marketRates.defaultChequeDiscountPercent;
  if (![cash, cheque].every(value => Number.isFinite(value) && value > 0 && value <= MAX_EXCHANGE_RATE) ||
      !Number.isFinite(discount) || discount < 0 || discount >= 100) return state;
  const cashRate = roundRate(cash), chequeRate = roundRate(cheque);
  if (cashRate <= 0 || chequeRate <= 0) return state;
  return { ...state, marketRates: { ...state.marketRates, cashUsdToLyd: cashRate, chequeUsdToLyd: chequeRate,
    defaultChequeDiscountPercent: discount, updatedAt: new Date().toISOString() } };
}
const MAX_MONEY_CENTS = BigInt(MAX_MONEY_AMOUNT) * 100n;
const MAX_SUMMARY_AMOUNT = 10_000_000_000_000;
const MAX_SUMMARY_CENTS = BigInt(MAX_SUMMARY_AMOUNT) * 100n;

function decimalFraction(value: number): [bigint, bigint] {
  const negative = value < 0;
  const [mantissa, exponentText = '0'] = Math.abs(value).toString().toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const exponent = Number(exponentText) - fraction.length;
  const digits = BigInt(whole + fraction) * (negative ? -1n : 1n);
  return exponent >= 0
    ? [digits * 10n ** BigInt(exponent), 1n]
    : [digits, 10n ** BigInt(-exponent)];
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}

function scaledInteger(value: number, scale: number, maximum: number): bigint | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > maximum) {
    return null;
  }
  const [numerator, denominator] = decimalFraction(value);
  return divideRounded(numerator * BigInt(scale), denominator);
}

function moneyFromCents(cents: bigint, maximum = MAX_MONEY_CENTS): number {
  return cents > maximum || cents < -maximum ? NaN : Number(cents) / 100;
}

export function roundMoney(value: number): number {
  const cents = scaledInteger(value, 100, MAX_SUMMARY_AMOUNT);
  return cents === null ? 0 : moneyFromCents(cents, MAX_SUMMARY_CENTS);
}

export function roundRate(value: number): number {
  const rate = scaledInteger(value, 10000, MAX_EXCHANGE_RATE);
  return rate === null ? 0 : Number(rate) / 10000;
}

function validMoney(value: number): boolean {
  return scaledInteger(value, 100, MAX_MONEY_AMOUNT) !== null;
}

function validFee(value: number | undefined): boolean {
  return value === undefined || (validMoney(value) && value >= 0);
}

function moneySum(...values: number[]): number {
  let total = 0n;
  for (const value of values) {
    const cents = scaledInteger(value, 100, MAX_MONEY_AMOUNT);
    if (cents === null) return NaN;
    total += cents;
  }
  return moneyFromCents(total);
}

function summarySum(...values: number[]): number {
  let total = 0n;
  for (const value of values) {
    const cents = scaledInteger(value, 100, MAX_SUMMARY_AMOUNT);
    if (cents === null) return NaN;
    total += cents;
  }
  return moneyFromCents(total, MAX_SUMMARY_CENTS);
}

function moneyRatio(amount: number, numerator: number, denominator = 1, maximum = MAX_MONEY_AMOUNT): number {
  const cents = scaledInteger(amount, 100, maximum);
  if (cents === null || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return NaN;
  }
  const [top, topScale] = decimalFraction(numerator);
  const [bottom, bottomScale] = decimalFraction(denominator);
  return moneyFromCents(divideRounded(cents * top * bottomScale, topScale * bottom), BigInt(maximum) * 100n);
}

// Quote with separate operands so binary products cannot lose decimal ties.
export const multiplyMoney = (amount: number, multiplier: number) => moneyRatio(amount, multiplier);
export const proportionalMoney = (amount: number, numerator: number, denominator: number) => moneyRatio(amount, numerator, denominator);
export const addMoney = (...values: number[]) => moneySum(...values);
export function calculateEffectiveRate(cost: number, quantity: number): number {
  const costCents = scaledInteger(cost, 100, MAX_MONEY_AMOUNT);
  const quantityCents = scaledInteger(quantity, 100, MAX_MONEY_AMOUNT);
  if (costCents === null || quantityCents === null || costCents <= 0n || quantityCents <= 0n) return 0;
  const rate = divideRounded(costCents * 10000n, quantityCents);
  return rate > BigInt(MAX_EXCHANGE_RATE) * 10000n ? 0 : Number(rate) / 10000;
}
export function subtractRates(left: number, right: number): number {
  const a = scaledInteger(left, 10000, MAX_EXCHANGE_RATE), b = scaledInteger(right, 10000, MAX_EXCHANGE_RATE);
  return a === null || b === null ? NaN : Number(a - b) / 10000;
}

function applyAccountDeltas(
  state: MaliState,
  changes: [string, number][],
  now: string
): Account[] | null {
  if (new Set(state.accounts.map((a) => a.id)).size !== state.accounts.length) return null;
  const deltas = new Map<string, number>();
  for (const [accountId, delta] of changes) {
    if (!state.accounts.some((a) => a.id === accountId) || !validMoney(delta)) return null;
    const combined = moneySum(deltas.get(accountId) || 0, delta);
    if (!validMoney(combined)) return null;
    deltas.set(accountId, combined);
  }
  let valid = true;
  const accounts = state.accounts.map((account) => {
    if (!deltas.has(account.id)) return account;
    const balance = moneySum(account.balance, deltas.get(account.id)!);
    // Bank accounts may represent an existing overdraft; physical cash cannot.
    if (!validMoney(balance) || (account.isCash && balance < 0)) valid = false;
    return { ...account, balance, updatedAt: now };
  });
  return valid ? accounts : null;
}

export interface DisbursementCheck {
  allowed: boolean;
  available: number;
  deficit: number;
}

/**
 * فحص إمكانية الصرف من الحساب ومنع السحب على المكشوف غير المصرح به (إصلاح DEBT-ACC-02)
 * الكاش النقدي يستحيل سحبه على المكشوف في جميع الأحوال.
 * الحسابات المصرفية يمكن سحبها على المكشوف فقط إذا كانت allowOverdraft = true مع مراعاة overdraftLimit.
 */
export function canDisburseFromAccount(
  account: Account | null | undefined,
  amount: number
): DisbursementCheck {
  if (!account || !validMoney(amount) || amount <= 0) {
    return { allowed: false, available: 0, deficit: roundMoney(amount || 0) };
  }
  const cleanAmount = roundMoney(amount);
  const currentBalance = roundMoney(account.balance);

  // الكاش النقدي الفعلي لا يمكن أن يكون سالباً أبداً
  if (account.isCash) {
    const available = Math.max(0, currentBalance);
    const deficit = cleanAmount > currentBalance ? roundMoney(cleanAmount - currentBalance) : 0;
    return {
      allowed: currentBalance >= cleanAmount,
      available,
      deficit,
    };
  }

  // حساب غير نقدي مصرح له بالسحب على المكشوف
  if (account.allowOverdraft) {
    const limit =
      account.overdraftLimit !== undefined && account.overdraftLimit > 0
        ? roundMoney(account.overdraftLimit)
        : undefined;
    if (limit !== undefined) {
      const maxAvailable = roundMoney(currentBalance + limit);
      const deficit = cleanAmount > maxAvailable ? roundMoney(cleanAmount - maxAvailable) : 0;
      return {
        allowed: maxAvailable >= cleanAmount,
        available: Math.max(0, maxAvailable),
        deficit,
      };
    }
    // سحب على المكشوف مفتوح ومصرح به
    return {
      allowed: true,
      available: Math.max(0, currentBalance),
      deficit: 0,
    };
  }

  // حساب غير نقدي بدون تصريح سحب على المكشوف
  const available = Math.max(0, currentBalance);
  const deficit = cleanAmount > currentBalance ? roundMoney(cleanAmount - currentBalance) : 0;
  return {
    allowed: currentBalance >= cleanAmount,
    available,
    deficit,
  };
}

/**
 * الفصل الهيكلي لحركات رأس المال والديون عن الإيرادات والمصروفات التشغيلية (إصلاح DEBT-ACC-03)
 */
export function isDebtTransaction(tx: Partial<Transaction> | null | undefined): boolean {
  if (!tx) return false;
  if (tx.debtId || tx.installmentId) return true;
  if (tx.type === 'debt_settlement') return true;
  const cat = tx.category?.trim();
  if (
    cat === 'ديون وأمانات' ||
    cat === 'تحصيل ديون' ||
    cat === 'سداد التزامات' ||
    cat === 'ديون' ||
    cat === 'سداد دين' ||
    cat === 'تحصيل دين'
  ) {
    return true;
  }
  return false;
}

export function calculateUsdDealCostBasis(deal: UsdDeal, usdAmount: number): number {
  if (!validMoney(usdAmount) || usdAmount <= 0 || usdAmount > deal.remainingUsd) return NaN;
  const allocated = moneySum(...deal.sales.map((sale) => sale.costBasisLyd));
  const remainingCost = moneySum(deal.totalLydCost, -allocated);
  if (!validMoney(remainingCost) || remainingCost < 0 || deal.remainingUsd <= 0) return NaN;
  // The final disposition absorbs the rounding remainder, including buy commission.
  return moneyRatio(remainingCost, usdAmount, deal.remainingUsd);
}

let identitySequence = 0;
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++identitySequence}-${Math.random().toString(36).substring(2, 8)}`;
}

export function deleteContactMutation(state: MaliState, contactId: string): MaliState {
  if (!state.contacts.some(contact => contact.id === contactId) ||
      state.transactions.some(tx => tx.contactId === contactId) ||
      state.debts.some(debt => debt.contactId === contactId) ||
      state.deals.some(deal => deal.contactId === contactId || deal.sales.some(sale => sale.contactId === contactId))) return state;
  return { ...state, contacts: state.contacts.filter(contact => contact.id !== contactId) };
}

export function updateContactMutation(state: MaliState, contactId: string, input: Partial<ContactPerson>): MaliState {
  const current = state.contacts.find(contact => contact.id === contactId);
  if (!current || (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim()))) return state;
  const next = { ...current, ...input, id: current.id, createdAt: current.createdAt };
  return { ...state, contacts: state.contacts.map(contact => contact.id === contactId ? next : contact) };
}

export function touchState(state: MaliState): MaliState {
  return {
    ...state,
    lastModifiedAt: new Date().toISOString(),
  };
}

/**
 * 1. إدارة الحسابات المالية (إنشاء، تعديل الرصيد، حذف آمن)
 */
export function createAccountMutation(
  state: MaliState,
  account: Omit<Account, 'id' | 'updatedAt'> & { id?: string }
): MaliState {
  const cleanName = (account.name || '').trim();
  if (!cleanName) return state;
  if (account.currency !== 'LYD' && account.currency !== 'USD') return state;
  if (!validMoney(account.balance) || (account.isCash && account.balance < 0)) return state;

  const newAcc: Account = {
    ...account,
    id: account.id || generateId('acc'),
    name: cleanName,
    bankName: (account.bankName || cleanName).trim(),
    balance: roundMoney(account.balance),
    updatedAt: new Date().toISOString(),
  };

  if (state.accounts.some((a) => a.id === newAcc.id)) {
    return state;
  }

  return touchState({
    ...state,
    accounts: [...state.accounts, newAcc],
  });
}

export function updateAccountBalanceMutation(
  state: MaliState,
  accountId: string,
  newBalance: number
): MaliState {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account || !validMoney(newBalance) || (account.isCash && newBalance < 0)) return state;
  const now = new Date().toISOString();
  return touchState({
    ...state,
    accounts: state.accounts.map((a) =>
      a.id === accountId ? { ...a, balance: roundMoney(newBalance), updatedAt: now } : a
    ),
  });
}

export function deleteAccountMutation(state: MaliState, accountId: string): MaliState {
  const hasFinancialReference = state.transactions.some(
    (t) => t.accountId === accountId || t.targetAccountId === accountId
  ) || state.debts.some(
    (d) => d.accountId === accountId || d.installments.some((i) => i.accountId === accountId)
  ) || state.deals.some(
    (d) =>
      d.sourceLydAccountId === accountId || d.usdHoldingAccountId === accountId ||
      d.sales.some((s) => s.sourceUsdAccountId === accountId || s.targetLydAccountId === accountId)
  );
  if (hasFinancialReference) {
    return state;
  }
  return touchState({
    ...state,
    accounts: state.accounts.filter((a) => a.id !== accountId),
  });
}

/**
 * 2. عمليات الصرف والقبض والتحويل وتسييل الصكوك (مع دعم Idempotency لمنع التكرار)
 */
export function recordExpenseOrIncomeMutation(
  state: MaliState,
  params: {
    id?: string;
    idempotencyKey?: string;
    title: string;
    type: 'expense' | 'income';
    amount: number;
    currency: Currency;
    category: string;
    accountId: string;
    paymentMethod: PaymentMethodType;
    contactId?: string;
    receiptImages?: string[];
    notes?: string;
    date?: string;
  }
): MaliState {
  if (!validMoney(params.amount)) return state;
  const cleanAmount = roundMoney(params.amount);
  if (cleanAmount <= 0) return state;

  if (
    params.idempotencyKey &&
    state.transactions.some((tx) => tx.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }
  if (params.id && state.transactions.some((tx) => tx.id === params.id)) {
    return state;
  }

  const targetAcc = state.accounts.find((a) => a.id === params.accountId);
  if (!targetAcc || targetAcc.currency !== params.currency) return state;

  const now = new Date().toISOString();
  const tx: Transaction = {
    id: params.id || generateId('tx'),
    idempotencyKey: params.idempotencyKey,
    title: params.title.trim() || (params.type === 'expense' ? 'مصروف' : 'إيراد'),
    type: params.type,
    amount: cleanAmount,
    currency: params.currency,
    category: params.category || 'عام',
    accountId: params.accountId,
    paymentMethod: params.paymentMethod,
    contactId: params.contactId,
    receiptImages: params.receiptImages,
    date: params.date || now,
    updatedAt: now,
    notes: params.notes,
  };

  const updatedAccounts = applyAccountDeltas(state, [
    [params.accountId, params.type === 'income' ? cleanAmount : -cleanAmount],
  ], now);
  if (!updatedAccounts) return state;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    transactions: [tx, ...state.transactions],
  });
}

export function recordTransferMutation(
  state: MaliState,
  params: {
    id?: string;
    idempotencyKey?: string;
    title: string;
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    feeAmount?: number;
    paymentMethod: PaymentMethodType;
    notes?: string;
    date?: string;
  }
): MaliState {
  if (!params.fromAccountId || !params.toAccountId) return state;
  if (params.fromAccountId === params.toAccountId) return state;
  if (!validMoney(params.amount) || !validFee(params.feeAmount)) return state;

  const cleanAmount = roundMoney(params.amount);
  const fee = roundMoney(params.feeAmount || 0);
  if (cleanAmount <= 0) return state;

  if (
    params.idempotencyKey &&
    state.transactions.some((tx) => tx.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  if (params.id && state.transactions.some((tx) => tx.id === params.id)) return state;

  const fromAcc = state.accounts.find((a) => a.id === params.fromAccountId);
  const toAcc = state.accounts.find((a) => a.id === params.toAccountId);
  if (!fromAcc || !toAcc) return state;
  // منع التحويل المباشر بين عملتين مختلفتين بدون صفقة صرف
  if (fromAcc.currency !== toAcc.currency) return state;

  const now = new Date().toISOString();
  const tx: Transaction = {
    id: params.id || generateId('tx-trf'),
    idempotencyKey: params.idempotencyKey,
    title: params.title.trim() || 'تحويل بين الحسابات',
    type: 'transfer',
    amount: cleanAmount,
    currency: fromAcc.currency,
    category: 'تحويل داخلي',
    accountId: params.fromAccountId,
    targetAccountId: params.toAccountId,
    paymentMethod: params.paymentMethod,
    feeAmount: fee,
    date: params.date || now,
    updatedAt: now,
    notes: params.notes,
  };

  const updatedAccounts = applyAccountDeltas(state, [
    [params.fromAccountId, -moneySum(cleanAmount, fee)],
    [params.toAccountId, cleanAmount],
  ], now);
  if (!updatedAccounts) return state;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    transactions: [tx, ...state.transactions],
  });
}

export function liquidateChequeToCashMutation(
  state: MaliState,
  params: {
    id?: string;
    idempotencyKey?: string;
    title: string;
    fromBankAccountId: string;
    toCashAccountId: string;
    grossChequeAmountLyd: number;
    discountPercent: number;
    notes?: string;
    date?: string;
  }
): MaliState {
  if (!params.fromBankAccountId || !params.toCashAccountId) return state;
  if (params.fromBankAccountId === params.toCashAccountId) return state;
  if (!validMoney(params.grossChequeAmountLyd)) return state;

  const gross = roundMoney(params.grossChequeAmountLyd);
  const pct = Number(params.discountPercent);
  if (gross <= 0 || !Number.isFinite(pct) || pct < 0 || pct >= 100) return state;

  if (
    params.idempotencyKey &&
    state.transactions.some((tx) => tx.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  if (params.id && state.transactions.some((tx) => tx.id === params.id)) return state;

  const fromAcc = state.accounts.find((a) => a.id === params.fromBankAccountId);
  const toAcc = state.accounts.find((a) => a.id === params.toCashAccountId);
  if (!fromAcc || !toAcc || fromAcc.currency !== 'LYD' || toAcc.currency !== 'LYD') return state;

  const feeAmount = moneyRatio(gross, pct, 100);
  const netCashReceived = moneySum(gross, -feeAmount);
  const now = new Date().toISOString();

  const tx: Transaction = {
    id: params.id || generateId('tx-liq'),
    idempotencyKey: params.idempotencyKey,
    title: params.title.trim() || `تسييل صك بقيمة ${gross} د.ل`,
    type: 'cheque_liquidation',
    amount: gross,
    currency: 'LYD',
    category: 'تسييل صكوك للكاش',
    accountId: params.fromBankAccountId,
    targetAccountId: params.toCashAccountId,
    paymentMethod: 'cheque',
    feeAmount,
    discountPercent: pct,
    date: params.date || now,
    updatedAt: now,
    notes:
      params.notes ||
      `تسييل صك بقيمة ${gross} د.ل بخصم ${pct}% (${feeAmount} د.ل) -> صافي كاش مستلم ${netCashReceived} د.ل`,
  };

  const updatedAccounts = applyAccountDeltas(state, [
    [params.fromBankAccountId, -gross], [params.toCashAccountId, netCashReceived],
  ], now);
  if (!updatedAccounts) return state;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    transactions: [tx, ...state.transactions],
  });
}

/**
 * 3. صفقات شراء وبيع الدولار وحساب الأرباح والخسائر بدقة عشرية
 */
export function createUsdDealMutation(
  state: MaliState,
  params: {
    id?: string;
    idempotencyKey?: string;
    title: string;
    contactId?: string;
    counterparty?: string;
    counterpartyPhone?: string;
    totalUsdBought: number;
    buyRate: number;
    buyCommissionLyd: number;
    buyPaymentMethod: PaymentMethodType;
    sourceLydAccountId: string;
    usdHoldingAccountId: string;
    buyReceiptImages?: string[];
    notes?: string;
    buyDate?: string;
  }
): MaliState {
  if (!validMoney(params.totalUsdBought) || !validFee(params.buyCommissionLyd)) return state;
  const usdBought = roundMoney(params.totalUsdBought);
  const rate = roundRate(params.buyRate);
  const commission = roundMoney(params.buyCommissionLyd || 0);

  if (usdBought <= 0 || rate <= 0) return state;

  if (
    params.idempotencyKey &&
    state.deals.some((d) => d.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  if (params.id && state.deals.some((d) => d.id === params.id)) return state;

  const lydAcc = state.accounts.find((a) => a.id === params.sourceLydAccountId);
  const usdAcc = state.accounts.find((a) => a.id === params.usdHoldingAccountId);
  if (!lydAcc || !usdAcc) return state;
  if (lydAcc.currency !== 'LYD' || usdAcc.currency !== 'USD') return state;

  const grossLydCost = moneyRatio(usdBought, rate);
  const totalLydCost = moneySum(grossLydCost, commission);
  if (!validMoney(totalLydCost)) return state;
  const effectiveBuyRate = calculateEffectiveRate(totalLydCost, usdBought);
  if (effectiveBuyRate <= 0) return state;

  const dealNumber = `DL-${String(state.deals.length + 101).padStart(3, '0')}`;
  const dealId = params.id || generateId('deal');
  const now = new Date().toISOString();

  const matchedContact = params.contactId
    ? state.contacts.find((c) => c.id === params.contactId)
    : undefined;

  const newDeal: UsdDeal = {
    id: dealId,
    idempotencyKey: params.idempotencyKey,
    dealNumber,
    title: params.title.trim() || `صفقة شراء ${usdBought} $`,
    contactId: params.contactId,
    counterparty: params.counterparty || matchedContact?.name,
    counterpartyPhone: params.counterpartyPhone || matchedContact?.phone,
    buyDate: params.buyDate || now,
    totalUsdBought: usdBought,
    buyRate: rate,
    grossLydCost,
    buyCommissionLyd: commission,
    totalLydCost,
    effectiveBuyRate,
    buyPaymentMethod: params.buyPaymentMethod,
    sourceLydAccountId: params.sourceLydAccountId,
    usdHoldingAccountId: params.usdHoldingAccountId,
    buyReceiptImages: params.buyReceiptImages || [],
    soldUsd: 0,
    personalTakenUsd: 0,
    remainingUsd: usdBought,
    totalLydReceived: 0,
    realizedProfitLyd: 0,
    status: 'open',
    sales: [],
    updatedAt: now,
    notes: params.notes,
  };

  const tx: Transaction = {
    id: generateId('tx-dbuy'),
    idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:buy` : undefined,
    title: `شراء ${usdBought.toLocaleString('en-US')} $ (${params.title})`,
    type: 'deal_buy',
    amount: totalLydCost,
    currency: 'LYD',
    category: 'تداول عملة - شراء دولار',
    accountId: params.sourceLydAccountId,
    targetAccountId: params.usdHoldingAccountId,
    paymentMethod: params.buyPaymentMethod,
    feeAmount: commission,
    exchangeRate: rate,
    dealId,
    contactId: params.contactId,
    receiptImages: params.buyReceiptImages,
    date: newDeal.buyDate,
    updatedAt: now,
    notes: params.notes,
  };

  const updatedAccounts = applyAccountDeltas(state, [
    [params.sourceLydAccountId, -totalLydCost], [params.usdHoldingAccountId, usdBought],
  ], now);
  if (!updatedAccounts) return state;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    deals: [newDeal, ...state.deals],
    transactions: [tx, ...state.transactions],
  });
}

export function sellFromUsdDealMutation(
  state: MaliState,
  params: {
    saleId?: string;
    idempotencyKey?: string;
    dealId: string;
    usdAmount: number;
    sellRate: number;
    commissionLyd: number;
    paymentMethod: PaymentMethodType;
    targetLydAccountId: string;
    sourceUsdAccountId: string;
    contactId?: string;
    buyerName?: string;
    buyerPhone?: string;
    receiptImages?: string[];
    notes?: string;
    date?: string;
  }
): MaliState {
  const deal = state.deals.find((d) => d.id === params.dealId);
  if (!deal) return state;
  if (!validMoney(params.usdAmount) || !validFee(params.commissionLyd)) return state;

  const reqUsd = roundMoney(params.usdAmount);
  const rate = roundRate(params.sellRate);
  const commission = roundMoney(params.commissionLyd || 0);

  if (reqUsd <= 0 || rate <= 0) return state;
  if (reqUsd > deal.remainingUsd) return state;

  const usdToSell = roundMoney(Math.min(reqUsd, deal.remainingUsd));
  if (usdToSell <= 0) return state;

  if (
    params.idempotencyKey &&
    state.deals.some((d) => d.sales.some((s) => s.idempotencyKey === params.idempotencyKey))
  ) {
    return state;
  }

  if (params.saleId && state.deals.some((d) => d.sales.some((s) => s.id === params.saleId))) return state;

  const targetLydAcc = state.accounts.find((a) => a.id === params.targetLydAccountId);
  const sourceUsdAcc = state.accounts.find((a) => a.id === params.sourceUsdAccountId);
  if (!targetLydAcc || !sourceUsdAcc || targetLydAcc.currency !== 'LYD' ||
    sourceUsdAcc.currency !== 'USD' || params.sourceUsdAccountId !== deal.usdHoldingAccountId ||
    sourceUsdAcc.balance < usdToSell) return state;

  const grossLyd = moneyRatio(usdToSell, rate);
  const netLydReceived = moneySum(grossLyd, -commission);
  const costBasisLyd = calculateUsdDealCostBasis(deal, usdToSell);
  const profitLyd = moneySum(netLydReceived, -costBasisLyd);
  if (!validMoney(profitLyd) || !validMoney(netLydReceived) || netLydReceived < 0) return state;

  const matchedContact = params.contactId
    ? state.contacts.find((c) => c.id === params.contactId)
    : undefined;

  const saleId = params.saleId || generateId('sale');
  const now = new Date().toISOString();

  const newSale: DealSale = {
    id: saleId,
    idempotencyKey: params.idempotencyKey,
    dealId: deal.id,
    usdAmount: usdToSell,
    sellRate: rate,
    grossLyd,
    commissionLyd: commission,
    netLydReceived,
    costBasisLyd,
    profitLyd,
    paymentMethod: params.paymentMethod,
    targetLydAccountId: params.targetLydAccountId,
    sourceUsdAccountId: params.sourceUsdAccountId,
    contactId: params.contactId,
    buyerName: params.buyerName || matchedContact?.name,
    buyerPhone: params.buyerPhone || matchedContact?.phone,
    isPersonalTake: false,
    receiptImages: params.receiptImages || [],
    date: params.date || now,
    notes: params.notes,
  };

  const newSoldUsd = moneySum(deal.soldUsd, usdToSell);
  const newRemainingUsd = moneySum(deal.totalUsdBought, -newSoldUsd, -deal.personalTakenUsd);
  const newTotalLydReceived = moneySum(deal.totalLydReceived, netLydReceived);
  const newRealizedProfitLyd = moneySum(deal.realizedProfitLyd, profitLyd);
  if (![newSoldUsd, newRemainingUsd, newTotalLydReceived, newRealizedProfitLyd].every(validMoney)) return state;
  const newStatus: UsdDeal['status'] = newRemainingUsd <= 0.005 ? 'closed' : 'partial';

  const updatedDeal: UsdDeal = {
    ...deal,
    soldUsd: newSoldUsd,
    remainingUsd: newRemainingUsd,
    totalLydReceived: newTotalLydReceived,
    realizedProfitLyd: newRealizedProfitLyd,
    status: newStatus,
    sales: [newSale, ...deal.sales],
    updatedAt: now,
  };

  const tx: Transaction = {
    id: generateId('tx-dsell'),
    idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:sell` : undefined,
    title: `بيع ${usdToSell.toLocaleString('en-US')} $ من ${deal.dealNumber} بسعر ${rate}`,
    type: 'deal_sell',
    amount: netLydReceived,
    currency: 'LYD',
    category: 'تداول عملة - بيع دولار',
    accountId: params.targetLydAccountId,
    targetAccountId: params.sourceUsdAccountId,
    paymentMethod: params.paymentMethod,
    feeAmount: commission,
    exchangeRate: rate,
    dealId: deal.id,
    saleId,
    contactId: params.contactId,
    receiptImages: params.receiptImages,
    date: newSale.date,
    updatedAt: now,
    notes: `صافي الربح المحقق: ${profitLyd >= 0 ? '+' : ''}${profitLyd} د.ل | ${params.notes || ''}`,
  };

  const updatedAccounts = applyAccountDeltas(state, [
    [params.sourceUsdAccountId, -usdToSell], [params.targetLydAccountId, netLydReceived],
  ], now);
  if (!updatedAccounts) return state;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    deals: state.deals.map((d) => (d.id === deal.id ? updatedDeal : d)),
    transactions: [tx, ...state.transactions],
  });
}

export function takePersonalFromUsdDealMutation(
  state: MaliState,
  params: {
    saleId?: string;
    idempotencyKey?: string;
    dealId: string;
    usdAmount: number;
    sourceUsdAccountId: string;
    targetPersonalUsdAccountId?: string;
    notes?: string;
    date?: string;
  }
): MaliState {
  const deal = state.deals.find((d) => d.id === params.dealId);
  if (!deal) return state;

  if (!validMoney(params.usdAmount)) return state;
  const source = state.accounts.find((a) => a.id === params.sourceUsdAccountId);
  const target = params.targetPersonalUsdAccountId
    ? state.accounts.find((a) => a.id === params.targetPersonalUsdAccountId) : undefined;
  if (!source || source.currency !== 'USD' || source.id !== deal.usdHoldingAccountId ||
    (params.targetPersonalUsdAccountId && (!target || target.currency !== 'USD'))) return state;

  const reqUsd = roundMoney(params.usdAmount);
  if (reqUsd <= 0 || reqUsd > deal.remainingUsd || source.balance < reqUsd) return state;

  const usdToTake = roundMoney(Math.min(reqUsd, deal.remainingUsd));
  if (usdToTake <= 0) return state;

  if (
    params.idempotencyKey &&
    state.deals.some((d) => d.sales.some((s) => s.idempotencyKey === params.idempotencyKey))
  ) {
    return state;
  }

  if (params.saleId && state.deals.some((d) => d.sales.some((s) => s.id === params.saleId))) return state;

  const costBasisLyd = calculateUsdDealCostBasis(deal, usdToTake);
  if (!validMoney(costBasisLyd)) return state;
  const saleId = params.saleId || generateId('ptake');
  const now = new Date().toISOString();

  const personalRecord: DealSale = {
    id: saleId,
    idempotencyKey: params.idempotencyKey,
    dealId: deal.id,
    usdAmount: usdToTake,
    sellRate: deal.effectiveBuyRate,
    grossLyd: costBasisLyd,
    commissionLyd: 0,
    netLydReceived: 0,
    costBasisLyd,
    profitLyd: 0,
    paymentMethod: 'cash',
    targetLydAccountId: params.targetPersonalUsdAccountId || '',
    sourceUsdAccountId: params.sourceUsdAccountId,
    buyerName: 'سحب واقتناء شخصي بالدولار',
    isPersonalTake: true,
    date: params.date || now,
    notes: params.notes || 'مبلغ محتفظ به شخصياً بالدولار (خارج البيع التجاري)',
  };

  const newPersonalTaken = moneySum(deal.personalTakenUsd, usdToTake);
  const newRemainingUsd = moneySum(deal.totalUsdBought, -deal.soldUsd, -newPersonalTaken);
  const newStatus: UsdDeal['status'] = newRemainingUsd <= 0.005 ? 'closed' : 'partial';

  const updatedDeal: UsdDeal = {
    ...deal,
    personalTakenUsd: newPersonalTaken,
    remainingUsd: newRemainingUsd,
    status: newStatus,
    sales: [personalRecord, ...deal.sales],
    updatedAt: now,
  };

  const tx: Transaction = {
    id: generateId('tx-ptake'),
    idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:ptake` : undefined,
    title: `تخصيص شخصي ${usdToTake.toLocaleString('en-US')} $ من ${deal.dealNumber}`,
    type: 'deal_personal_take',
    amount: usdToTake,
    currency: 'USD',
    category: 'مقتنيات وادخار شخصي بالدولار',
    accountId: params.sourceUsdAccountId,
    targetAccountId: params.targetPersonalUsdAccountId,
    paymentMethod: 'cash',
    exchangeRate: deal.effectiveBuyRate,
    dealId: deal.id,
    saleId,
    date: personalRecord.date,
    updatedAt: now,
    notes: `تكلفة الشراء المقابلة: ${costBasisLyd} د.ل | ${params.notes || ''}`,
  };

  const updatedAccounts = target && target.id !== source.id
    ? applyAccountDeltas(state, [[source.id, -usdToTake], [target.id, usdToTake]], now)
    : state.accounts;
  if (!updatedAccounts) return state;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    deals: state.deals.map((d) => (d.id === deal.id ? updatedDeal : d)),
    transactions: [tx, ...state.transactions],
  });
}

export function deleteUsdDealMutation(state: MaliState, dealId: string): MaliState {
  const matches = state.deals.filter((d) => d.id === dealId);
  if (matches.length !== 1) return state;
  const deal = matches[0];

  const balanceChanges: Record<string, number> = {};
  const addDelta = (accId: string | undefined, delta: number) => {
    if (!accId) return;
    balanceChanges[accId] = moneySum(balanceChanges[accId] || 0, delta);
  };

  // 1. عكس جميع عمليات البيع أو السحب الشخصي المرتبطة بالصفقة
  for (const sale of deal.sales) {
    if (sale.isPersonalTake) {
      if (
        sale.targetLydAccountId &&
        sale.targetLydAccountId !== sale.sourceUsdAccountId
      ) {
        addDelta(sale.sourceUsdAccountId, sale.usdAmount);
        addDelta(sale.targetLydAccountId, -sale.usdAmount);
      }
    } else {
      addDelta(sale.sourceUsdAccountId, sale.usdAmount);
      addDelta(sale.targetLydAccountId, -sale.netLydReceived);
    }
  }

  // 2. عكس عملية الشراء الأصلية للصفقة
  addDelta(deal.sourceLydAccountId, deal.totalLydCost);
  addDelta(deal.usdHoldingAccountId, -deal.totalUsdBought);

  const now = new Date().toISOString();
  const updatedAccounts = applyAccountDeltas(state, Object.entries(balanceChanges), now);
  if (!updatedAccounts) return state;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    deals: state.deals.filter((d) => d.id !== dealId),
    transactions: state.transactions.filter((tx) => tx.dealId !== dealId),
  });
}

/**
 * 4. إدارة الديون والمستحقات والسداد الجزئي والكامل والحذف الذري (إصلاح FIN-01)
 */
export function addDebtRecordMutation(
  state: MaliState,
  params: {
    id?: string;
    idempotencyKey?: string;
    contactId?: string;
    personName: string;
    phone?: string;
    direction: 'receivable' | 'payable';
    currency: Currency;
    totalAmount: number;
    dueDate?: string;
    accountId?: string;
    paymentMethod?: PaymentMethodType;
    notes?: string;
    createdAt?: string;
  }
): MaliState {
  if (!validMoney(params.totalAmount) || !['LYD', 'USD'].includes(params.currency) ||
    !['receivable', 'payable'].includes(params.direction)) return state;
  const cleanAmount = roundMoney(params.totalAmount);
  const cleanPerson = (params.personName || '').trim();
  if (cleanAmount <= 0 || !cleanPerson) return state;

  if (
    params.idempotencyKey &&
    state.debts.some((d) => d.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  if (params.id && state.debts.some((d) => d.id === params.id)) return state;
  const account = params.accountId ? state.accounts.find((a) => a.id === params.accountId) : undefined;
  if (params.accountId && (!account || account.currency !== params.currency)) return state;
  if (params.accountId && account && params.direction === 'receivable') {
    const disburse = canDisburseFromAccount(account, cleanAmount);
    if (!disburse.allowed) return state;
  }

  const debtId = params.id || generateId('debt');
  const now = new Date().toISOString();
  const initialTxId = params.accountId ? generateId('tx-debt-init') : undefined;

  const newDebt: DebtRecord = {
    id: debtId,
    idempotencyKey: params.idempotencyKey,
    contactId: params.contactId,
    personName: cleanPerson,
    phone: params.phone,
    direction: params.direction,
    currency: params.currency,
    totalAmount: cleanAmount,
    paidAmount: 0,
    remainingAmount: cleanAmount,
    accountId: params.accountId,
    initialPaymentMethod: params.paymentMethod || 'cash',
    initialTransactionId: initialTxId,
    dueDate: params.dueDate,
    status: 'active',
    installments: [],
    createdAt: params.createdAt || now,
    updatedAt: now,
    notes: params.notes,
  };

  let updatedAccounts = state.accounts;
  let updatedTransactions = state.transactions;

  if (params.accountId && initialTxId) {
    const isMoneyOut = params.direction === 'receivable';
    const tx: Transaction = {
      id: initialTxId,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:init` : undefined,
      title: isMoneyOut
        ? `إقراض / دين لي عند: ${cleanPerson}`
        : `استلام أمانة / دين عليّ لـ: ${cleanPerson}`,
      type: isMoneyOut ? 'expense' : 'income',
      amount: cleanAmount,
      currency: params.currency,
      category: 'ديون وأمانات',
      accountId: params.accountId,
      paymentMethod: params.paymentMethod || 'cash',
      debtId,
      contactId: params.contactId,
      date: newDebt.createdAt,
      updatedAt: now,
      notes: params.notes,
    };

    updatedTransactions = [tx, ...state.transactions];
    const accounts = applyAccountDeltas(state, [
      [params.accountId, isMoneyOut ? -cleanAmount : cleanAmount],
    ], now);
    if (!accounts) return state;
    updatedAccounts = accounts;
  }

  return touchState({
    ...state,
    accounts: updatedAccounts,
    debts: [newDebt, ...state.debts],
    transactions: updatedTransactions,
  });
}

export function settleDebtInstallmentMutation(
  state: MaliState,
  params: {
    installmentId?: string;
    idempotencyKey?: string;
    debtId: string;
    amount: number;
    accountId?: string;
    paymentMethod?: PaymentMethodType;
    settlementType?: DebtSettlementType;
    isNonCash?: boolean;
    nonCashReason?: string;
    notes?: string;
    date?: string;
  }
): MaliState {
  const debt = state.debts.find((d) => d.id === params.debtId);
  if (!debt) return state;
  if (!validMoney(params.amount)) return state;

  const reqAmount = roundMoney(params.amount);
  if (reqAmount <= 0 || debt.remainingAmount <= 0) return state;

  if (
    params.idempotencyKey &&
    state.debts.some((d) => d.installments.some((i) => i.idempotencyKey === params.idempotencyKey))
  ) {
    return state;
  }

  if (params.installmentId && state.debts.some((d) =>
    d.installments.some((i) => i.id === params.installmentId))) return state;

  if (reqAmount > debt.remainingAmount) return state;
  const effectiveAmount = reqAmount;
  if (effectiveAmount <= 0) return state;

  const isNonCash = params.settlementType === 'non_cash' || params.isNonCash === true;
  let nonCashReason: string | undefined = undefined;
  let targetAcc: Account | undefined = undefined;

  if (isNonCash) {
    // التسوية غير النقدية تتطلب سبباً صريحاً، ولا تؤثر على أي خزينة (إصلاح DEBT-ACC-01)
    nonCashReason = (params.nonCashReason || params.notes || '').trim();
    if (!nonCashReason) return state;
  } else {
    // القسط النقدي يتطلب إلزامياً تحديد خزينة بنفس العملة ولا يصح افتراض التسوية تلقائياً
    if (!params.accountId) return state;
    targetAcc = state.accounts.find((a) => a.id === params.accountId);
    if (!targetAcc || targetAcc.currency !== debt.currency) return state;

    // عند سداد التزام (payable) يخرج مال من الخزينة، فيجب التحقق من كفاية الرصيد أو السحب على المكشوف المصرح به
    if (debt.direction === 'payable') {
      const disburse = canDisburseFromAccount(targetAcc, effectiveAmount);
      if (!disburse.allowed) return state;
    }
  }

  const now = new Date().toISOString();
  const instId = params.installmentId || generateId('inst');
  const txId = (!isNonCash && params.accountId) ? generateId('tx-dsettle') : undefined;

  const installment: DebtInstallment = {
    id: instId,
    idempotencyKey: params.idempotencyKey,
    amount: effectiveAmount,
    date: params.date || now,
    accountId: isNonCash ? undefined : params.accountId,
    paymentMethod: isNonCash ? 'cash' : (params.paymentMethod || (targetAcc?.isCash ? 'cash' : 'transfer')),
    settlementType: isNonCash ? 'non_cash' : 'cash',
    isNonCash: isNonCash || false,
    nonCashReason,
    transactionId: txId,
    notes: params.notes,
  };

  const newPaid = moneySum(debt.paidAmount, effectiveAmount);
  const newRemaining = moneySum(debt.totalAmount, -newPaid);
  if (!validMoney(newPaid) || !validMoney(newRemaining)) return state;
  const newStatus: DebtRecord['status'] = newRemaining <= 0.005 ? 'completed' : 'active';

  const updatedDebt: DebtRecord = {
    ...debt,
    paidAmount: newPaid,
    remainingAmount: newRemaining,
    status: newStatus,
    installments: [installment, ...debt.installments],
    updatedAt: now,
  };

  if (isNonCash) {
    return touchState({
      ...state,
      debts: state.debts.map((d) => (d.id === debt.id ? updatedDebt : d)),
    });
  }

  const isMoneyIn = debt.direction === 'receivable';
  const tx: Transaction = {
    id: txId || '',
    idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:tx` : undefined,
    title: isMoneyIn
      ? `تحصيل دفعة دين من: ${debt.personName}`
      : `سداد دفعة دين/أمانة إلى: ${debt.personName}`,
    type: 'debt_settlement',
    amount: effectiveAmount,
    currency: debt.currency,
    category: isMoneyIn ? 'تحصيل ديون' : 'سداد التزامات',
    accountId: params.accountId!,
    paymentMethod: params.paymentMethod || (targetAcc?.isCash ? 'cash' : 'transfer'),
    debtId: debt.id,
    installmentId: instId,
    contactId: debt.contactId,
    date: installment.date,
    updatedAt: now,
    notes: params.notes,
  };

  const updatedAccounts = applyAccountDeltas(state, [
    [params.accountId!, isMoneyIn ? effectiveAmount : -effectiveAmount],
  ], now);
  if (!updatedAccounts) return state;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    debts: state.debts.map((d) => (d.id === debt.id ? updatedDebt : d)),
    transactions: [tx, ...state.transactions],
  });
}

/**
 * حذف قسط دين ذرياً وعكس الأثر المالي على الخزينة المرتبطة إن وجد (إصلاح DEBT-ACC-01)
 */
export function deleteDebtInstallmentMutation(
  state: MaliState,
  debtId: string,
  installmentId: string
): MaliState {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return state;

  const installment = debt.installments.find((i) => i.id === installmentId);
  if (!installment) return state;

  const instAmount = installment.amount;
  if (!validMoney(instAmount) || instAmount <= 0) return state;

  const remainingInstallments = debt.installments.filter((i) => i.id !== installmentId);
  const newPaid = moneySum(...remainingInstallments.map((i) => i.amount));
  const newRemaining = moneySum(debt.totalAmount, -newPaid);
  if (!validMoney(newPaid) || !validMoney(newRemaining) || newRemaining < 0) return state;

  const now = new Date().toISOString();
  const newStatus: DebtRecord['status'] = newRemaining <= 0.005 ? 'completed' : 'active';

  const updatedDebt: DebtRecord = {
    ...debt,
    paidAmount: Math.max(0, newPaid),
    remainingAmount: Math.min(debt.totalAmount, newRemaining),
    status: newStatus,
    installments: remainingInstallments,
    updatedAt: now,
  };

  // إذا كان قسط تسوية غير نقدية، لا توجد خزينة أو معاملة لعكسها
  if (installment.isNonCash || installment.settlementType === 'non_cash') {
    return touchState({
      ...state,
      debts: state.debts.map((d) => (d.id === debt.id ? updatedDebt : d)),
    });
  }

  // قسط نقدي: البحث عن المعاملة وعكس حركة الرصيد
  const isMoneyIn = debt.direction === 'receivable';
  const delta = isMoneyIn ? -instAmount : instAmount;

  const linkedTx = state.transactions.find((tx) =>
    (installment.transactionId && tx.id === installment.transactionId) ||
    tx.installmentId === installmentId
  );

  const targetAccountId = installment.accountId || linkedTx?.accountId;
  let updatedAccounts = state.accounts;

  if (targetAccountId) {
    const accounts = applyAccountDeltas(state, [[targetAccountId, delta]], now);
    if (!accounts) return state;
    updatedAccounts = accounts;
  }

  const updatedTransactions = linkedTx
    ? state.transactions.filter((tx) => tx.id !== linkedTx.id)
    : state.transactions;

  return touchState({
    ...state,
    accounts: updatedAccounts,
    debts: state.debts.map((d) => (d.id === debt.id ? updatedDebt : d)),
    transactions: updatedTransactions,
  });
}

/**
 * حذف سجل الدين مع عكس جميع الأرصدة والحركات المالية المرتبطة به ذرياً (إصلاح FIN-01)
 */
export function deleteDebtMutation(state: MaliState, debtId: string): MaliState {
  const matches = state.debts.filter((d) => d.id === debtId);
  if (matches.length !== 1) return state;
  const debt = matches[0];
  const installmentTxIds = new Set(debt.installments.map((i) => i.transactionId).filter(Boolean));
  const linked = state.transactions.filter((tx) => tx.debtId === debtId ||
    tx.id === debt.initialTransactionId || installmentTxIds.has(tx.id));
  const changes: [string, number][] = [];
  for (const tx of linked) {
    if (tx.type === 'debt_settlement') {
      changes.push([tx.accountId, debt.direction === 'receivable' ? -tx.amount : tx.amount]);
    } else if (tx.type === 'expense') {
      changes.push([tx.accountId, tx.amount]);
    } else if (tx.type === 'income') {
      changes.push([tx.accountId, -tx.amount]);
    } else {
      return state;
    }
  }
  // Legacy records without transaction IDs can still be reversed individually.
  // A declared-but-missing transaction is ambiguous; never guess and refund twice.
  if (debt.initialTransactionId && !linked.some((tx) => tx.id === debt.initialTransactionId)) return state;
  if (debt.accountId && !debt.initialTransactionId &&
    !linked.some((tx) => tx.type === 'expense' || tx.type === 'income')) {
    changes.push([debt.accountId, debt.direction === 'receivable' ? debt.totalAmount : -debt.totalAmount]);
  }
  for (const installment of debt.installments) {
    if (installment.isNonCash || installment.settlementType === 'non_cash') continue;
    if (installment.transactionId) {
      if (!linked.some((tx) => tx.id === installment.transactionId)) return state;
    } else if (installment.accountId && !linked.some((tx) => tx.installmentId === installment.id)) {
      changes.push([installment.accountId,
        debt.direction === 'receivable' ? -installment.amount : installment.amount]);
    }
  }
  const now = new Date().toISOString();
  const accounts = applyAccountDeltas(state, changes, now);
  if (!accounts) return state;
  const ids = new Set(linked.map((tx) => tx.id));
  return touchState({ ...state, accounts, debts: state.debts.filter((d) => d.id !== debtId),
    transactions: state.transactions.filter((tx) => !ids.has(tx.id)) });
}

function reverseDealSale(state: MaliState, transaction: Transaction): MaliState {
  const deal = state.deals.find((d) => d.id === transaction.dealId);
  if (!deal) return state;
  const personal = transaction.type === 'deal_personal_take';
  const matches = transaction.saleId
    ? deal.sales.filter((s) => s.id === transaction.saleId)
    : deal.sales.filter((s) => Boolean(s.isPersonalTake) === personal &&
      (personal ? s.usdAmount === transaction.amount : s.netLydReceived === transaction.amount));
  if (matches.length !== 1) return state;
  const sale = matches[0];
  if (Boolean(sale.isPersonalTake) !== personal) return state;
  const changes: [string, number][] = [];
  if (personal) {
    if (sale.targetLydAccountId && sale.targetLydAccountId !== sale.sourceUsdAccountId) {
      changes.push([sale.sourceUsdAccountId, sale.usdAmount], [sale.targetLydAccountId, -sale.usdAmount]);
    }
  } else {
    changes.push([sale.sourceUsdAccountId, sale.usdAmount], [sale.targetLydAccountId, -sale.netLydReceived]);
  }
  const now = new Date().toISOString();
  const accounts = applyAccountDeltas(state, changes, now);
  if (!accounts) return state;
  const sales = deal.sales.filter((s) => s.id !== sale.id);
  const soldUsd = moneySum(...sales.filter((s) => !s.isPersonalTake).map((s) => s.usdAmount));
  const personalTakenUsd = moneySum(...sales.filter((s) => s.isPersonalTake).map((s) => s.usdAmount));
  const remainingUsd = moneySum(deal.totalUsdBought, -soldUsd, -personalTakenUsd);
  const totalLydReceived = moneySum(...sales.filter((s) => !s.isPersonalTake).map((s) => s.netLydReceived));
  const realizedProfitLyd = moneySum(...sales.filter((s) => !s.isPersonalTake).map((s) => s.profitLyd));
  if (![soldUsd, personalTakenUsd, remainingUsd, totalLydReceived, realizedProfitLyd].every(validMoney) || remainingUsd < 0) {
    return state;
  }
  const updated: UsdDeal = { ...deal, sales, soldUsd, personalTakenUsd, remainingUsd,
    totalLydReceived, realizedProfitLyd, updatedAt: now,
    status: sales.length === 0 ? 'open' : remainingUsd === 0 ? 'closed' : 'partial' };
  return touchState({ ...state, accounts,
    deals: state.deals.map((d) => d.id === deal.id ? updated : d),
    transactions: state.transactions.filter((tx) => tx.id !== transaction.id) });
}

/** Reverse one operation together with all linked financial records. */
export function deleteTransactionMutation(state: MaliState, txId: string): MaliState {
  const matches = state.transactions.filter((tx) => tx.id === txId);
  if (matches.length !== 1) return state;
  const tx = matches[0];
  if (tx.type === 'deal_buy') return tx.dealId ? deleteUsdDealMutation(state, tx.dealId) : state;
  if (tx.type === 'deal_sell' || tx.type === 'deal_personal_take') return reverseDealSale(state, tx);
  const initialDebt = state.debts.find((d) => d.initialTransactionId === tx.id ||
    (d.id === tx.debtId && (tx.type === 'expense' || tx.type === 'income')));
  if (initialDebt) return deleteDebtMutation(state, initialDebt.id);

  const now = new Date().toISOString();
  let debts = state.debts;
  const changes: [string, number][] = [];
  if (tx.type === 'expense') changes.push([tx.accountId, tx.amount]);
  else if (tx.type === 'income') changes.push([tx.accountId, -tx.amount]);
  else if (tx.type === 'transfer') {
    changes.push([tx.accountId, moneySum(tx.amount, tx.feeAmount || 0)], [tx.targetAccountId || '', -tx.amount]);
  } else if (tx.type === 'cheque_liquidation') {
    changes.push([tx.accountId, tx.amount], [tx.targetAccountId || '', -moneySum(tx.amount, -(tx.feeAmount || 0))]);
  } else if (tx.type === 'debt_settlement') {
    const debt = state.debts.find((d) => d.id === tx.debtId);
    if (!debt) return state;
    // Exact identity must win before legacy amount/account matching.
    let installments = debt.installments.filter((i) => i.transactionId === tx.id);
    if (installments.length === 0 && tx.installmentId) installments = debt.installments.filter((i) => i.id === tx.installmentId);
    if (installments.length === 0 && !tx.installmentId) installments = debt.installments.filter((i) =>
      !i.transactionId && i.amount === tx.amount && i.accountId === tx.accountId);
    if (installments.length !== 1) return state;
    const remaining = debt.installments.filter((i) => i.id !== installments[0].id);
    const paidAmount = moneySum(...remaining.map((i) => i.amount));
    const remainingAmount = moneySum(debt.totalAmount, -paidAmount);
    if (!validMoney(paidAmount) || !validMoney(remainingAmount) || remainingAmount < 0) return state;
    debts = state.debts.map((d) => d.id === debt.id ? { ...d, installments: remaining,
      paidAmount, remainingAmount, status: remainingAmount === 0 ? 'completed' : 'active', updatedAt: now } : d);
    changes.push([tx.accountId, debt.direction === 'receivable' ? -tx.amount : tx.amount]);
  } else return state;
  const accounts = applyAccountDeltas(state, changes, now);
  if (!accounts) return state;
  return touchState({ ...state, accounts, debts, transactions: state.transactions.filter((t) => t.id !== txId) });
}

/**
 * 6. مطابقة أرصدة لوحة المعلومات مع السجلات الفعلية بدقة عشرية
 */
export interface DashboardSummary {
  totalCashLyd: number;
  totalBankLyd: number;
  totalLyd: number;
  totalCashUsd: number;
  totalBankUsd: number;
  totalUsd: number;
  netWorthEstimatedLyd: number;
  totalRealizedProfitLyd: number;
  totalOpenDealsUsd: number;
  totalPersonalTakenUsd: number;
  totalReceivableLyd: number;
  totalPayableLyd: number;
  totalReceivableUsd: number;
  totalPayableUsd: number;
  currentMonthExpensesLyd: number;
  currentMonthChequeFeesLyd: number;
}

export function reconcileDashboardSummary(
  state: MaliState,
  referenceDate: Date = new Date()
): DashboardSummary {
  let totalCashLyd = 0;
  let totalBankLyd = 0;
  let totalCashUsd = 0;
  let totalBankUsd = 0;

  for (const acc of state.accounts) {
    const bal = roundMoney(acc.balance);
    if (acc.currency === 'LYD') {
      if (acc.isCash) totalCashLyd = summarySum(totalCashLyd, bal);
      else totalBankLyd = summarySum(totalBankLyd, bal);
    } else {
      if (acc.isCash) totalCashUsd = summarySum(totalCashUsd, bal);
      else totalBankUsd = summarySum(totalBankUsd, bal);
    }
  }

  const totalLyd = summarySum(totalCashLyd, totalBankLyd);
  const totalUsd = summarySum(totalCashUsd, totalBankUsd);
  const cashRate = roundRate(state.marketRates?.cashUsdToLyd || 0);
  const netWorthEstimatedLyd = summarySum(totalLyd, moneyRatio(totalUsd, cashRate, 1, MAX_SUMMARY_AMOUNT));

  let totalRealizedProfitLyd = 0;
  let totalOpenDealsUsd = 0;
  let totalPersonalTakenUsd = 0;

  for (const d of state.deals) {
    totalRealizedProfitLyd = summarySum(totalRealizedProfitLyd, d.realizedProfitLyd);
    totalOpenDealsUsd = summarySum(totalOpenDealsUsd, d.remainingUsd);
    totalPersonalTakenUsd = summarySum(totalPersonalTakenUsd, d.personalTakenUsd);
  }

  let totalReceivableLyd = 0;
  let totalPayableLyd = 0;
  let totalReceivableUsd = 0;
  let totalPayableUsd = 0;

  for (const d of state.debts) {
    if (d.status !== 'active') continue;
    const rem = roundMoney(d.remainingAmount);
    if (d.direction === 'receivable' && d.currency === 'LYD') {
      totalReceivableLyd = summarySum(totalReceivableLyd, rem);
    } else if (d.direction === 'payable' && d.currency === 'LYD') {
      totalPayableLyd = summarySum(totalPayableLyd, rem);
    } else if (d.direction === 'receivable' && d.currency === 'USD') {
      totalReceivableUsd = summarySum(totalReceivableUsd, rem);
    } else if (d.direction === 'payable' && d.currency === 'USD') {
      totalPayableUsd = summarySum(totalPayableUsd, rem);
    }
  }

  const currentMonthPrefix = financialDate(referenceDate).slice(0, 7);
  let currentMonthExpensesLyd = 0;
  let currentMonthChequeFeesLyd = 0;

  for (const tx of state.transactions) {
    if (!tx.date || !tx.date.startsWith(currentMonthPrefix)) continue;
    if (tx.type === 'expense' && tx.currency === 'LYD' && !isDebtTransaction(tx)) {
      currentMonthExpensesLyd = summarySum(currentMonthExpensesLyd, tx.amount);
    }
    if (tx.type === 'cheque_liquidation' && tx.feeAmount) {
      currentMonthChequeFeesLyd = summarySum(currentMonthChequeFeesLyd, tx.feeAmount);
    }
  }

  return {
    totalCashLyd,
    totalBankLyd,
    totalLyd,
    totalCashUsd,
    totalBankUsd,
    totalUsd,
    netWorthEstimatedLyd,
    totalRealizedProfitLyd,
    totalOpenDealsUsd,
    totalPersonalTakenUsd,
    totalReceivableLyd,
    totalPayableLyd,
    totalReceivableUsd,
    totalPayableUsd,
    currentMonthExpensesLyd,
    currentMonthChequeFeesLyd,
  };
}

type BackupRecord = Record<string, unknown>;

function validateFinancialBackup(parsed: BackupRecord): void {
  const requireRecords = (value: unknown, name: string): BackupRecord[] => {
    if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error(`جدول ${name} غير صالح.`);
    }
    const records = value as BackupRecord[];
    const ids = records.map((item) => item.id);
    if (ids.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
      throw new Error(`معرفات ${name} مفقودة أو مكررة.`);
    }
    const keys = records.map((item) => item.idempotencyKey).filter((key) => key !== undefined);
    if (keys.some((key) => typeof key !== 'string' || !key.trim()) || new Set(keys).size !== keys.length) {
      throw new Error(`مفاتيح عمليات ${name} مكررة أو غير صالحة.`);
    }
    return records;
  };
  const amount = (record: BackupRecord, key: string, signed = false): number => {
    const value = record[key];
    if (typeof value !== 'number' || !validMoney(value) || (!signed && value < 0)) {
      throw new Error(`القيمة المالية ${key} غير صالحة.`);
    }
    return roundMoney(value);
  };
  const currency = (record: BackupRecord): Currency => {
    if (record.currency !== 'LYD' && record.currency !== 'USD') throw new Error('عملة غير صالحة.');
    return record.currency;
  };
  const accounts = requireRecords(parsed.accounts, 'الحسابات');
  for (const account of accounts) {
    currency(account);
    if (typeof account.name !== 'string' || !account.name.trim() || typeof account.isCash !== 'boolean') {
      throw new Error('بيانات حساب غير صالحة.');
    }
    amount(account, 'balance', !account.isCash);
  }
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const contacts = requireRecords(parsed.contacts ?? [], 'المتعاملين');
  if (contacts.some(contact => typeof contact.name !== 'string' || !contact.name.trim())) throw new Error('بيانات متعامل غير صالحة.');
  const contactIds = new Set(contacts.map(contact => contact.id));
  const contactRef = (id: unknown) => {
    if (id !== undefined && (typeof id !== 'string' || !contactIds.has(id))) throw new Error('مرجع متعامل مفقود.');
  };
  const accountRef = (id: unknown, expected?: Currency): BackupRecord => {
    const account = accountById.get(id);
    if (typeof id !== 'string' || !account || (expected && account.currency !== expected)) {
      throw new Error('مرجع حساب مفقود أو بعملة مختلفة.');
    }
    return account;
  };
  const transactions = requireRecords(parsed.transactions, 'الحركات');
  const transactionById = new Map(transactions.map((tx) => [tx.id, tx]));
  const deals = requireRecords(parsed.deals ?? [], 'الصفقات');
  const debts = requireRecords(parsed.debts ?? [], 'الديون');
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const debtById = new Map(debts.map((d) => [d.id, d]));
  const saleIds = new Set<unknown>();
  const installmentIds = new Set<unknown>();
  const paymentMethods = ['cash', 'cheque', 'transfer', 'card'];
  const transactionTypes = ['expense', 'income', 'transfer', 'cheque_liquidation',
    'deal_buy', 'deal_sell', 'deal_personal_take', 'debt_settlement'];
  for (const tx of transactions) {
    contactRef(tx.contactId);
    if (!transactionTypes.includes(String(tx.type)) || !paymentMethods.includes(String(tx.paymentMethod)) ||
      typeof tx.title !== 'string' || typeof tx.category !== 'string' ||
      typeof tx.date !== 'string' || !Number.isFinite(Date.parse(tx.date))) {
      throw new Error('بيانات حركة غير صالحة.');
    }
    amount(tx, 'amount');
    if (tx.feeAmount !== undefined) amount(tx, 'feeAmount');
    const txCurrency = currency(tx);
    accountRef(tx.accountId, txCurrency);
    if (tx.targetAccountId) accountRef(tx.targetAccountId);
    if (tx.type === 'transfer') accountRef(tx.targetAccountId, txCurrency);
    if (tx.type === 'cheque_liquidation') {
      if (txCurrency !== 'LYD') throw new Error('عملة تسييل الصك غير صالحة.');
      accountRef(tx.targetAccountId, 'LYD');
      if (Number(tx.feeAmount || 0) > Number(tx.amount)) throw new Error('خصم الصك يتجاوز قيمته.');
    }
    if (tx.dealId && !dealById.has(tx.dealId)) throw new Error('مرجع صفقة مفقود.');
    if (tx.debtId && !debtById.has(tx.debtId)) throw new Error('مرجع دين مفقود.');
  }
  for (const deal of deals) {
    contactRef(deal.contactId);
    accountRef(deal.sourceLydAccountId, 'LYD');
    accountRef(deal.usdHoldingAccountId, 'USD');
    const totalUsd = amount(deal, 'totalUsdBought');
    const totalCost = amount(deal, 'totalLydCost');
    if (totalUsd <= 0 || typeof deal.buyRate !== 'number' || roundRate(deal.buyRate) <= 0 ||
      typeof deal.effectiveBuyRate !== 'number' || roundRate(deal.effectiveBuyRate) <= 0) {
      throw new Error('قيمة شراء الصفقة أو سعرها غير صالح.');
    }
    const commission = amount(deal, 'buyCommissionLyd');
    if (amount(deal, 'grossLydCost') !== moneyRatio(totalUsd, roundRate(deal.buyRate)) ||
      totalCost !== moneySum(amount(deal, 'grossLydCost'), commission)) {
      throw new Error('تكلفة شراء الصفقة غير متطابقة.');
    }
    const sales = requireRecords(deal.sales, 'مبيعات الصفقة');
    for (const sale of sales) {
      contactRef(sale.contactId);
      if (saleIds.has(sale.id) || sale.dealId !== deal.id ||
        (sale.isPersonalTake !== undefined && typeof sale.isPersonalTake !== 'boolean')) {
        throw new Error('مرجع بيع مكرر أو غير صالح.');
      }
      saleIds.add(sale.id);
      accountRef(sale.sourceUsdAccountId, 'USD');
      amount(sale, 'usdAmount');
      amount(sale, 'costBasisLyd');
      if (sale.isPersonalTake) {
        if (sale.targetLydAccountId) accountRef(sale.targetLydAccountId, 'USD');
        if (amount(sale, 'netLydReceived') !== 0 || amount(sale, 'profitLyd', true) !== 0) {
          throw new Error('السحب الشخصي لا ينتج إيراداً أو ربحاً.');
        }
      } else {
        accountRef(sale.targetLydAccountId, 'LYD');
        if (typeof sale.sellRate !== 'number' || roundRate(sale.sellRate) <= 0) throw new Error('سعر بيع غير صالح.');
        const gross = amount(sale, 'grossLyd');
        const fees = amount(sale, 'commissionLyd');
        const net = amount(sale, 'netLydReceived');
        if (gross !== moneyRatio(amount(sale, 'usdAmount'), roundRate(sale.sellRate)) ||
          net !== moneySum(gross, -fees) || amount(sale, 'profitLyd', true) !== moneySum(net, -amount(sale, 'costBasisLyd'))) {
          throw new Error('قيم البيع والربح غير متطابقة.');
        }
      }
    }
    const sold = moneySum(...sales.filter((sale) => !sale.isPersonalTake).map((sale) => amount(sale, 'usdAmount')));
    const personal = moneySum(...sales.filter((sale) => sale.isPersonalTake).map((sale) => amount(sale, 'usdAmount')));
    const remaining = moneySum(totalUsd, -sold, -personal);
    const received = moneySum(...sales.map((sale) => amount(sale, 'netLydReceived')));
    const profit = moneySum(...sales.map((sale) => amount(sale, 'profitLyd', true)));
    const cost = moneySum(...sales.map((sale) => amount(sale, 'costBasisLyd')));
    if (remaining < 0 || amount(deal, 'soldUsd') !== sold || amount(deal, 'personalTakenUsd') !== personal ||
      amount(deal, 'remainingUsd') !== remaining || amount(deal, 'totalLydReceived') !== received ||
      amount(deal, 'realizedProfitLyd', true) !== profit || cost > totalCost ||
      (remaining === 0 && cost !== totalCost) ||
      !['open', 'partial', 'closed'].includes(String(deal.status)) || (remaining === 0) !== (deal.status === 'closed')) {
      throw new Error('إجماليات الصفقة غير متطابقة مع مبيعاتها.');
    }
  }
  for (const debt of debts) {
    contactRef(debt.contactId);
    const debtCurrency = currency(debt);
    if (!['receivable', 'payable'].includes(String(debt.direction))) throw new Error('اتجاه دين غير صالح.');
    if (debt.accountId) accountRef(debt.accountId, debtCurrency);
    if (debt.initialTransactionId) {
      const initial = transactionById.get(debt.initialTransactionId);
      if (!initial || initial.debtId !== debt.id || initial.accountId !== debt.accountId ||
        initial.amount !== debt.totalAmount || initial.type !== (debt.direction === 'receivable' ? 'expense' : 'income')) {
        throw new Error('حركة إنشاء الدين مفقودة أو غير متطابقة.');
      }
    }
    const installments = requireRecords(debt.installments, 'دفعات الدين');
    for (const installment of installments) {
      if (installmentIds.has(installment.id)) throw new Error('معرف دفعة مكرر.');
      installmentIds.add(installment.id);
      amount(installment, 'amount');
      if (installment.accountId) accountRef(installment.accountId, debtCurrency);
      if (installment.transactionId) {
        const tx = transactionById.get(installment.transactionId);
        if (!tx || tx.debtId !== debt.id || tx.type !== 'debt_settlement' ||
          tx.accountId !== installment.accountId || tx.amount !== installment.amount ||
          (tx.installmentId && tx.installmentId !== installment.id)) {
          throw new Error('حركة دفعة مفقودة أو غير متطابقة.');
        }
      }
    }
    const total = amount(debt, 'totalAmount');
    const paid = moneySum(...installments.map((i) => amount(i, 'amount')));
    const remaining = moneySum(total, -paid);
    if (total <= 0 || remaining < 0 || amount(debt, 'paidAmount') !== paid ||
      amount(debt, 'remainingAmount') !== remaining ||
      debt.status !== (remaining === 0 ? 'completed' : 'active')) {
      throw new Error('إجماليات الدين غير متطابقة مع دفعاته.');
    }
  }
  for (const tx of transactions) {
    if (tx.saleId && !saleIds.has(tx.saleId)) throw new Error('مرجع بيع مفقود.');
    if (tx.installmentId && !installmentIds.has(tx.installmentId)) throw new Error('مرجع دفعة مفقود.');
  }
  if (parsed.marketRates !== undefined) {
    if (!parsed.marketRates || typeof parsed.marketRates !== 'object') throw new Error('أسعار الصرف غير صالحة.');
    const rates = parsed.marketRates as BackupRecord;
    for (const key of ['cashUsdToLyd', 'chequeUsdToLyd']) {
      const rate = rates[key];
      if (typeof rate !== 'number' || roundRate(rate) <= 0) throw new Error('سعر صرف غير صالح.');
    }
    const discount = rates.defaultChequeDiscountPercent;
    if (typeof discount !== 'number' || !Number.isFinite(discount) || discount < 0 || discount >= 100) {
      throw new Error('نسبة خصم الصك غير صالحة.');
    }
  }
}

/**
 * 7. التحقق الصارم من سلامة وصحة ملفات النسخ الاحتياطي (JSON Import Validation)
 */
export function validateAndSanitizeBackupPayload(
  rawJson: string,
  fallbackState: MaliState
): { valid: boolean; state?: MaliState; error?: string } {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'ملف النسخة الاحتياطية غير صالح (ليس كائن JSON).' };
    }
    if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
      return {
        valid: false,
        error: 'ملف النسخة الاحتياطية يفتقد إلى جداول الحسابات أو الحركات الأساسية.',
      };
    }

    validateFinancialBackup(parsed);

    const sanitizedAccounts: Account[] = parsed.accounts
      .filter((a: any) => a && typeof a.id === 'string' && typeof a.name === 'string')
      .map((a: any) => ({
        ...a,
        currency: a.currency === 'USD' ? 'USD' : 'LYD',
        balance: roundMoney(Number(a.balance) || 0),
        isCash: Boolean(a.isCash),
        updatedAt: a.updatedAt || new Date().toISOString(),
      }));

    const sanitizedContacts: ContactPerson[] = Array.isArray(parsed.contacts)
      ? parsed.contacts.filter((c: any) => c && typeof c.id === 'string' && typeof c.name === 'string')
      : fallbackState.contacts;

    const sanitizedTransactions: Transaction[] = parsed.transactions
      .filter((t: any) => t && typeof t.id === 'string' && typeof t.type === 'string')
      .map((t: any) => ({
        ...t,
        amount: roundMoney(Math.max(0, Number(t.amount) || 0)),
        currency: t.currency === 'USD' ? 'USD' : 'LYD',
        feeAmount: t.feeAmount !== undefined ? roundMoney(Number(t.feeAmount) || 0) : undefined,
        date: t.date || new Date().toISOString(),
      }));

    const sanitizedDeals: UsdDeal[] = Array.isArray(parsed.deals)
      ? parsed.deals
          .filter((d: any) => d && typeof d.id === 'string')
          .map((d: any) => ({
            ...d,
            totalUsdBought: roundMoney(Number(d.totalUsdBought) || 0),
            buyRate: roundRate(Number(d.buyRate) || 0),
            totalLydCost: roundMoney(Number(d.totalLydCost) || 0),
            effectiveBuyRate: roundRate(Number(d.effectiveBuyRate) || Number(d.buyRate) || 0),
            soldUsd: roundMoney(Number(d.soldUsd) || 0),
            personalTakenUsd: roundMoney(Number(d.personalTakenUsd) || 0),
            remainingUsd: roundMoney(Number(d.remainingUsd) || 0),
            totalLydReceived: roundMoney(Number(d.totalLydReceived) || 0),
            realizedProfitLyd: roundMoney(Number(d.realizedProfitLyd) || 0),
            sales: Array.isArray(d.sales) ? d.sales : [],
          }))
      : [];

    const sanitizedDebts: DebtRecord[] = Array.isArray(parsed.debts)
      ? parsed.debts
          .filter((d: any) => d && typeof d.id === 'string')
          .map((d: any) => ({
            ...d,
            totalAmount: roundMoney(Number(d.totalAmount) || 0),
            paidAmount: roundMoney(Number(d.paidAmount) || 0),
            remainingAmount: roundMoney(Number(d.remainingAmount) || 0),
            installments: Array.isArray(d.installments) ? d.installments : [],
          }))
      : [];

    const restoredState: MaliState = {
      accounts: sanitizedAccounts,
      contacts: sanitizedContacts,
      transactions: sanitizedTransactions,
      deals: sanitizedDeals,
      debts: sanitizedDebts,
      procedures: Array.isArray(parsed.procedures) ? parsed.procedures : fallbackState.procedures,
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : fallbackState.budgets,
      marketRates:
        parsed.marketRates && typeof parsed.marketRates === 'object'
          ? {
              ...parsed.marketRates,
              cashUsdToLyd: roundRate(
                Number(parsed.marketRates.cashUsdToLyd) || fallbackState.marketRates.cashUsdToLyd
              ),
              chequeUsdToLyd: roundRate(
                Number(parsed.marketRates.chequeUsdToLyd) || fallbackState.marketRates.chequeUsdToLyd
              ),
              defaultChequeDiscountPercent: Number(
                parsed.marketRates.defaultChequeDiscountPercent ??
                  fallbackState.marketRates.defaultChequeDiscountPercent
              ),
              updatedAt: parsed.marketRates.updatedAt || new Date().toISOString(),
            }
          : fallbackState.marketRates,
      supabaseConfig: fallbackState.supabaseConfig,
      lastModifiedAt: parsed.lastModifiedAt || new Date().toISOString(),
    };

    if (parsed.financialAudit !== undefined) restoredState.financialAudit = validateFinancialAudit(parsed.financialAudit, restoredState);
    return { valid: true, state: restoredState };
  } catch (e: any) {
    return {
      valid: false,
      error: `تعذر قراءة ملف النسخة الاحتياطية: ${e?.message || 'صيغة JSON غير صالحة'}`,
    };
  }
}
