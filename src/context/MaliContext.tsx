import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account,
  AuthUser,
  ContactPerson,
  ContactRole,
  Currency,
  DebtSettlementType,
  FinancialProcedure,
  MaliState,
  MarketRates,
  PaymentMethodType,
  SupabaseConfig,
} from '../types/mali';
import { INITIAL_MALI_STATE } from '../data/initialData';
import { SessionScope, emptyFinancialState } from '../services/sessionScope';
import { SerialQueue } from '../services/serialQueue';
import { createDurableSyncWorker, type CloudSyncStatus, type SyncOutbox, type SyncScheduler } from '../services/durableSyncWorker';
import { subscribeSyncLifecycle } from '../services/syncLifecycle';
import { syncConfigIdentity, validateSyncOutbox } from '../services/syncOutboxValidation';
import { financialStorage } from '../services/financialStorage';
import { CENTRAL_SERVER_ONLY } from '../services/centralStoragePolicy';
import { createCentralVaultSession } from '../services/centralVaultSession';
import { appendFinancialAudit, financialOperationId } from '../services/financialAudit';
import type { FinancialAuditMetadata } from '../types/financialAudit';
import { financialDate } from '../services/financialDate';
import { snapshotFinancialInput } from '../services/financialInputSnapshot';
import { conflictSnapshotForReview, prepareConflictResolution, sameFinancialState, type ConflictChoice, type ConflictReviewToken } from '../services/conflictResolutionCore';
import type { CloudConflictReview, CloudConflictResolutionResult } from '../types/cloudConflict';
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
  deleteContactMutation,
  deleteDebtMutation,
  deleteDebtInstallmentMutation,
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
  updateContactMutation,
  generateId,
  updateMarketRatesMutation,
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
  paymentMethod?: PaymentMethodType;
  settlementType?: DebtSettlementType;
  isNonCash?: boolean;
  nonCashReason?: string;
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
  logoutUser: () => Promise<boolean>;
  authCleanupPending: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncMessage: string | null;
  cloudSyncStatus: CloudSyncStatus<MaliState>;
  readonly mutationStatus: Readonly<{ phase: 'idle' | 'saving' | 'storage-error' }>;
  readonly mutationSessionGeneration: number;
  retryPendingMutation: () => Promise<boolean>;
  updateMarketRates: (rates: Partial<MarketRates>) => Promise<boolean>;
  addContact: (input: AddContactInput) => Promise<ContactPerson | null>;
  updateContact: (contactId: string, partial: Partial<ContactPerson>) => Promise<boolean>;
  deleteContact: (contactId: string) => Promise<boolean>;
  addAccount: (acc: Omit<Account, 'id' | 'updatedAt'>) => Promise<boolean>;
  updateAccountBalance: (accountId: string, newBalance: number) => Promise<boolean>;
  deleteAccount: (accountId: string) => Promise<boolean>;
  liquidateChequeToCash: (input: ChequeLiquidationInput) => Promise<boolean>;
  createUsdDeal: (input: CreateDealInput) => Promise<boolean>;
  recordDealSale: (input: RecordDealSaleInput) => Promise<boolean>;
  updateDealBuyReceipts: (dealId: string, images: string[]) => Promise<boolean>;
  updateDealSaleReceipts: (dealId: string, saleId: string, images: string[]) => Promise<boolean>;
  deleteUsdDeal: (dealId: string, reverseBalances?: boolean) => Promise<boolean>;
  addTransaction: (input: AddTransactionInput) => Promise<boolean>;
  deleteTransaction: (txId: string) => Promise<boolean>;
  updateCategoryBudget: (category: string, monthlyLimitLyd: number) => Promise<boolean>;
  addDebt: (input: AddDebtInput) => Promise<boolean>;
  addDebtInstallment: (input: AddDebtInstallmentInput) => Promise<boolean>;
  deleteDebtInstallment: (debtId: string, installmentId: string) => Promise<boolean>;
  deleteDebt: (debtId: string) => Promise<boolean>;
  addProcedure: (input: AddProcedureInput) => Promise<boolean>;
  toggleProcedureStage: (procedureId: string, stageId: string) => Promise<boolean>;
  addProcedureStage: (procedureId: string, stageTitle: string) => Promise<boolean>;
  deleteProcedure: (procedureId: string) => Promise<boolean>;
  updateSupabaseConfig: (cfg: Partial<SupabaseConfig>) => Promise<boolean>;
  syncToCloud: (overrideCfg?: SupabaseConfig) => Promise<SyncResult>;
  pullFromCloud: (overrideCfg?: SupabaseConfig) => Promise<SyncResult>;
  importStateJson: (jsonStr: string) => Promise<boolean>;
  inspectCloudConflict: () => CloudConflictReview | null;
  resolveCloudConflict: (review: Readonly<ConflictReviewToken>, choice: ConflictChoice, reason: string) => Promise<CloudConflictResolutionResult>;
}

const MaliContext = createContext<MaliContextValue | undefined>(undefined);

