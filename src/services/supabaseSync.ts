import {
  Account,
  AuthUser,
  ContactPerson,
  DebtRecord,
  MaliState,
  SupabaseConfig,
  Transaction,
  UsdDeal,
} from '../types/mali';
import { getSharedSupabaseClient } from './authService';
import { roundMoney, roundRate } from './financialEngine';

export const SUPABASE_SQL_SCHEMA = `-- =============================================================================
-- منظومة «مالي - Mali» | المخطط الكامل المحصّن لقاعدة بيانات Supabase (PostgreSQL + Strict RLS)
-- جميع الجداول محمية بسياسات عزل صارمة (auth.uid() = user_id) للمستخدمين الموثقين فقط
-- =============================================================================

-- راجع الملف الرسمي الكامل في المستودع: supabase/schema.sql
-- وملف الهجرة الأمنية: supabase/migrations/20261012221500_security_rls_hardening.sql
`;

export interface SyncResult {
  ok: boolean;
  success: boolean;
  message: string;
  updatedAt?: string;
  timestamp?: string;
  conflictDetected?: boolean;
  cloudState?: Partial<MaliState>;
  data?: MaliState;
}

export interface PullResult extends SyncResult {
  state?: Partial<MaliState>;
  isEmpty?: boolean;
}

/**
 * التحقق من وجود جلسة مصادقة سحابية صالحة وموثّقة من Supabase Auth
 * يمنع المستخدم المجهول (anon) أو وضع الضيف المحلي (isLocalOnly) من الوصول للسحابة
 */
