import type { AuthUser, MaliState, SupabaseConfig } from '../types/mali';

export interface SyncResult {
  ok: boolean;
  success: boolean;
  message: string;
  updatedAt?: string;
  timestamp?: string;
  /** Exact server CAS token; null means a relational-only legacy vault. */
  snapshotUpdatedAt?: string | null;
  conflictDetected?: boolean;
  cloudState?: Partial<MaliState>;
  data?: MaliState;
}
export interface PullResult extends SyncResult {
  state?: Partial<MaliState>;
  isEmpty?: boolean;
}
interface DbError { message: string }
interface DbResult<T = unknown> { data: T | null; error: DbError | null }
/** Injectable boundary runs the production sync logic without native modules. */
export interface SyncClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: DbError | null }> };
  // The fluent query builder varies by table; every result is checked below.
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult<any>>;
}
interface SyncDependencies {
  getClient(config: SupabaseConfig): SyncClient;
  fallbackState: MaliState;
  validateBackup(raw: string, fallback: MaliState): { valid: boolean; state?: MaliState; error?: string };
}
const COLLECTIONS = ['accounts', 'contacts', 'transactions', 'deals', 'debts', 'procedures', 'budgets'] as const;
const TABLES = ['mali_accounts', 'mali_contacts', 'mali_usd_deals', 'mali_transactions', 'mali_debts'] as const;
const fail = (message: string): SyncResult => ({ ok: false, success: false, message });
const isObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validTimestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function createSupabaseSyncService(deps: SyncDependencies) {
  const configured = (config: SupabaseConfig) => Boolean(config?.url?.trim() && config?.anonKey?.trim());
  async function verifyUser(client: SyncClient, expectedId: string) {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user || data.user.id !== expectedId) throw new Error('تغيّرت جلسة الحساب أو انتهت صلاحيتها. يرجى تسجيل الدخول مجدداً.');
  }
  async function verifiedClient(config: SupabaseConfig, user?: AuthUser | null) {
    if (!user || user.isLocalOnly || !user.id) throw new Error('يجب تسجيل الدخول بحساب سحابي موثّق لتفعيل المزامنة.');
    const client = deps.getClient(config);
    await verifyUser(client, user.id);
    return { client, userId: user.id };
  }
  function validatePayload(value: unknown, userId: string): MaliState {
    if (!isObject(value) || (value.ownerId !== undefined && value.ownerId !== userId)) throw new Error('مالك النسخة السحابية أو محتواها غير صالح.');
    for (const collection of COLLECTIONS) {
      const rows = value[collection];
      if (!Array.isArray(rows) || rows.some((row) => !isObject(row) || typeof row.id !== 'string' || !row.id.trim())) throw new Error(`بيانات النسخة غير صالحة: ${collection}.`);
      if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error(`معرّفات مكررة في النسخة: ${collection}.`);
    }
    if (!isObject(value.marketRates) || (value.lastModifiedAt !== undefined && !validTimestamp(value.lastModifiedAt))) throw new Error('أسعار السوق أو تاريخ النسخة غير صالح.');
    const checked = deps.validateBackup(JSON.stringify(value), deps.fallbackState);
    if (!checked.valid || !checked.state) throw new Error(checked.error || 'النسخة المالية غير صالحة.');
    for (const collection of COLLECTIONS) {
      if (checked.state[collection].length !== value[collection].length) throw new Error(`تحتوي النسخة على سجلات تالفة في ${collection}.`);
    }
    return checked.state;
  }
  function payloadForState(state: MaliState, userId: string) {
    const checked = validatePayload(state, userId);
    return {
      ownerId: userId, accounts: checked.accounts, contacts: checked.contacts,
      transactions: checked.transactions, deals: checked.deals, debts: checked.debts,
      procedures: checked.procedures, budgets: checked.budgets, marketRates: checked.marketRates,
      lastModifiedAt: checked.lastModifiedAt || new Date().toISOString(),
    };
  }
  async function testSupabaseConnection(config: SupabaseConfig, currentUser?: AuthUser | null) {
    if (!configured(config)) return { ok: false, message: 'إعدادات Supabase غير مكتملة.' };
    try {
      const { client, userId } = await verifiedClient(config, currentUser);
      const result: DbResult<any[]> = await client.from('mali_vault_snapshots').select('workspace_key').eq('user_id', userId).limit(1);
      if (result.error) throw new Error(result.error.message);
      await verifyUser(client, userId);
      return { ok: true, message: 'الاتصال بخزنتك السحابية ناجح.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'فشل الاتصال بالسحابة.' };
    }
  }
  async function pushStateToSupabase(state: MaliState, overrideConfig?: SupabaseConfig, currentUser?: AuthUser | null,
    // Compatibility only: forceOverwrite deliberately grants no bypass.
    _options?: { forceOverwrite?: boolean }): Promise<SyncResult> {
    const config = overrideConfig || state.supabaseConfig;
    if (!configured(config)) return fail('إعدادات Supabase غير مكتملة.');
    if (config.lastSyncedAt !== undefined && !validTimestamp(config.lastSyncedAt)) return fail('تاريخ آخر مزامنة غير صالح. اسحب النسخة السحابية أولاً.');
    try {
      const { client, userId } = await verifiedClient(config, currentUser);
      const { data, error } = await client.rpc('mali_sync_vault', {
        p_expected_user_id: userId, p_expected_updated_at: config.lastSyncedAt || null,
        p_payload: payloadForState(state, userId),
      });
      if (error) throw new Error(`فشل حفظ الخزنة السحابية: ${error.message}`);
      if (!isObject(data) || typeof data.ok !== 'boolean') throw new Error('استجابة المزامنة السحابية غير صالحة.');
      await verifyUser(client, userId);
      if (!data.ok) {
        if (data.conflictDetected === true && validTimestamp(data.updatedAt)) return {
          ...fail('تغيّرت الخزنة السحابية منذ آخر سحب. اسحب النسخة الأحدث قبل حفظ تعديلاتك.'),
          conflictDetected: true, updatedAt: data.updatedAt, timestamp: data.updatedAt,
          snapshotUpdatedAt: data.updatedAt, cloudState: validatePayload(data.cloudState, userId),
        };
        return fail('رفض الخادم حفظ الخزنة السحابية.');
      }
      if (!validTimestamp(data.updatedAt)) throw new Error('لم يُرجع الخادم تاريخ الحفظ الموثّق.');
      return { ok: true, success: true, updatedAt: data.updatedAt, timestamp: data.updatedAt,
        snapshotUpdatedAt: data.updatedAt, message: 'تم حفظ الخزنة وكافة الجداول المالية معاً بنجاح.' };
    } catch (error) { return fail(error instanceof Error ? error.message : 'فشل الرفع إلى السحابة.'); }
  }
  async function pullStateFromSupabase(config: SupabaseConfig, currentUser?: AuthUser | null): Promise<PullResult> {
    if (!configured(config)) return fail('إعدادات Supabase غير مكتملة.');
    try {
      const { client, userId } = await verifiedClient(config, currentUser);
      const snapshotResult: DbResult<any[]> = await client.from('mali_vault_snapshots').select('workspace_key, payload, updated_at, user_id')
        .eq('user_id', userId).order('updated_at', { ascending: false }).limit(1);
      if (snapshotResult.error) throw new Error(snapshotResult.error.message);
      if (!Array.isArray(snapshotResult.data)) throw new Error('استجابة الخزنة السحابية غير صالحة.');
      if (snapshotResult.data.length) {
        const snapshot = snapshotResult.data[0];
        if (snapshot.user_id !== userId || !validTimestamp(snapshot.updated_at)) throw new Error('مالك الخزنة أو تاريخها غير صالح.');
        const state = validatePayload(snapshot.payload, userId);
        await verifyUser(client, userId);
        return { ok: true, success: true, state, data: state, updatedAt: snapshot.updated_at,
          timestamp: snapshot.updated_at, snapshotUpdatedAt: snapshot.updated_at, message: 'تم استرجاع خزنتك السحابية بنجاح.' };
      }
      const results: DbResult<any[]>[] = await Promise.all(TABLES.map((table) => client.from(table).select('*').eq('user_id', userId)));
      for (const result of results) {
        if (result.error) throw new Error(`تعذر قراءة الجداول المالية: ${result.error.message}`);
        if (!Array.isArray(result.data)) throw new Error('استجابة الجداول المالية غير صالحة.');
      }
      await verifyUser(client, userId);
      const rows = results.flatMap((result) => result.data!);
      if (!rows.length) return { ...fail('لا توجد نسخة محفوظة لهذا الحساب.'), isEmpty: true, snapshotUpdatedAt: null };
      if (rows.some((row) => row.user_id !== userId)) throw new Error('مالك السجلات المالية غير صالح.');
      if (new Set(rows.map((row) => row.workspace_key)).size !== 1) throw new Error('توجد مساحات عمل قديمة متعددة. تعذر دمجها تلقائياً بأمان.');
      if (!results[0].data!.length) throw new Error('توجد سجلات مالية بدون حسابات. تعذر استرجاع النسخة بأمان.');
      const [accounts, contacts, deals, transactions, debts] = results.map((result) => result.data!);
      const dates = rows.map((row) => row.updated_at || row.created_at).filter(validTimestamp).sort((a, b) => Date.parse(a) - Date.parse(b));
      const updatedAt = dates.at(-1);
      const legacyPayload = {
        accounts: accounts.map((r) => r.sync_payload || ({ id: r.id, name: r.name, bankName: r.bank_name, category: r.category, currency: r.currency, balance: Number(r.balance), accountNumber: r.account_number || undefined, isCash: Boolean(r.is_cash), color: r.color || '#0F766E', notes: r.notes || undefined, updatedAt: r.updated_at })),
        contacts: contacts.map((r) => r.sync_payload || ({ id: r.id, name: r.name, phone: r.phone, role: r.role, bankDetails: r.bank_details || undefined, notes: r.notes || undefined, createdAt: r.created_at })),
        deals: deals.map((r) => r.sync_payload || ({ id: r.id, dealNumber: r.deal_number, title: r.title, contactId: r.seller_contact_id || undefined, counterparty: r.counterparty, counterpartyPhone: r.counterparty_phone || undefined, buyDate: r.buy_date, totalUsdBought: Number(r.usd_amount), buyRate: Number(r.buy_rate), grossLydCost: Number(r.usd_amount) * Number(r.buy_rate), buyCommissionLyd: Number(r.cheque_extra_cost_lyd || 0), totalLydCost: Number(r.total_lyd_cost), effectiveBuyRate: Number(r.effective_buy_rate), buyPaymentMethod: r.buy_method, sourceLydAccountId: r.source_lyd_account_id, usdHoldingAccountId: r.target_usd_account_id, soldUsd: Number(r.sold_usd), personalTakenUsd: Number(r.personal_taken_usd), remainingUsd: Number(r.remaining_usd), totalLydReceived: Number(r.total_lyd_received), realizedProfitLyd: Number(r.realized_profit_lyd), status: r.status, buyReceiptImages: r.buy_receipt_images || [], sales: r.sales || [], notes: r.notes || undefined, updatedAt: r.updated_at })),
        transactions: transactions.map((r) => r.sync_payload || ({ id: r.id, title: r.title, type: r.type, amount: Number(r.amount), currency: r.currency, category: r.category, accountId: r.account_id, targetAccountId: r.target_account_id || undefined, paymentMethod: r.payment_method, exchangeRate: r.exchange_rate ? Number(r.exchange_rate) : undefined, feeAmount: Number(r.fee_amount || 0), dealId: r.deal_id || undefined, saleId: r.sale_id || undefined, contactId: r.contact_id || undefined, receiptImages: r.receipt_images || [], date: r.tx_date, updatedAt: r.updated_at, notes: r.notes || undefined })),
        debts: debts.map((r) => r.sync_payload || ({ id: r.id, contactId: r.contact_id || undefined, personName: r.person_name, phone: r.phone || undefined, direction: r.direction, currency: r.currency, totalAmount: Number(r.total_amount), paidAmount: Number(r.paid_amount), remainingAmount: Number(r.remaining_amount), createdAt: r.created_at, dueDate: r.due_date || undefined, status: r.status === 'settled' ? 'completed' : 'active', installments: r.installments || [], updatedAt: r.updated_at, notes: r.notes || undefined })),
        procedures: [], budgets: [], marketRates: deps.fallbackState.marketRates,
        ...(updatedAt ? { lastModifiedAt: updatedAt } : {}),
      };
      const state = validatePayload(legacyPayload, userId);
      return { ok: true, success: true, state, data: state, updatedAt, timestamp: updatedAt,
        snapshotUpdatedAt: null, message: 'تم استرجاع الجداول المالية القديمة الخاصة بحسابك.' };
    } catch (error) { return fail(error instanceof Error ? error.message : 'فشل السحب من السحابة.'); }
  }
  return { testSupabaseConnection, pushStateToSupabase, pullStateFromSupabase };
}
