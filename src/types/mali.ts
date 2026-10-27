import type { FinancialAuditEvent } from './financialAudit';
export type Currency = 'LYD' | 'USD';

export type PaymentMethodType = 'cash' | 'cheque' | 'transfer' | 'card';

export type AccountCategory = 'cash_lyd' | 'cash_usd' | 'bank_lyd' | 'bank_usd' | 'ewallet';

export type AuthProviderType = 'email' | 'google' | 'facebook';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  googleSub?: string;
  googleSyncedAt?: string;
  provider: AuthProviderType;
  isLocalOnly?: boolean; // true = جلسة محلية (وضع عدم الاتصال) لا تمنح أي صلاحيات سحابية
  createdAt: string;
}

export type ContactRole =
  | 'مكتب صرافة'
  | 'تاجر عملة'
  | 'شركة / مورد'
  | 'شريك تجاري'
  | 'شخصي / عميل';

export interface ContactPerson {
  id: string;
  name: string;
  phone: string;
  role: ContactRole;
  bankDetails?: string;
  notes?: string;
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  bankName: string;
  category: AccountCategory;
  currency: Currency;
  balance: number;
  isCash: boolean; // true = كاش نقدي, false = رصيد مصرفي / صكوك / حوالات
  allowOverdraft?: boolean; // سحب على المكشوف مصرح به
  overdraftLimit?: number; // سقف السحب على المكشوف
  accountNumber?: string;
  color: string;
  notes?: string;
  updatedAt: string;
}

export type TransactionType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'cheque_liquidation'
  | 'deal_buy'
  | 'deal_sell'
  | 'deal_personal_take'
  | 'debt_settlement';

export interface Transaction {
  id: string;
  title: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  category: string;
  accountId: string;
  targetAccountId?: string;
  paymentMethod: PaymentMethodType;
  feeAmount?: number;
  discountPercent?: number;
  exchangeRate?: number;
  dealId?: string;
  saleId?: string;
  debtId?: string;
  installmentId?: string;
  contactId?: string;
  idempotencyKey?: string;
  receiptImages?: string[];
  date: string;
  updatedAt?: string;
  notes?: string;
}

export interface DealSale {
  id: string;
  dealId: string;
  usdAmount: number;
  sellRate: number;
  grossLyd: number;
  commissionLyd: number;
  netLydReceived: number;
  costBasisLyd: number;
  profitLyd: number;
  paymentMethod: PaymentMethodType;
  targetLydAccountId: string;
  sourceUsdAccountId: string;
  contactId?: string;
  buyerName?: string;
  buyerPhone?: string;
  isPersonalTake?: boolean;
  idempotencyKey?: string;
  receiptImages?: string[];
  date: string;
  notes?: string;
}

export interface UsdDeal {
  id: string;
  dealNumber: string;
  title: string;
  contactId?: string;
  counterparty?: string;
  counterpartyPhone?: string;
  buyDate: string;
  totalUsdBought: number;
  buyRate: number;
  grossLydCost: number;
  buyCommissionLyd: number;
  totalLydCost: number;
  effectiveBuyRate: number; // totalLydCost / totalUsdBought
  buyPaymentMethod: PaymentMethodType;
  sourceLydAccountId: string;
  usdHoldingAccountId: string;
  buyReceiptImages?: string[];
  soldUsd: number;
  personalTakenUsd: number;
  remainingUsd: number;
  totalLydReceived: number;
  realizedProfitLyd: number;
  status: 'open' | 'partial' | 'closed';
  sales: DealSale[];
  idempotencyKey?: string;
  updatedAt?: string;
  notes?: string;
}

export type DebtSettlementType = 'cash' | 'non_cash';

export interface DebtInstallment {
  id: string;
  amount: number;
  date: string;
  accountId?: string;
  paymentMethod: PaymentMethodType;
  settlementType?: DebtSettlementType;
  isNonCash?: boolean; // تسوية غير نقدية (مقاصة / تنازل / تسوية عينية)
  nonCashReason?: string; // سبب وتفاصيل التسوية غير النقدية
  transactionId?: string;
  idempotencyKey?: string;
  notes?: string;
}

export interface DebtRecord {
  id: string;
  contactId?: string;
  personName: string;
  phone?: string;
  direction: 'receivable' | 'payable'; // receivable = لي (دين لي عند الغير), payable = عليّ (دين أو أمانة عليّ)
  currency: Currency;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  accountId?: string;
  initialPaymentMethod?: PaymentMethodType;
  initialTransactionId?: string;
  dueDate?: string;
  status: 'active' | 'completed';
  installments: DebtInstallment[];
  idempotencyKey?: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
}

export interface ProcedureStage {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: string;
}

export interface FinancialProcedure {
  id: string;
  title: string;
  procedureType:
    | 'صك مصدق / مقاصة'
    | 'تسييل / سحب مصرفي'
    | 'اعتماد / حوالة خارجية'
    | 'بطاقة دولية / أغراض شخصية'
    | 'حجز مالي / التزام'
    | 'إجراء مصرفي عام';
  bankOrEntity: string;
  referenceNumber?: string;
  amount?: number;
  currency?: Currency;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  dueDate?: string;
  stages: ProcedureStage[];
  notes?: string;
  createdAt: string;
}

export interface CategoryBudget {
  id: string;
  category: string;
  monthlyLimitLyd: number;
  color: string;
  icon: string;
}

export interface MarketRates {
  cashUsdToLyd: number;
  chequeUsdToLyd: number;
  defaultChequeDiscountPercent: number;
  updatedAt: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  workspaceKey: string;
  autoSync: boolean;
  lastSyncedAt?: string;
}

export interface MaliState {
  /** Append-only local evidence; server acceptance is recorded independently. */
  financialAudit?: FinancialAuditEvent[];
  /** Device-only metadata; never included in the cloud snapshot or exported backups. */
  pendingCloudSync?: boolean;
  localRevision?: number;
  accounts: Account[];
  contacts: ContactPerson[];
  transactions: Transaction[];
  deals: UsdDeal[];
  debts: DebtRecord[];
  procedures: FinancialProcedure[];
  budgets: CategoryBudget[];
  marketRates: MarketRates;
  supabaseConfig: SupabaseConfig;
  lastModifiedAt?: string;
}
