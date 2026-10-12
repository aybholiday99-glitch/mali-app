-- CLI-created migration, ordered after 20261012221500_security_rls_hardening.
-- No live data is removed by the migration. The RPC replaces only the caller's
-- submitted workspace inside one transaction; failures roll back every write.
BEGIN;

ALTER TABLE public.mali_accounts ADD COLUMN IF NOT EXISTS sync_payload JSONB;
ALTER TABLE public.mali_contacts ADD COLUMN IF NOT EXISTS sync_payload JSONB;
ALTER TABLE public.mali_usd_deals ADD COLUMN IF NOT EXISTS sync_payload JSONB;
ALTER TABLE public.mali_transactions ADD COLUMN IF NOT EXISTS sync_payload JSONB;
ALTER TABLE public.mali_debts ADD COLUMN IF NOT EXISTS sync_payload JSONB;


-- Pure validation helpers live outside the exposed public API schema. They never
-- read user tables, mutate data, elevate privileges, or set transaction flags.
CREATE SCHEMA IF NOT EXISTS mali_validation;
REVOKE ALL ON SCHEMA mali_validation FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA mali_validation TO authenticated;

CREATE OR REPLACE FUNCTION mali_validation.require_text(p_value JSONB, p_label TEXT, p_nonempty BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_text TEXT;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Invalid text: %', p_label USING ERRCODE = '22023';
  END IF;
  v_text := p_value #>> '{}';
  IF p_nonempty AND length(btrim(v_text)) = 0 THEN
    RAISE EXCEPTION 'Empty text: %', p_label USING ERRCODE = '22023';
  END IF;
  RETURN v_text;
END;
$$;

CREATE OR REPLACE FUNCTION mali_validation.require_enum(p_value JSONB, p_allowed TEXT[], p_label TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_text TEXT := mali_validation.require_text(p_value, p_label, true);
BEGIN
  IF NOT (v_text = ANY(p_allowed)) THEN
    RAISE EXCEPTION 'Invalid enum: %', p_label USING ERRCODE = '22023';
  END IF;
  RETURN v_text;
END;
$$;

CREATE OR REPLACE FUNCTION mali_validation.require_number(
  p_value JSONB, p_label TEXT, p_scale INTEGER DEFAULT 2,
  p_maximum NUMERIC DEFAULT 1000000000000, p_signed BOOLEAN DEFAULT false
)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_number NUMERIC;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid number: %', p_label USING ERRCODE = '22023';
  END IF;
  v_number := (p_value #>> '{}')::NUMERIC;
  IF abs(v_number) > p_maximum OR (NOT p_signed AND v_number < 0)
     OR (p_scale IS NOT NULL AND v_number <> round(v_number, p_scale)) THEN
    RAISE EXCEPTION 'Invalid range or decimal precision: %', p_label USING ERRCODE = '22023';
  END IF;
  RETURN v_number;
END;
$$;

CREATE OR REPLACE FUNCTION mali_validation.require_timestamp(p_value JSONB, p_label TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_text TEXT := mali_validation.require_text(p_value, p_label, true);
  v_timestamp TIMESTAMPTZ;
BEGIN
  -- Never admit PostgreSQL's relative/special date vocabulary. Calendar-only
  -- values use UTC, matching the client's interpretation of YYYY-MM-DD.
  IF v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v_text := v_text || 'T00:00:00Z';
  ELSIF v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' THEN
    RAISE EXCEPTION 'Invalid absolute timestamp: %', p_label USING ERRCODE = '22023';
  END IF;
  v_timestamp := v_text::TIMESTAMPTZ; -- PostgreSQL verifies real calendar dates.
  IF NOT isfinite(v_timestamp)
     OR v_timestamp < TIMESTAMPTZ '0001-01-01 00:00:00+00'
     OR v_timestamp >= TIMESTAMPTZ '10000-01-01 00:00:00+00' THEN
    RAISE EXCEPTION 'Timestamp outside supported years: %', p_label USING ERRCODE = '22023';
  END IF;
  RETURN v_timestamp;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_time_zone_displacement_value THEN
  RAISE EXCEPTION 'Invalid timestamp: %', p_label USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION mali_validation.require_records(p_value JSONB, p_label TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row JSONB;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid collection: %', p_label USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid nested record: %', p_label USING ERRCODE = '22023';
    END IF;
    PERFORM mali_validation.require_text(v_row->'id', p_label || '.id', true);
    IF v_row ? 'idempotencyKey' THEN
      PERFORM mali_validation.require_text(v_row->'idempotencyKey', p_label || '.idempotencyKey', true);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) e GROUP BY e->>'id' HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) e WHERE e ? 'idempotencyKey'
                GROUP BY e->>'idempotencyKey' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate identity or request key: %', p_label USING ERRCODE = '22023';
  END IF;
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION mali_validation.require_strings(p_value JSONB, p_label TEXT)
RETURNS VOID LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'Invalid string collection: %', p_label USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mali_validation.require_reference(p_map JSONB, p_id JSONB, p_label TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id TEXT := mali_validation.require_text(p_id, p_label, true);
BEGIN
  IF NOT (p_map ? v_id) THEN
    RAISE EXCEPTION 'Missing reference: %', p_label USING ERRCODE = '22023';
  END IF;
  RETURN p_map->v_id;
END;
$$;

CREATE OR REPLACE FUNCTION mali_validation.require_account(p_map JSONB, p_id JSONB, p_currency TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_account JSONB := mali_validation.require_reference(p_map, p_id, 'account');
BEGIN
  IF p_currency IS NOT NULL AND v_account->>'currency' IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION 'Account currency mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION mali_validation.require_vault(p_payload JSONB)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_key TEXT; v_field TEXT; v_row JSONB; v_sale JSONB; v_installment JSONB; v_stage JSONB;
  v_accounts JSONB; v_contacts JSONB; v_transactions JSONB; v_deals JSONB; v_debts JSONB;
  v_sales JSONB := '{}'; v_installments JSONB := '{}'; v_sale_keys TEXT[] := '{}'; v_installment_keys TEXT[] := '{}';
  v_parent JSONB; v_link JSONB; v_currency TEXT; v_type TEXT; v_personal BOOLEAN;
  v_total NUMERIC; v_cost NUMERIC; v_rate NUMERIC; v_gross NUMERIC; v_fee NUMERIC;
  v_sold NUMERIC; v_taken NUMERIC; v_received NUMERIC; v_profit NUMERIC; v_allocated NUMERIC; v_paid NUMERIC;
  v_status TEXT;
  v_methods CONSTANT TEXT[] := ARRAY['cash','cheque','transfer','card'];
  v_currencies CONSTANT TEXT[] := ARRAY['LYD','USD'];
BEGIN
  FOREACH v_key IN ARRAY ARRAY['accounts','contacts','transactions','deals','debts','procedures','budgets'] LOOP
    PERFORM mali_validation.require_records(p_payload->v_key, v_key);
  END LOOP;
  SELECT COALESCE(jsonb_object_agg(e->>'id', e), '{}') INTO v_accounts FROM jsonb_array_elements(p_payload->'accounts') e;
  SELECT COALESCE(jsonb_object_agg(e->>'id', e), '{}') INTO v_contacts FROM jsonb_array_elements(p_payload->'contacts') e;
  SELECT COALESCE(jsonb_object_agg(e->>'id', e), '{}') INTO v_transactions FROM jsonb_array_elements(p_payload->'transactions') e;
  SELECT COALESCE(jsonb_object_agg(e->>'id', e), '{}') INTO v_deals FROM jsonb_array_elements(p_payload->'deals') e;
  SELECT COALESCE(jsonb_object_agg(e->>'id', e), '{}') INTO v_debts FROM jsonb_array_elements(p_payload->'debts') e;
  IF jsonb_typeof(p_payload->'marketRates') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid market rates' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['cashUsdToLyd','chequeUsdToLyd'] LOOP
    IF mali_validation.require_number(p_payload->'marketRates'->v_key, v_key, 4, 1000000) <= 0 THEN
      RAISE EXCEPTION 'Exchange rate must be positive' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF mali_validation.require_number(p_payload->'marketRates'->'defaultChequeDiscountPercent', 'discount', NULL, 100) >= 100 THEN
    RAISE EXCEPTION 'Invalid cheque discount' USING ERRCODE = '22023';
  END IF;
  PERFORM mali_validation.require_timestamp(p_payload->'marketRates'->'updatedAt','rates.updatedAt');
  PERFORM mali_validation.require_timestamp(p_payload->'lastModifiedAt','lastModifiedAt');

  -- Validate optional metadata before any projection cast/write.
  FOREACH v_key IN ARRAY ARRAY['accounts','contacts','transactions','deals','debts','procedures','budgets'] LOOP
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->v_key) LOOP
      FOREACH v_field IN ARRAY ARRAY['notes','color','accountNumber','bankDetails','counterparty','counterpartyPhone','phone','referenceNumber'] LOOP
        IF v_row ? v_field THEN PERFORM mali_validation.require_text(v_row->v_field,v_field); END IF;
      END LOOP;
      IF v_row ? 'updatedAt' THEN PERFORM mali_validation.require_timestamp(v_row->'updatedAt','updatedAt'); END IF;
      IF v_row ? 'dueDate' THEN PERFORM mali_validation.require_timestamp(v_row->'dueDate','dueDate'); END IF;
      IF v_row ? 'contactId' THEN PERFORM mali_validation.require_reference(v_contacts,v_row->'contactId','contactId'); END IF;
      IF v_row ? 'receiptImages' THEN PERFORM mali_validation.require_strings(v_row->'receiptImages','receiptImages'); END IF;
      IF v_row ? 'buyReceiptImages' THEN PERFORM mali_validation.require_strings(v_row->'buyReceiptImages','buyReceiptImages'); END IF;
    END LOOP;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'accounts') LOOP
    PERFORM mali_validation.require_text(v_row->'name','account.name',true);
    PERFORM mali_validation.require_text(v_row->'bankName','account.bankName');
    PERFORM mali_validation.require_enum(v_row->'currency',v_currencies,'account.currency');
    PERFORM mali_validation.require_enum(v_row->'category',ARRAY['cash_lyd','cash_usd','bank_lyd','bank_usd','ewallet'],'account.category');
    IF jsonb_typeof(v_row->'isCash') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid cash flag' USING ERRCODE = '22023'; END IF;
    PERFORM mali_validation.require_number(v_row->'balance','account.balance',2,1000000000000,NOT (v_row->>'isCash')::BOOLEAN);
    IF v_row ? 'accountNumber' THEN PERFORM mali_validation.require_text(v_row->'accountNumber','accountNumber'); END IF;
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'contacts') LOOP
    PERFORM mali_validation.require_text(v_row->'name','contact.name',true);
    PERFORM mali_validation.require_text(v_row->'phone','contact.phone');
    PERFORM mali_validation.require_enum(v_row->'role',ARRAY['مكتب صرافة','تاجر عملة','شركة / مورد','شريك تجاري','شخصي / عميل'],'contact.role');
    PERFORM mali_validation.require_timestamp(v_row->'createdAt','contact.createdAt');
    IF v_row ? 'bankDetails' THEN PERFORM mali_validation.require_text(v_row->'bankDetails','bankDetails'); END IF;
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'deals') LOOP
    PERFORM mali_validation.require_text(v_row->'dealNumber','dealNumber',true);
    PERFORM mali_validation.require_text(v_row->'title','deal.title',true);
    PERFORM mali_validation.require_timestamp(v_row->'buyDate','buyDate');
    PERFORM mali_validation.require_enum(v_row->'buyPaymentMethod',v_methods,'buyPaymentMethod');
    PERFORM mali_validation.require_account(v_accounts,v_row->'sourceLydAccountId','LYD');
    PERFORM mali_validation.require_account(v_accounts,v_row->'usdHoldingAccountId','USD');
    v_total := mali_validation.require_number(v_row->'totalUsdBought','totalUsdBought');
    v_cost := mali_validation.require_number(v_row->'totalLydCost','totalLydCost');
    v_rate := mali_validation.require_number(v_row->'buyRate','buyRate',4,1000000);
    v_gross := mali_validation.require_number(v_row->'grossLydCost','grossLydCost');
    v_fee := mali_validation.require_number(v_row->'buyCommissionLyd','buyCommissionLyd');
    IF v_total <= 0 OR v_rate <= 0 OR v_gross <> round(v_total*v_rate,2) OR v_cost <> v_gross+v_fee
       OR mali_validation.require_number(v_row->'effectiveBuyRate','effectiveBuyRate',4,1000000) <= 0
       OR (v_total > 0 AND (v_row->>'effectiveBuyRate')::NUMERIC <> round(v_cost/v_total,4)) THEN
      RAISE EXCEPTION 'Invalid original deal cost or rate' USING ERRCODE = '22023';
    END IF;
    PERFORM mali_validation.require_records(v_row->'sales','deal.sales');
    v_sold := 0; v_taken := 0; v_received := 0; v_profit := 0; v_allocated := 0;
    FOR v_sale IN SELECT value FROM jsonb_array_elements(v_row->'sales') LOOP
      IF v_sales ? (v_sale->>'id') OR v_sale->>'dealId' IS DISTINCT FROM v_row->>'id' THEN
        RAISE EXCEPTION 'Duplicate or mismatched sale identity' USING ERRCODE = '22023';
      END IF;
      v_sales := v_sales || jsonb_build_object(v_sale->>'id',v_sale);
      IF v_sale ? 'idempotencyKey' THEN
        IF v_sale->>'idempotencyKey'=ANY(v_sale_keys) THEN RAISE EXCEPTION 'Duplicate sale request key' USING ERRCODE = '22023'; END IF;
        v_sale_keys := array_append(v_sale_keys,v_sale->>'idempotencyKey');
      END IF;
      IF v_sale ? 'isPersonalTake' AND jsonb_typeof(v_sale->'isPersonalTake') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Invalid personal allocation flag' USING ERRCODE = '22023';
      END IF;
      v_personal := COALESCE((v_sale->>'isPersonalTake')::BOOLEAN,false);
      PERFORM mali_validation.require_enum(v_sale->'paymentMethod',v_methods,'sale.paymentMethod');
      PERFORM mali_validation.require_timestamp(v_sale->'date','sale.date');
      PERFORM mali_validation.require_account(v_accounts,v_sale->'sourceUsdAccountId','USD');
      IF v_sale->>'sourceUsdAccountId' IS DISTINCT FROM v_row->>'usdHoldingAccountId' THEN
        RAISE EXCEPTION 'Sale source does not hold this deal' USING ERRCODE = '22023';
      END IF;
      FOREACH v_field IN ARRAY ARRAY['notes','buyerName','buyerPhone'] LOOP
        IF v_sale ? v_field THEN PERFORM mali_validation.require_text(v_sale->v_field,v_field); END IF;
      END LOOP;
      IF v_sale ? 'contactId' THEN PERFORM mali_validation.require_reference(v_contacts,v_sale->'contactId','sale.contactId'); END IF;
      IF v_sale ? 'receiptImages' THEN PERFORM mali_validation.require_strings(v_sale->'receiptImages','sale.receiptImages'); END IF;
      v_total := mali_validation.require_number(v_sale->'usdAmount','sale.usdAmount');
      v_cost := mali_validation.require_number(v_sale->'costBasisLyd','sale.costBasisLyd');
      v_gross := mali_validation.require_number(v_sale->'grossLyd','sale.grossLyd');
      v_fee := mali_validation.require_number(v_sale->'commissionLyd','sale.commissionLyd');
      v_rate := mali_validation.require_number(v_sale->'sellRate','sale.sellRate',4,1000000);
      IF v_total <= 0 OR v_rate <= 0 THEN RAISE EXCEPTION 'Sale quantity/rate must be positive' USING ERRCODE = '22023'; END IF;
      IF v_personal THEN
        -- Empty/same-source targets retain the dollars in the holding account.
        IF v_sale ? 'targetLydAccountId' THEN
          PERFORM mali_validation.require_text(v_sale->'targetLydAccountId','personal.target');
          IF v_sale->>'targetLydAccountId' <> '' THEN PERFORM mali_validation.require_account(v_accounts,v_sale->'targetLydAccountId','USD'); END IF;
        END IF;
        IF mali_validation.require_number(v_sale->'netLydReceived','personal.net') <> 0
           OR mali_validation.require_number(v_sale->'profitLyd','personal.profit',2,1000000000000,true) <> 0
           OR v_fee <> 0 OR v_gross <> v_cost OR v_rate <> (v_row->>'effectiveBuyRate')::NUMERIC THEN
          RAISE EXCEPTION 'Personal allocation cannot produce proceeds/profit' USING ERRCODE = '22023';
        END IF;
        v_taken := v_taken+v_total;
      ELSE
        PERFORM mali_validation.require_account(v_accounts,v_sale->'targetLydAccountId','LYD');
        IF v_gross <> round(v_total*v_rate,2)
           OR mali_validation.require_number(v_sale->'netLydReceived','sale.net') <> v_gross-v_fee
           OR mali_validation.require_number(v_sale->'profitLyd','sale.profit',2,1000000000000,true) <> v_gross-v_fee-v_cost THEN
          RAISE EXCEPTION 'Sale gross/net/cost/profit mismatch' USING ERRCODE = '22023';
        END IF;
        v_sold := v_sold+v_total;
      END IF;
      v_received := v_received+(v_sale->>'netLydReceived')::NUMERIC;
      v_profit := v_profit+(v_sale->>'profitLyd')::NUMERIC;
      v_allocated := v_allocated+v_cost;
    END LOOP;
    v_total := (v_row->>'totalUsdBought')::NUMERIC;
    v_cost := (v_row->>'totalLydCost')::NUMERIC;
    v_status := CASE WHEN v_total-v_sold-v_taken=0 THEN 'closed'
                     WHEN jsonb_array_length(v_row->'sales')=0 THEN 'open' ELSE 'partial' END;
    IF v_total-v_sold-v_taken < 0 OR mali_validation.require_number(v_row->'soldUsd','soldUsd') <> v_sold
       OR mali_validation.require_number(v_row->'personalTakenUsd','personalTakenUsd') <> v_taken
       OR mali_validation.require_number(v_row->'remainingUsd','remainingUsd') <> v_total-v_sold-v_taken
       OR mali_validation.require_number(v_row->'totalLydReceived','totalLydReceived') <> v_received
       OR mali_validation.require_number(v_row->'realizedProfitLyd','realizedProfitLyd',2,1000000000000,true) <> v_profit
       OR v_allocated > v_cost OR (v_status='closed' AND v_allocated <> v_cost)
       OR mali_validation.require_enum(v_row->'status',ARRAY['open','partial','closed'],'deal.status') <> v_status THEN
      RAISE EXCEPTION 'Deal totals/status do not reconcile with sales' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'debts') LOOP
    v_currency := mali_validation.require_enum(v_row->'currency',v_currencies,'debt.currency');
    v_type := mali_validation.require_enum(v_row->'direction',ARRAY['receivable','payable'],'debt.direction');
    PERFORM mali_validation.require_text(v_row->'personName','personName',true);
    PERFORM mali_validation.require_timestamp(v_row->'createdAt','debt.createdAt');
    v_total := mali_validation.require_number(v_row->'totalAmount','debt.totalAmount');
    IF v_total <= 0 THEN RAISE EXCEPTION 'Debt principal must be positive' USING ERRCODE = '22023'; END IF;
    IF COALESCE(v_row->>'accountId','') <> '' THEN PERFORM mali_validation.require_account(v_accounts,v_row->'accountId',v_currency); END IF;
    IF v_row ? 'initialPaymentMethod' THEN PERFORM mali_validation.require_enum(v_row->'initialPaymentMethod',v_methods,'initialPaymentMethod'); END IF;
    IF v_row ? 'initialTransactionId' THEN
      v_link := mali_validation.require_reference(v_transactions,v_row->'initialTransactionId','initialTransactionId');
      IF v_link->>'debtId' IS DISTINCT FROM v_row->>'id' OR v_link->>'accountId' IS DISTINCT FROM v_row->>'accountId'
         OR v_link->'amount' IS DISTINCT FROM v_row->'totalAmount'
         OR v_link->>'type' IS DISTINCT FROM (CASE WHEN v_type='receivable' THEN 'expense' ELSE 'income' END) THEN
        RAISE EXCEPTION 'Initial debt transaction mismatch' USING ERRCODE = '22023';
      END IF;
    END IF;
    PERFORM mali_validation.require_records(v_row->'installments','debt.installments');
    v_paid := 0;
    FOR v_installment IN SELECT value FROM jsonb_array_elements(v_row->'installments') LOOP
      IF v_installments ? (v_installment->>'id') THEN RAISE EXCEPTION 'Duplicate installment identity' USING ERRCODE = '22023'; END IF;
      v_installments := v_installments || jsonb_build_object(v_installment->>'id',jsonb_build_object('debtId',v_row->>'id','record',v_installment));
      IF v_installment ? 'idempotencyKey' THEN
        IF v_installment->>'idempotencyKey'=ANY(v_installment_keys) THEN RAISE EXCEPTION 'Duplicate installment request key' USING ERRCODE = '22023'; END IF;
        v_installment_keys := array_append(v_installment_keys,v_installment->>'idempotencyKey');
      END IF;
      IF v_installment ? 'notes' THEN PERFORM mali_validation.require_text(v_installment->'notes','installment.notes'); END IF;
      v_cost := mali_validation.require_number(v_installment->'amount','installment.amount');
      IF v_cost <= 0 THEN RAISE EXCEPTION 'Installment amount must be positive' USING ERRCODE = '22023'; END IF;
      v_paid := v_paid+v_cost;
      PERFORM mali_validation.require_timestamp(v_installment->'date','installment.date');
      PERFORM mali_validation.require_enum(v_installment->'paymentMethod',v_methods,'installment.paymentMethod');
      IF COALESCE(v_installment->>'accountId','') <> '' THEN
        PERFORM mali_validation.require_account(v_accounts,v_installment->'accountId',v_currency);
      END IF;
      IF v_installment ? 'transactionId' THEN
        v_link := mali_validation.require_reference(v_transactions,v_installment->'transactionId','installment.transactionId');
        IF v_link->>'type' IS DISTINCT FROM 'debt_settlement' OR v_link->>'debtId' IS DISTINCT FROM v_row->>'id'
           OR v_link->>'accountId' IS DISTINCT FROM v_installment->>'accountId'
           OR v_link->'amount' IS DISTINCT FROM v_installment->'amount'
           OR (v_link ? 'installmentId' AND v_link->>'installmentId' IS DISTINCT FROM v_installment->>'id') THEN
          RAISE EXCEPTION 'Installment transaction mismatch' USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
    IF v_paid > v_total OR mali_validation.require_number(v_row->'paidAmount','paidAmount') <> v_paid
       OR mali_validation.require_number(v_row->'remainingAmount','remainingAmount') <> v_total-v_paid
       OR mali_validation.require_enum(v_row->'status',ARRAY['active','completed'],'debt.status') <>
          (CASE WHEN v_paid=v_total THEN 'completed' ELSE 'active' END) THEN
      RAISE EXCEPTION 'Debt totals/status do not reconcile with installments' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Resolve both sides of every journal link after nested identities are known.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'transactions') LOOP
    v_type := mali_validation.require_enum(v_row->'type',ARRAY['expense','income','transfer','cheque_liquidation','deal_buy','deal_sell','deal_personal_take','debt_settlement'],'transaction.type');
    v_currency := mali_validation.require_enum(v_row->'currency',v_currencies,'transaction.currency');
    PERFORM mali_validation.require_enum(v_row->'paymentMethod',v_methods,'transaction.paymentMethod');
    PERFORM mali_validation.require_text(v_row->'title','transaction.title');
    PERFORM mali_validation.require_text(v_row->'category','transaction.category');
    PERFORM mali_validation.require_timestamp(v_row->'date','transaction.date');
    v_total := mali_validation.require_number(v_row->'amount','transaction.amount');
    v_fee := CASE WHEN v_row ? 'feeAmount' THEN mali_validation.require_number(v_row->'feeAmount','transaction.feeAmount') ELSE 0 END;
    IF v_row ? 'exchangeRate' AND mali_validation.require_number(v_row->'exchangeRate','transaction.exchangeRate',4,1000000) <= 0 THEN
      RAISE EXCEPTION 'Invalid transaction exchange rate' USING ERRCODE = '22023';
    END IF;
    PERFORM mali_validation.require_account(v_accounts,v_row->'accountId',v_currency);
    IF COALESCE(v_row->>'targetAccountId','') <> '' THEN PERFORM mali_validation.require_account(v_accounts,v_row->'targetAccountId'); END IF;
    IF v_row ? 'dealId' THEN PERFORM mali_validation.require_reference(v_deals,v_row->'dealId','transaction.dealId'); END IF;
    IF v_row ? 'debtId' THEN PERFORM mali_validation.require_reference(v_debts,v_row->'debtId','transaction.debtId'); END IF;
    IF v_row ? 'dealId' AND v_type NOT IN ('deal_buy','deal_sell','deal_personal_take') THEN
      RAISE EXCEPTION 'Unexpected deal journal reference' USING ERRCODE = '22023';
    END IF;
    IF v_row ? 'debtId' AND v_type NOT IN ('expense','income','debt_settlement') THEN
      RAISE EXCEPTION 'Unexpected debt journal reference' USING ERRCODE = '22023';
    END IF;
    IF v_type IN ('transfer','cheque_liquidation') THEN
      IF v_total <= 0 THEN RAISE EXCEPTION 'Transfer amount must be positive' USING ERRCODE = '22023'; END IF;
      PERFORM mali_validation.require_account(v_accounts,v_row->'targetAccountId',v_currency);
      IF v_row->>'accountId'=v_row->>'targetAccountId' THEN RAISE EXCEPTION 'Transfer accounts must differ' USING ERRCODE = '22023'; END IF;
      IF v_type='cheque_liquidation' THEN
        IF v_currency <> 'LYD' OR v_fee > v_total THEN RAISE EXCEPTION 'Invalid cheque currency or discount' USING ERRCODE = '22023'; END IF;
        v_rate := mali_validation.require_number(v_row->'discountPercent','cheque.discountPercent',NULL,100);
        IF v_rate >= 100 OR v_fee <> round(v_total*v_rate/100,2) THEN RAISE EXCEPTION 'Cheque discount mismatch' USING ERRCODE = '22023'; END IF;
      END IF;
    ELSIF v_type='deal_buy' THEN
      v_parent := mali_validation.require_reference(v_deals,v_row->'dealId','buy.dealId');
      IF v_currency <> 'LYD' OR v_row->>'accountId' IS DISTINCT FROM v_parent->>'sourceLydAccountId'
         OR v_row->>'targetAccountId' IS DISTINCT FROM v_parent->>'usdHoldingAccountId'
         OR v_total <> (v_parent->>'totalLydCost')::NUMERIC OR v_fee <> (v_parent->>'buyCommissionLyd')::NUMERIC
         OR v_row->'exchangeRate' IS DISTINCT FROM v_parent->'buyRate' THEN RAISE EXCEPTION 'Purchase journal mismatch' USING ERRCODE = '22023'; END IF;
    ELSIF v_type IN ('deal_sell','deal_personal_take') THEN
      v_link := mali_validation.require_reference(v_sales,v_row->'saleId','transaction.saleId');
      v_personal := COALESCE((v_link->>'isPersonalTake')::BOOLEAN,false);
      IF v_row->>'dealId' IS DISTINCT FROM v_link->>'dealId' OR v_personal IS DISTINCT FROM (v_type='deal_personal_take')
         OR v_total <> (CASE WHEN v_personal THEN v_link->>'usdAmount' ELSE v_link->>'netLydReceived' END)::NUMERIC
         OR v_row->'exchangeRate' IS DISTINCT FROM v_link->'sellRate'
         OR v_row->>'accountId' IS DISTINCT FROM (CASE WHEN v_personal THEN v_link->>'sourceUsdAccountId' ELSE v_link->>'targetLydAccountId' END)
         OR COALESCE(v_row->>'targetAccountId','') IS DISTINCT FROM (CASE WHEN v_personal THEN COALESCE(v_link->>'targetLydAccountId','') ELSE v_link->>'sourceUsdAccountId' END)
         OR (v_personal AND v_fee <> 0)
         OR (NOT v_personal AND v_fee <> (v_link->>'commissionLyd')::NUMERIC) THEN
        RAISE EXCEPTION 'Sale/personal journal mismatch' USING ERRCODE = '22023';
      END IF;
    ELSIF v_type='debt_settlement' THEN
      v_link := mali_validation.require_reference(v_installments,v_row->'installmentId','transaction.installmentId');
      IF v_link->>'debtId' IS DISTINCT FROM v_row->>'debtId'
         OR v_link->'record'->>'transactionId' IS DISTINCT FROM v_row->>'id'
         OR v_link->'record'->>'accountId' IS DISTINCT FROM v_row->>'accountId'
         OR v_link->'record'->'amount' IS DISTINCT FROM v_row->'amount'
         OR v_currency IS DISTINCT FROM v_debts->(v_row->>'debtId')->>'currency' THEN
        RAISE EXCEPTION 'Settlement journal mismatch' USING ERRCODE = '22023';
      END IF;
    ELSIF v_type IN ('expense','income') THEN
      IF v_total <= 0 THEN RAISE EXCEPTION 'Expense/income amount must be positive' USING ERRCODE = '22023'; END IF;
      IF v_row ? 'debtId' THEN
        v_parent := mali_validation.require_reference(v_debts,v_row->'debtId','initial.debtId');
        IF (v_parent ? 'initialTransactionId' AND v_parent->>'initialTransactionId' IS DISTINCT FROM v_row->>'id')
           OR v_total <> (v_parent->>'totalAmount')::NUMERIC
           OR v_row->>'accountId' IS DISTINCT FROM v_parent->>'accountId'
           OR v_currency IS DISTINCT FROM v_parent->>'currency'
           OR v_type IS DISTINCT FROM (CASE WHEN v_parent->>'direction'='receivable' THEN 'expense' ELSE 'income' END) THEN
          RAISE EXCEPTION 'Initial debt journal mismatch' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
    IF v_row ? 'saleId' AND v_type NOT IN ('deal_sell','deal_personal_take') THEN RAISE EXCEPTION 'Unexpected sale journal reference' USING ERRCODE = '22023'; END IF;
    IF v_row ? 'installmentId' AND v_type <> 'debt_settlement' THEN RAISE EXCEPTION 'Unexpected installment reference' USING ERRCODE = '22023'; END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'transactions') e WHERE e->>'type'='deal_buy'
             GROUP BY e->>'dealId' HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'transactions') e WHERE e->>'type' IN ('deal_sell','deal_personal_take')
                GROUP BY e->>'saleId' HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'transactions') e WHERE e->>'type'='debt_settlement'
                GROUP BY e->>'installmentId' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate linked financial journal' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'budgets') LOOP
    PERFORM mali_validation.require_text(v_row->'category','budget.category',true);
    PERFORM mali_validation.require_number(v_row->'monthlyLimitLyd','monthlyLimitLyd');
    PERFORM mali_validation.require_text(v_row->'color','budget.color');
    PERFORM mali_validation.require_text(v_row->'icon','budget.icon');
  END LOOP;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'procedures') LOOP
    PERFORM mali_validation.require_text(v_row->'title','procedure.title',true);
    PERFORM mali_validation.require_text(v_row->'bankOrEntity','bankOrEntity');
    PERFORM mali_validation.require_enum(v_row->'procedureType',ARRAY['صك مصدق / مقاصة','تسييل / سحب مصرفي','اعتماد / حوالة خارجية','بطاقة دولية / أغراض شخصية','حجز مالي / التزام','إجراء مصرفي عام'],'procedureType');
    PERFORM mali_validation.require_enum(v_row->'status',ARRAY['pending','in_progress','completed','cancelled'],'procedure.status');
    PERFORM mali_validation.require_timestamp(v_row->'createdAt','procedure.createdAt');
    IF v_row ? 'amount' THEN PERFORM mali_validation.require_number(v_row->'amount','procedure.amount'); END IF;
    IF v_row ? 'currency' THEN PERFORM mali_validation.require_enum(v_row->'currency',v_currencies,'procedure.currency'); END IF;
    PERFORM mali_validation.require_records(v_row->'stages','procedure.stages');
    FOR v_stage IN SELECT value FROM jsonb_array_elements(v_row->'stages') LOOP
      PERFORM mali_validation.require_text(v_stage->'title','stage.title',true);
      IF jsonb_typeof(v_stage->'completed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid stage completion flag' USING ERRCODE = '22023'; END IF;
      IF v_stage ? 'completedAt' THEN PERFORM mali_validation.require_timestamp(v_stage->'completedAt','completedAt'); END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION mali_validation.require_text(JSONB,TEXT,BOOLEAN),
  mali_validation.require_enum(JSONB,TEXT[],TEXT),
  mali_validation.require_number(JSONB,TEXT,INTEGER,NUMERIC,BOOLEAN),
  mali_validation.require_timestamp(JSONB,TEXT), mali_validation.require_records(JSONB,TEXT),
  mali_validation.require_strings(JSONB,TEXT), mali_validation.require_reference(JSONB,JSONB,TEXT),
  mali_validation.require_account(JSONB,JSONB,TEXT), mali_validation.require_vault(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mali_validation.require_text(JSONB,TEXT,BOOLEAN),
  mali_validation.require_enum(JSONB,TEXT[],TEXT),
  mali_validation.require_number(JSONB,TEXT,INTEGER,NUMERIC,BOOLEAN),
  mali_validation.require_timestamp(JSONB,TEXT), mali_validation.require_records(JSONB,TEXT),
  mali_validation.require_strings(JSONB,TEXT), mali_validation.require_reference(JSONB,JSONB,TEXT),
  mali_validation.require_account(JSONB,JSONB,TEXT), mali_validation.require_vault(JSONB) TO authenticated;

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

  -- No projection or snapshot write is permitted until the full payload passes.
  PERFORM mali_validation.require_vault(p_payload);

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
  SELECT e->>'id', v_workspace, v_user_id, e->>'name', e->>'phone', e->>'role', e->>'bankDetails', e->>'notes', mali_validation.require_timestamp(e->'createdAt','contact.createdAt'), e
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