async function getVerifiedCloudUserId(
  config: SupabaseConfig,
  currentUser?: AuthUser | null
): Promise<{ userId: string | null; error?: string }> {
  if (currentUser?.isLocalOnly) {
    return {
      userId: null,
      error: 'أنت تستخدم الوضع المحلي (بدون سحابة). يرجى تسجيل الدخول بحساب سحابي لتفعيل المزامنة.',
    };
  }

  try {
    const supabase = getSharedSupabaseClient(config);
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (!sessionErr && sessionData?.session?.user?.id) {
      return { userId: sessionData.session.user.id };
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (!userErr && userData?.user?.id) {
      return { userId: userData.user.id };
    }

    return {
      userId: null,
      error: 'انتهت صلاحية الجلسة السحابية أو لم يتم تسجيل الدخول. يرجى تسجيل الدخول مجدداً.',
    };
  } catch (e: any) {
    return {
      userId: null,
      error: `تعذر التحقق من الجلسة السحابية: ${e?.message || 'خطأ في الاتصال'}`,
    };
  }
}

/**
 * تحديد مفتاح مساحة العمل المعزول لكل مستخدم لمنع التصادم بين المستخدمين في جدول الخزنة
 */
async function resolveIsolatedWorkspaceKey(
  config: SupabaseConfig,
  userId: string
): Promise<string> {
  const supabase = getSharedSupabaseClient(config);
  try {
    const { data } = await supabase
      .from('mali_vault_snapshots')
      .select('workspace_key, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0 && data[0].workspace_key) {
      return String(data[0].workspace_key);
    }
  } catch {
    // ignore and use user-scoped key
  }

  return `mali-vault-${userId}`;
}

export async function testSupabaseConnection(
  config: SupabaseConfig,
  currentUser?: AuthUser | null
): Promise<{ ok: boolean; message: string }> {
  if (!config.url.trim() || !config.anonKey.trim()) {
    return {
      ok: false,
      message: 'يرجى إدخال رابط المشروع (Project URL) والمفتاح العام (Anon Key) أولاً.',
    };
  }

  const { userId, error: authErr } = await getVerifiedCloudUserId(config, currentUser);
  if (!userId) {
    return {
      ok: false,
      message: authErr || 'يجب تسجيل الدخول بحساب سحابي موثّق لاختبار الاتصال بقاعدة البيانات المحمية.',
    };
  }

  try {
    const supabase = getSharedSupabaseClient(config);
    const { error } = await supabase
      .from('mali_vault_snapshots')
      .select('workspace_key, updated_at')
      .eq('user_id', userId)
      .limit(1);

    if (error) {
      return {
        ok: false,
        message: `تعذر الوصول إلى الجداول السحابية: ${error.message}`,
      };
    }

    return {
      ok: true,
      message:
        'الاتصال بقاعدة بيانات Supabase ناجح ومؤمّن بسياسات العزل الصارمة (Strict RLS: auth.uid() = user_id).',
    };
  } catch (e: any) {
    return {
      ok: false,
      message: `فشل الاتصال بالخادم: ${e?.message || 'تحقق من الإنترنت أو صحة الرابط'}`,
    };
  }
}

/**
 * رفع الحالة المالية إلى Supabase مع حماية ضد الكتابة فوق نسخة سحابية أحدث (Conflict Detection)
 */
export async function pushStateToSupabase(
  state: MaliState,
  overrideConfig?: SupabaseConfig,
  currentUser?: AuthUser | null,
  options?: { forceOverwrite?: boolean }
): Promise<SyncResult> {
  const config = overrideConfig || state.supabaseConfig;
  if (!config?.url?.trim() || !config?.anonKey?.trim()) {
    return {
      ok: false,
      success: false,
      message: 'إعدادات Supabase غير مكتملة.',
    };
  }

  const { userId, error: authErr } = await getVerifiedCloudUserId(config, currentUser);
  if (!userId) {
    return {
      ok: false,
      success: false,
      message: authErr || 'غير مصرح بالمزامنة بدون جلسة مصادقة سحابية نشطة.',
    };
  }

  try {
    const supabase = getSharedSupabaseClient(config);
    const workspaceKey = await resolveIsolatedWorkspaceKey(config, userId);

    // 1. التحقق من وجود نسخة أحدث في السحابة قبل الكتابة لمنع فقدان البيانات
    if (!options?.forceOverwrite) {
      const { data: existingRows } = await supabase
        .from('mali_vault_snapshots')
        .select('updated_at, payload')
        .eq('workspace_key', workspaceKey)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingRows?.updated_at) {
        const cloudTime = new Date(existingRows.updated_at).getTime();
        const lastSyncedTime = config.lastSyncedAt ? new Date(config.lastSyncedAt).getTime() : 0;
        const localModTime = state.lastModifiedAt ? new Date(state.lastModifiedAt).getTime() : 0;

        // إذا لم يسبق لهذا الجهاز المزامنة مع السحابة، وكانت السحابة تحتوي على بيانات فعلية أحدث من تعديلات الجهاز
        if (lastSyncedTime === 0 && cloudTime > localModTime + 1000) {
          return {
            ok: false,
            success: false,
            conflictDetected: true,
            updatedAt: existingRows.updated_at,
            timestamp: existingRows.updated_at,
            cloudState: existingRows.payload as Partial<MaliState>,
            message:
              'توجد بيانات أحدث محفوظة في خزنتك السحابية. تم إيقاف الرفع التلقائي لحماية بياناتك السحابية من الاستبدال.',
          };
        }
      }
    }

    const now = new Date().toISOString();

    const sanitizedPayload = {
      ownerId: userId,
      ownerEmail: currentUser?.email || null,
      accounts: state.accounts,
      contacts: state.contacts,
      transactions: state.transactions,
      deals: state.deals,
      debts: state.debts,
      procedures: state.procedures,
      budgets: state.budgets,
      marketRates: state.marketRates,
      lastModifiedAt: state.lastModifiedAt || now,
      exportedAt: now,
    };

    // 2. حفظ لقطة الخزنة الموحدة (Vault Snapshot) مع فرض user_id = auth.uid()
    const { error: vaultError } = await supabase
      .from('mali_vault_snapshots')
      .upsert(
        {
          workspace_key: workspaceKey,
          user_id: userId,
          payload: sanitizedPayload,
          updated_at: now,
        },
        { onConflict: 'workspace_key' }
      );

    if (vaultError) {
      return {
        ok: false,
        success: false,
        message: `فشل حفظ الخزنة السحابية: ${vaultError.message}`,
      };
    }

    // 3. مزامنة الجداول العلائقية الخمسة مع حذف السجلات الملغاة لضمان تطابق الجداول
    const relationalErrors: string[] = [];

    // أ) الحسابات المالية (mali_accounts)
    if (state.accounts.length > 0) {
      const accountRows = state.accounts.map((a) => ({
        id: a.id,
        workspace_key: workspaceKey,
        user_id: userId,
        name: a.name,
        bank_name: a.bankName,
        category: a.category,
        currency: a.currency,
        balance: roundMoney(a.balance),
        account_number: a.accountNumber || null,
        is_cash: a.isCash,
        color: a.color || '#0F766E',
        notes: a.notes || null,
        updated_at: a.updatedAt || now,
      }));
      const { error: accErr } = await supabase
        .from('mali_accounts')
        .upsert(accountRows, { onConflict: 'workspace_key,id' });
      if (accErr) relationalErrors.push(`accounts: ${accErr.message}`);
    }
    // حذف الحسابات التي أزالها المستخدم محلياً
    const { data: cloudAccs } = await supabase
      .from('mali_accounts')
      .select('id')
      .eq('workspace_key', workspaceKey)
      .eq('user_id', userId);
    if (cloudAccs) {
      const localAccIds = new Set(state.accounts.map((a) => a.id));
      const staleAccIds = cloudAccs.map((r) => r.id).filter((id) => !localAccIds.has(id));
      if (staleAccIds.length > 0) {
        await supabase
          .from('mali_accounts')
          .delete()
          .eq('workspace_key', workspaceKey)
          .eq('user_id', userId)
          .in('id', staleAccIds);
      }
    }

    // ب) المتعاملون (mali_contacts)
    if (state.contacts.length > 0) {
      const contactRows = state.contacts.map((c) => ({
        id: c.id,
        workspace_key: workspaceKey,
        user_id: userId,
        name: c.name,
        phone: c.phone,
        role: c.role,
        bank_details: c.bankDetails || null,
        notes: c.notes || null,
        created_at: c.createdAt || now,
      }));
      const { error: cntErr } = await supabase
        .from('mali_contacts')
        .upsert(contactRows, { onConflict: 'workspace_key,id' });
      if (cntErr) relationalErrors.push(`contacts: ${cntErr.message}`);
    }
    const { data: cloudCnts } = await supabase
      .from('mali_contacts')
      .select('id')
      .eq('workspace_key', workspaceKey)
      .eq('user_id', userId);
    if (cloudCnts) {
      const localCntIds = new Set(state.contacts.map((c) => c.id));
      const staleCntIds = cloudCnts.map((r) => r.id).filter((id) => !localCntIds.has(id));
      if (staleCntIds.length > 0) {
        await supabase
          .from('mali_contacts')
          .delete()
          .eq('workspace_key', workspaceKey)
          .eq('user_id', userId)
          .in('id', staleCntIds);
      }
    }

    // ج) صفقات الدولار (mali_usd_deals)
    if (state.deals.length > 0) {
      const dealRows = state.deals.map((d) => ({
        id: d.id,
        workspace_key: workspaceKey,
        user_id: userId,
        deal_number: d.dealNumber,
        title: d.title,
        seller_contact_id: d.contactId || null,
        counterparty: d.counterparty || 'غير محدد',
        counterparty_phone: d.counterpartyPhone || null,
        buy_date: d.buyDate,
        usd_amount: roundMoney(d.totalUsdBought),
        buy_rate: roundRate(d.buyRate),
        effective_buy_rate: roundRate(d.effectiveBuyRate),
        total_lyd_cost: roundMoney(d.totalLydCost),
        buy_method: d.buyPaymentMethod,
        source_lyd_account_id: d.sourceLydAccountId,
        target_usd_account_id: d.usdHoldingAccountId,
        cheque_extra_cost_lyd: roundMoney(d.buyCommissionLyd || 0),
        sold_usd: roundMoney(d.soldUsd),
        personal_taken_usd: roundMoney(d.personalTakenUsd),
        remaining_usd: roundMoney(d.remainingUsd),
        total_lyd_received: roundMoney(d.totalLydReceived),
        realized_profit_lyd: roundMoney(d.realizedProfitLyd),
        status: d.status,
        buy_receipt_images: d.buyReceiptImages || [],
        sales: d.sales || [],
        notes: d.notes || null,
        updated_at: d.updatedAt || now,
      }));
      const { error: dealErr } = await supabase
        .from('mali_usd_deals')
        .upsert(dealRows, { onConflict: 'workspace_key,id' });
      if (dealErr) relationalErrors.push(`deals: ${dealErr.message}`);
    }
    const { data: cloudDeals } = await supabase
      .from('mali_usd_deals')
      .select('id')
      .eq('workspace_key', workspaceKey)
      .eq('user_id', userId);
    if (cloudDeals) {
      const localDealIds = new Set(state.deals.map((d) => d.id));
      const staleDealIds = cloudDeals.map((r) => r.id).filter((id) => !localDealIds.has(id));
      if (staleDealIds.length > 0) {
        await supabase
          .from('mali_usd_deals')
          .delete()
          .eq('workspace_key', workspaceKey)
          .eq('user_id', userId)
          .in('id', staleDealIds);
      }
    }

    // د) الحركات المالية (mali_transactions)
    if (state.transactions.length > 0) {
      const txRows = state.transactions.map((tx) => ({
        id: tx.id,
        workspace_key: workspaceKey,
        user_id: userId,
        title: tx.title,
        type: tx.type,
        amount: roundMoney(tx.amount),
        currency: tx.currency,
        category: tx.category,
        account_id: tx.accountId,
        target_account_id: tx.targetAccountId || null,
        payment_method: tx.paymentMethod,
        exchange_rate: tx.exchangeRate || null,
        fee_amount: roundMoney(tx.feeAmount || 0),
        deal_id: tx.dealId || null,
        sale_id: tx.saleId || null,
        contact_id: tx.contactId || null,
        receipt_images: tx.receiptImages || [],
        tx_date: tx.date,
        notes: tx.notes || null,
        updated_at: tx.updatedAt || now,
      }));
      const { error: txErr } = await supabase
        .from('mali_transactions')
        .upsert(txRows, { onConflict: 'workspace_key,id' });
      if (txErr) relationalErrors.push(`transactions: ${txErr.message}`);
    }
    const { data: cloudTxs } = await supabase
      .from('mali_transactions')
      .select('id')
      .eq('workspace_key', workspaceKey)
      .eq('user_id', userId);
    if (cloudTxs) {
      const localTxIds = new Set(state.transactions.map((t) => t.id));
      const staleTxIds = cloudTxs.map((r) => r.id).filter((id) => !localTxIds.has(id));
      if (staleTxIds.length > 0) {
        await supabase
          .from('mali_transactions')
          .delete()
          .eq('workspace_key', workspaceKey)
          .eq('user_id', userId)
          .in('id', staleTxIds);
      }
    }

    // هـ) الديون والأمانات (mali_debts)
    if (state.debts.length > 0) {
      const debtRows = state.debts.map((d) => ({
        id: d.id,
        workspace_key: workspaceKey,
        user_id: userId,
        contact_id: d.contactId || null,
        person_name: d.personName,
        phone: d.phone || null,
        direction: d.direction,
        currency: d.currency,
        total_amount: roundMoney(d.totalAmount),
        paid_amount: roundMoney(d.paidAmount),
        remaining_amount: roundMoney(d.remainingAmount),
        created_at: d.createdAt,
        due_date: d.dueDate || null,
        status: d.status === 'completed' ? 'settled' : 'active',
        installments: d.installments || [],
        notes: d.notes || null,
        updated_at: d.updatedAt || now,
      }));
      const { error: debtErr } = await supabase
        .from('mali_debts')
        .upsert(debtRows, { onConflict: 'workspace_key,id' });
      if (debtErr) relationalErrors.push(`debts: ${debtErr.message}`);
    }
    const { data: cloudDebts } = await supabase
      .from('mali_debts')
      .select('id')
      .eq('workspace_key', workspaceKey)
      .eq('user_id', userId);
    if (cloudDebts) {
      const localDebtIds = new Set(state.debts.map((d) => d.id));
      const staleDebtIds = cloudDebts.map((r) => r.id).filter((id) => !localDebtIds.has(id));
      if (staleDebtIds.length > 0) {
        await supabase
          .from('mali_debts')
          .delete()
          .eq('workspace_key', workspaceKey)
          .eq('user_id', userId)
          .in('id', staleDebtIds);
      }
    }

    return {
      ok: true,
      success: true,
      updatedAt: now,
      timestamp: now,
      message:
        relationalErrors.length === 0
          ? 'تمت مزامنة كافة الحسابات والصفقات والحركات والديون في قاعدة بيانات Supabase بنجاح.'
          : `تم حفظ الخزنة السحابية مع ملاحظات فرعية: ${relationalErrors.join(' | ')}`,
    };
  } catch (e: any) {
    return {
      ok: false,
      success: false,
      message: `خطأ أثناء الرفع إلى السحابة: ${e?.message || 'غير معروف'}`,
    };
  }
}

