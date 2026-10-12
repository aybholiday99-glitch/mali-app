import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account,
  AuthUser,
  ContactPerson,
  ContactRole,
  Currency,
  DealSale,
  DebtRecord,
  FinancialProcedure,
  MaliState,
  MarketRates,
  PaymentMethodType,
  SupabaseConfig,
  Transaction,
  UsdDeal,
} from '../types/mali';
import { INITIAL_MALI_STATE } from '../data/initialData';
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
  roundRate,
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
const LEGACY_STORAGE_KEY = '@mali_app_state_v1';
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
  addAccount: (acc: Omit<Account, 'id' | 'updatedAt'>) => void;
  updateAccountBalance: (accountId: string, newBalance: number) => void;
  deleteAccount: (accountId: string) => void;
  liquidateChequeToCash: (input: ChequeLiquidationInput) => void;
  createUsdDeal: (input: CreateDealInput) => void;
  recordDealSale: (input: RecordDealSaleInput) => void;
  updateDealBuyReceipts: (dealId: string, images: string[]) => void;
  updateDealSaleReceipts: (dealId: string, saleId: string, images: string[]) => void;
  deleteUsdDeal: (dealId: string, reverseBalances?: boolean) => void;
  addTransaction: (input: AddTransactionInput) => void;
  deleteTransaction: (txId: string) => void;
  updateCategoryBudget: (category: string, monthlyLimitLyd: number) => void;
  addDebt: (input: AddDebtInput) => void;
  addDebtInstallment: (input: AddDebtInstallmentInput) => void;
  deleteDebt: (debtId: string) => void;
  addProcedure: (input: AddProcedureInput) => void;
  toggleProcedureStage: (procedureId: string, stageId: string) => void;
  addProcedureStage: (procedureId: string, stageTitle: string) => void;
  deleteProcedure: (procedureId: string) => void;
  updateSupabaseConfig: (cfg: Partial<SupabaseConfig>) => void;
  syncToCloud: (overrideCfg?: SupabaseConfig) => Promise<SyncResult>;
  pullFromCloud: (overrideCfg?: SupabaseConfig) => Promise<SyncResult>;
  importStateJson: (jsonStr: string) => boolean;
  resetDemoData: () => void;
}

const MaliContext = createContext<MaliContextValue | undefined>(undefined);

