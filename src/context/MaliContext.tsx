import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account,
  AuthUser,
  ContactPerson,
  ContactRole,
  Currency,
  FinancialProcedure,
  MaliState,
  MarketRates,
  PaymentMethodType,
  SupabaseConfig,
} from '../types/mali';
import { INITIAL_MALI_STATE } from '../data/initialData';
import { SessionScope, emptyFinancialState } from '../services/sessionScope';
import { SerialQueue } from '../services/serialQueue';
import { financialDate } from '../services/financialDate';
import {
  pullStateFromSupabase,
  pushStateToSupabase,
  SyncResult,
} from '../services/supabaseSync';
import {
  clearAuthSession,
  consumeOAuthRedirectIfPresent,
  getPersistedSessionUser,
  savePersistedSessionUser,
  subscribeToAuthIdentity,
} from '../services/authService';
import {
  addDebtRecordMutation,
  createAccountMutation,
  createUsdDealMutation,
  deleteAccountMutation,
  deleteDebtMutation,
  deleteTransactionMutation,
  deleteUsdDealMutation,
  liquidateChequeToCashMutation,
  recordExpenseOrIncomeMutation,
  recordTransferMutation,
  roundMoney,
  MAX_MONEY_AMOUNT,
  sellFromUsdDealMutation,
  settleDebtInstallmentMutation,
  takePersonalFromUsdDealMutation,
  touchState,
  updateAccountBalanceMutation,
  validateAndSanitizeBackupPayload,
} from '../services/financialEngine';
import {
  CALM_DARK_THEME,
  CALM_LIGHT_THEME,
  ThemePalette,
} from '../theme/calmTheme';

const BASE_STORAGE_KEY = '@mali_app_state_v2';
const THEME_KEY = '@mali_app_theme_v1';

function getStorageKeyForUser(userId?: string | null): string {
  if (!userId) return `${BASE_STORAGE_KEY}_anonymous`;
  return `${BASE_STORAGE_KEY}_${userId}`;
}

export interface CreateDealInput {
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
  idempotencyKey?: string;
  immediateSale?: {
    usdAmount: number;
    sellRate: number;
    commissionLyd: number;
    paymentMethod: PaymentMethodType;
    targetLydAccountId: string;
    buyerContactId?: string;
    buyerName?: string;
    buyerPhone?: string;
    receiptImages?: string[];
  };
}

export interface RecordDealSaleInput {
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
  isPersonalTake?: boolean;
  receiptImages?: string[];
  notes?: string;
  idempotencyKey?: string;
}

export interface ChequeLiquidationInput {
  sourceBankAccountId: string;
  targetCashAccountId: string;
  chequeAmountLyd: number;
  discountPercent: number;
  notes?: string;
  idempotencyKey?: string;
}

