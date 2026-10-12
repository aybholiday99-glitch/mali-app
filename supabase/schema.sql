-- =============================================================================
-- منظومة «مالي - Mali» | المخطط الكامل لقاعدة بيانات Supabase (PostgreSQL + RLS)
-- نسخة محصّنة أمنياً (Strict Per-Operation RLS + Authenticated Isolation)
-- =============================================================================

-- 1. جدول خزنة المزامنة الشاملة (Vault Snapshots) مع عزل صارم للمستخدمين (RLS)
CREATE TABLE IF NOT EXISTS public.mali_vault_snapshots (
  workspace_key TEXT PRIMARY KEY CHECK (char_length(workspace_key) >= 6),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. جدول الحسابات والخزائن المالية (Accounts & Wallets)
CREATE TABLE IF NOT EXISTS public.mali_accounts (
  id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  category TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('LYD', 'USD')),
  balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  account_number TEXT,
  is_cash BOOLEAN NOT NULL DEFAULT false,
  color TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_key, id)
);

-- 3. جدول المتعاملين (الأشخاص والوسطاء والتجار)
CREATE TABLE IF NOT EXISTS public.mali_contacts (
  id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  bank_details TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_key, id)
);

-- 4. جدول صفقات شراء وبيع الدولار (USD/LYD Deals)
CREATE TABLE IF NOT EXISTS public.mali_usd_deals (
  id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_number TEXT NOT NULL,
  title TEXT NOT NULL,
  seller_contact_id TEXT,
  counterparty TEXT NOT NULL,
  counterparty_phone TEXT,
  buy_date TEXT NOT NULL,
  usd_amount NUMERIC(18, 2) NOT NULL CHECK (usd_amount > 0),
  buy_rate NUMERIC(18, 4) NOT NULL CHECK (buy_rate > 0),
  effective_buy_rate NUMERIC(18, 4) NOT NULL,
  total_lyd_cost NUMERIC(18, 2) NOT NULL,
  buy_method TEXT NOT NULL,
  source_lyd_account_id TEXT NOT NULL,
  target_usd_account_id TEXT NOT NULL,
  cheque_extra_cost_lyd NUMERIC(18, 2) DEFAULT 0,
  sold_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  personal_taken_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  remaining_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_lyd_received NUMERIC(18, 2) NOT NULL DEFAULT 0,
  realized_profit_lyd NUMERIC(18, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('open', 'partial', 'closed')),
  buy_receipt_images JSONB DEFAULT '[]'::jsonb,
  sales JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_key, id)
);

-- 5. جدول سجل الحركات المالية والمصاريف وتسييل الصكوك (Transactions Ledger)
CREATE TABLE IF NOT EXISTS public.mali_transactions (
  id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('LYD', 'USD')),
  category TEXT NOT NULL,
  account_id TEXT NOT NULL,
  target_account_id TEXT,
  payment_method TEXT NOT NULL,
  exchange_rate NUMERIC(18, 4),
  fee_amount NUMERIC(18, 2) DEFAULT 0,
  deal_id TEXT,
  sale_id TEXT,
  contact_id TEXT,
  receipt_images JSONB DEFAULT '[]'::jsonb,
  tx_date TEXT NOT NULL,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_key, id)
);

-- 6. جدول الديون والأمانات (Debts & Commitments)
CREATE TABLE IF NOT EXISTS public.mali_debts (
  id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id TEXT,
  person_name TEXT NOT NULL,
  phone TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('receivable', 'payable')),
  currency TEXT NOT NULL CHECK (currency IN ('LYD', 'USD')),
  total_amount NUMERIC(18, 2) NOT NULL,
  paid_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(18, 2) NOT NULL,
  created_at TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'settled')),
  installments JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_key, id)
);

-- 7. جدول أرشيف السجلات القديمة غير المنسوبة لمالك (Quarantine Archive)
CREATE TABLE IF NOT EXISTS public.mali_legacy_unowned_archive (
  archive_id BIGSERIAL PRIMARY KEY,
  source_table TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  row_data JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- تفعيل سياسات الأمان الصارمة وعزل البيانات (Row Level Security - RLS)
-- =============================================================================
ALTER TABLE public.mali_vault_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_usd_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_legacy_unowned_archive ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mali_vault_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mali_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mali_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mali_usd_deals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mali_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mali_debts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mali_legacy_unowned_archive FORCE ROW LEVEL SECURITY;

-- سحب كافة الصلاحيات من المستخدم المجهول (anon) و(PUBLIC)
REVOKE ALL ON TABLE public.mali_vault_snapshots FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_accounts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_contacts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_usd_deals FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_transactions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_debts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_legacy_unowned_archive FROM PUBLIC, anon, authenticated;

-- منح الصلاحيات اللازمة للمستخدم الموثّق فقط (authenticated) خاضعة لسياسات RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_vault_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_usd_deals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_debts TO authenticated;

-- سياسات جدول الخزنة الشاملة (mali_vault_snapshots)
DROP POLICY IF EXISTS "mali_vault_owner_policy" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_snapshots_select_own" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_snapshots_insert_own" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_snapshots_update_own" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_snapshots_delete_own" ON public.mali_vault_snapshots;

CREATE POLICY "mali_vault_snapshots_select_own" ON public.mali_vault_snapshots
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_vault_snapshots_insert_own" ON public.mali_vault_snapshots
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_vault_snapshots_update_own" ON public.mali_vault_snapshots
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id) WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_vault_snapshots_delete_own" ON public.mali_vault_snapshots
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- سياسات جدول الحسابات (mali_accounts)
DROP POLICY IF EXISTS "mali_accounts_owner_policy" ON public.mali_accounts;
DROP POLICY IF EXISTS "mali_accounts_select_own" ON public.mali_accounts;
DROP POLICY IF EXISTS "mali_accounts_insert_own" ON public.mali_accounts;
DROP POLICY IF EXISTS "mali_accounts_update_own" ON public.mali_accounts;
DROP POLICY IF EXISTS "mali_accounts_delete_own" ON public.mali_accounts;