/**
 * سحب أحدث نسخة خاصة بالمستخدم الموثّق حصرياً من Supabase
 */
export async function pullStateFromSupabase(
  config: SupabaseConfig,
  currentUser?: AuthUser | null
): Promise<PullResult> {
  if (!config?.url?.trim() || !config?.anonKey?.trim()) {
    return {
      ok: false,
      success: false,
      message: 'إعدادات Supabase غير مكتملة.',
    };
  }

  const { userId, error: authErr } = await getVerifiedCloudUserId(config, currentUser);
  if (!userId) {
    return {
      ok: false,
      success: false,
      message: authErr || 'يجب تسجيل الدخول بحساب سحابي موثّق لاسترجاع البيانات.',
    };
  }

  try {
    const supabase = getSharedSupabaseClient(config);

    // 1. البحث عن أحدث خزنة يملكها المستخدم الموثّق (user_id = auth.uid())
    const { data: snapshots, error } = await supabase
      .from('mali_vault_snapshots')
      .select('workspace_key, payload, updated_at, user_id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      return {
        ok: false,
        success: false,
        message: `تعذر جلب البيانات من Supabase: ${error.message}`,
      };
    }

    if (snapshots && snapshots.length > 0 && snapshots[0].payload) {
      const payloadState = snapshots[0].payload as MaliState;
      return {
        ok: true,
        success: true,
        state: payloadState,
        data: payloadState,
        updatedAt: snapshots[0].updated_at,
        timestamp: snapshots[0].updated_at,
        message: 'تم استرجاع أحدث نسخة سحابية خاصة بحسابك من Supabase بنجاح.',
      };
    }

    // 2. في حال عدم وجود لقطة موحدة، نفحص الجداول العلائقية الخاصة بهذا المستخدم فقط
    const [accRes, cntRes, dealRes, txRes, debtRes] = await Promise.all([
      supabase.from('mali_accounts').select('*').eq('user_id', userId),
      supabase.from('mali_contacts').select('*').eq('user_id', userId),
      supabase.from('mali_usd_deals').select('*').eq('user_id', userId),
      supabase.from('mali_transactions').select('*').eq('user_id', userId),
      supabase.from('mali_debts').select('*').eq('user_id', userId),
    ]);

    if (accRes.data && accRes.data.length > 0) {
      const reconstructedAccounts: Account[] = accRes.data.map((r: any) => ({
        id: r.id,
        name: r.name,
        bankName: r.bank_name,
        category: r.category,
        currency: r.currency,
        balance: roundMoney(Number(r.balance)),
        accountNumber: r.account_number || undefined,
        isCash: Boolean(r.is_cash),
        color: r.color || '#0F766E',
        notes: r.notes || undefined,
        updatedAt: r.updated_at,
      }));

      const reconstructedContacts: ContactPerson[] = (cntRes.data || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        role: r.role,
        bankDetails: r.bank_details || undefined,
        notes: r.notes || undefined,
        createdAt: r.created_at,
      }));

      const reconstructedDeals: UsdDeal[] = (dealRes.data || []).map((r: any) => ({
        id: r.id,
        dealNumber: r.deal_number,
        title: r.title,
        contactId: r.seller_contact_id || undefined,
        counterparty: r.counterparty,
        counterpartyPhone: r.counterparty_phone || undefined,
        buyDate: r.buy_date,
        totalUsdBought: roundMoney(Number(r.usd_amount)),
        buyRate: roundRate(Number(r.buy_rate)),
        grossLydCost: roundMoney(Number(r.usd_amount) * Number(r.buy_rate)),
        buyCommissionLyd: roundMoney(Number(r.cheque_extra_cost_lyd || 0)),
        totalLydCost: roundMoney(Number(r.total_lyd_cost)),
        effectiveBuyRate: roundRate(Number(r.effective_buy_rate)),
        buyPaymentMethod: r.buy_method,
        sourceLydAccountId: r.source_lyd_account_id,
        usdHoldingAccountId: r.target_usd_account_id,
        soldUsd: roundMoney(Number(r.sold_usd)),
        personalTakenUsd: roundMoney(Number(r.personal_taken_usd)),
        remainingUsd: roundMoney(Number(r.remaining_usd)),
        totalLydReceived: roundMoney(Number(r.total_lyd_received)),
        realizedProfitLyd: roundMoney(Number(r.realized_profit_lyd)),
        status: r.status,
        buyReceiptImages: r.buy_receipt_images || [],
        sales: r.sales || [],
        notes: r.notes || undefined,
        updatedAt: r.updated_at,
      }));

      const reconstructedTransactions: Transaction[] = (txRes.data || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        amount: roundMoney(Number(r.amount)),
        currency: r.currency,
        category: r.category,
        accountId: r.account_id,
        targetAccountId: r.target_account_id || undefined,
        paymentMethod: r.payment_method,
        exchangeRate: r.exchange_rate ? roundRate(Number(r.exchange_rate)) : undefined,
        feeAmount: roundMoney(Number(r.fee_amount || 0)),
        dealId: r.deal_id || undefined,
        saleId: r.sale_id || undefined,
        contactId: r.contact_id || undefined,
        receiptImages: r.receipt_images || [],
        date: r.tx_date,
        updatedAt: r.updated_at,
        notes: r.notes || undefined,
      }));

      const reconstructedDebts: DebtRecord[] = (debtRes.data || []).map((r: any) => ({
        id: r.id,
        contactId: r.contact_id || undefined,
        personName: r.person_name,
        phone: r.phone || undefined,
        direction: r.direction,
        currency: r.currency,
        totalAmount: roundMoney(Number(r.total_amount)),
        paidAmount: roundMoney(Number(r.paid_amount)),
        remainingAmount: roundMoney(Number(r.remaining_amount)),
        createdAt: r.created_at,
        dueDate: r.due_date || undefined,
        status: r.status === 'settled' ? 'completed' : 'active',
        installments: r.installments || [],
        updatedAt: r.updated_at,
        notes: r.notes || undefined,
      }));

      const now = new Date().toISOString();
      const partialState: Partial<MaliState> = {
        accounts: reconstructedAccounts,
        contacts: reconstructedContacts,
        deals: reconstructedDeals,
        transactions: reconstructedTransactions,
        debts: reconstructedDebts,
      };

      return {
        ok: true,
        success: true,
        state: partialState,
        data: partialState as MaliState,
        updatedAt: now,
        timestamp: now,
        message: 'تم استرجاع الجداول المالية العلائقية الخاصة بحسابك من Supabase بنجاح.',
      };
    }

    return {
      ok: false,
      success: false,
      isEmpty: true,
      message: 'لا توجد نسخة محفوظة مسبقاً لهذا الحساب على السحابة.',
    };
  } catch (e: any) {
    return {
      ok: false,
      success: false,
      message: `خطأ أثناء السحب من السحابة: ${e?.message || 'غير معروف'}`,
    };
  }
}