function mergePartialCloudState(base: MaliState, cloud: Partial<MaliState>, updatedAt?: string, snapshotUpdatedAt?: string | null): MaliState {
  return {
    ...base,
    financialAudit: cloud.financialAudit,
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

export const MaliProvider: React.FC<{ children: React.ReactNode; syncScheduler?: SyncScheduler }> = ({ children, syncScheduler }) => {
  const [state, setState] = useState<MaliState>(INITIAL_MALI_STATE);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus<MaliState>>({ phase: 'idle', outbox: null });
  const [authCleanupPending, setAuthCleanupPending] = useState(false);
  const [mutationStatus, setMutationStatus] = useState<MaliContextValue['mutationStatus']>({ phase: 'idle' });
  const pendingLogoutConfig = useRef<SupabaseConfig | null>(null);

  const theme = isDarkMode ? CALM_DARK_THEME : CALM_LIGHT_THEME;

  const scope = useRef(new SessionScope());
  const [mutationSession, setMutationSession] = useState({ generation: 0, userId: null as string | null });
  const localRevision = useRef(0);
  const recoveryRequired = useRef(false);
  const stateRef = useRef(state);
  const durableStateRef = useRef(state);
  const userRef = useRef<AuthUser | null>(null);
  const centralSession = useRef(createCentralVaultSession(
    { pull: (config, user) => pullStateFromSupabase(config, user),
      push: (candidate, config, user) => pushStateToSupabase(candidate, config, user) },
    (user) => ({
      ...emptyFinancialState(INITIAL_MALI_STATE),
      budgets: [],
      supabaseConfig: { ...INITIAL_MALI_STATE.supabaseConfig, workspaceKey: `mali-vault-${user.id}`, lastSyncedAt: undefined },
    }),
  ));
  const syncQueue = useRef(new SerialQueue());
  const storageQueue = useRef(new SerialQueue());
  const mutationQueue = useRef(new SerialQueue());
  const mutationRequests = useRef(0);
  const configurationSaving = useRef(false);
  const pendingMutation = useRef<{
    token: ReturnType<SessionScope['capture']>; user: AuthUser | null;
    requestKey: string; next: MaliState; revision: number; configId: string; verified?: MaliState;
  } | null>(null);
  const cacheReplacement = useRef<{ token: ReturnType<SessionScope['capture']>; next: MaliState; verified?: MaliState } | null>(null);
  const isFinancialMutationLocked = () => mutationRequests.current > 0 || pendingMutation.current !== null;
  const hydrating = useRef(false);
  const foreground = useRef(true);
  const syncWorker = useRef<ReturnType<typeof createDurableSyncWorker<MaliState>> | null>(null);
  const conflictRequest = useRef<AbortController | null>(null);
  const applyState = (next: MaliState) => { durableStateRef.current = next; stateRef.current = next; setState(next); };

  const saveCache = (next: MaliState, ownerId?: string | null, retained?: SyncOutbox<MaliState> | null) => {
    if (CENTRAL_SERVER_ONLY) return Promise.reject(new Error('التخزين المالي على جهاز العميل محظور في الوضع المركزي.'));
    const record = retained === undefined ? syncWorker.current?.getRecord() : retained;
    const raw = JSON.stringify({ ...next, cloudOutbox: record?.ownerId === ownerId ? record : undefined });
    return storageQueue.current.run(async () => {
      const key = getStorageKeyForUser(ownerId);
      await financialStorage.setItem(key, raw);
      if (await financialStorage.getItem(key) !== raw) throw new Error('Unverified financial write.');
    });
  };

  function activateWorker() {
    if (CENTRAL_SERVER_ONLY) return;
    syncWorker.current?.setActive(foreground.current && !hydrating.current && !recoveryRequired.current && !pendingMutation.current && !configurationSaving.current && stateRef.current.supabaseConfig.autoSync);
  }

  function startSyncWorker(user: AuthUser, token: ReturnType<SessionScope['capture']>, initial?: SyncOutbox<MaliState>) {
    syncWorker.current?.dispose();
    const worker: ReturnType<typeof createDurableSyncWorker<MaliState>> = createDurableSyncWorker<MaliState>({
      ownerId: user.id, initial, scheduler: syncScheduler,
      withBaseline: (payload, timestamp) => ({ ...payload, supabaseConfig: { ...payload.supabaseConfig, lastSyncedAt: timestamp } }),
      persist: record => storageQueue.current.run(async () => {
        if (!scope.current.isCurrent(token) || syncWorker.current !== worker) throw new Error('Stale worker.');
        const before = stateRef.current;
        const staged = pendingMutation.current;
        const writesCandidate = !!staged && scope.current.isCurrent(staged.token) && staged.user?.id === record.ownerId &&
          staged.revision === record.pending?.revision && staged.configId === syncConfigIdentity(record.pending.payload.supabaseConfig);
        // The UI still holds the previous accepted state while enqueue verifies a candidate.
        // ACK/retry metadata writes always preserve the newest committed financial records.
        const replacement = cacheReplacement.current;
        const writesReplacement = !!replacement && scope.current.isCurrent(replacement.token);
        const base = writesCandidate ? record.pending!.payload : writesReplacement ? replacement.next : durableStateRef.current;
        const sameConfig = syncConfigIdentity(base.supabaseConfig) === record.configId;
        const next = { ...base,
          pendingCloudSync: !!record.pending || (record.acknowledgedRevision !== undefined && (base.localRevision ?? 0) > record.acknowledgedRevision),
          supabaseConfig: sameConfig ? { ...base.supabaseConfig, lastSyncedAt: record.syncedAt } : base.supabaseConfig };
        const raw = JSON.stringify({ ...next, cloudOutbox: record });
        const key = getStorageKeyForUser(user.id);
        await financialStorage.setItem(key, raw);
        if (await financialStorage.getItem(key) !== raw) throw new Error('Unverified outbox write.');
        if (!scope.current.isCurrent(token) || syncWorker.current !== worker) throw new Error('Stale worker.');
        if (writesCandidate) {
          if (pendingMutation.current === staged) staged.verified = next;
          else if (durableStateRef.current.localRevision === staged.revision) {
            // The candidate may publish while an older in-flight ACK finishes verifying.
            applyState({ ...durableStateRef.current, pendingCloudSync: next.pendingCloudSync,
              supabaseConfig: next.supabaseConfig });
          }
        } else if (writesReplacement) {
          if (cacheReplacement.current !== replacement) throw new Error('Cancelled replacement.');
          replacement.verified = next;
        } else if (stateRef.current === before) applyState(next);
      }),
      send: (payload, signal) => syncQueue.current.run(async () => {
        if (!scope.current.isCurrent(token) || syncWorker.current !== worker || signal.aborted) return { ok: false, success: false, failureKind: 'session', message: 'تغيرت جلسة المستخدم.' };
        if (syncConfigIdentity(payload.supabaseConfig) !== syncConfigIdentity(stateRef.current.supabaseConfig)) return { ok: false, success: false, failureKind: 'configuration', message: 'تغير مشروع المزامنة. تم إلغاء طلب الرفع السابق.' };
        return pushStateToSupabase(payload, payload.supabaseConfig, user, { signal });
      }),
      onStatus: status => {
        if (!scope.current.isCurrent(token) || syncWorker.current !== worker) return;
        setCloudSyncStatus(status); setIsSyncing(status.phase === 'uploading');
        if (status.phase === 'storage-error') setLastSyncMessage('تعذر حفظ قائمة الرفع على الجهاز. تم إيقاف الرفع؛ صدّر نسخة احتياطية وأعد المحاولة.');
      },
      onResult: result => { if (scope.current.isCurrent(token) && syncWorker.current === worker) setLastSyncMessage(result.message); },
    });
    syncWorker.current = worker;
    return worker;
  }

  useEffect(() => subscribeSyncLifecycle(active => {
    foreground.current = active; activateWorker();
  }, () => syncWorker.current?.wake()), []);

  useEffect(() => {
    const activeScope = scope.current;
    const boot = activeScope.capture();
    let mounted = true;
    (async () => {
      try {
        // Callback exchange must finish before looking up the persisted session.
        const callbackUser = await consumeOAuthRedirectIfPresent(INITIAL_MALI_STATE.supabaseConfig);
        const savedUser = callbackUser || await getPersistedSessionUser(INITIAL_MALI_STATE.supabaseConfig);
        const savedTheme = await AsyncStorage.getItem(THEME_KEY);
        if (!mounted || !activeScope.isCurrent(boot)) return;
        if (savedTheme === 'dark') setIsDarkMode(true);
        if (savedUser) loginUser(savedUser);
      } catch {
        if (mounted && activeScope.isCurrent(boot)) setLastSyncMessage('تعذر قراءة البيانات المحفوظة.');
      } finally {
        if (mounted && activeScope.isCurrent(boot)) setIsLoading(false);
      }
    })();
    return () => { mounted = false; activeScope.begin(null); conflictRequest.current?.abort(); syncWorker.current?.dispose(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  };

  async function commitPendingMutation(): Promise<boolean> {
    const staged = pendingMutation.current;
    if (!staged || !scope.current.isCurrent(staged.token) || staged.configId !== syncConfigIdentity(stateRef.current.supabaseConfig)) return false;
    setMutationStatus({ phase: 'saving' }); setLastSyncMessage(null);
    const { user, token, next, revision, configId } = staged;
    if (CENTRAL_SERVER_ONLY) {
      if (!user || user.isLocalOnly) return false;
      const confirmed = await centralSession.current.update(() => next);
      if (!scope.current.isCurrent(token) || pendingMutation.current !== staged) return false;
      pendingMutation.current = null;
      if (!confirmed.ok) {
        recoveryRequired.current = true;
        setMutationStatus({ phase: 'storage-error' });
        setLastSyncMessage(confirmed.message + ' أعد تسجيل الدخول لاسترجاع النسخة الموثّقة.');
        return false;
      }
      localRevision.current = revision;
      applyState(confirmed.state);
      setMutationStatus({ phase: 'idle' });
      setLastSyncMessage('تم اعتماد العملية وحفظها على الخادم المركزي.');
      return true;
    }
    const worker = syncWorker.current || (user && !user.isLocalOnly ? startSyncWorker(user, token) : null);
    worker?.setActive(false);
    try {
      if (user && !user.isLocalOnly && worker) {
        await worker.enqueue(next, revision, configId, next.supabaseConfig.lastSyncedAt);
        if (!staged.verified) throw new Error('Unverified candidate.');
      } else {
        await saveCache(next, user?.id);
        staged.verified = next;
      }
      if (!scope.current.isCurrent(token) || pendingMutation.current !== staged) return false;
      localRevision.current = revision;
      pendingMutation.current = null;
      applyState(staged.verified);
      setMutationStatus({ phase: 'idle' });
      setLastSyncMessage('تم الحفظ على هذا الجهاز.');
      activateWorker();
      return true;
    } catch {
      if (scope.current.isCurrent(token) && pendingMutation.current === staged) {
        setMutationStatus({ phase: 'storage-error' });
        setLastSyncMessage('تعذر تأكيد حفظ العملية. احتُفظ بها لإعادة المحاولة دون تكرارها.');
      }
      return false;
    }
  }

  const persistState = (updater: (prev: MaliState) => MaliState,
    metadata?: Partial<Omit<FinancialAuditMetadata, 'ownerId'>>, requestKey = ''): Promise<boolean> => {
    const token = mutationSession;
    if (!scope.current.isCurrent(token) || hydrating.current || recoveryRequired.current || configurationSaving.current) return Promise.resolve(false);
    mutationRequests.current++;
    const result = mutationQueue.current.run(async () => {
      if (!scope.current.isCurrent(token) || hydrating.current || recoveryRequired.current || configurationSaving.current) return false;
      if (pendingMutation.current) {
        if (pendingMutation.current.requestKey !== requestKey) {
          setLastSyncMessage('أعد محاولة حفظ العملية السابقة قبل بدء عملية أخرى.'); return false;
        }
        return commitPendingMutation();
      }
      const prev = durableStateRef.current;
      let mutation: MaliState;
      try {
        const candidate = updater(prev);
        mutation = appendFinancialAudit(prev, candidate, {
          ownerId: userRef.current?.id || 'anonymous', action: metadata?.action || 'financial_update',
          reason: metadata?.reason || 'عملية مالية معتمدة من هذا الجهاز.', operationId: metadata?.operationId || financialOperationId(prev, candidate),
        });
      } catch {
        setLastSyncMessage('تعذر حفظ دليل العملية المالي. لم يتم تغيير الخزنة.'); return false;
      }
      if (mutation === prev || JSON.stringify(mutation) === JSON.stringify(prev)) {
        setLastSyncMessage('لم يتم تسجيل العملية. راجع الحساب والعملة والرصيد والمبلغ ثم حاول مجدداً.'); return false;
      }
      const user = userRef.current, revision = localRevision.current + 1;
      if (!Number.isSafeInteger(revision)) return false;
      const next: MaliState = JSON.parse(JSON.stringify({ ...touchState(mutation), localRevision: revision, pendingCloudSync: !!user && !user.isLocalOnly }));
      pendingMutation.current = { token, user, requestKey, next, revision, configId: syncConfigIdentity(next.supabaseConfig) };
      return commitPendingMutation();
    });
    return result.finally(() => { if (scope.current.isCurrent(token)) mutationRequests.current--; });
  };

  const retryPendingMutation = (): Promise<boolean> => {
    const token = mutationSession;
    return mutationQueue.current.run(async () => scope.current.isCurrent(token) && !hydrating.current && !recoveryRequired.current && !configurationSaving.current
      ? commitPendingMutation() : false);
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
      id: generateId('cnt'),
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

  function captureFinancialInput<T extends object>(input: T, kind: 'object' | 'array' = 'object') {
    if (!scope.current.isCurrent(mutationSession)) return null;
    try { return snapshotFinancialInput(input, kind); }
    catch { setLastSyncMessage('لم يتم تسجيل العملية. استخدم بيانات مالية بسيطة وصحيحة.'); return null; }
  }

  const updateMarketRates = (rates: Partial<MarketRates>) => {
    const snapshot = captureFinancialInput(rates); if (!snapshot) return Promise.resolve(false);
    rates = snapshot.value;
    return persistState((prev) => updateMarketRatesMutation(prev, rates), undefined, 'rates:' + snapshot.fingerprint);
  };

  const addContact = async (input: AddContactInput): Promise<ContactPerson | null> => {
    const snapshot = captureFinancialInput(input); if (!snapshot) return null;
    input = snapshot.value;
    const saved = await persistState((prev) => {
      const newContact: ContactPerson = {
      id: generateId('cnt'),
      name: input.name.trim(),
      phone: input.phone.trim(),
      role: input.role,
      bankDetails: input.bankDetails?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      createdAt: todayStr(),
    };
      return !newContact.name || prev.contacts.some(contact => contact.id === newContact.id) ? prev : ({
      ...prev,
      contacts: [newContact, ...prev.contacts],
      });
    }, undefined, 'contact:add:' + snapshot.fingerprint);
    return saved ? stateRef.current.contacts[0] : null;
  };

  const updateContact = (contactId: string, partial: Partial<ContactPerson>) => {
    const snapshot = captureFinancialInput(partial); if (!snapshot) return Promise.resolve(false);
    partial = snapshot.value;
    return persistState(prev => updateContactMutation(prev, contactId, partial), undefined, 'contact:update:' + JSON.stringify(contactId) + ':' + snapshot.fingerprint);
  };

  const deleteContact = (contactId: string) => {
    return persistState(prev => deleteContactMutation(prev, contactId), undefined, 'contact:delete:' + contactId);
  };

  const addAccount = (acc: Omit<Account, 'id' | 'updatedAt'>) => {
    const snapshot = captureFinancialInput(acc); if (!snapshot) return Promise.resolve(false);
    acc = snapshot.value;
    return persistState((prev) => createAccountMutation(prev, acc), undefined, 'account:add:' + snapshot.fingerprint);
  };

  const updateAccountBalance = (accountId: string, newBalance: number) => {
    return persistState((prev) => {
      const candidate = updateAccountBalanceMutation(prev, accountId, newBalance);
      return candidate !== prev && prev.accounts.find(row => row.id === accountId)?.balance === candidate.accounts.find(row => row.id === accountId)?.balance
        ? prev : candidate;
    },{action:'balance_correction',reason:'تصحيح يدوي لرصيد الحساب '+accountId}, 'account:balance:' + JSON.stringify([accountId, newBalance]));
  };

  const deleteAccount = (accountId: string) => {
    return persistState((prev) => deleteAccountMutation(prev, accountId), undefined, 'account:delete:' + accountId);
  };

  const liquidateChequeToCash = (input: ChequeLiquidationInput) => {
    const snapshot = captureFinancialInput(input); if (!snapshot) return Promise.resolve(false);
    input = snapshot.value;
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
      }), undefined, 'cheque:' + snapshot.fingerprint
    );
  };

  const createUsdDeal = (input: CreateDealInput) => {
    const snapshot = captureFinancialInput(input); if (!snapshot) return Promise.resolve(false);
    input = snapshot.value;
    return persistState((prev) => {
      const sellerRes = ensureContactInList(
        prev.contacts,
        input.contactId,
        input.counterparty,
        input.counterpartyPhone,
        'تاجر عملة'
      );
      const dealId = generateId('deal');
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
    }, undefined, 'deal:add:' + snapshot.fingerprint);
  };

  const recordDealSale = (input: RecordDealSaleInput) => {
    const snapshot = captureFinancialInput(input); if (!snapshot) return Promise.resolve(false);
    input = snapshot.value;
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
    }, undefined, 'deal:sell:' + snapshot.fingerprint);
  };

  const updateDealBuyReceipts = (dealId: string, images: string[]) => {
    const snapshot = captureFinancialInput(images, 'array'); if (!snapshot) return Promise.resolve(false);
    images = snapshot.value;
    return persistState((prev) => ({
      ...prev,
      deals: prev.deals.map((d) =>
        d.id === dealId
          ? { ...d, buyReceiptImages: images.length > 0 ? images : undefined }
          : d
      ),
    }), undefined, 'deal:buy-receipts:' + JSON.stringify(dealId) + ':' + snapshot.fingerprint);
  };

  const updateDealSaleReceipts = (
    dealId: string,
    saleId: string,
    images: string[]
  ) => {
    const snapshot = captureFinancialInput(images, 'array'); if (!snapshot) return Promise.resolve(false);
    images = snapshot.value;
    return persistState((prev) => ({
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
    }), undefined, 'deal:sale-receipts:' + JSON.stringify([dealId, saleId]) + ':' + snapshot.fingerprint);
  };

  const deleteUsdDeal = (dealId: string) => {
    return persistState((prev) => deleteUsdDealMutation(prev, dealId),{action:'deal_reversal',reason:'عكس صفقة الدولار '+dealId}, 'deal:delete:' + dealId);
  };

  const addTransaction = (input: AddTransactionInput) => {
    const snapshot = captureFinancialInput(input); if (!snapshot) return Promise.resolve(false);
    input = snapshot.value;
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
    }, undefined, 'transaction:add:' + snapshot.fingerprint);
  };

  const deleteTransaction = (txId: string) => {
    return persistState((prev) => deleteTransactionMutation(prev, txId),{action:'transaction_reversal',reason:'عكس الحركة المالية '+txId}, 'transaction:delete:' + txId);
  };

  const updateCategoryBudget = (category: string, monthlyLimitLyd: number) => {
    return persistState((prev) => {
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
    }, undefined, 'budget:' + JSON.stringify([category, monthlyLimitLyd]));
  };

  const addDebt = (input: AddDebtInput) => {
    const snapshot = captureFinancialInput(input); if (!snapshot) return Promise.resolve(false);
    input = snapshot.value;
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
    }, undefined, 'debt:add:' + snapshot.fingerprint);
  };

  const addDebtInstallment = (input: AddDebtInstallmentInput) => {
    const snapshot = captureFinancialInput(input); if (!snapshot) return Promise.resolve(false);
    input = snapshot.value;
    return persistState((prev) => {
      const candidate = settleDebtInstallmentMutation(prev, {
        idempotencyKey: input.idempotencyKey,
        debtId: input.debtId,
        amount: input.amount,
        accountId: input.accountId,
        paymentMethod: input.paymentMethod || 'cash',
        settlementType: input.settlementType,
        isNonCash: input.isNonCash,
        nonCashReason: input.nonCashReason,
        notes: input.notes,
        date: todayStr(),
      });
      return candidate === prev ? prev : candidate;
    }, undefined, 'debt:installment:' + snapshot.fingerprint);
  };

  const deleteDebtInstallment = (debtId: string, installmentId: string) => {
    return persistState(
      (prev) => {
        const candidate = deleteDebtInstallmentMutation(prev, debtId, installmentId);
        return candidate === prev ? prev : candidate;
      },
      { action: 'installment_reversal', reason: 'عكس قسط الدين ' + installmentId },
      'debt:installment:delete:' + debtId + ':' + installmentId
    );
  };

  const deleteDebt = (debtId: string) => {
    return persistState((prev) => deleteDebtMutation(prev, debtId),{action:'debt_reversal',reason:'عكس الدين '+debtId}, 'debt:delete:' + debtId);
  };

  const addProcedure = (input: AddProcedureInput) => {
    const snapshot = captureFinancialInput(input); if (!snapshot) return Promise.resolve(false);
    input = snapshot.value;
    return persistState((prev) => {
    const newProc: FinancialProcedure = {
      id: generateId('proc'),
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
          ? input.stages.map((st) => ({
              id: generateId('stage'),
              title: st,
              completed: false,
            }))
          : [
              {
                id: generateId('stage'),
                title: 'بدء المعاملة وتجهيز المستندات',
                completed: true,
                completedAt: todayStr(),
              },
              {
                id: generateId('stage'),
                title: 'المراجعة والتنفيذ بالمصرف/الجهة',
                completed: false,
              },
              {
                id: generateId('stage'),
                title: 'إتمام الإجراء والاعتماد النهائي',
                completed: false,
              },
            ],
    };

    return {
      ...prev,
      procedures: [newProc, ...prev.procedures],
    };
    }, undefined, 'procedure:add:' + snapshot.fingerprint);
  };

  const toggleProcedureStage = (procedureId: string, stageId: string) => {
    return persistState((prev) => ({
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
    }), undefined, 'procedure:toggle:' + JSON.stringify([procedureId, stageId]));
  };

  const addProcedureStage = (procedureId: string, stageTitle: string) => {
    if (!stageTitle.trim()) return Promise.resolve(false);
    return persistState((prev) => ({
      ...prev,
      procedures: prev.procedures.map((p) => {
        if (p.id !== procedureId) return p;
        const stages = [
          ...p.stages,
          { id: generateId('stage'), title: stageTitle.trim(), completed: false },
        ];
        return {
          ...p,
          stages,
          status: 'in_progress',
        };
      }),
    }), undefined, 'procedure:stage:' + JSON.stringify([procedureId, stageTitle]));
  };

  const deleteProcedure = (procedureId: string) => {
    return persistState((prev) => ({
      ...prev,
      procedures: prev.procedures.filter((p) => p.id !== procedureId),
    }), undefined, 'procedure:delete:' + procedureId);
  };

  const updateSupabaseConfig = async (cfg: Partial<SupabaseConfig>) => {
    if (CENTRAL_SERVER_ONLY) {
      setLastSyncMessage('خادم مالي المركزي ثابت ويديره المسؤول؛ لا يمكن للعميل تغييره.');
      return false;
    }
    const token = mutationSession;
    if (!scope.current.isCurrent(token) || hydrating.current || recoveryRequired.current || isFinancialMutationLocked() || configurationSaving.current) return false;
    const snapshot = captureFinancialInput(cfg); if (!snapshot) return false;
    cfg = snapshot.value;
    configurationSaving.current = true; activateWorker();
    return mutationQueue.current.run(async () => {
      try {
        if (!scope.current.isCurrent(token) || pendingMutation.current) return false;
        const before = durableStateRef.current;
        const config = { ...before.supabaseConfig, ...cfg };
        if (config.url !== before.supabaseConfig.url || config.anonKey !== before.supabaseConfig.anonKey) config.lastSyncedAt = undefined;
        await syncWorker.current?.changeConfiguration(syncConfigIdentity(config));
        if (!scope.current.isCurrent(token)) return false;
        const next = { ...durableStateRef.current, supabaseConfig: config };
        // Configuration is device metadata, not an unsynced financial mutation.
        await saveCache(next, userRef.current?.id);
        if (!scope.current.isCurrent(token)) return false;
        applyState(next);
        return true;
      } catch {
        if (scope.current.isCurrent(token)) setLastSyncMessage('تعذر حفظ إعدادات المزامنة على هذا الجهاز.');
        return false;
      } finally {
        if (scope.current.isCurrent(token)) { configurationSaving.current = false; activateWorker(); }
      }
    });
  };

  const syncToCloud = async (overrideCfg?: SupabaseConfig): Promise<SyncResult> => {
    if (CENTRAL_SERVER_ONLY) return {
      ok: false, success: false, message: 'الحفظ يتم مباشرة على الخادم مع كل عملية؛ لا توجد قائمة رفع محلية.',
    };
    const token = mutationSession;
    const user = userRef.current;
    try {
      if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
      if (recoveryRequired.current || hydrating.current) return { ok: false, success: false, message: 'استرجع نسخة صحيحة قبل الرفع.' };
      if (isFinancialMutationLocked() || configurationSaving.current) return { ok: false, success: false, message: 'أكمل حفظ العملية على الجهاز قبل الرفع.' };
      if (!user || user.isLocalOnly) return { ok: false, success: false, failureKind: 'session', message: 'سجل الدخول بحساب سحابي قبل الرفع.' };
      const current = stateRef.current;
      const cfg = overrideCfg || current.supabaseConfig;
      const worker = syncWorker.current || startSyncWorker(user, token);
      const acknowledgement = worker.getRecord();
      if (cloudSyncStatus.phase === 'storage-error' && acknowledgement?.pending === null && acknowledgement.acknowledgedRevision === localRevision.current
        && acknowledgement.syncedAt && acknowledgement.configId === syncConfigIdentity(cfg)) return await worker.flush();
      await worker.enqueue({ ...current, supabaseConfig: cfg }, localRevision.current, syncConfigIdentity(cfg), cfg.lastSyncedAt);
      await worker.resumeAfterRepair(syncConfigIdentity(cfg));
      return await worker.flush();
    } catch {
      return { ok: false, success: false, message: 'تعذر حفظ قائمة الرفع محلياً. تم الاحتفاظ بالتعديل.' };
    }
  };

  const pullFromCloud = async (overrideCfg?: SupabaseConfig): Promise<SyncResult> => {
    if (CENTRAL_SERVER_ONLY) {
      const user = userRef.current, token = mutationSession;
      if (!user || user.isLocalOnly || !scope.current.isCurrent(token) || hydrating.current ||
          isFinancialMutationLocked() || configurationSaving.current) {
        return { ok: false, success: false, message: 'يلزم إنهاء العملية الجارية وتسجيل الدخول بحساب سحابي.' };
      }
      setIsSyncing(true);
      try {
        const fresh = await centralSession.current.open(user, stateRef.current.supabaseConfig);
        if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
        if (!fresh.ok) {
          recoveryRequired.current = true;
          setLastSyncMessage(fresh.message);
          return { ok: false, success: false, message: fresh.message };
        }
        recoveryRequired.current = false;
        applyState(fresh.state);
        setMutationStatus({ phase: 'idle' });
        setLastSyncMessage('تم تحديث البيانات المالية مباشرة من الخادم.');
        return { ok: true, success: true, message: 'تم تحديث البيانات المالية من الخادم.' };
      } finally { if (scope.current.isCurrent(token)) setIsSyncing(false); }
    }
    const token = mutationSession;
    const user = userRef.current;
    if (!scope.current.isCurrent(token) || hydrating.current || recoveryRequired.current) return { ok: false, success: false, message: 'انتظر اكتمال الحفظ أو مراجعة التعارض قبل الاسترجاع.' };
    setIsSyncing(true);
    return syncQueue.current.run(async () => {
    const before = stateRef.current;
    let ownsReplacement = false;
    try {
      if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
      if (hydrating.current || recoveryRequired.current) return { ok: false, success: false, message: 'انتظر اكتمال الحفظ أو مراجعة التعارض قبل الاسترجاع.' };
      if (isFinancialMutationLocked() || configurationSaving.current) return { ok: false, success: false, message: 'أكمل حفظ العملية على الجهاز قبل الاسترجاع.' };
      const res = await pullStateFromSupabase(overrideCfg || before.supabaseConfig, user);
      if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
      // A concurrent local edit must never be discarded by a delayed pull.
      if (stateRef.current !== before || hydrating.current || recoveryRequired.current || isFinancialMutationLocked() || configurationSaving.current) {
        return { ok: false, success: false, conflictDetected: true, message: 'توجد تعديلات محلية جديدة. لم يتم استبدالها بالنسخة السحابية.' };
      }
      setLastSyncMessage(res.message);
      if (res.ok && res.state && before.pendingCloudSync) {
        const message = 'توجد تعديلات محلية غير مرفوعة. صدّر نسخة احتياطية قبل استبدالها بالنسخة السحابية.';
        setLastSyncMessage(message);
        return { ...res, ok: false, success: false, conflictDetected: true, message };
      }
      if (res.isEmpty) {
        if (recoveryRequired.current) {
          const message = 'الخزنة السحابية فارغة. تم الاحتفاظ بالنسخة المحلية التي تحتاج استعادة دون استبدالها.';
          setLastSyncMessage(message);
          return { ...res, ok: false, success: false, message };
        }
        const cleared = { ...before, supabaseConfig: { ...(overrideCfg || before.supabaseConfig), lastSyncedAt: undefined } };
        ownsReplacement = true; hydrating.current = true; activateWorker();
        const replacement = { token, next: cleared } as NonNullable<typeof cacheReplacement.current>;
        cacheReplacement.current = replacement;
        await syncWorker.current?.observeCloudBaseline(undefined, true);
        if (!replacement.verified) { await saveCache(cleared, user?.id); replacement.verified = cleared; }
        if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
        applyState(replacement.verified);
      }
      if (res.ok && res.state) {
        const merged = mergePartialCloudState({ ...before, supabaseConfig: overrideCfg || before.supabaseConfig }, res.state, res.updatedAt, res.snapshotUpdatedAt);
        ownsReplacement = true; hydrating.current = true; activateWorker();
        const replacement = { token, next: merged } as NonNullable<typeof cacheReplacement.current>;
        cacheReplacement.current = replacement;
        await syncWorker.current?.observeCloudBaseline(res.snapshotUpdatedAt === null ? undefined : res.snapshotUpdatedAt || res.updatedAt);
        if (!replacement.verified) { await saveCache(merged, user?.id); replacement.verified = merged; }
        if (!scope.current.isCurrent(token)) return { ok: false, success: false, message: 'تغيرت جلسة المستخدم.' };
        recoveryRequired.current = false;
        applyState(replacement.verified);
      }
      return res;
    } catch {
      if (scope.current.isCurrent(token) && cacheReplacement.current) {
        recoveryRequired.current = true;
        setLastSyncMessage('تعذر تأكيد حفظ النسخة المسترجعة. أعد الاسترجاع أو استعد نسخة صحيحة قبل التعديل.');
      }
      return { ok: false, success: false, message: 'تعذر تأكيد حفظ النسخة المسترجعة على الجهاز.' };
    } finally {
      if (scope.current.isCurrent(token)) {
        if (ownsReplacement) { cacheReplacement.current = null; hydrating.current = false; }
        if (!hydrating.current) setIsSyncing(false);
        activateWorker();
      }
    }
    });
  };

  /** Archive first, then one verified commit of finances AND the replacement outbox. */
  async function recoverEnvelope(next: MaliState, record: SyncOutbox<MaliState> | undefined,
    evidence: string, token: ReturnType<SessionScope['capture']>, user: AuthUser | null, before: MaliState) {
    const current = () => scope.current.isCurrent(token) && stateRef.current === before;
    const raw = JSON.stringify({ ...next, cloudOutbox: record });
    await storageQueue.current.run(async () => {
      if (!current()) throw new Error('Stale recovery.');
      const key = getStorageKeyForUser(user?.id);
      await financialStorage.recoverItem(key, raw, evidence, current);
      if (await financialStorage.getItem(key) !== raw) throw new Error('Unverified recovery.');
    });
    if (!current()) return false;
    localRevision.current = next.localRevision!; recoveryRequired.current = false; applyState(next);
    if (user && !user.isLocalOnly) startSyncWorker(user, token, record);
    return true;
  }

  const inspectCloudConflict = (): CloudConflictReview | null => {
    const user = userRef.current, token = mutationSession, record = syncWorker.current?.getRecord();
    if (!scope.current.isCurrent(token) || !user || user.isLocalOnly || hydrating.current || isFinancialMutationLocked() || configurationSaving.current
      || record?.stop?.reason !== 'conflict' || !record.stop.attempted || !record.stop.result.cloudState || !record.stop.result.updatedAt
      || record.ownerId !== user.id || record.configId !== syncConfigIdentity(stateRef.current.supabaseConfig)) return null;
    try {
      const original = conflictSnapshotForReview(record.stop.result.cloudState as MaliState);
      return Object.freeze({ token: Object.freeze({ ownerId: user.id, sessionGeneration: token.generation, configId: record.configId,
        localRevision: localRevision.current, cloudTimestamp: record.stop.result.updatedAt }), local: conflictSnapshotForReview(stateRef.current),
        cloud: original, originalCloud: original, attempted: conflictSnapshotForReview(record.stop.attempted.payload) });
    } catch { return null; }
  };

  const resolveCloudConflict = async (suppliedReview: Readonly<ConflictReviewToken>, choice: ConflictChoice, reason: string): Promise<CloudConflictResolutionResult> => {
    const fail = (message: string): CloudConflictResolutionResult => ({ ok: false, success: false, conflictDetected: true, message });
    let review: ConflictReviewToken;
    try { review = snapshotFinancialInput(suppliedReview).value; } catch { return fail('تعذر قراءة قرار التعارض. أعد مراجعة النسختين.'); }
    if (!['keep-local', 'adopt-cloud'].includes(choice) || typeof reason !== 'string' || !reason.trim() || reason.length > 2048)
      return fail('اكتب سبب اعتماد النسخة قبل حل التعارض.');
    const token = mutationSession, user = userRef.current, before = stateRef.current, worker = syncWorker.current, record = worker?.getRecord();
    if (!scope.current.isCurrent(token) || !user || user.isLocalOnly || hydrating.current || isFinancialMutationLocked() || configurationSaving.current
      || !record || record.stop?.reason !== 'conflict' || review.ownerId !== user.id || review.sessionGeneration !== token.generation
      || review.configId !== syncConfigIdentity(before.supabaseConfig) || review.localRevision !== localRevision.current)
      return fail('تغيرت الجلسة أو النسخة المحلية. أعد مراجعة النسختين قبل القرار.');
    const controller = new AbortController(); conflictRequest.current = controller;
    const current = () => scope.current.isCurrent(token) && stateRef.current === before && syncWorker.current === worker
      && worker?.getRecord() === record && !controller.signal.aborted;
    hydrating.current = true; activateWorker(); setIsSyncing(true);
    const timer = setTimeout(() => controller.abort(), 30_000);
    let replacedWorker = false;
    try {
      const fresh = await syncQueue.current.run(async () => {
        if (!current()) return { ok: false, success: false, message: 'تم إلغاء مراجعة التعارض.' };
        return Promise.race([pullStateFromSupabase(before.supabaseConfig, user, { signal: controller.signal }),
          new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Cancelled review.')), { once: true }))]);
      });
      clearTimeout(timer);
      if (!current()) return fail('تم إلغاء المراجعة أو تغيرت النسخة. بقي التعارض محفوظاً.');
      const prepared = prepareConflictResolution({ choice, reason, review, current: { ownerId: user.id, sessionGeneration: token.generation,
        configId: syncConfigIdentity(before.supabaseConfig), localRevision: localRevision.current }, local: before, blockedOutbox: record,
        freshCloud: { ownerId: user.id, configId: syncConfigIdentity(before.supabaseConfig), identityVerified: fresh.identityVerified,
          snapshotUpdatedAt: fresh.snapshotUpdatedAt ?? null, state: 'state' in fresh ? fresh.state : undefined, isEmpty: 'isEmpty' in fresh ? fresh.isEmpty : undefined } });
      if (prepared.status === 'refused') return fail(prepared.message);
      if (prepared.status === 'changed-cloud') {
        const cached = inspectConflictDuringLock();
        return { ...fail('تغيرت النسخة السحابية. اعرض النسخة الجديدة وراجعها ثم اختر قراراً جديداً؛ لم تتغير الخزنة.'),
          review: cached ? Object.freeze({ ...cached, token: prepared.review, cloud: prepared.cloud }) : undefined };
      }
      // No second enqueue/write after publication: readyRecord is included in the same commit.
      if (!current()) return fail('تغيرت النسخة أثناء المراجعة.');
      worker?.dispose(); syncWorker.current = null; replacedWorker = true;
      const committed = await recoverEnvelope(prepared.candidate as MaliState, prepared.readyRecord as SyncOutbox<MaliState>,
        JSON.stringify(prepared.evidence), token, user, before);
      if (!committed) return fail('تغيرت الجلسة. بقيت أدلة القرار محفوظة.');
      return { ok: true, success: true, updatedAt: prepared.readyRecord.syncedAt,
        message: choice === 'keep-local' ? 'تم حفظ القرار وجميع النسخ على هذا الجهاز. تنتظر المحلية رفعاً عادياً يتحقق من التعارض مجدداً.'
          : 'تم اعتماد السحابية على هذا الجهاز وحفظ جميع النسخ السابقة للاسترجاع. لم تُرفع بيانات إلى السحابة.' };
    } catch {
      if (replacedWorker && scope.current.isCurrent(token)) {
        recoveryRequired.current = true;
        // Retain a blocked, inactive record for review/retry. Never overwrite an uncertain commit.
        if (!syncWorker.current) startSyncWorker(user, token, record);
      }
      return fail('تعذر تأكيد مراجعة التعارض أو حفظ أدلته. بقي الرفع متوقفاً؛ أعد المراجعة أو افتح الخزنة مجدداً.');
    } finally {
      clearTimeout(timer);
      if (conflictRequest.current === controller) conflictRequest.current = null;
      if (scope.current.isCurrent(token)) { hydrating.current = false; setIsSyncing(false); activateWorker(); }
    }
    function inspectConflictDuringLock(): CloudConflictReview | null {
      try {
        const original = conflictSnapshotForReview(record!.stop!.result.cloudState as MaliState);
        return { token: review, local: conflictSnapshotForReview(before), cloud: original, originalCloud: original,
          attempted: conflictSnapshotForReview(record!.stop!.attempted!.payload) };
      } catch { return null; }
    }
  };

  const importStateJson = async (jsonStr: string): Promise<boolean> => {
    if (CENTRAL_SERVER_ONLY) {
      setLastSyncMessage('استيراد ملفات الخزنة مباشرة إلى الهاتف معطل. تُرحّل النسخ القديمة عبر عملية مؤمّنة إلى الخادم فقط.');
      return false;
    }
    if (!scope.current.isCurrent(mutationSession) || hydrating.current || isFinancialMutationLocked() || configurationSaving.current) return false;
    const validation = validateAndSanitizeBackupPayload(jsonStr, stateRef.current);
    if (!validation.valid || !validation.state) return false;
    const token=scope.current.capture(),user=userRef.current,before=stateRef.current;
    const {financialAudit:sourceHistory,...imported}=validation.state;
    const ownerId=user?.id||'anonymous';
    const existingHistory=before.financialAudit||[];
    const preserveSourceHistory=!!sourceHistory?.length && sourceHistory.every(event=>event.ownerId===ownerId) &&
      JSON.stringify(sourceHistory.slice(0,existingHistory.length))===JSON.stringify(existingHistory);
    let replacement:MaliState;
    try {replacement=preserveSourceHistory?validation.state:appendFinancialAudit(before,imported,{ownerId,action:'backup_import',reason:'استعادة نسخة احتياطية اختارها المستخدم على هذا الجهاز.'});}
    catch {setLastSyncMessage('تعذر اعتماد النسخة مع السجل المالي الحالي.');return false;}
    if(!sameFinancialState(replacement,validation.state)) {
      setLastSyncMessage('تاريخ النسخة يتعارض مع عملية سبق عكسها أو اعتمادها. لم تُسترجع النسخة؛ بقي الملف والخزنة والسجل الحالي دون تغيير.');
      return false;
    }
    const retained=syncWorker.current?.getRecord();
    const revision=Math.max(localRevision.current,retained?.pending?.revision||0,retained?.acknowledgedRevision||0,retained?.stop?.attempted?.revision||0)+1;
    if(!Number.isSafeInteger(revision))return false;
    syncWorker.current?.dispose();syncWorker.current=null;hydrating.current=true;
    const sameConfig=!retained || retained.configId===syncConfigIdentity(replacement.supabaseConfig);
    const next={...touchState(replacement),localRevision:revision,pendingCloudSync:!!user && !user.isLocalOnly,
      supabaseConfig:{...replacement.supabaseConfig,lastSyncedAt:sameConfig?(retained?.syncedAt||replacement.supabaseConfig.lastSyncedAt):replacement.supabaseConfig.lastSyncedAt}};
    const outbox:SyncOutbox<MaliState>|undefined=user && !user.isLocalOnly?{version:1,ownerId:user.id,configId:retained?.configId||syncConfigIdentity(next.supabaseConfig),
      pending:{revision,payload:next},attempts:retained?.attempts||0,nextAttemptAt:retained?.nextAttemptAt||Date.now(),syncedAt:retained?.syncedAt||next.supabaseConfig.lastSyncedAt,
      acknowledgedRevision:retained?.acknowledgedRevision,stop:retained?.stop||(!sameConfig?{reason:'configuration',result:{ok:false,success:false,message:'تغير مشروع المزامنة. تم الاحتفاظ بالنسختين.'}}:undefined)}:undefined;
    const {supabaseConfig:_sourceConfig,...sourceEvidence}=validation.state;
    try {
      return await recoverEnvelope(next,outbox,JSON.stringify(sourceEvidence),token,user,before);
    } catch {if(scope.current.isCurrent(token)){recoveryRequired.current=true;setLastSyncMessage('تعذر تأكيد حفظ الاستعادة. تم إيقاف التعديل والرفع؛ أعد الاسترجاع أو افتح الخزنة مجدداً.');}return false;}
    finally {
      if(scope.current.isCurrent(token)) {
        hydrating.current=false;
        if(user && !user.isLocalOnly && !syncWorker.current)startSyncWorker(user,token,retained||undefined);
        activateWorker();
      }
    }
  };

  function loginUser(user: AuthUser) {
    if (CENTRAL_SERVER_ONLY && user.isLocalOnly) {
      setLastSyncMessage('الدخول كضيف غير متاح؛ بيانات العملاء تُحفظ حصرياً على الخادم.');
      return;
    }
    conflictRequest.current?.abort(); conflictRequest.current = null;
    pendingMutation.current = null; cacheReplacement.current = null; configurationSaving.current = false; mutationRequests.current = 0;
    setMutationStatus({ phase: 'idle' });
    syncWorker.current?.dispose(); syncWorker.current = null;
    setCloudSyncStatus({ phase: 'idle', outbox: null });
    pendingLogoutConfig.current = null;
    setAuthCleanupPending(false);
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
      if (CENTRAL_SERVER_ONLY) {
        try {
          // Pre-cutover legacy records MUST NOT be discarded or silently ignored.
          const previous = await storageQueue.current.run(() => financialStorage.getItem(key));
          if (!scope.current.isCurrent(token)) return;
          if (previous !== null) {
            recoveryRequired.current = true;
            setLastSyncMessage('توجد خزنة محفوظة على هذا الجهاز. يلزم ترحيلها والتحقق من نسخة الخادم قبل التحويل إلى الوضع المركزي؛ لم تُحذف البيانات.');
            setCurrentUser(null);
            return;
          }
          const opened = await centralSession.current.open(user, userState.supabaseConfig);
          if (!scope.current.isCurrent(token)) return;
          if (!opened.ok) {
            recoveryRequired.current = true;
            setLastSyncMessage(opened.message);
            setCurrentUser(null);
            return;
          }
          applyState(opened.state);
          await savePersistedSessionUser(user, opened.state.supabaseConfig);
          setLastSyncMessage('تم تحميل الخزنة المعتمدة من الخادم فقط.');
        } catch {
          if (scope.current.isCurrent(token)) {
            recoveryRequired.current = true;
            setCurrentUser(null);
            setLastSyncMessage('تعذر التحقق من البيانات على الخادم. مُنعت العمليات لحماية سجلات العميل.');
          }
        } finally {
          if (scope.current.isCurrent(token)) {
            hydrating.current = false;
            setIsLoading(false);
            setIsSyncing(false);
          }
        }
        return;
      }
      let cacheLoaded = false;
      let identityVerified = false;
      let outbox: SyncOutbox<MaliState> | null = null;
      try {
        const cachedRaw = await storageQueue.current.run(() => financialStorage.getItem(key));
        if (!scope.current.isCurrent(token)) return;
        if (cachedRaw) {
          const validation = validateAndSanitizeBackupPayload(cachedRaw, userState);
          if (!validation.valid || !validation.state) {
            recoveryRequired.current = true;
            await storageQueue.current.run(() => financialStorage.setItem(key + '_recovery', cachedRaw));
            setLastSyncMessage('النسخة المحلية تحتاج مراجعة. تم الاحتفاظ بها دون رفع أو استبدال.');
            return;
          }
          const parsed = JSON.parse(cachedRaw);
          try { outbox = validateSyncOutbox(parsed.cloudOutbox, user.id, raw => validateAndSanitizeBackupPayload(raw, userState).valid); }
          catch {
            recoveryRequired.current = true;
            await storageQueue.current.run(() => financialStorage.setItem(key + '_recovery', cachedRaw));
            setLastSyncMessage('قائمة الرفع المحلية تحتاج مراجعة. تم الاحتفاظ بها دون رفع أو استبدال.');
            return;
          }
          const revision = parsed.localRevision;
          localRevision.current = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
          if (outbox?.pending && outbox.pending.revision > localRevision.current) {
            recoveryRequired.current = true;
            await storageQueue.current.run(() => financialStorage.setItem(key + '_recovery', cachedRaw));
            return;
          }
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
        identityVerified = res.identityVerified === true;
        const hasPendingLocal = Boolean(userState.pendingCloudSync || outbox?.pending || outbox?.stop);
        if (res.ok && res.state && !hasPendingLocal && stateRef.current === before) {
          const merged = mergePartialCloudState(userState, res.state, res.updatedAt, res.snapshotUpdatedAt);
          applyState(merged);
          if (outbox) outbox = { ...outbox, syncedAt: merged.supabaseConfig.lastSyncedAt };
          await saveCache(merged, user.id, outbox);
        } else if (res.isEmpty) {
          // New cloud users keep an empty vault; no demo data is uploaded on login.
          const cleared = { ...stateRef.current, supabaseConfig: { ...stateRef.current.supabaseConfig, lastSyncedAt: undefined } };
          applyState(cleared);
          if (outbox && !outbox.stop) outbox = { ...outbox, syncedAt: undefined, pending: outbox.pending ? { ...outbox.pending, payload: { ...outbox.pending.payload, supabaseConfig: { ...outbox.pending.payload.supabaseConfig, lastSyncedAt: undefined } } } : null };
          await saveCache(cleared, user.id, outbox);
        } else if (hasPendingLocal) {
          setLastSyncMessage('توجد تعديلات محلية غير مرفوعة. تم الاحتفاظ بها؛ ارفعها أو صدّر نسخة احتياطية قبل استرجاع السحابة.');
        }
      } catch {
        if (scope.current.isCurrent(token)) {
          if (!cacheLoaded) recoveryRequired.current = true;
          setLastSyncMessage(cacheLoaded ? 'تعذر تحميل السحابة. تم الاحتفاظ بالتعديلات المحلية.' : 'تعذر قراءة الخزنة المحلية. تم إيقاف التعديلات لحماية البيانات؛ استرجع نسخة صحيحة.');
        }
      } finally {
        if (scope.current.isCurrent(token)) {
          hydrating.current = false; setIsLoading(false); setIsSyncing(false);
          if (cacheLoaded && !recoveryRequired.current && !user.isLocalOnly) {
            const worker = startSyncWorker(user, token, outbox || undefined);
            void (async () => {
              if (identityVerified) await worker.resumeVerifiedSession();
              if (stateRef.current.pendingCloudSync || outbox?.pending || outbox?.stop) await worker.enqueue(stateRef.current, localRevision.current, syncConfigIdentity(stateRef.current.supabaseConfig), stateRef.current.supabaseConfig.lastSyncedAt);
              if (scope.current.isCurrent(token)) activateWorker();
            })().catch(() => { if (scope.current.isCurrent(token)) setLastSyncMessage('تعذر استعادة قائمة الرفع المحلية.'); });
          }
        }
      }
    })();
  }

  function invalidateLocalSession() {
    centralSession.current.clear();
    conflictRequest.current?.abort(); conflictRequest.current = null;
    pendingMutation.current = null; cacheReplacement.current = null; configurationSaving.current = false; mutationRequests.current = 0;
    setMutationStatus({ phase: 'idle' });
    syncWorker.current?.dispose(); syncWorker.current = null;
    setCloudSyncStatus({ phase: 'idle', outbox: null });
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

  const logoutUser = async () => {
    const cfg = pendingLogoutConfig.current || stateRef.current.supabaseConfig;
    pendingLogoutConfig.current = cfg;
    invalidateLocalSession();
    setAuthCleanupPending(true);
    const token = scope.current.capture();
    try {
      await clearAuthSession(cfg);
      if (scope.current.isCurrent(token)) {
        pendingLogoutConfig.current = null;
        setAuthCleanupPending(false);
        setLastSyncMessage(null);
      }
      return true;
    } catch {
      if (scope.current.isCurrent(token)) setLastSyncMessage('تعذر تأكيد إزالة بيانات الدخول من الجهاز. أعد محاولة تسجيل الخروج.');
      return false;
    }
  };

  useEffect(() => subscribeToAuthIdentity((user) => {
    if (!user) {
      if (userRef.current && !userRef.current.isLocalOnly) invalidateLocalSession();
    } else if (!pendingLogoutConfig.current && userRef.current?.id !== user.id) {
      loginUser(user);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        cloudSyncStatus,
        mutationStatus,
        mutationSessionGeneration: mutationSession.generation,
        retryPendingMutation,
        authCleanupPending,
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
        deleteDebtInstallment,
        deleteDebt,
        addProcedure,
        toggleProcedureStage,
        addProcedureStage,
        deleteProcedure,
        updateSupabaseConfig,
        syncToCloud,
        pullFromCloud,
        importStateJson,
        inspectCloudConflict,
        resolveCloudConflict,
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