CREATE POLICY "mali_accounts_select_own" ON public.mali_accounts
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_accounts_insert_own" ON public.mali_accounts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_accounts_update_own" ON public.mali_accounts
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id) WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_accounts_delete_own" ON public.mali_accounts
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- سياسات جدول المتعاملين (mali_contacts)
DROP POLICY IF EXISTS "mali_contacts_owner_policy" ON public.mali_contacts;
DROP POLICY IF EXISTS "mali_contacts_select_own" ON public.mali_contacts;
DROP POLICY IF EXISTS "mali_contacts_insert_own" ON public.mali_contacts;
DROP POLICY IF EXISTS "mali_contacts_update_own" ON public.mali_contacts;
DROP POLICY IF EXISTS "mali_contacts_delete_own" ON public.mali_contacts;

CREATE POLICY "mali_contacts_select_own" ON public.mali_contacts
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_contacts_insert_own" ON public.mali_contacts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_contacts_update_own" ON public.mali_contacts
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id) WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_contacts_delete_own" ON public.mali_contacts
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- سياسات جدول صفقات الدولار (mali_usd_deals)
DROP POLICY IF EXISTS "mali_usd_deals_owner_policy" ON public.mali_usd_deals;
DROP POLICY IF EXISTS "mali_usd_deals_select_own" ON public.mali_usd_deals;
DROP POLICY IF EXISTS "mali_usd_deals_insert_own" ON public.mali_usd_deals;
DROP POLICY IF EXISTS "mali_usd_deals_update_own" ON public.mali_usd_deals;
DROP POLICY IF EXISTS "mali_usd_deals_delete_own" ON public.mali_usd_deals;

CREATE POLICY "mali_usd_deals_select_own" ON public.mali_usd_deals
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_usd_deals_insert_own" ON public.mali_usd_deals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_usd_deals_update_own" ON public.mali_usd_deals
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id) WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_usd_deals_delete_own" ON public.mali_usd_deals
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- سياسات جدول الحركات المالية (mali_transactions)
DROP POLICY IF EXISTS "mali_transactions_owner_policy" ON public.mali_transactions;
DROP POLICY IF EXISTS "mali_transactions_select_own" ON public.mali_transactions;
DROP POLICY IF EXISTS "mali_transactions_insert_own" ON public.mali_transactions;
DROP POLICY IF EXISTS "mali_transactions_update_own" ON public.mali_transactions;
DROP POLICY IF EXISTS "mali_transactions_delete_own" ON public.mali_transactions;

CREATE POLICY "mali_transactions_select_own" ON public.mali_transactions
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_transactions_insert_own" ON public.mali_transactions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_transactions_update_own" ON public.mali_transactions
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id) WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_transactions_delete_own" ON public.mali_transactions
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- سياسات جدول الديون والأمانات (mali_debts)
DROP POLICY IF EXISTS "mali_debts_owner_policy" ON public.mali_debts;
DROP POLICY IF EXISTS "mali_debts_select_own" ON public.mali_debts;
DROP POLICY IF EXISTS "mali_debts_insert_own" ON public.mali_debts;
DROP POLICY IF EXISTS "mali_debts_update_own" ON public.mali_debts;
DROP POLICY IF EXISTS "mali_debts_delete_own" ON public.mali_debts;

CREATE POLICY "mali_debts_select_own" ON public.mali_debts
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_debts_insert_own" ON public.mali_debts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_debts_update_own" ON public.mali_debts
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id) WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "mali_debts_delete_own" ON public.mali_debts
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- دالة تأكيد البريد التلقائي المحصّنة (SECURITY DEFINER + search_path فارغ + سحب التنفيذ العام)
CREATE OR REPLACE FUNCTION public.handle_mali_auto_confirm_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_mali_auto_confirm_user() FROM PUBLIC, anon, authenticated;