export interface AddTransactionInput {
  title: string;
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  currency: Currency;
  category: string;
  accountId: string;
  targetAccountId?: string;
  paymentMethod: PaymentMethodType;
  feeAmount?: number;
  contactId?: string;
  receiptImages?: string[];
  date?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface AddDebtInput {
  contactId?: string;
  personName: string;
  phone?: string;
  direction: 'receivable' | 'payable';
  currency: Currency;
  totalAmount: number;
  dueDate?: string;
  notes?: string;
  affectAccountId?: string;
  paymentMethod?: PaymentMethodType;
  idempotencyKey?: string;
}

export interface AddDebtInstallmentInput {
  debtId: string;
  amount: number;
  accountId?: string;
  paymentMethod: PaymentMethodType;
  notes?: string;
  idempotencyKey?: string;
}

export interface AddProcedureInput {
  title: string;
  procedureType: FinancialProcedure['procedureType'];
  bankOrEntity: string;
  referenceNumber?: string;
  amount?: number;
  currency?: Currency;
  dueDate?: string;
  stages: string[];
  notes?: string;
}

export interface AddContactInput {
  name: string;
  phone: string;
  role: ContactRole;
  bankDetails?: string;
  notes?: string;
}

interface MaliContextValue {
  state: MaliState;
  theme: ThemePalette;
  isDarkMode: boolean;
  toggleTheme: () => void;
  currentUser: AuthUser | null;
  loginUser: (user: AuthUser) => void;
  logoutUser: () => void;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncMessage: string | null;
  updateMarketRates: (rates: Partial<MarketRates>) => void;
  addContact: (input: AddContactInput) => ContactPerson;
  updateContact: (contactId: string, partial: Partial<ContactPerson>) => void;
  deleteContact: (contactId: string) => void;
  addAccount: (acc: Omit<Account, 'id' | 'updatedAt'>) => boolean;
  updateAccountBalance: (accountId: string, newBalance: number) => boolean;
  deleteAccount: (accountId: string) => boolean;
  liquidateChequeToCash: (input: ChequeLiquidationInput) => boolean;
  createUsdDeal: (input: CreateDealInput) => boolean;
  recordDealSale: (input: RecordDealSaleInput) => boolean;
  updateDealBuyReceipts: (dealId: string, images: string[]) => void;
  updateDealSaleReceipts: (dealId: string, saleId: string, images: string[]) => void;
  deleteUsdDeal: (dealId: string, reverseBalances?: boolean) => boolean;
  addTransaction: (input: AddTransactionInput) => boolean;
  deleteTransaction: (txId: string) => boolean;
  updateCategoryBudget: (category: string, monthlyLimitLyd: number) => void;
  addDebt: (input: AddDebtInput) => boolean;
  addDebtInstallment: (input: AddDebtInstallmentInput) => boolean;
  deleteDebt: (debtId: string) => boolean;
  addProcedure: (input: AddProcedureInput) => void;
  toggleProcedureStage: (procedureId: string, stageId: string) => void;
  addProcedureStage: (procedureId: string, stageTitle: string) => void;
  deleteProcedure: (procedureId: string) => void;
  updateSupabaseConfig: (cfg: Partial<SupabaseConfig>) => void;
  syncToCloud: (overrideCfg?: SupabaseConfig) => Promise<SyncResult>;
  pullFromCloud: (overrideCfg?: SupabaseConfig) => Promise<SyncResult>;
  importStateJson: (jsonStr: string) => boolean;
}

const MaliContext = createContext<MaliContextValue | undefined>(undefined);

function mergePartialCloudState(base: MaliState, cloud: Partial<MaliState>, updatedAt?: string, snapshotUpdatedAt?: string | null): MaliState {
  return {
    ...base,
    accounts: Array.isArray(cloud.accounts) ? cloud.accounts : base.accounts,
    contacts: Array.isArray(cloud.contacts) ? cloud.contacts : base.contacts,
    transactions: Array.isArray(cloud.transactions) ? cloud.transactions : base.transactions,
    deals: Array.isArray(cloud.deals) ? cloud.deals : base.deals,
    debts: Array.isArray(cloud.debts) ? cloud.debts : base.debts,
    procedures: Array.isArray(cloud.procedures) ? cloud.procedures : base.procedures,
    budgets: Array.isArray(cloud.budgets) ? cloud.budgets : base.budgets,
    marketRates: cloud.marketRates ? { ...base.marketRates, ...cloud.marketRates } : base.marketRates,
    pendingCloudSync: false,
    lastModifiedAt: cloud.lastModifiedAt || updatedAt || new Date().toISOString(),
    supabaseConfig: {
      ...base.supabaseConfig,
      lastSyncedAt: snapshotUpdatedAt === null ? undefined : (snapshotUpdatedAt || updatedAt),
    },
  };
}

export const MaliProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<MaliState>(INITIAL_MALI_STATE);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null);

  const theme = isDarkMode ? CALM_DARK_THEME : CALM_LIGHT_THEME;

  const scope = useRef(new SessionScope());
  const [mutationSession, setMutationSession] = useState({ generation: 0, userId: null as string | null });
  const localRevision = useRef(0);
  const recoveryRequired = useRef(false);
  const stateRef = useRef(state);
  const userRef = useRef<AuthUser | null>(null);
  const syncQueue = useRef(new SerialQueue());
  const storageQueue = useRef(new SerialQueue());
  const hydrating = useRef(false);
  const applyState = (next: MaliState) => { stateRef.current = next; setState(next); };

  useEffect(() => {
    const boot = scope.current.capture();
    let mounted = true;
    (async () => {
      try {
        // Callback exchange must finish before looking up the persisted session.
        const callbackUser = await consumeOAuthRedirectIfPresent(INITIAL_MALI_STATE.supabaseConfig);
        const savedUser = callbackUser || await getPersistedSessionUser(INITIAL_MALI_STATE.supabaseConfig);
        const savedTheme = await AsyncStorage.getItem(THEME_KEY);
        if (!mounted || !scope.current.isCurrent(boot)) return;
        if (savedTheme === 'dark') setIsDarkMode(true);
        if (savedUser) loginUser(savedUser);
      } catch {
        if (mounted && scope.current.isCurrent(boot)) setLastSyncMessage('تعذر قراءة البيانات المحفوظة.');
      } finally {
        if (mounted && scope.current.isCurrent(boot)) setIsLoading(false);
      }
    })();
    return () => { mounted = false; scope.current.begin(null); };
  }, []);

  const toggleTheme = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  };

  const persistState = (updater: (prev: MaliState) => MaliState) => {
    if (!scope.current.isCurrent(mutationSession) || hydrating.current || recoveryRequired.current) return false;
    const prev = stateRef.current;
    const mutation = updater(prev);
    if (mutation === prev) {
      setLastSyncMessage('لم يتم تسجيل العملية. راجع الحساب والعملة والرصيد والمبلغ ثم حاول مجدداً.');
      return false;
    }
    const token = scope.current.capture();
    const user = userRef.current;
    const revision = ++localRevision.current;
    const next = { ...touchState(mutation), localRevision: revision, pendingCloudSync: !!user && !user.isLocalOnly };
    applyState(next);
    // Side effects run once, outside React's replayable state updater.
    setLastSyncMessage(null);
    void storageQueue.current.run(() => AsyncStorage.setItem(getStorageKeyForUser(user?.id), JSON.stringify(next))).then(() => {
      if (scope.current.isCurrent(token) && user?.isLocalOnly && stateRef.current === next) setLastSyncMessage('تم الحفظ على هذا الجهاز.');
    }).catch(() => {
      if (scope.current.isCurrent(token)) setLastSyncMessage('تعذر حفظ التعديل على هذا الجهاز. يرجى تصدير نسخة احتياطية.');
    });
    if (user && !user.isLocalOnly && next.supabaseConfig.autoSync) {
      void syncQueue.current.run(async () => {
        if (!scope.current.isCurrent(token)) return;
        const cfg = { ...next.supabaseConfig, lastSyncedAt: stateRef.current.supabaseConfig.lastSyncedAt };
        const res = await pushStateToSupabase(next, cfg, user);
        if (!scope.current.isCurrent(token)) return;
        setLastSyncMessage(res.message);
        if (res.ok && res.updatedAt) {
          const current = stateRef.current;
          const acknowledged = { ...current, pendingCloudSync: localRevision.current !== revision, supabaseConfig: { ...current.supabaseConfig, lastSyncedAt: res.updatedAt } };
          applyState(acknowledged);
          await storageQueue.current.run(() => AsyncStorage.setItem(getStorageKeyForUser(user.id), JSON.stringify(acknowledged)));
        }
      }).catch(() => {
        if (scope.current.isCurrent(token)) setLastSyncMessage('تعذر رفع التعديل. تم الاحتفاظ به محلياً.');
      });
    }
    return true;
  };

  const todayStr = () => financialDate();

  const ensureContactInList = (
    contacts: ContactPerson[],
    contactId?: string,
    name?: string,
    phone?: string,
    defaultRole: ContactRole = 'تاجر عملة'
  ): {
    updatedContacts: ContactPerson[];
    resolvedId?: string;
    resolvedName?: string;
    resolvedPhone?: string;
  } => {
    if (contactId) {
      const found = contacts.find((c) => c.id === contactId);
      if (found) {
        const updatedPhone = phone?.trim() || found.phone;
        const updatedContacts =
          updatedPhone !== found.phone
            ? contacts.map((c) =>
                c.id === found.id ? { ...c, phone: updatedPhone } : c
              )
            : contacts;
        return {
          updatedContacts,
          resolvedId: found.id,
          resolvedName: found.name,
          resolvedPhone: updatedPhone,
        };
      }
    }
    const cleanName = name?.trim();
    if (!cleanName) {
      return { updatedContacts: contacts };
    }
    const byName = contacts.find(
      (c) => c.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (byName) {
      const updatedPhone = phone?.trim() || byName.phone;
      const updatedContacts =
        updatedPhone !== byName.phone
          ? contacts.map((c) =>
              c.id === byName.id ? { ...c, phone: updatedPhone } : c
            )
          : contacts;
      return {
        updatedContacts,
        resolvedId: byName.id,
        resolvedName: byName.name,
        resolvedPhone: updatedPhone,
      };
    }

    const newContact: ContactPerson = {
      id: `cnt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: cleanName,
      phone: phone?.trim() || '',
      role: defaultRole,
      createdAt: todayStr(),
    };
    return {
      updatedContacts: [newContact, ...contacts],
      resolvedId: newContact.id,
      resolvedName: newContact.name,
      resolvedPhone: newContact.phone,
    };
  };

  const updateMarketRates = (rates: Partial<MarketRates>) => {
    persistState((prev) => ({
      ...prev,
      marketRates: {
        ...prev.marketRates,
        ...rates,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const addContact = (input: AddContactInput): ContactPerson => {
    const newContact: ContactPerson = {
      id: `cnt-${Date.now()}`,
      name: input.name.trim(),
      phone: input.phone.trim(),
      role: input.role,
      bankDetails: input.bankDetails?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      createdAt: todayStr(),
    };
    persistState((prev) => ({
      ...prev,
      contacts: [newContact, ...prev.contacts],
    }));
    return newContact;
  };

  const updateContact = (contactId: string, partial: Partial<ContactPerson>) => {
    persistState((prev) => ({
      ...prev,
      contacts: prev.contacts.map((c) =>
        c.id === contactId ? { ...c, ...partial } : c
      ),
    }));
  };

  const deleteContact = (contactId: string) => {
    persistState((prev) => ({
      ...prev,
      contacts: prev.contacts.filter((c) => c.id !== contactId),
    }));
  };

  const addAccount = (acc: Omit<Account, 'id' | 'updatedAt'>) => {
    return persistState((prev) => createAccountMutation(prev, acc));
  };

  const updateAccountBalance = (accountId: string, newBalance: number) => {
    return persistState((prev) => updateAccountBalanceMutation(prev, accountId, newBalance));
  };

  const deleteAccount = (accountId: string) => {
    return persistState((prev) => deleteAccountMutation(prev, accountId));
  };

  const liquidateChequeToCash = (input: ChequeLiquidationInput) => {
    return persistState((prev) =>
      liquidateChequeToCashMutation(prev, {
        idempotencyKey: input.idempotencyKey,
        title: `تسييل صك إلى كاش (خصم ${input.discountPercent}%)`,
        fromBankAccountId: input.sourceBankAccountId,
        toCashAccountId: input.targetCashAccountId,
        grossChequeAmountLyd: input.chequeAmountLyd,
        discountPercent: input.discountPercent,
        notes: input.notes,
        date: todayStr(),
      })
    );
  };

  const createUsdDeal = (input: CreateDealInput) => {
    return persistState((prev) => {
      const sellerRes = ensureContactInList(
        prev.contacts,
        input.contactId,
        input.counterparty,
        input.counterpartyPhone,
        'تاجر عملة'
      );
      const dealId = `deal-${Date.now()}`;
      const stateWithContact: MaliState = {
        ...prev,
        contacts: sellerRes.updatedContacts,
      };

      let nextState = createUsdDealMutation(stateWithContact, {
        id: dealId,
        idempotencyKey: input.idempotencyKey,
        title: input.title,
        contactId: sellerRes.resolvedId,
        counterparty: sellerRes.resolvedName,
        counterpartyPhone: sellerRes.resolvedPhone,
        totalUsdBought: input.totalUsdBought,
        buyRate: input.buyRate,
        buyCommissionLyd: input.buyCommissionLyd ?? 0,
        buyPaymentMethod: input.buyPaymentMethod,
        sourceLydAccountId: input.sourceLydAccountId,
        usdHoldingAccountId: input.usdHoldingAccountId,
        buyReceiptImages: input.buyReceiptImages,
        notes: input.notes,
        buyDate: todayStr(),
      });

      if (nextState === stateWithContact) return prev;
      if (input.immediateSale) {
        const saleInput = input.immediateSale;
        const buyerRes = ensureContactInList(
          nextState.contacts,
          saleInput.buyerContactId,
          saleInput.buyerName,
          saleInput.buyerPhone,
          'تاجر عملة'
        );
        const saleBase = { ...nextState, contacts: buyerRes.updatedContacts };
        nextState = sellFromUsdDealMutation(
          saleBase,
          {
            dealId,
            idempotencyKey: input.idempotencyKey
              ? `${input.idempotencyKey}:imm_sale`
              : undefined,
            usdAmount: saleInput.usdAmount,
            sellRate: saleInput.sellRate,
            commissionLyd: saleInput.commissionLyd ?? 0,
            paymentMethod: saleInput.paymentMethod,
            targetLydAccountId: saleInput.targetLydAccountId,
            sourceUsdAccountId: input.usdHoldingAccountId,
            contactId: buyerRes.resolvedId,
            buyerName: buyerRes.resolvedName,
            buyerPhone: buyerRes.resolvedPhone,
            receiptImages: saleInput.receiptImages,
            date: todayStr(),
            notes: `بيع مباشر عند فتح الصفقة بسعر ${saleInput.sellRate}`,
          }
        );
        if (nextState === saleBase) return prev;
      }

      return nextState;
    });
  };

  const recordDealSale = (input: RecordDealSaleInput) => {
    return persistState((prev) => {
      if (input.isPersonalTake) {
        return takePersonalFromUsdDealMutation(prev, {
          idempotencyKey: input.idempotencyKey,
          dealId: input.dealId,
          usdAmount: input.usdAmount,
          sourceUsdAccountId: input.sourceUsdAccountId,
          targetPersonalUsdAccountId: input.targetLydAccountId || undefined,
          notes: input.notes,
          date: todayStr(),
        });
      }

      const buyerRes = ensureContactInList(
        prev.contacts,
        input.contactId,
        input.buyerName,
        input.buyerPhone,
        'تاجر عملة'
      );

      const prepared = { ...prev, contacts: buyerRes.updatedContacts };
      const candidate = sellFromUsdDealMutation(
        prepared,
        {
          idempotencyKey: input.idempotencyKey,
          dealId: input.dealId,
          usdAmount: input.usdAmount,
          sellRate: input.sellRate,
          commissionLyd: input.commissionLyd ?? 0,
          paymentMethod: input.paymentMethod,
          targetLydAccountId: input.targetLydAccountId,
          sourceUsdAccountId: input.sourceUsdAccountId,
          contactId: buyerRes.resolvedId,
          buyerName: buyerRes.resolvedName,
          buyerPhone: buyerRes.resolvedPhone,
          receiptImages: input.receiptImages,
          notes: input.notes,
          date: todayStr(),
        }
      );
      return candidate === prepared ? prev : candidate;
    });
  };

  const updateDealBuyReceipts = (dealId: string, images: string[]) => {
    persistState((prev) => ({
      ...prev,
      deals: prev.deals.map((d) =>
        d.id === dealId
          ? { ...d, buyReceiptImages: images.length > 0 ? images : undefined }
          : d
      ),
    }));
  };

  const updateDealSaleReceipts = (
    dealId: string,
    saleId: string,
    images: string[]
  ) => {
    persistState((prev) => ({
      ...prev,
      deals: prev.deals.map((d) =>
        d.id === dealId
          ? {
              ...d,
              sales: d.sales.map((s) =>
                s.id === saleId
                  ? {
                      ...s,
                      receiptImages: images.length > 0 ? images : undefined,
                    }
                  : s
              ),
            }
          : d
      ),
    }));
  };

  const deleteUsdDeal = (dealId: string) => {
    return persistState((prev) => deleteUsdDealMutation(prev, dealId));
  };

  const addTransaction = (input: AddTransactionInput) => {
    return persistState((prev) => {
      if (input.type === 'transfer') {
        if (!input.targetAccountId) return prev;
        return recordTransferMutation(prev, {
          idempotencyKey: input.idempotencyKey,
          title: input.title,
          fromAccountId: input.accountId,
          toAccountId: input.targetAccountId,
          amount: input.amount,
          feeAmount: input.feeAmount,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
          date: input.date || todayStr(),
        });
      }

      const rawFee = input.feeAmount ?? 0;
      if (!Number.isFinite(rawFee) || rawFee < 0 || rawFee > MAX_MONEY_AMOUNT ||
          !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_MONEY_AMOUNT) return prev;
      const principalCents = BigInt(Math.round(roundMoney(input.amount) * 100));
      const feeCents = BigInt(Math.round(roundMoney(rawFee) * 100));
      const totalCents = input.type === 'expense' ? principalCents + feeCents : principalCents - feeCents;
      const effectiveAmount = Number(totalCents) / 100;

      return recordExpenseOrIncomeMutation(prev, {
        idempotencyKey: input.idempotencyKey,
        title: input.title,
        type: input.type,
        amount: effectiveAmount,
        currency: input.currency,
        category: input.category,
        accountId: input.accountId,
        paymentMethod: input.paymentMethod,
        contactId: input.contactId,
        receiptImages: input.receiptImages,
        notes: input.notes,
        date: input.date || todayStr(),
      });
    });
  };

  const deleteTransaction = (txId: string) => {
    return persistState((prev) => deleteTransactionMutation(prev, txId));
  };

  const updateCategoryBudget = (category: string, monthlyLimitLyd: number) => {
    persistState((prev) => {
      const exists = prev.budgets.some((b) => b.category === category);
      if (exists) {
        return {
          ...prev,
          budgets: prev.budgets.map((b) =>
            b.category === category ? { ...b, monthlyLimitLyd: roundMoney(monthlyLimitLyd) } : b
          ),
        };
      }
      return {
        ...prev,
        budgets: [
          ...prev.budgets,
          {
            id: `b-${Date.now()}`,
            category,
            monthlyLimitLyd: roundMoney(monthlyLimitLyd),
            color: '#0D9488',
            icon: 'wallet',
          },
        ],
      };
    });
  };

  const addDebt = (input: AddDebtInput) => {
    return persistState((prev) => {
      const personRes = ensureContactInList(
        prev.contacts,
        input.contactId,
        input.personName,
        input.phone,
        'شريك تجاري'
      );

      const prepared = { ...prev, contacts: personRes.updatedContacts };
      const candidate = addDebtRecordMutation(
        prepared,
        {
          idempotencyKey: input.idempotencyKey,
          contactId: personRes.resolvedId,
          personName: personRes.resolvedName || input.personName,
          phone: personRes.resolvedPhone || input.phone,
          direction: input.direction,
          currency: input.currency,
          totalAmount: input.totalAmount,
          dueDate: input.dueDate,
          accountId: input.affectAccountId,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
          createdAt: todayStr(),
        }
      );
      return candidate === prepared ? prev : candidate;
    });
  };

  const addDebtInstallment = (input: AddDebtInstallmentInput) => {
    return persistState((prev) => {
      return settleDebtInstallmentMutation(prev, {
        idempotencyKey: input.idempotencyKey,
        debtId: input.debtId,
        amount: input.amount,
        accountId: input.accountId,
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        date: todayStr(),
      });
    });
  };

  const deleteDebt = (debtId: string) => {
    return persistState((prev) => deleteDebtMutation(prev, debtId));
  };

  const addProcedure = (input: AddProcedureInput) => {
    const newProc: FinancialProcedure = {
      id: `proc-${Date.now()}`,
      title: input.title,
      procedureType: input.procedureType,
      bankOrEntity: input.bankOrEntity,
      referenceNumber: input.referenceNumber,
      amount: input.amount !== undefined ? roundMoney(input.amount) : undefined,
      currency: input.currency || 'LYD',
      status: 'in_progress',
      dueDate: input.dueDate,
      createdAt: todayStr(),
      notes: input.notes,
      stages:
        input.stages.length > 0
          ? input.stages.map((st, idx) => ({
              id: `st-${Date.now()}-${idx}`,
              title: st,
              completed: false,
            }))
          : [
              {
                id: `st-${Date.now()}-1`,
                title: 'بدء المعاملة وتجهيز المستندات',
                completed: true,
                completedAt: todayStr(),
              },
              {
                id: `st-${Date.now()}-2`,
                title: 'المراجعة والتنفيذ بالمصرف/الجهة',
                completed: false,
              },
              {
                id: `st-${Date.now()}-3`,
                title: 'إتمام الإجراء والاعتماد النهائي',
                completed: false,
              },
            ],
    };

    persistState((prev) => ({
      ...prev,
      procedures: [newProc, ...prev.procedures],
    }));
  };

  const toggleProcedureStage = (procedureId: string, stageId: string) => {
    persistState((prev) => ({
      ...prev,
      procedures: prev.procedures.map((p) => {
        if (p.id !== procedureId) return p;
        const stages = p.stages.map((s) =>
          s.id === stageId
            ? {
                ...s,
                completed: !s.completed,
                completedAt: !s.completed ? todayStr() : undefined,
              }
            : s
        );
        const allDone = stages.length > 0 && stages.every((s) => s.completed);
        const anyDone = stages.some((s) => s.completed);
        return {
          ...p,
          stages,
          status: allDone ? 'completed' : anyDone ? 'in_progress' : 'pending',
        };
      }),
    }));
  };

  const addProcedureStage = (procedureId: string, stageTitle: string) => {
    if (!stageTitle.trim()) return;
    persistState((prev) => ({
      ...prev,
      procedures: prev.procedures.map((p) => {
        if (p.id !== procedureId) return p;
        const stages = [
          ...p.stages,
          { id: `st-${Date.now()}`, title: stageTitle.trim(), completed: false },
        ];
        return {
          ...p,
          stages,
          status: 'in_progress',
        };
      }),
    }));
  };

  const deleteProcedure = (procedureId: string) => {
    persistState((prev) => ({
      ...prev,
      procedures: prev.procedures.filter((p) => p.id !== procedureId),
    }));
  };

  const updateSupabaseConfig = (cfg: Partial<SupabaseConfig>) => {
    persistState((prev) => ({
      ...prev,
      supabaseConfig: {
        ...prev.supabaseConfig,
        ...cfg,
      },
    }));
  };

  const syncToCloud = async (overrideCfg?: SupabaseConfig): Promise<SyncResult> => {
    const token = scope.current.capture();
    const user = userRef.current;
    setIsSyncing(true);
    return syncQueue.current.run(async () => {
    try {
      if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
      if (recoveryRequired.current) return { ok: false, success: false, message: 'استرجع نسخة صحيحة قبل الرفع.' };
      const current = stateRef.current;
      const revision = localRevision.current;
      const cfg = overrideCfg || current.supabaseConfig;
      const res = await pushStateToSupabase(current, cfg, user);
      if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
      setLastSyncMessage(res.message);
      if (res.ok && res.updatedAt) {
        const next = { ...stateRef.current, pendingCloudSync: localRevision.current !== revision, supabaseConfig: { ...cfg, lastSyncedAt: res.updatedAt } };
        applyState(next);
        await storageQueue.current.run(() => AsyncStorage.setItem(getStorageKeyForUser(user?.id), JSON.stringify(next)));
      }
      return res;
    } finally {
      if (scope.current.isCurrent(token)) setIsSyncing(false);
    }
    });
  };

  const pullFromCloud = async (overrideCfg?: SupabaseConfig): Promise<SyncResult> => {
    const token = scope.current.capture();
    const user = userRef.current;
    setIsSyncing(true);
    return syncQueue.current.run(async () => {
    const before = stateRef.current;
    try {
      if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
      const res = await pullStateFromSupabase(overrideCfg || before.supabaseConfig, user);
      if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
      // A concurrent local edit must never be discarded by a delayed pull.
      if (stateRef.current !== before) {
        return { ok: false, success: false, conflictDetected: true, message: 'توجد تعديلات محلية جديدة. لم يتم استبدالها بالنسخة السحابية.' };
      }
      setLastSyncMessage(res.message);
      if (res.ok && res.state && before.pendingCloudSync) {
        const message = 'توجد تعديلات محلية غير مرفوعة. صدّر نسخة احتياطية قبل استبدالها بالنسخة السحابية.';
        setLastSyncMessage(message);
        return { ...res, ok: false, success: false, conflictDetected: true, message };
      }
      if (res.isEmpty) {
        const cleared = { ...before, supabaseConfig: { ...before.supabaseConfig, lastSyncedAt: undefined } };
        applyState(cleared);
        await storageQueue.current.run(() => AsyncStorage.setItem(getStorageKeyForUser(user?.id), JSON.stringify(cleared)));
      }
      if (res.ok && res.state) {
        recoveryRequired.current = false;
        const merged = mergePartialCloudState(before, res.state, res.updatedAt, res.snapshotUpdatedAt);
        applyState(merged);
        await storageQueue.current.run(() => AsyncStorage.setItem(getStorageKeyForUser(user?.id), JSON.stringify(merged)));
      }
      return res;
    } finally {
      if (scope.current.isCurrent(token)) setIsSyncing(false);
    }
    });
  };

  const importStateJson = (jsonStr: string): boolean => {
    if (!scope.current.isCurrent(mutationSession) || hydrating.current) return false;
    const validation = validateAndSanitizeBackupPayload(jsonStr, stateRef.current);
    if (!validation.valid || !validation.state) return false;
    recoveryRequired.current = false;
    return persistState(() => validation.state!);
  };

  function loginUser(user: AuthUser) {
    const token = scope.current.begin(user.id);
    setMutationSession(token);
    localRevision.current = 0;
    recoveryRequired.current = false;
    userRef.current = user;
    setCurrentUser(user);
    setIsLoading(true);
    hydrating.current = true;
    const nextWorkspaceKey = user.isLocalOnly ? 'mali-local-offline' : `mali-vault-${user.id}`;
    let userState: MaliState = {
      ...emptyFinancialState(INITIAL_MALI_STATE),
      supabaseConfig: { ...INITIAL_MALI_STATE.supabaseConfig, workspaceKey: nextWorkspaceKey, lastSyncedAt: undefined },
    };
    applyState(userState);
    (async () => {
      const key = getStorageKeyForUser(user.id);
      let cacheLoaded = false;
      try {
        const cachedRaw = await storageQueue.current.run(() => AsyncStorage.getItem(key));
        if (!scope.current.isCurrent(token)) return;
        if (cachedRaw) {
          const validation = validateAndSanitizeBackupPayload(cachedRaw, userState);
          if (!validation.valid || !validation.state) {
            recoveryRequired.current = true;
            await storageQueue.current.run(() => AsyncStorage.setItem(key + '_recovery', cachedRaw));
            setLastSyncMessage('النسخة المحلية تحتاج مراجعة. تم الاحتفاظ بها دون رفع أو استبدال.');
            return;
          }
          const parsed = JSON.parse(cachedRaw);
          const revision = parsed.localRevision;
          localRevision.current = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
          const pending = typeof parsed.pendingCloudSync === 'boolean' ? parsed.pendingCloudSync :
            Boolean(parsed.lastModifiedAt && (!parsed.supabaseConfig?.lastSyncedAt || Date.parse(parsed.lastModifiedAt) > Date.parse(parsed.supabaseConfig.lastSyncedAt)));
          userState = { ...validation.state, localRevision: localRevision.current, pendingCloudSync: pending, supabaseConfig: {
            ...userState.supabaseConfig,
            autoSync: typeof parsed.supabaseConfig?.autoSync === 'boolean' ? parsed.supabaseConfig.autoSync : userState.supabaseConfig.autoSync,
            lastSyncedAt: parsed.supabaseConfig?.lastSyncedAt,
          } };
        }
        cacheLoaded = true;
        applyState(userState);
        await savePersistedSessionUser(user, userState.supabaseConfig);
        if (!scope.current.isCurrent(token)) return;
        if (user.isLocalOnly) {
          setLastSyncMessage('تم تفعيل الوضع المحلي المعزول.');
          return;
        }
        setIsSyncing(true);
        const before = stateRef.current;
        const res = await syncQueue.current.run(() => pullStateFromSupabase(userState.supabaseConfig, user));
        if (!scope.current.isCurrent(token)) return;
        setLastSyncMessage(res.message);
        const hasPendingLocal = Boolean(userState.pendingCloudSync);
        if (res.ok && res.state && !hasPendingLocal && stateRef.current === before) {
          const merged = mergePartialCloudState(userState, res.state, res.updatedAt, res.snapshotUpdatedAt);
          applyState(merged);
          await storageQueue.current.run(() => AsyncStorage.setItem(key, JSON.stringify(merged)));
        } else if (res.isEmpty) {
          // New cloud users keep an empty vault; no demo data is uploaded on login.
          const cleared = { ...stateRef.current, supabaseConfig: { ...stateRef.current.supabaseConfig, lastSyncedAt: undefined } };
          applyState(cleared);
          await storageQueue.current.run(() => AsyncStorage.setItem(key, JSON.stringify(cleared)));
        } else if (hasPendingLocal) {
          setLastSyncMessage('توجد تعديلات محلية غير مرفوعة. تم الاحتفاظ بها؛ ارفعها أو صدّر نسخة احتياطية قبل استرجاع السحابة.');
        }
      } catch {
        if (scope.current.isCurrent(token)) {
          if (!cacheLoaded) recoveryRequired.current = true;
          setLastSyncMessage(cacheLoaded ? 'تعذر تحميل السحابة. تم الاحتفاظ بالتعديلات المحلية.' : 'تعذر قراءة الخزنة المحلية. تم إيقاف التعديلات لحماية البيانات؛ استرجع نسخة صحيحة.');
        }
      } finally {
        if (scope.current.isCurrent(token)) { hydrating.current = false; setIsLoading(false); setIsSyncing(false); }
      }
    })();
  }

  function invalidateLocalSession() {
    setMutationSession(scope.current.begin(null));
    recoveryRequired.current = false;
    hydrating.current = false;
    userRef.current = null;
    setCurrentUser(null);
    setLastSyncMessage(null);
    setIsSyncing(false);
    setIsLoading(false);
    applyState(emptyFinancialState(INITIAL_MALI_STATE));
  }

  const logoutUser = () => {
    const cfg = stateRef.current.supabaseConfig;
    invalidateLocalSession();
    clearAuthSession(cfg).catch(() => {});
  };

  useEffect(() => subscribeToAuthIdentity((user) => {
    if (!user) {
      if (userRef.current && !userRef.current.isLocalOnly) invalidateLocalSession();
    } else if (userRef.current?.id !== user.id) {
      loginUser(user);
    }
  }, INITIAL_MALI_STATE.supabaseConfig), []);

  return (
    <MaliContext.Provider
      value={{
        state,
        theme,
        isDarkMode,
        toggleTheme,
        currentUser,
        loginUser,
        logoutUser,
        isLoading,
        isSyncing,
        lastSyncMessage,
        updateMarketRates,
        addContact,
        updateContact,
        deleteContact,
        addAccount,
        updateAccountBalance,
        deleteAccount,
        liquidateChequeToCash,
        createUsdDeal,
        recordDealSale,
        updateDealBuyReceipts,
        updateDealSaleReceipts,
        deleteUsdDeal,
        addTransaction,
        deleteTransaction,
        updateCategoryBudget,
        addDebt,
        addDebtInstallment,
        deleteDebt,
        addProcedure,
        toggleProcedureStage,
        addProcedureStage,
        deleteProcedure,
        updateSupabaseConfig,
        syncToCloud,
        pullFromCloud,
        importStateJson,
      }}
    >
      {children}
    </MaliContext.Provider>
  );
};

export const useMali = (): MaliContextValue => {
  const ctx = useContext(MaliContext);
  if (!ctx) {
    throw new Error('useMali must be used within a MaliProvider');
  }
  return ctx;
};
