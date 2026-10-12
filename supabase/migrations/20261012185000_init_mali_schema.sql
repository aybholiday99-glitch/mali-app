-- =============================================================================
-- منظومة «مالي - Mali» | المخطط الكامل لقاعدة بيانات Supabase (PostgreSQL + RLS)
-- انسخ هذا الكود بالكامل وضعه في (SQL Editor) داخل مشروعك في Supabase ثم اضغط Run
-- =============================================================================

-- 1. جدول خزنة المزامنة الشاملة (Vault Snapshots) مع عزل المستخدمين (RLS)
CREATE TABLE IF NOT EXISTS public.mali_vault_snapshots (
  workspace_key TEXT PRIMARY KEY CHECK (char_length(workspace_key) >= 6),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. جدول الحسابات والخزائن المالية (Accounts & Wallets)
CREATE TABLE IF NOT EXISTS public.mali_accounts (
  id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('buyer', 'seller', 'both', 'broker')),
  bank_details TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_key, id)
);

-- 4. جدول صفقات شراء وبيع الدولار (USD/LYD Deals)
CREATE TABLE IF NOT EXISTS public.mali_usd_deals (
  id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- =============================================================================
-- تفعيل سياسات الأمان وعزل البيانات (Row Level Security - RLS)
-- =============================================================================
ALTER TABLE public.mali_vault_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_usd_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_debts ENABLE ROW LEVEL SECURITY;

-- سياسة جدول الخزنة: إذا كان السجل مربوطاً بمستخدم مسجل (user_id) لا يملكه إلا صاحبه (auth.uid() = user_id)
DROP POLICY IF EXISTS "Allow anon access to mali_vault_snapshots" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_owner_policy" ON public.mali_vault_snapshots;
CREATE POLICY "mali_vault_owner_policy"
  ON public.mali_vault_snapshots
  FOR ALL
  USING (
    (user_id IS NULL AND char_length(workspace_key) >= 6)
    OR (auth.uid() = user_id)
  )
  WITH CHECK (
    (user_id IS NULL AND char_length(workspace_key) >= 6)
    OR (auth.uid() = user_id)
  );

-- سياسات الجداول العلائقية
DROP POLICY IF EXISTS "mali_accounts_owner_policy" ON public.mali_accounts;
CREATE POLICY "mali_accounts_owner_policy"
  ON public.mali_accounts FOR ALL
  USING ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id))
  WITH CHECK ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id));

DROP POLICY IF EXISTS "mali_contacts_owner_policy" ON public.mali_contacts;
CREATE POLICY "mali_contacts_owner_policy"
  ON public.mali_contacts FOR ALL
  USING ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id))
  WITH CHECK ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id));

DROP POLICY IF EXISTS "mali_usd_deals_owner_policy" ON public.mali_usd_deals;
CREATE POLICY "mali_usd_deals_owner_policy"
  ON public.mali_usd_deals FOR ALL
  USING ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id))
  WITH CHECK ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id));

DROP POLICY IF EXISTS "mali_transactions_owner_policy" ON public.mali_transactions;
CREATE POLICY "mali_transactions_owner_policy"
  ON public.mali_transactions FOR ALL
  USING ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id))
  WITH CHECK ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id));

DROP POLICY IF EXISTS "mali_debts_owner_policy" ON public.mali_debts;
CREATE POLICY "mali_debts_owner_policy"
  ON public.mali_debts FOR ALL
  USING ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id))
  WITH CHECK ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id));
