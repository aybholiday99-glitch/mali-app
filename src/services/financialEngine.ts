import type {
  Account,
  ContactPerson,
  Currency,
  DealSale,
  DebtInstallment,
  DebtRecord,
  MaliState,
  PaymentMethodType,
  Transaction,
  UsdDeal,
} from '../types/mali';

/**
 * تقريب مالي صارم إلى منزلتين عشريتين لتجنب أخطاء الفاصلة العائمة (IEEE-754)
 */
export function roundMoney(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * تقريب أسعار الصرف إلى 4 منازل عشرية بدقة
 */
export function roundRate(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 10000) / 10000;
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
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
  if (!Number.isFinite(Number(account.balance))) return state;

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
  if (!Number.isFinite(Number(newBalance))) return state;
  const now = new Date().toISOString();
  return touchState({
    ...state,
    accounts: state.accounts.map((a) =>
      a.id === accountId ? { ...a, balance: roundMoney(newBalance), updatedAt: now } : a
    ),
  });
}

export function deleteAccountMutation(state: MaliState, accountId: string): MaliState {
  // منع حذف حساب مرتبط بصفقات دولار مفتوحة لتجنب اختلال الأرصدة عند استرداد أو بيع الصفقة
  const hasOpenDeal = state.deals.some(
    (d) =>
      d.status !== 'closed' &&
      (d.sourceLydAccountId === accountId || d.usdHoldingAccountId === accountId)
  );
  if (hasOpenDeal) {
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
  if (!targetAcc) return state;

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

  const updatedAccounts = state.accounts.map((acc) => {
    if (acc.id !== params.accountId) return acc;
    const delta = params.type === 'income' ? cleanAmount : -cleanAmount;
    return {
      ...acc,
      balance: roundMoney(acc.balance + delta),
      updatedAt: now,
    };
  });

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

  const cleanAmount = roundMoney(params.amount);
  const fee = roundMoney(Math.max(0, params.feeAmount || 0));
  if (cleanAmount <= 0) return state;

  if (
    params.idempotencyKey &&
    state.transactions.some((tx) => tx.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

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

  const updatedAccounts = state.accounts.map((acc) => {
    if (acc.id === params.fromAccountId) {
      return {
        ...acc,
        balance: roundMoney(acc.balance - cleanAmount - fee),
        updatedAt: now,
      };
    }
    if (acc.id === params.toAccountId) {
      return {
        ...acc,
        balance: roundMoney(acc.balance + cleanAmount),
        updatedAt: now,
      };
    }
    return acc;
  });

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

  const gross = roundMoney(params.grossChequeAmountLyd);
  const pct = Number(params.discountPercent);
  if (gross <= 0 || !Number.isFinite(pct) || pct < 0 || pct >= 100) return state;

  if (
    params.idempotencyKey &&
    state.transactions.some((tx) => tx.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  const fromAcc = state.accounts.find((a) => a.id === params.fromBankAccountId);
  const toAcc = state.accounts.find((a) => a.id === params.toCashAccountId);
  if (!fromAcc || !toAcc) return state;

  const feeAmount = roundMoney(gross * (pct / 100));
  const netCashReceived = roundMoney(gross - feeAmount);
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

  const updatedAccounts = state.accounts.map((acc) => {
    if (acc.id === params.fromBankAccountId) {
      return {
        ...acc,
        balance: roundMoney(acc.balance - gross),
        updatedAt: now,
      };
    }
    if (acc.id === params.toCashAccountId) {
      return {
        ...acc,
        balance: roundMoney(acc.balance + netCashReceived),
        updatedAt: now,
      };
    }
    return acc;
  });

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
  const usdBought = roundMoney(params.totalUsdBought);
  const rate = roundRate(params.buyRate);
  const commission = roundMoney(Math.max(0, params.buyCommissionLyd || 0));

  if (usdBought <= 0 || rate <= 0) return state;

  if (
    params.idempotencyKey &&
    state.deals.some((d) => d.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  const lydAcc = state.accounts.find((a) => a.id === params.sourceLydAccountId);
  const usdAcc = state.accounts.find((a) => a.id === params.usdHoldingAccountId);
  if (!lydAcc || !usdAcc) return state;
  if (lydAcc.currency !== 'LYD' || usdAcc.currency !== 'USD') return state;

  const grossLydCost = roundMoney(usdBought * rate);
  const totalLydCost = roundMoney(grossLydCost + commission);
  const effectiveBuyRate = roundRate(totalLydCost / usdBought);

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

  const updatedAccounts = state.accounts.map((acc) => {
    if (acc.id === params.sourceLydAccountId) {
      return {
        ...acc,
        balance: roundMoney(acc.balance - totalLydCost),
        updatedAt: now,
      };
    }
    if (acc.id === params.usdHoldingAccountId) {
      return {
        ...acc,
        balance: roundMoney(acc.balance + usdBought),
        updatedAt: now,
      };
    }
    return acc;
  });

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

  const reqUsd = roundMoney(params.usdAmount);
  const rate = roundRate(params.sellRate);
  const commission = roundMoney(Math.max(0, params.commissionLyd || 0));

  if (reqUsd <= 0 || rate <= 0) return state;
  // منع بيع كمية أكبر من المتبقي في الصفقة (مع هامش دقة 0.005)
  if (reqUsd > deal.remainingUsd + 0.005) return state;

  const usdToSell = roundMoney(Math.min(reqUsd, deal.remainingUsd));
  if (usdToSell <= 0) return state;

  if (
    params.idempotencyKey &&
    deal.sales.some((s) => s.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  const targetLydAcc = state.accounts.find((a) => a.id === params.targetLydAccountId);
  const sourceUsdAcc = state.accounts.find((a) => a.id === params.sourceUsdAccountId);
  if (!targetLydAcc || !sourceUsdAcc) return state;

  const grossLyd = roundMoney(usdToSell * rate);
  const netLydReceived = roundMoney(grossLyd - commission);
  const costBasisLyd = roundMoney(usdToSell * deal.effectiveBuyRate);
  const profitLyd = roundMoney(netLydReceived - costBasisLyd);

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

  const newSoldUsd = roundMoney(deal.soldUsd + usdToSell);
  const newRemainingUsd = roundMoney(
    Math.max(0, deal.totalUsdBought - newSoldUsd - deal.personalTakenUsd)
  );
  const newTotalLydReceived = roundMoney(deal.totalLydReceived + netLydReceived);
  const newRealizedProfitLyd = roundMoney(deal.realizedProfitLyd + profitLyd);
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

  const updatedAccounts = state.accounts.map((acc) => {
    if (acc.id === params.sourceUsdAccountId) {
      return {
        ...acc,
        balance: roundMoney(acc.balance - usdToSell),
        updatedAt: now,
      };
    }
    if (acc.id === params.targetLydAccountId) {
      return {
        ...acc,
        balance: roundMoney(acc.balance + netLydReceived),
        updatedAt: now,
      };
    }
    return acc;
  });

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

  const reqUsd = roundMoney(params.usdAmount);
  if (reqUsd <= 0 || reqUsd > deal.remainingUsd + 0.005) return state;

  const usdToTake = roundMoney(Math.min(reqUsd, deal.remainingUsd));
  if (usdToTake <= 0) return state;

  if (
    params.idempotencyKey &&
    deal.sales.some((s) => s.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  const costBasisLyd = roundMoney(usdToTake * deal.effectiveBuyRate);
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

  const newPersonalTaken = roundMoney(deal.personalTakenUsd + usdToTake);
  const newRemainingUsd = roundMoney(
    Math.max(0, deal.totalUsdBought - deal.soldUsd - newPersonalTaken)
  );
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

  const updatedAccounts = state.accounts.map((acc) => {
    if (
      params.targetPersonalUsdAccountId &&
      params.targetPersonalUsdAccountId !== params.sourceUsdAccountId
    ) {
      if (acc.id === params.sourceUsdAccountId) {
        return {
          ...acc,
          balance: roundMoney(acc.balance - usdToTake),
          updatedAt: now,
        };
      }
      if (acc.id === params.targetPersonalUsdAccountId) {
        return {
          ...acc,
          balance: roundMoney(acc.balance + usdToTake),
          updatedAt: now,
        };
      }
    }
    return acc;
  });

  return touchState({
    ...state,
    accounts: updatedAccounts,
    deals: state.deals.map((d) => (d.id === deal.id ? updatedDeal : d)),
    transactions: [tx, ...state.transactions],
  });
}

export function deleteUsdDealMutation(state: MaliState, dealId: string): MaliState {
  const deal = state.deals.find((d) => d.id === dealId);
  if (!deal) return state;

  const balanceChanges: Record<string, number> = {};
  const addDelta = (accId: string | undefined, delta: number) => {
    if (!accId) return;
    balanceChanges[accId] = roundMoney((balanceChanges[accId] || 0) + delta);
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
  const updatedAccounts = state.accounts.map((acc) => {
    const delta = balanceChanges[acc.id];
    if (!delta) return acc;
    return {
      ...acc,
      balance: roundMoney(acc.balance + delta),
      updatedAt: now,
    };
  });

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
  const cleanAmount = roundMoney(params.totalAmount);
  const cleanPerson = (params.personName || '').trim();
  if (cleanAmount <= 0 || !cleanPerson) return state;

  if (
    params.idempotencyKey &&
    state.debts.some((d) => d.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
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
    updatedAccounts = state.accounts.map((acc) => {
      if (acc.id !== params.accountId) return acc;
      return {
        ...acc,
        balance: roundMoney(acc.balance + (isMoneyOut ? -cleanAmount : cleanAmount)),
        updatedAt: now,
      };
    });
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
    accountId: string;
    paymentMethod: PaymentMethodType;
    notes?: string;
    date?: string;
  }
): MaliState {
  const debt = state.debts.find((d) => d.id === params.debtId);
  if (!debt) return state;

  const reqAmount = roundMoney(params.amount);
  if (reqAmount <= 0 || debt.remainingAmount <= 0) return state;

  if (
    params.idempotencyKey &&
    debt.installments.some((i) => i.idempotencyKey === params.idempotencyKey)
  ) {
    return state;
  }

  const targetAcc = state.accounts.find((a) => a.id === params.accountId);
  if (!targetAcc) return state;

  const effectiveAmount = roundMoney(Math.min(reqAmount, debt.remainingAmount));
  if (effectiveAmount <= 0) return state;

  const now = new Date().toISOString();
  const instId = params.installmentId || generateId('inst');
  const txId = generateId('tx-dsettle');

  const installment: DebtInstallment = {
    id: instId,
    idempotencyKey: params.idempotencyKey,
    amount: effectiveAmount,
    date: params.date || now,
    accountId: params.accountId,
    paymentMethod: params.paymentMethod,
    transactionId: txId,
    notes: params.notes,
  };

  const newPaid = roundMoney(debt.paidAmount + effectiveAmount);
  const newRemaining = roundMoney(Math.max(0, debt.totalAmount - newPaid));
  const newStatus: DebtRecord['status'] = newRemaining <= 0.005 ? 'completed' : 'active';

  const updatedDebt: DebtRecord = {
    ...debt,
    paidAmount: newPaid,
    remainingAmount: newRemaining,
    status: newStatus,
    installments: [installment, ...debt.installments],
    updatedAt: now,
  };

  const isMoneyIn = debt.direction === 'receivable';
  const tx: Transaction = {
    id: txId,
    idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:tx` : undefined,
    title: isMoneyIn
      ? `تحصيل دفعة دين من: ${debt.personName}`
      : `سداد دفعة دين/أمانة إلى: ${debt.personName}`,
    type: 'debt_settlement',
    amount: effectiveAmount,
    currency: debt.currency,
    category: isMoneyIn ? 'تحصيل ديون' : 'سداد التزامات',
    accountId: params.accountId,
    paymentMethod: params.paymentMethod,
    debtId: debt.id,
    installmentId: instId,
    contactId: debt.contactId,
    date: installment.date,
    updatedAt: now,
    notes: params.notes,
  };

  const updatedAccounts = state.accounts.map((acc) => {
    if (acc.id !== params.accountId) return acc;
    return {
      ...acc,
      balance: roundMoney(
        acc.balance + (isMoneyIn ? effectiveAmount : -effectiveAmount)
      ),
      updatedAt: now,
    };
  });

  return touchState({
    ...state,
    accounts: updatedAccounts,
    debts: state.debts.map((d) => (d.id === debt.id ? updatedDebt : d)),
    transactions: [tx, ...state.transactions],
  });
}

/**
 * حذف سجل الدين مع عكس جميع الأرصدة والحركات المالية المرتبطة به ذرياً (إصلاح FIN-01)
 */
export function deleteDebtMutation(state: MaliState, debtId: string): MaliState {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return state;

  const balanceChanges: Record<string, number> = {};
  const addDelta = (accId: string | undefined, delta: number) => {
    if (!accId) return;
    balanceChanges[accId] = roundMoney((balanceChanges[accId] || 0) + delta);
  };

  // 1. البحث عن جميع الحركات المالية المرتبطة بهذا الدين في سجل الحركات
  const linkedTransactions = state.transactions.filter(
    (tx) => tx.debtId === debtId || (debt.initialTransactionId && tx.id === debt.initialTransactionId)
  );

  if (linkedTransactions.length > 0) {
    // عكس أثر كل حركة مرتبطة بالدين على الحسابات
    for (const tx of linkedTransactions) {
      if (tx.type === 'debt_settlement') {
        const wasMoneyIn = debt.direction === 'receivable' || tx.category === 'تحصيل ديون';
        addDelta(tx.accountId, wasMoneyIn ? -tx.amount : tx.amount);
      } else if (tx.type === 'expense') {
        addDelta(tx.accountId, tx.amount);
      } else if (tx.type === 'income') {
        addDelta(tx.accountId, -tx.amount);
      }
    }
  } else {
    // في حال وجود دفعات مسجلة داخل سجل الدين لم يكن لها حركة منفصلة في جدول الحركات
    const isReceivable = debt.direction === 'receivable';
    for (const inst of debt.installments) {
      if (inst.accountId) {
        addDelta(inst.accountId, isReceivable ? -inst.amount : inst.amount);
      }
    }
    if (debt.accountId) {
      addDelta(debt.accountId, isReceivable ? debt.totalAmount : -debt.totalAmount);
    }
  }

  const now = new Date().toISOString();
  const updatedAccounts = state.accounts.map((acc) => {
    const delta = balanceChanges[acc.id];
    if (!delta) return acc;
    return {
      ...acc,
      balance: roundMoney(acc.balance + delta),
      updatedAt: now,
    };
  });

  const linkedTxIds = new Set(linkedTransactions.map((t) => t.id));

  return touchState({
    ...state,
    accounts: updatedAccounts,
    debts: state.debts.filter((d) => d.id !== debtId),
    transactions: state.transactions.filter(
      (tx) => tx.debtId !== debtId && !linkedTxIds.has(tx.id)
    ),
  });
}

/**
 * 5. حذف حركة مالية وعكس أثرها بدقة على الحسابات وسجل الديون (إصلاح FIN-02)
 */
export function deleteTransactionMutation(
  state: MaliState,
  txId: string
): MaliState {
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return state;

  // صفقات الدولار يتم حذفها أو تعديلها عبر deleteUsdDeal لضمان تطابق سجل المبيعات والربح المحقق
  if (
    tx.type === 'deal_buy' ||
    tx.type === 'deal_sell' ||
    tx.type === 'deal_personal_take'
  ) {
    return state;
  }

  const now = new Date().toISOString();
  let updatedDebts = state.debts;

  // إذا كانت الحركة عبارة عن دفعة سداد/تحصيل دين (debt_settlement)، نحدّث سجل الدين المرتبط فوراً
  let wasDebtMoneyIn = tx.category === 'تحصيل ديون';
  if (tx.type === 'debt_settlement' && tx.debtId) {
    const linkedDebt = state.debts.find((d) => d.id === tx.debtId);
    if (linkedDebt) {
      wasDebtMoneyIn = linkedDebt.direction === 'receivable';
      let removedMatch = false;
      const remainingInstallments = linkedDebt.installments.filter((inst) => {
        if (removedMatch) return true;
        if (
          (inst.transactionId && inst.transactionId === tx.id) ||
          (tx.installmentId && inst.id === tx.installmentId) ||
          (roundMoney(inst.amount) === roundMoney(tx.amount) &&
            inst.accountId === tx.accountId)
        ) {
          removedMatch = true;
          return false;
        }
        return true;
      });

      const recalculatedPaid = roundMoney(
        Math.max(
          0,
          removedMatch
            ? remainingInstallments.reduce((sum, i) => sum + roundMoney(i.amount), 0)
            : linkedDebt.paidAmount - tx.amount
        )
      );
      const recalculatedRemaining = roundMoney(
        Math.max(0, linkedDebt.totalAmount - recalculatedPaid)
      );

      updatedDebts = state.debts.map((d) =>
        d.id === linkedDebt.id
          ? {
              ...d,
              paidAmount: recalculatedPaid,
              remainingAmount: recalculatedRemaining,
              status: recalculatedRemaining <= 0.005 ? 'completed' : 'active',
              installments: remainingInstallments,
              updatedAt: now,
            }
          : d
      );
    }
  }

  const updatedAccounts = state.accounts.map((acc) => {
    if (tx.type === 'expense') {
      if (acc.id === tx.accountId) {
        return { ...acc, balance: roundMoney(acc.balance + tx.amount), updatedAt: now };
      }
    } else if (tx.type === 'income') {
      if (acc.id === tx.accountId) {
        return { ...acc, balance: roundMoney(acc.balance - tx.amount), updatedAt: now };
      }
    } else if (tx.type === 'debt_settlement') {
      if (acc.id === tx.accountId) {
        const delta = wasDebtMoneyIn ? -tx.amount : tx.amount;
        return { ...acc, balance: roundMoney(acc.balance + delta), updatedAt: now };
      }
    } else if (tx.type === 'transfer') {
      if (acc.id === tx.accountId) {
        return {
          ...acc,
          balance: roundMoney(acc.balance + tx.amount + (tx.feeAmount || 0)),
          updatedAt: now,
        };
      }
      if (acc.id === tx.targetAccountId) {
        return { ...acc, balance: roundMoney(acc.balance - tx.amount), updatedAt: now };
      }
    } else if (tx.type === 'cheque_liquidation') {
      const netCash = roundMoney(tx.amount - (tx.feeAmount || 0));
      if (acc.id === tx.accountId) {
        return { ...acc, balance: roundMoney(acc.balance + tx.amount), updatedAt: now };
      }
      if (acc.id === tx.targetAccountId) {
        return { ...acc, balance: roundMoney(acc.balance - netCash), updatedAt: now };
      }
    }
    return acc;
  });

  return touchState({
    ...state,
    accounts: updatedAccounts,
    debts: updatedDebts,
    transactions: state.transactions.filter((t) => t.id !== txId),
  });
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
      if (acc.isCash) totalCashLyd = roundMoney(totalCashLyd + bal);
      else totalBankLyd = roundMoney(totalBankLyd + bal);
    } else {
      if (acc.isCash) totalCashUsd = roundMoney(totalCashUsd + bal);
      else totalBankUsd = roundMoney(totalBankUsd + bal);
    }
  }

  const totalLyd = roundMoney(totalCashLyd + totalBankLyd);
  const totalUsd = roundMoney(totalCashUsd + totalBankUsd);
  const cashRate = roundRate(state.marketRates?.cashUsdToLyd || 0);
  const netWorthEstimatedLyd = roundMoney(totalLyd + roundMoney(totalUsd * cashRate));

  let totalRealizedProfitLyd = 0;
  let totalOpenDealsUsd = 0;
  let totalPersonalTakenUsd = 0;

  for (const d of state.deals) {
    totalRealizedProfitLyd = roundMoney(totalRealizedProfitLyd + roundMoney(d.realizedProfitLyd));
    totalOpenDealsUsd = roundMoney(totalOpenDealsUsd + roundMoney(d.remainingUsd));
    totalPersonalTakenUsd = roundMoney(totalPersonalTakenUsd + roundMoney(d.personalTakenUsd));
  }

  let totalReceivableLyd = 0;
  let totalPayableLyd = 0;
  let totalReceivableUsd = 0;
  let totalPayableUsd = 0;

  for (const d of state.debts) {
    if (d.status !== 'active') continue;
    const rem = roundMoney(d.remainingAmount);
    if (d.direction === 'receivable' && d.currency === 'LYD') {
      totalReceivableLyd = roundMoney(totalReceivableLyd + rem);
    } else if (d.direction === 'payable' && d.currency === 'LYD') {
      totalPayableLyd = roundMoney(totalPayableLyd + rem);
    } else if (d.direction === 'receivable' && d.currency === 'USD') {
      totalReceivableUsd = roundMoney(totalReceivableUsd + rem);
    } else if (d.direction === 'payable' && d.currency === 'USD') {
      totalPayableUsd = roundMoney(totalPayableUsd + rem);
    }
  }

  const currentMonthPrefix = referenceDate.toISOString().slice(0, 7);
  let currentMonthExpensesLyd = 0;
  let currentMonthChequeFeesLyd = 0;

  for (const tx of state.transactions) {
    if (!tx.date || !tx.date.startsWith(currentMonthPrefix)) continue;
    if (tx.type === 'expense' && tx.currency === 'LYD') {
      currentMonthExpensesLyd = roundMoney(currentMonthExpensesLyd + roundMoney(tx.amount));
    }
    if (tx.type === 'cheque_liquidation' && tx.feeAmount) {
      currentMonthChequeFeesLyd = roundMoney(
        currentMonthChequeFeesLyd + roundMoney(tx.feeAmount)
      );
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

    return { valid: true, state: restoredState };
  } catch (e: any) {
    return {
      valid: false,
      error: `تعذر قراءة ملف النسخة الاحتياطية: ${e?.message || 'صيغة JSON غير صالحة'}`,
    };
  }
}
