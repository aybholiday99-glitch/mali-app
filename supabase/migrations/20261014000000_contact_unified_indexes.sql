-- =============================================================================
-- Migration: 20261014000000_contact_unified_indexes.sql
-- Purpose:
--   Add search and foreign lookup indexes for contacts across transactions,
--   debts, deals, and contacts tables to accelerate contact-filtered queries.
--
-- Tenant Isolation & Safety:
--   - Leading column is workspace_key to maintain workspace tenant scoping.
--   - Uses CREATE INDEX IF NOT EXISTS for safe, idempotent application.
--   - Wrapped in a transaction block (BEGIN / COMMIT).
--   - Preserves all existing table constraints, RLS policies, and grants.
-- =============================================================================

BEGIN;

-- 1. Foreign lookup index on transactions by contact within workspace
CREATE INDEX IF NOT EXISTS idx_mali_transactions_workspace_contact
  ON public.mali_transactions (workspace_key, contact_id);

-- 2. Foreign lookup index on debts by contact within workspace
CREATE INDEX IF NOT EXISTS idx_mali_debts_workspace_contact
  ON public.mali_debts (workspace_key, contact_id);

-- 3. Foreign lookup index on USD deals by seller contact within workspace
CREATE INDEX IF NOT EXISTS idx_mali_usd_deals_workspace_seller_contact
  ON public.mali_usd_deals (workspace_key, seller_contact_id);

-- 4. Search lookup index on contacts by phone within workspace
CREATE INDEX IF NOT EXISTS idx_mali_contacts_workspace_phone
  ON public.mali_contacts (workspace_key, phone);

COMMIT;