function mergePartialCloudState(base: MaliState, cloud: Partial<MaliState>, updatedAt?: string): MaliState {
  return {
    ...base,
    accounts: Array.isArray(cloud.accounts) ? cloud.accounts : base.accounts,
    contacts: Array.isArray(cloud.contacts) && cloud.contacts.length > 0 ? cloud.contacts : base.contacts,
    transactions: Array.isArray(cloud.transactions) ? cloud.transactions : base.transactions,
    deals: Array.isArray(cloud.deals) ? cloud.deals : base.deals,
    debts: Array.isArray(cloud.debts) ? cloud.debts : base.debts,
    procedures: Array.isArray(cloud.procedures) ? cloud.procedures : base.procedures,
    budgets: Array.isArray(cloud.budgets) ? cloud.budgets : base.budgets,
    marketRates: cloud.marketRates ? { ...base.marketRates, ...cloud.marketRates } : base.marketRates,
    lastModifiedAt: cloud.lastModifiedAt || updatedAt || new Date().toISOString(),
    supabaseConfig: {
      ...base.supabaseConfig,
      lastSyncedAt: updatedAt || new Date().toISOString(),
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

  useEffect(() => {
    (async () => {
      try {
        const [oauthCallbackUser, savedUser, savedTheme] = await Promise.all([
          consumeOAuthRedirectIfPresent(INITIAL_MALI_STATE.supabaseConfig),
          getPersistedSessionUser(INITIAL_MALI_STATE.supabaseConfig),
          AsyncStorage.getItem(THEME_KEY),
        ]);
        if (savedTheme === 'dark') {
          setIsDarkMode(true);
        }
        const activeUser = oauthCallbackUser || savedUser;
        if (activeUser) {
          setCurrentUser(activeUser);
          const userStorageKey = getStorageKeyForUser(activeUser.id);
          const savedForUser =
            (await AsyncStorage.getItem(userStorageKey)) ||
            (await AsyncStorage.getItem(LEGACY_STORAGE_KEY));

          let initialLoadedState = INITIAL_MALI_STATE;
          if (savedForUser) {
            const parsed = JSON.parse(savedForUser);
            initialLoadedState = {
              ...INITIAL_MALI_STATE,
              ...parsed,
              supabaseConfig: {
                ...INITIAL_MALI_STATE.supabaseConfig,
                ...(parsed.supabaseConfig || {}),
                url:
                  parsed.supabaseConfig?.url?.trim() ||
                  INITIAL_MALI_STATE.supabaseConfig.url,
                anonKey:
                  parsed.supabaseConfig?.anonKey?.trim() ||
                  INITIAL_MALI_STATE.supabaseConfig.anonKey,
                workspaceKey: `mali-vault-${activeUser.id}`,
              },
              contacts:
                Array.isArray(parsed.contacts) && parsed.contacts.length > 0
                  ? parsed.contacts
                  : INITIAL_MALI_STATE.contacts,
            };
            setState(initialLoadedState);
          }

          // إذا كان المستخدم موثقاً سحابياً، نسحب أحدث نسخة من السحابة للتحقق من عدم وجود تحديثات أحدث
          if (!activeUser.isLocalOnly) {
            const pullRes = await pullStateFromSupabase(
              initialLoadedState.supabaseConfig,
              activeUser
            );
            if (pullRes.ok && pullRes.state) {
              const cloudTime = pullRes.updatedAt ? new Date(pullRes.updatedAt).getTime() : 0;
              const localTime = initialLoadedState.lastModifiedAt
                ? new Date(initialLoadedState.lastModifiedAt).getTime()
                : 0;
              if (!savedForUser || cloudTime >= localTime) {
                const merged = mergePartialCloudState(
                  initialLoadedState,
                  pullRes.state,
                  pullRes.updatedAt
                );
                setState(merged);
                await AsyncStorage.setItem(userStorageKey, JSON.stringify(merged));
              }
            }
          }
        }
      } catch (e) {
        console.warn('Failed to load Mali state from storage:', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const toggleTheme = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  };

  const persistState = (updater: (prev: MaliState) => MaliState) => {
    setState((prev) => {
      const next = touchState(updater(prev));
      const storageKey = getStorageKeyForUser(currentUser?.id);
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch((err) =>
        console.warn('Failed saving state:', err)
      );
      if (
        currentUser &&
        !currentUser.isLocalOnly &&
        next.supabaseConfig.autoSync &&
        next.supabaseConfig.url.trim() &&
        next.supabaseConfig.anonKey.trim()
      ) {
        pushStateToSupabase(next, next.supabaseConfig, currentUser).catch(() => {});
      }
      return next;
    });
  };

  const todayStr = () => new Date().toISOString().slice(0, 10);

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
    persistState((prev) => createAccountMutation(prev, acc));
  };

  const updateAccountBalance = (accountId: string, newBalance: number) => {
    persistState((prev) => updateAccountBalanceMutation(prev, accountId, newBalance));
  };

  const deleteAccount = (accountId: string) => {
    persistState((prev) => deleteAccountMutation(prev, accountId));
  };

  const liquidateChequeToCash = (input: ChequeLiquidationInput) => {
    persistState((prev) =>
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
    persistState((prev) => {
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
        buyCommissionLyd: input.buyCommissionLyd || 0,
        buyPaymentMethod: input.buyPaymentMethod,
        sourceLydAccountId: input.sourceLydAccountId,
        usdHoldingAccountId: input.usdHoldingAccountId,
        buyReceiptImages: input.buyReceiptImages,
        notes: input.notes,
        buyDate: todayStr(),
      });

      if (
        input.immediateSale &&
        input.immediateSale.usdAmount > 0 &&
        input.immediateSale.sellRate > 0
      ) {
        const saleInput = input.immediateSale;
        const buyerRes = ensureContactInList(
          nextState.contacts,
          saleInput.buyerContactId,
          saleInput.buyerName,
          saleInput.buyerPhone,
          'تاجر عملة'
        );
        nextState = sellFromUsdDealMutation(
          { ...nextState, contacts: buyerRes.updatedContacts },
          {
            dealId,
            idempotencyKey: input.idempotencyKey
              ? `${input.idempotencyKey}:imm_sale`
              : undefined,
            usdAmount: Math.min(saleInput.usdAmount, input.totalUsdBought),
            sellRate: saleInput.sellRate,
            commissionLyd: saleInput.commissionLyd || 0,
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
      }

      return nextState;
    });
  };

  const recordDealSale = (input: RecordDealSaleInput) => {
    persistState((prev) => {
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

      return sellFromUsdDealMutation(
        { ...prev, contacts: buyerRes.updatedContacts },
        {
          idempotencyKey: input.idempotencyKey,
          dealId: input.dealId,
          usdAmount: input.usdAmount,
          sellRate: input.sellRate,
          commissionLyd: input.commissionLyd || 0,
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

  const deleteUsdDeal = (dealId: string, reverseBalances: boolean = true) => {
    persistState((prev) => {
      if (!reverseBalances) {
        return {
          ...prev,
          deals: prev.deals.filter((d) => d.id !== dealId),
          transactions: prev.transactions.filter((t) => t.dealId !== dealId),
        };
      }
      return deleteUsdDealMutation(prev, dealId);
    });
  };

  const addTransaction = (input: AddTransactionInput) => {
    persistState((prev) => {
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

      const fee = roundMoney(Math.max(0, input.feeAmount || 0));
      const effectiveAmount =
        fee > 0
          ? input.type === 'expense'
            ? roundMoney(input.amount + fee)
            : roundMoney(input.amount - fee)
          : roundMoney(input.amount);

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
    persistState((prev) => {
      const tx = prev.transactions.find((t) => t.id === txId);
      if (!tx) return prev;

      if (tx.type === 'deal_buy' && tx.dealId) {
        return deleteUsdDealMutation(prev, tx.dealId);
      }

      if (
        (tx.type === 'deal_sell' || tx.type === 'deal_personal_take') &&
        tx.dealId
      ) {
        const deal = prev.deals.find((d) => d.id === tx.dealId);
        if (!deal) return prev;
        const targetSale =
          deal.sales.find((s) => tx.saleId && s.id === tx.saleId) ||
          deal.sales.find(
            (s) =>
              Boolean(s.isPersonalTake) === (tx.type === 'deal_personal_take') &&
              (tx.type === 'deal_personal_take'
                ? roundMoney(s.usdAmount) === roundMoney(tx.amount)
                : roundMoney(s.netLydReceived) === roundMoney(tx.amount))
          );

        if (!targetSale) return prev;

        const remainingSales = deal.sales.filter((s) => s.id !== targetSale.id);
        const newSoldUsd = remainingSales
          .filter((s) => !s.isPersonalTake)
          .reduce((sum, s) => roundMoney(sum + s.usdAmount), 0);
        const newPersonalUsd = remainingSales
          .filter((s) => s.isPersonalTake)
          .reduce((sum, s) => roundMoney(sum + s.usdAmount), 0);
        const newRemainingUsd = roundMoney(
          Math.max(0, deal.totalUsdBought - newSoldUsd - newPersonalUsd)
        );
        const newTotalLydReceived = remainingSales
          .filter((s) => !s.isPersonalTake)
          .reduce((sum, s) => roundMoney(sum + s.netLydReceived), 0);
        const newRealizedProfit = remainingSales
          .filter((s) => !s.isPersonalTake)
          .reduce((sum, s) => roundMoney(sum + s.profitLyd), 0);

        const updatedDeal: UsdDeal = {
          ...deal,
          soldUsd: newSoldUsd,
          personalTakenUsd: newPersonalUsd,
          remainingUsd: newRemainingUsd,
          totalLydReceived: newTotalLydReceived,
          realizedProfitLyd: newRealizedProfit,
          status:
            remainingSales.length === 0
              ? 'open'
              : newRemainingUsd <= 0.005
              ? 'closed'
              : 'partial',
          sales: remainingSales,
          updatedAt: new Date().toISOString(),
        };

        const updatedAccounts = prev.accounts.map((a) => {
          let bal = a.balance;
          if (a.id === targetSale.sourceUsdAccountId) {
            bal = roundMoney(bal + targetSale.usdAmount);
          }
          if (!targetSale.isPersonalTake && a.id === targetSale.targetLydAccountId) {
            bal = roundMoney(bal - targetSale.netLydReceived);
          }
          return bal !== a.balance ? { ...a, balance: bal } : a;
        });

        return {
          ...prev,
          accounts: updatedAccounts,
          deals: prev.deals.map((d) => (d.id === deal.id ? updatedDeal : d)),
          transactions: prev.transactions.filter((t) => t.id !== txId),
        };
      }

      return deleteTransactionMutation(prev, txId);
    });
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
    persistState((prev) => {
      const personRes = ensureContactInList(
        prev.contacts,
        input.contactId,
        input.personName,
        input.phone,
        'شريك تجاري'
      );

      return addDebtRecordMutation(
        { ...prev, contacts: personRes.updatedContacts },
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
    });
  };

  const addDebtInstallment = (input: AddDebtInstallmentInput) => {
    persistState((prev) => {
      if (!input.accountId) {
        const target = prev.debts.find((d) => d.id === input.debtId);
        if (!target) return prev;
        const amount = roundMoney(Math.min(input.amount, target.remainingAmount));
        if (amount <= 0) return prev;
        const newPaid = roundMoney(target.paidAmount + amount);
        const newRem = roundMoney(Math.max(0, target.totalAmount - newPaid));
        return {
          ...prev,
          debts: prev.debts.map((d) =>
            d.id === target.id
              ? {
                  ...target,
                  paidAmount: newPaid,
                  remainingAmount: newRem,
                  status: newRem <= 0.005 ? 'completed' : 'active',
                  installments: [
                    {
                      id: `inst-${Date.now()}`,
                      idempotencyKey: input.idempotencyKey,
                      amount,
                      date: todayStr(),
                      paymentMethod: input.paymentMethod,
                      notes: input.notes,
                    },
                    ...target.installments,
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : d
          ),
        };
      }

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
    persistState((prev) => deleteDebtMutation(prev, debtId));
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
    setIsSyncing(true);
    try {
      const cfg = overrideCfg || state.supabaseConfig;
      const res = await pushStateToSupabase(state, cfg, currentUser, { forceOverwrite: true });
      setLastSyncMessage(res.message);
      if (res.ok && res.updatedAt) {
        updateSupabaseConfig({
          ...(overrideCfg || {}),
          lastSyncedAt: res.updatedAt,
        });
      }
      return res;
    } finally {
      setIsSyncing(false);
    }
  };

  const pullFromCloud = async (overrideCfg?: SupabaseConfig): Promise<SyncResult> => {
    setIsSyncing(true);
    try {
      const cfg = overrideCfg || state.supabaseConfig;
      const res = await pullStateFromSupabase(cfg, currentUser);
      setLastSyncMessage(res.message);
      if (res.ok && res.state) {
        const merged = mergePartialCloudState(state, res.state, res.updatedAt);
        setState(merged);
        const storageKey = getStorageKeyForUser(currentUser?.id);
        await AsyncStorage.setItem(storageKey, JSON.stringify(merged));
      }
      return res;
    } finally {
      setIsSyncing(false);
    }
  };

  const importStateJson = (jsonStr: string): boolean => {
    const validation = validateAndSanitizeBackupPayload(jsonStr, state);
    if (!validation.valid || !validation.state) {
      return false;
    }
    persistState(() => validation.state!);
    return true;
  };

  const resetDemoData = () => {
    persistState(() => INITIAL_MALI_STATE);
  };

  const loginUser = (user: AuthUser) => {
    setCurrentUser(user);
    savePersistedSessionUser(user, state.supabaseConfig).catch(() => {});

    (async () => {
      const userStorageKey = getStorageKeyForUser(user.id);
      const nextWorkspaceKey = user.isLocalOnly
        ? 'mali-local-offline'
        : `mali-vault-${user.id}`;

      let userState: MaliState = {
        ...INITIAL_MALI_STATE,
        supabaseConfig: {
          ...state.supabaseConfig,
          workspaceKey: nextWorkspaceKey,
        },
      };

      try {
        const cachedRaw = await AsyncStorage.getItem(userStorageKey);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          userState = {
            ...userState,
            ...parsed,
            supabaseConfig: {
              ...userState.supabaseConfig,
              ...(parsed.supabaseConfig || {}),
              workspaceKey: nextWorkspaceKey,
            },
          };
        }
      } catch {
        // ignore cache parse error
      }

      setState(userState);

      if (user.isLocalOnly) {
        setLastSyncMessage('تم تفعيل الوضع المحلي المعزول (بدون مزامنة سحابية).');
        return;
      }

      // السحب أولاً من السحابة لمنع استبدال بيانات المستخدم السحابية الأحدث ببيانات محلية افتراضية
      setIsSyncing(true);
      try {
        const pullRes = await pullStateFromSupabase(userState.supabaseConfig, user);
        if (pullRes.ok && pullRes.state) {
          const cloudTime = pullRes.updatedAt ? new Date(pullRes.updatedAt).getTime() : 0;
          const localTime = userState.lastModifiedAt
            ? new Date(userState.lastModifiedAt).getTime()
            : 0;

          if (!userState.lastModifiedAt || cloudTime >= localTime) {
            const merged = mergePartialCloudState(userState, pullRes.state, pullRes.updatedAt);
            setState(merged);
            await AsyncStorage.setItem(userStorageKey, JSON.stringify(merged));
            setLastSyncMessage('تم استرجاع ومزامنة خزنتك السحابية بنجاح.');
            return;
          }
        }

        // إذا لم تكن هناك نسخة سحابية سابقة لهذا المستخدم، نرفع خزنته الأولية
        if (pullRes.isEmpty) {
          const pushRes = await pushStateToSupabase(userState, userState.supabaseConfig, user);
          if (pushRes.ok) {
            setLastSyncMessage(pushRes.message);
          }
        }
      } catch {
        // ignore network error on initial login sync
      } finally {
        setIsSyncing(false);
      }
    })();
  };

  const logoutUser = () => {
    const cfg = state.supabaseConfig;
    setCurrentUser(null);
    setLastSyncMessage(null);
    setState(INITIAL_MALI_STATE);
    clearAuthSession(cfg).catch(() => {});
  };

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
        resetDemoData,
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
