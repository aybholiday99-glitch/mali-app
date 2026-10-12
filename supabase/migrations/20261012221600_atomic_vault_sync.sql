-- CLI-created migration, ordered after 20261012221500_security_rls_hardening.
-- No live data is removed by the migration. The RPC replaces only the caller's
-- submitted workspace inside one transaction; failures roll back every write.
BEGIN;

ALTER TABLE public.mali_accounts ADD COLUMN IF NOT EXISTS sync_payload JSONB;
ALTER TABLE public.mali_contacts ADD COLUMN IF NOT EXISTS sync_payload JSONB;
ALTER TABLE public.mali_usd_deals ADD COLUMN IF NOT EXISTS sync_payload JSONB;
ALTER TABLE public.mali_transactions ADD COLUMN IF NOT EXISTS sync_payload JSONB;
ALTER TABLE public.mali_debts ADD COLUMN IF NOT EXISTS sync_payload JSONB;

-- Invoker RPCs need table grants. A trigger closes the old REST write path so
-- those grants cannot bypass compare-and-swap. PostgREST exposes public RPCs,
-- not pg_catalog.set_config; no exposed function accepts arbitrary SQL/GUCs.
-- The GUC gate protects API roles, not trusted SQL connections which can set
-- arbitrary transaction configuration. RLS remains the ownership boundary.
CREATE OR REPLACE FUNCTION public.mali_require_atomic_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND
     (auth.uid() IS NULL OR current_setting('mali.atomic_sync_user', true) IS DISTINCT FROM auth.uid()::TEXT) THEN
    RAISE EXCEPTION 'Financial writes must use mali_sync_vault' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mali_require_atomic_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER mali_accounts_atomic_sync BEFORE INSERT OR UPDATE OR DELETE ON public.mali_accounts
  FOR EACH ROW EXECUTE FUNCTION public.mali_require_atomic_sync();
CREATE TRIGGER mali_contacts_atomic_sync BEFORE INSERT OR UPDATE OR DELETE ON public.mali_contacts
  FOR EACH ROW EXECUTE FUNCTION public.mali_require_atomic_sync();
CREATE TRIGGER mali_usd_deals_atomic_sync BEFORE INSERT OR UPDATE OR DELETE ON public.mali_usd_deals
  FOR EACH ROW EXECUTE FUNCTION public.mali_require_atomic_sync();
CREATE TRIGGER mali_transactions_atomic_sync BEFORE INSERT OR UPDATE OR DELETE ON public.mali_transactions
  FOR EACH ROW EXECUTE FUNCTION public.mali_require_atomic_sync();
CREATE TRIGGER mali_debts_atomic_sync BEFORE INSERT OR UPDATE OR DELETE ON public.mali_debts
  FOR EACH ROW EXECUTE FUNCTION public.mali_require_atomic_sync();
CREATE TRIGGER mali_vault_snapshots_atomic_sync BEFORE INSERT OR UPDATE OR DELETE ON public.mali_vault_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.mali_require_atomic_sync();

