-- ============================================================================
-- Migration: 20261012221500_security_rls_hardening.sql
-- Purpose:
--   1. Quarantine legacy unowned rows (user_id IS NULL) into a protected
--      archive table without data loss or false ownership attribution.
--   2. Remove all permissive (user_id IS NULL) RLS conditions across all 6 tables.
--   3. Revoke all privileges on financial tables from PUBLIC and anon.
--   4. Create strict per-operation (SELECT, INSERT, UPDATE, DELETE) RLS policies
--      restricted exclusively to authenticated users matching auth.uid() = user_id.
--   5. Harden public.handle_mali_auto_confirm_user() with immutable search_path
--      and revoke EXECUTE from PUBLIC, anon, and authenticated.
-- ============================================================================

BEGIN;

-- 1. Create protected quarantine archive table for any legacy unowned rows
CREATE TABLE IF NOT EXISTS public.mali_legacy_unowned_archive (
  archive_id BIGSERIAL PRIMARY KEY,
  source_table TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  record_id TEXT NOT NULL,
  record_data JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mali_legacy_unowned_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_legacy_unowned_archive FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mali_legacy_unowned_archive FROM PUBLIC, anon, authenticated;

-- Archive any existing rows where user_id IS NULL before enforcing strict ownership
INSERT INTO public.mali_legacy_unowned_archive (source_table, workspace_key, record_id, record_data)
SELECT 'mali_vault_snapshots', workspace_key, workspace_key, to_jsonb(t)
FROM public.mali_vault_snapshots t
WHERE t.user_id IS NULL;

INSERT INTO public.mali_legacy_unowned_archive (source_table, workspace_key, record_id, record_data)
SELECT 'mali_accounts', workspace_key, id, to_jsonb(t)
FROM public.mali_accounts t
WHERE t.user_id IS NULL;

INSERT INTO public.mali_legacy_unowned_archive (source_table, workspace_key, record_id, record_data)
SELECT 'mali_contacts', workspace_key, id, to_jsonb(t)
FROM public.mali_contacts t
WHERE t.user_id IS NULL;

INSERT INTO public.mali_legacy_unowned_archive (source_table, workspace_key, record_id, record_data)
SELECT 'mali_usd_deals', workspace_key, id, to_jsonb(t)
FROM public.mali_usd_deals t
WHERE t.user_id IS NULL;

INSERT INTO public.mali_legacy_unowned_archive (source_table, workspace_key, record_id, record_data)
SELECT 'mali_transactions', workspace_key, id, to_jsonb(t)
FROM public.mali_transactions t
WHERE t.user_id IS NULL;

INSERT INTO public.mali_legacy_unowned_archive (source_table, workspace_key, record_id, record_data)
SELECT 'mali_debts', workspace_key, id, to_jsonb(t)
FROM public.mali_debts t
WHERE t.user_id IS NULL;

-- Set default user_id to auth.uid() for authenticated inserts
ALTER TABLE public.mali_vault_snapshots ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.mali_accounts ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.mali_contacts ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.mali_usd_deals ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.mali_transactions ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.mali_debts ALTER COLUMN user_id SET DEFAULT auth.uid();

-- 2. Enable and FORCE Row Level Security on all 6 financial tables
ALTER TABLE public.mali_vault_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_vault_snapshots FORCE ROW LEVEL SECURITY;

ALTER TABLE public.mali_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.mali_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_contacts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.mali_usd_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_usd_deals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.mali_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_transactions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.mali_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_debts FORCE ROW LEVEL SECURITY;

-- 3. Revoke all privileges from PUBLIC and anon; grant strict CRUD only to authenticated
REVOKE ALL ON TABLE public.mali_vault_snapshots FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_accounts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_contacts FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_usd_deals FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_transactions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.mali_debts FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_vault_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_usd_deals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mali_debts TO authenticated;

-- 4. Drop legacy permissive policies
DROP POLICY IF EXISTS "Allow anon access to mali_vault_snapshots" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_owner_policy" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_accounts_owner_policy" ON public.mali_accounts;
DROP POLICY IF EXISTS "mali_contacts_owner_policy" ON public.mali_contacts;
DROP POLICY IF EXISTS "mali_usd_deals_owner_policy" ON public.mali_usd_deals;
DROP POLICY IF EXISTS "mali_transactions_owner_policy" ON public.mali_transactions;
DROP POLICY IF EXISTS "mali_debts_owner_policy" ON public.mali_debts;

-- 5. Create strict per-operation policies for mali_vault_snapshots
DROP POLICY IF EXISTS "mali_vault_select_own" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_insert_own" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_update_own" ON public.mali_vault_snapshots;
DROP POLICY IF EXISTS "mali_vault_delete_own" ON public.mali_vault_snapshots;

CREATE POLICY "mali_vault_select_own"
  ON public.mali_vault_snapshots FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "mali_vault_insert_own"
  ON public.mali_vault_snapshots FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_vault_update_own"
  ON public.mali_vault_snapshots FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_vault_delete_own"
  ON public.mali_vault_snapshots FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

-- 6. Create strict per-operation policies for mali_accounts
DROP POLICY IF EXISTS "mali_accounts_select_own" ON public.mali_accounts;
DROP POLICY IF EXISTS "mali_accounts_insert_own" ON public.mali_accounts;
DROP POLICY IF EXISTS "mali_accounts_update_own" ON public.mali_accounts;
DROP POLICY IF EXISTS "mali_accounts_delete_own" ON public.mali_accounts;

CREATE POLICY "mali_accounts_select_own"
  ON public.mali_accounts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "mali_accounts_insert_own"
  ON public.mali_accounts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_accounts_update_own"
  ON public.mali_accounts FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_accounts_delete_own"
  ON public.mali_accounts FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

-- 7. Create strict per-operation policies for mali_contacts
DROP POLICY IF EXISTS "mali_contacts_select_own" ON public.mali_contacts;
DROP POLICY IF EXISTS "mali_contacts_insert_own" ON public.mali_contacts;
DROP POLICY IF EXISTS "mali_contacts_update_own" ON public.mali_contacts;
DROP POLICY IF EXISTS "mali_contacts_delete_own" ON public.mali_contacts;

CREATE POLICY "mali_contacts_select_own"
  ON public.mali_contacts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "mali_contacts_insert_own"
  ON public.mali_contacts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_contacts_update_own"
  ON public.mali_contacts FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_contacts_delete_own"
  ON public.mali_contacts FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

-- 8. Create strict per-operation policies for mali_usd_deals
DROP POLICY IF EXISTS "mali_usd_deals_select_own" ON public.mali_usd_deals;
DROP POLICY IF EXISTS "mali_usd_deals_insert_own" ON public.mali_usd_deals;
DROP POLICY IF EXISTS "mali_usd_deals_update_own" ON public.mali_usd_deals;
DROP POLICY IF EXISTS "mali_usd_deals_delete_own" ON public.mali_usd_deals;

CREATE POLICY "mali_usd_deals_select_own"
  ON public.mali_usd_deals FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "mali_usd_deals_insert_own"
  ON public.mali_usd_deals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_usd_deals_update_own"
  ON public.mali_usd_deals FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_usd_deals_delete_own"
  ON public.mali_usd_deals FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

-- 9. Create strict per-operation policies for mali_transactions
DROP POLICY IF EXISTS "mali_transactions_select_own" ON public.mali_transactions;
DROP POLICY IF EXISTS "mali_transactions_insert_own" ON public.mali_transactions;
DROP POLICY IF EXISTS "mali_transactions_update_own" ON public.mali_transactions;
DROP POLICY IF EXISTS "mali_transactions_delete_own" ON public.mali_transactions;

CREATE POLICY "mali_transactions_select_own"
  ON public.mali_transactions FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "mali_transactions_insert_own"
  ON public.mali_transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_transactions_update_own"
  ON public.mali_transactions FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_transactions_delete_own"
  ON public.mali_transactions FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

-- 10. Create strict per-operation policies for mali_debts
DROP POLICY IF EXISTS "mali_debts_select_own" ON public.mali_debts;
DROP POLICY IF EXISTS "mali_debts_insert_own" ON public.mali_debts;
DROP POLICY IF EXISTS "mali_debts_update_own" ON public.mali_debts;
DROP POLICY IF EXISTS "mali_debts_delete_own" ON public.mali_debts;

CREATE POLICY "mali_debts_select_own"
  ON public.mali_debts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "mali_debts_insert_own"
  ON public.mali_debts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_debts_update_own"
  ON public.mali_debts FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id AND char_length(workspace_key) >= 6);

CREATE POLICY "mali_debts_delete_own"
  ON public.mali_debts FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id IS NOT NULL AND auth.uid() = user_id);

-- 11. Harden public.handle_mali_auto_confirm_user()
CREATE OR REPLACE FUNCTION public.handle_mali_auto_confirm_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND TG_TABLE_SCHEMA = 'auth' AND TG_TABLE_NAME = 'users' THEN
    IF NEW.email_confirmed_at IS NULL THEN
      NEW.email_confirmed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_mali_auto_confirm_user() FROM PUBLIC, anon, authenticated;

COMMIT;