CREATE OR REPLACE FUNCTION public.mali_sync_vault(
  p_expected_user_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_workspace TEXT;
  v_updated_at TIMESTAMPTZ;
  v_previous_payload JSONB;
  v_exists BOOLEAN;
  v_now TIMESTAMPTZ;
  v_key TEXT;
  v_rows JSONB;
  v_row JSONB;
  v_workspaces TEXT[];
  v_previous_sync_user TEXT;
BEGIN
  IF v_user_id IS NULL OR p_expected_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'The authenticated user does not match the vault owner' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_payload->>'ownerId' IS DISTINCT FROM v_user_id::TEXT THEN
    RAISE EXCEPTION 'Invalid vault ownership or payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'supabaseConfig' THEN
    RAISE EXCEPTION 'Connection configuration must not be stored in vault payloads' USING ERRCODE = '22023';
  END IF;

  -- Serialize new-vault creation as well as updates for this authenticated user.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mali-sync:' || v_user_id::TEXT, 0));
  SELECT s.workspace_key, s.updated_at, s.payload
    INTO v_workspace, v_updated_at, v_previous_payload
    FROM public.mali_vault_snapshots AS s
    WHERE s.user_id = v_user_id
    ORDER BY s.updated_at DESC, s.workspace_key
    LIMIT 1 FOR UPDATE;
  v_exists := FOUND;

  IF v_exists THEN
    -- A null baseline is create-only. Every existing vault needs the exact
    -- timestamp observed by this device, including devices synced previously.
    IF p_expected_updated_at IS NULL OR p_expected_updated_at IS DISTINCT FROM v_updated_at THEN
      RETURN jsonb_build_object('ok', false, 'conflictDetected', true,
        'updatedAt', v_updated_at, 'cloudState', v_previous_payload);
    END IF;
  ELSE
    IF p_expected_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'The expected vault no longer exists; pull before retrying' USING ERRCODE = '40001';
    END IF;
    -- A snapshot CAS token cannot prove which relational legacy revision the
    -- client has seen. Require a verified migration instead of replacing it.
    SELECT array_agg(DISTINCT w.workspace_key) INTO v_workspaces FROM (
      SELECT workspace_key FROM public.mali_accounts WHERE user_id = v_user_id
      UNION SELECT workspace_key FROM public.mali_contacts WHERE user_id = v_user_id
      UNION SELECT workspace_key FROM public.mali_usd_deals WHERE user_id = v_user_id
      UNION SELECT workspace_key FROM public.mali_transactions WHERE user_id = v_user_id
      UNION SELECT workspace_key FROM public.mali_debts WHERE user_id = v_user_id
    ) AS w;
    IF cardinality(v_workspaces) > 0 THEN
      RAISE EXCEPTION 'Legacy relational data requires verified migration before the first snapshot' USING ERRCODE = '22023';
    END IF;
    v_workspace := 'mali-vault-' || v_user_id::TEXT;
  END IF;

  FOREACH v_key IN ARRAY ARRAY['accounts', 'contacts', 'transactions', 'deals', 'debts', 'procedures', 'budgets'] LOOP
    v_rows := p_payload->v_key;
    IF v_rows IS NULL OR jsonb_typeof(v_rows) <> 'array' THEN
      RAISE EXCEPTION 'Invalid collection: %', v_key USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) AS e(value)
      WHERE jsonb_typeof(e.value) <> 'object' OR jsonb_typeof(e.value->'id') IS DISTINCT FROM 'string'
         OR length(btrim(e.value->>'id')) = 0) THEN
      RAISE EXCEPTION 'Invalid record in collection: %', v_key USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) AS e(value)
      GROUP BY e.value->>'id' HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'Duplicate record ID in collection: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(p_payload->'marketRates') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload->'marketRates'->'cashUsdToLyd') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload->'marketRates'->'chequeUsdToLyd') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload->'marketRates'->'defaultChequeDiscountPercent') IS DISTINCT FROM 'number'
     OR (p_payload->'marketRates'->>'cashUsdToLyd')::NUMERIC <= 0
     OR (p_payload->'marketRates'->>'chequeUsdToLyd')::NUMERIC <= 0
     OR (p_payload->'marketRates'->>'defaultChequeDiscountPercent')::NUMERIC NOT BETWEEN 0 AND 100
     OR jsonb_typeof(p_payload->'lastModifiedAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Invalid rates or modification timestamp' USING ERRCODE = '22023';
  END IF;
  PERFORM (p_payload->>'lastModifiedAt')::TIMESTAMPTZ;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'accounts') LOOP
    IF jsonb_typeof(v_row->'name') IS DISTINCT FROM 'string' OR length(btrim(v_row->>'name')) = 0
       OR jsonb_typeof(v_row->'bankName') IS DISTINCT FROM 'string'
       OR v_row->>'category' NOT IN ('cash_lyd', 'cash_usd', 'bank_lyd', 'bank_usd', 'ewallet')
       OR v_row->>'currency' NOT IN ('LYD', 'USD')
       OR jsonb_typeof(v_row->'balance') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_row->'isCash') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Invalid account' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'contacts') LOOP
    IF jsonb_typeof(v_row->'name') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'phone') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'role') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'createdAt') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid contact' USING ERRCODE = '22023';
    END IF;
    PERFORM (v_row->>'createdAt')::TIMESTAMPTZ;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'transactions') LOOP
    IF v_row->>'type' NOT IN ('expense', 'income', 'transfer', 'cheque_liquidation', 'deal_buy', 'deal_sell', 'deal_personal_take', 'debt_settlement')
       OR v_row->>'currency' NOT IN ('LYD', 'USD')
       OR v_row->>'paymentMethod' NOT IN ('cash', 'cheque', 'transfer', 'card')
       OR jsonb_typeof(v_row->'title') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'category') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'accountId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'date') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'amount') IS DISTINCT FROM 'number'
       OR (v_row->>'amount')::NUMERIC < 0
       OR (v_row ? 'feeAmount' AND (jsonb_typeof(v_row->'feeAmount') IS DISTINCT FROM 'number' OR (v_row->>'feeAmount')::NUMERIC < 0)) THEN
      RAISE EXCEPTION 'Invalid transaction' USING ERRCODE = '22023';
    END IF;
    PERFORM (v_row->>'date')::TIMESTAMPTZ;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'deals') LOOP
    FOREACH v_key IN ARRAY ARRAY['totalUsdBought', 'buyRate', 'grossLydCost', 'buyCommissionLyd', 'totalLydCost', 'effectiveBuyRate', 'soldUsd', 'personalTakenUsd', 'remainingUsd', 'totalLydReceived', 'realizedProfitLyd'] LOOP
      IF jsonb_typeof(v_row->v_key) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Invalid deal amount: %', v_key USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF (v_row->>'totalUsdBought')::NUMERIC <= 0 OR (v_row->>'buyRate')::NUMERIC <= 0
       OR (v_row->>'effectiveBuyRate')::NUMERIC <= 0
       OR (v_row->>'soldUsd')::NUMERIC < 0 OR (v_row->>'personalTakenUsd')::NUMERIC < 0
       OR (v_row->>'remainingUsd')::NUMERIC < 0
       OR abs((v_row->>'totalUsdBought')::NUMERIC - (v_row->>'soldUsd')::NUMERIC - (v_row->>'personalTakenUsd')::NUMERIC - (v_row->>'remainingUsd')::NUMERIC) > 0.01
       OR v_row->>'status' NOT IN ('open', 'partial', 'closed')
       OR v_row->>'buyPaymentMethod' NOT IN ('cash', 'cheque', 'transfer', 'card')
       OR jsonb_typeof(v_row->'dealNumber') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'title') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'buyDate') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'sourceLydAccountId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'usdHoldingAccountId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'sales') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid deal or remaining USD' USING ERRCODE = '22023';
    END IF;
    PERFORM (v_row->>'buyDate')::TIMESTAMPTZ;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'debts') LOOP
    IF v_row->>'direction' NOT IN ('receivable', 'payable') OR v_row->>'currency' NOT IN ('LYD', 'USD')
       OR v_row->>'status' NOT IN ('active', 'completed')
       OR jsonb_typeof(v_row->'personName') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'createdAt') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'totalAmount') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_row->'paidAmount') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_row->'remainingAmount') IS DISTINCT FROM 'number'
       OR (v_row->>'totalAmount')::NUMERIC < 0 OR (v_row->>'paidAmount')::NUMERIC < 0
       OR (v_row->>'remainingAmount')::NUMERIC < 0
       OR abs((v_row->>'totalAmount')::NUMERIC - (v_row->>'paidAmount')::NUMERIC - (v_row->>'remainingAmount')::NUMERIC) > 0.01
       OR jsonb_typeof(v_row->'installments') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid debt or remaining amount' USING ERRCODE = '22023';
    END IF;
    PERFORM (v_row->>'createdAt')::TIMESTAMPTZ;
  END LOOP;

  -- An acknowledged repeat with the same baseline/content is a no-op. A lost
  -- acknowledgement yields a safe conflict, never a second financial mutation.
  IF v_exists AND (v_previous_payload - 'lastModifiedAt' - 'exportedAt') = (p_payload - 'lastModifiedAt' - 'exportedAt') THEN
    RETURN jsonb_build_object('ok', true, 'updatedAt', v_updated_at);
  END IF;
  v_now := greatest(clock_timestamp(), COALESCE(v_updated_at + INTERVAL '1 microsecond', '-infinity'::TIMESTAMPTZ));
  v_previous_sync_user := current_setting('mali.atomic_sync_user', true);
  PERFORM set_config('mali.atomic_sync_user', v_user_id::TEXT, true);

  -- Delete children first. Any permission/constraint/delete error aborts the RPC.
  DELETE FROM public.mali_transactions AS r WHERE r.user_id = v_user_id AND r.workspace_key = v_workspace
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'transactions') AS e(value) WHERE e.value->>'id' = r.id);
  DELETE FROM public.mali_debts AS r WHERE r.user_id = v_user_id AND r.workspace_key = v_workspace
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'debts') AS e(value) WHERE e.value->>'id' = r.id);
  DELETE FROM public.mali_usd_deals AS r WHERE r.user_id = v_user_id AND r.workspace_key = v_workspace
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'deals') AS e(value) WHERE e.value->>'id' = r.id);
  DELETE FROM public.mali_contacts AS r WHERE r.user_id = v_user_id AND r.workspace_key = v_workspace
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'contacts') AS e(value) WHERE e.value->>'id' = r.id);
  DELETE FROM public.mali_accounts AS r WHERE r.user_id = v_user_id AND r.workspace_key = v_workspace
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'accounts') AS e(value) WHERE e.value->>'id' = r.id);

  INSERT INTO public.mali_accounts (id, workspace_key, user_id, name, bank_name, category, currency, balance, account_number, is_cash, color, notes, updated_at, sync_payload)
  SELECT e->>'id', v_workspace, v_user_id, e->>'name', e->>'bankName', e->>'category', e->>'currency', (e->>'balance')::NUMERIC,
    e->>'accountNumber', (e->>'isCash')::BOOLEAN, COALESCE(e->>'color', '#0F766E'), e->>'notes', v_now, e
  FROM jsonb_array_elements(p_payload->'accounts') AS e
  ON CONFLICT (workspace_key, id) DO UPDATE SET user_id = EXCLUDED.user_id, name = EXCLUDED.name, bank_name = EXCLUDED.bank_name,
    category = EXCLUDED.category, currency = EXCLUDED.currency, balance = EXCLUDED.balance, account_number = EXCLUDED.account_number,
    is_cash = EXCLUDED.is_cash, color = EXCLUDED.color, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at, sync_payload = EXCLUDED.sync_payload;

  INSERT INTO public.mali_contacts (id, workspace_key, user_id, name, phone, role, bank_details, notes, created_at, sync_payload)
  SELECT e->>'id', v_workspace, v_user_id, e->>'name', e->>'phone', e->>'role', e->>'bankDetails', e->>'notes', (e->>'createdAt')::TIMESTAMPTZ, e
  FROM jsonb_array_elements(p_payload->'contacts') AS e
  ON CONFLICT (workspace_key, id) DO UPDATE SET user_id = EXCLUDED.user_id, name = EXCLUDED.name, phone = EXCLUDED.phone,
    role = EXCLUDED.role, bank_details = EXCLUDED.bank_details, notes = EXCLUDED.notes, created_at = EXCLUDED.created_at, sync_payload = EXCLUDED.sync_payload;

  INSERT INTO public.mali_usd_deals (id, workspace_key, user_id, deal_number, title, seller_contact_id, counterparty, counterparty_phone,
    buy_date, usd_amount, buy_rate, effective_buy_rate, total_lyd_cost, buy_method, source_lyd_account_id, target_usd_account_id,
    cheque_extra_cost_lyd, sold_usd, personal_taken_usd, remaining_usd, total_lyd_received, realized_profit_lyd, status, buy_receipt_images, sales, notes, updated_at, sync_payload)
  SELECT e->>'id', v_workspace, v_user_id, e->>'dealNumber', e->>'title', e->>'contactId', COALESCE(e->>'counterparty', 'غير محدد'), e->>'counterpartyPhone',
    e->>'buyDate', (e->>'totalUsdBought')::NUMERIC, (e->>'buyRate')::NUMERIC, (e->>'effectiveBuyRate')::NUMERIC, (e->>'totalLydCost')::NUMERIC,
    e->>'buyPaymentMethod', e->>'sourceLydAccountId', e->>'usdHoldingAccountId', (e->>'buyCommissionLyd')::NUMERIC,
    (e->>'soldUsd')::NUMERIC, (e->>'personalTakenUsd')::NUMERIC, (e->>'remainingUsd')::NUMERIC, (e->>'totalLydReceived')::NUMERIC,
    (e->>'realizedProfitLyd')::NUMERIC, e->>'status', COALESCE(e->'buyReceiptImages', '[]'::JSONB), e->'sales', e->>'notes', v_now, e
  FROM jsonb_array_elements(p_payload->'deals') AS e
  ON CONFLICT (workspace_key, id) DO UPDATE SET user_id = EXCLUDED.user_id, deal_number = EXCLUDED.deal_number, title = EXCLUDED.title,
    seller_contact_id = EXCLUDED.seller_contact_id, counterparty = EXCLUDED.counterparty, counterparty_phone = EXCLUDED.counterparty_phone,
    buy_date = EXCLUDED.buy_date, usd_amount = EXCLUDED.usd_amount, buy_rate = EXCLUDED.buy_rate, effective_buy_rate = EXCLUDED.effective_buy_rate,
    total_lyd_cost = EXCLUDED.total_lyd_cost, buy_method = EXCLUDED.buy_method, source_lyd_account_id = EXCLUDED.source_lyd_account_id,
    target_usd_account_id = EXCLUDED.target_usd_account_id, cheque_extra_cost_lyd = EXCLUDED.cheque_extra_cost_lyd, sold_usd = EXCLUDED.sold_usd,
    personal_taken_usd = EXCLUDED.personal_taken_usd, remaining_usd = EXCLUDED.remaining_usd, total_lyd_received = EXCLUDED.total_lyd_received,
    realized_profit_lyd = EXCLUDED.realized_profit_lyd, status = EXCLUDED.status, buy_receipt_images = EXCLUDED.buy_receipt_images,
    sales = EXCLUDED.sales, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at, sync_payload = EXCLUDED.sync_payload;

  INSERT INTO public.mali_transactions (id, workspace_key, user_id, title, type, amount, currency, category, account_id, target_account_id,
    payment_method, exchange_rate, fee_amount, deal_id, sale_id, contact_id, receipt_images, tx_date, notes, updated_at, sync_payload)
  SELECT e->>'id', v_workspace, v_user_id, e->>'title', e->>'type', (e->>'amount')::NUMERIC, e->>'currency', e->>'category', e->>'accountId', e->>'targetAccountId',
    e->>'paymentMethod', (e->>'exchangeRate')::NUMERIC, COALESCE((e->>'feeAmount')::NUMERIC, 0), e->>'dealId', e->>'saleId', e->>'contactId',
    COALESCE(e->'receiptImages', '[]'::JSONB), e->>'date', e->>'notes', v_now, e
  FROM jsonb_array_elements(p_payload->'transactions') AS e
  ON CONFLICT (workspace_key, id) DO UPDATE SET user_id = EXCLUDED.user_id, title = EXCLUDED.title, type = EXCLUDED.type,
    amount = EXCLUDED.amount, currency = EXCLUDED.currency, category = EXCLUDED.category, account_id = EXCLUDED.account_id,
    target_account_id = EXCLUDED.target_account_id, payment_method = EXCLUDED.payment_method, exchange_rate = EXCLUDED.exchange_rate,
    fee_amount = EXCLUDED.fee_amount, deal_id = EXCLUDED.deal_id, sale_id = EXCLUDED.sale_id, contact_id = EXCLUDED.contact_id,
    receipt_images = EXCLUDED.receipt_images, tx_date = EXCLUDED.tx_date, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at, sync_payload = EXCLUDED.sync_payload;

  INSERT INTO public.mali_debts (id, workspace_key, user_id, contact_id, person_name, phone, direction, currency, total_amount,
    paid_amount, remaining_amount, created_at, due_date, status, installments, notes, updated_at, sync_payload)
  SELECT e->>'id', v_workspace, v_user_id, e->>'contactId', e->>'personName', e->>'phone', e->>'direction', e->>'currency', (e->>'totalAmount')::NUMERIC,
    (e->>'paidAmount')::NUMERIC, (e->>'remainingAmount')::NUMERIC, e->>'createdAt', e->>'dueDate',
    CASE WHEN e->>'status' = 'completed' THEN 'settled' ELSE 'active' END, e->'installments', e->>'notes', v_now, e
  FROM jsonb_array_elements(p_payload->'debts') AS e
  ON CONFLICT (workspace_key, id) DO UPDATE SET user_id = EXCLUDED.user_id, contact_id = EXCLUDED.contact_id, person_name = EXCLUDED.person_name,
    phone = EXCLUDED.phone, direction = EXCLUDED.direction, currency = EXCLUDED.currency, total_amount = EXCLUDED.total_amount,
    paid_amount = EXCLUDED.paid_amount, remaining_amount = EXCLUDED.remaining_amount, created_at = EXCLUDED.created_at,
    due_date = EXCLUDED.due_date, status = EXCLUDED.status, installments = EXCLUDED.installments, notes = EXCLUDED.notes,
    updated_at = EXCLUDED.updated_at, sync_payload = EXCLUDED.sync_payload;

  INSERT INTO public.mali_vault_snapshots (workspace_key, user_id, payload, updated_at)
  VALUES (v_workspace, v_user_id, p_payload, v_now)
  ON CONFLICT (workspace_key) DO UPDATE SET user_id = EXCLUDED.user_id, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
  PERFORM set_config('mali.atomic_sync_user', COALESCE(v_previous_sync_user, ''), true);
  RETURN jsonb_build_object('ok', true, 'updatedAt', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.mali_sync_vault(UUID, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mali_sync_vault(UUID, TIMESTAMPTZ, JSONB) TO authenticated;
COMMIT;
