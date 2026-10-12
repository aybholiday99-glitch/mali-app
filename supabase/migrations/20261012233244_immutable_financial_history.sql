-- Preserve accepted financial evidence independently of replaceable projections.
-- Offline events remain client assertions; server owner/time are separate facts.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mali_history_writer') THEN
    CREATE ROLE mali_history_writer NOLOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mali_history_writer' AND
    (rolsuper OR rolcanlogin OR rolinherit OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'Unsafe internal history writer attributes' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='mali_history_writer') OR
     EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member_role ON member_role.oid=m.member
       WHERE r.rolname='mali_history_writer' AND member_role.rolname<>current_user) THEN
    RAISE EXCEPTION 'Unsafe internal history writer memberships' USING ERRCODE='42501';
  END IF;
  -- Only the migration operator may transfer ownership; API roles never join.
  EXECUTE format('GRANT mali_history_writer TO %I',current_user);
END $$;
CREATE SCHEMA mali_audit;
REVOKE ALL ON SCHEMA mali_audit FROM PUBLIC, anon, authenticated;

CREATE TABLE public.mali_financial_history (
  history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_key TEXT NOT NULL,
  actor_id UUID,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  snapshot_updated_at TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('observed_baseline','cloud_commit','snapshot_deleted')),
  changes JSONB NOT NULL CHECK(jsonb_typeof(changes)='array'),
  client_events JSONB NOT NULL DEFAULT '[]'::JSONB CHECK(jsonb_typeof(client_events)='array'),
  -- Exact records observed at enrollment, without fabricated earlier chronology.
  observed_state JSONB
);
CREATE INDEX mali_financial_history_owner_cursor ON public.mali_financial_history(user_id,history_id);
ALTER TABLE public.mali_financial_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_financial_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mali_financial_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.mali_financial_history TO authenticated;
CREATE POLICY mali_history_owner_read ON public.mali_financial_history FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
GRANT USAGE ON SCHEMA public,auth,mali_audit,mali_validation TO mali_history_writer;
GRANT SELECT(user_id,workspace_key) ON public.mali_financial_history TO mali_history_writer;
GRANT INSERT(user_id,workspace_key,actor_id,snapshot_updated_at,event_type,changes,client_events,observed_state)
  ON public.mali_financial_history TO mali_history_writer;
GRANT USAGE ON SEQUENCE public.mali_financial_history_history_id_seq TO mali_history_writer;
GRANT EXECUTE ON FUNCTION auth.uid(),mali_validation.require_text(JSONB,TEXT,BOOLEAN),
  mali_validation.require_enum(JSONB,TEXT[],TEXT),mali_validation.require_timestamp(JSONB,TEXT) TO mali_history_writer;
CREATE POLICY mali_history_writer_read ON public.mali_financial_history FOR SELECT TO mali_history_writer
  USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id);
CREATE POLICY mali_history_writer_insert ON public.mali_financial_history FOR INSERT TO mali_history_writer
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id AND actor_id = (SELECT auth.uid()));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON TABLE public.mali_financial_history FROM service_role;
  END IF;
END $$;

CREATE FUNCTION mali_audit.deny_history_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'Accepted financial history is immutable' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER mali_history_immutable BEFORE UPDATE OR DELETE ON public.mali_financial_history
  FOR EACH ROW EXECUTE FUNCTION mali_audit.deny_history_change();
CREATE TRIGGER mali_history_no_truncate BEFORE TRUNCATE ON public.mali_financial_history
  FOR EACH STATEMENT EXECUTE FUNCTION mali_audit.deny_history_change();

CREATE FUNCTION mali_audit.financial_state(p_payload JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT COALESCE(jsonb_object_agg(k,p_payload->k),'{}'::JSONB)
  FROM unnest(ARRAY['accounts','contacts','transactions','deals','debts','procedures','budgets','marketRates']) AS k
  WHERE p_payload ? k;
$$;
CREATE FUNCTION mali_audit.record_map(p_payload JSONB) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_key TEXT; v_row JSONB; v_map JSONB := '{}'::JSONB;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['accounts','contacts','transactions','deals','debts','procedures','budgets'] LOOP
    IF jsonb_typeof(p_payload->v_key)='array' THEN
      FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->v_key) LOOP
        v_map := v_map || jsonb_build_object(v_key || ':' || (v_row->>'id'),v_row);
      END LOOP;
    END IF;
  END LOOP;
  IF p_payload ? 'marketRates' THEN v_map := v_map || jsonb_build_object('marketRates:marketRates',p_payload->'marketRates'); END IF;
  RETURN v_map;
END;
$$;
CREATE FUNCTION mali_audit.row_changes(p_before JSONB,p_after JSONB) RETURNS JSONB
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  WITH old_rows AS (SELECT * FROM jsonb_each(mali_audit.record_map(p_before))),
       new_rows AS (SELECT * FROM jsonb_each(mali_audit.record_map(p_after)))
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'collection',split_part(COALESCE(n.key,o.key),':',1),
    'recordId',substr(COALESCE(n.key,o.key),strpos(COALESCE(n.key,o.key),':')+1),
    'before',o.value,'after',n.value) ORDER BY COALESCE(n.key,o.key)),'[]'::JSONB)
  FROM old_rows o FULL JOIN new_rows n ON n.key=o.key WHERE o.value IS DISTINCT FROM n.value;
$$;

CREATE FUNCTION mali_audit.validate_client_events(p_events JSONB,p_payload JSONB,p_owner UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_event JSONB; v_change JSONB; v_index INTEGER := 0; v_id TEXT; v_operation TEXT;
  v_ids TEXT[] := ARRAY[]::TEXT[]; v_operations TEXT[] := ARRAY[]::TEXT[];
  v_keys TEXT[]; v_collection TEXT; v_record TEXT; v_key TEXT;
  v_map JSONB := '{}'::JSONB; v_before JSONB; v_after JSONB;
BEGIN
  IF p_events IS NULL THEN RETURN; END IF;
  IF jsonb_typeof(p_events)<>'array' OR jsonb_array_length(p_events)>10000 OR
     octet_length(convert_to(p_events::TEXT,'UTF8'))>33554432 THEN
    RAISE EXCEPTION 'Invalid or oversized financial audit' USING ERRCODE='22023';
  END IF;
  FOR v_event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    v_index := v_index+1;
    IF jsonb_typeof(v_event)<>'object' OR v_event->'version' IS DISTINCT FROM '1'::JSONB OR
       v_event->'sequence' IS DISTINCT FROM to_jsonb(v_index) OR v_event->>'ownerId' IS DISTINCT FROM p_owner::TEXT THEN
      RAISE EXCEPTION 'Invalid audit identity or sequence' USING ERRCODE='22023';
    END IF;
    v_id := mali_validation.require_text(v_event->'id','audit.id',true);
    IF length(v_id)>256 OR v_id=ANY(v_ids) THEN RAISE EXCEPTION 'Duplicate audit event' USING ERRCODE='22023'; END IF;
    v_ids := array_append(v_ids,v_id);
    IF length(mali_validation.require_text(v_event->'action','audit.action',true))>128 OR
       length(mali_validation.require_text(v_event->'reason','audit.reason',true))>2048 OR
       (v_index=1 AND v_event->>'action'<>'observed_baseline') OR
       (v_index>1 AND v_event->>'action'='observed_baseline') THEN
      RAISE EXCEPTION 'Invalid audit action or reason' USING ERRCODE='22023';
    END IF;
    PERFORM mali_validation.require_timestamp(v_event->'recordedAt','audit.recordedAt');
    IF (v_event->>'recordedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
      RAISE EXCEPTION 'Invalid audit timestamp notation' USING ERRCODE='22023';
    END IF;
    IF v_event ? 'operationId' THEN
      v_operation := mali_validation.require_text(v_event->'operationId','audit.operationId',true);
      IF length(v_operation)>256 OR v_operation=ANY(v_operations) THEN RAISE EXCEPTION 'Duplicate audit operation' USING ERRCODE='22023'; END IF;
      v_operations := array_append(v_operations,v_operation);
    END IF;
    IF jsonb_typeof(v_event->'changes') IS DISTINCT FROM 'array' OR jsonb_array_length(v_event->'changes')>20000 OR
       (v_index>1 AND jsonb_array_length(v_event->'changes')=0) THEN RAISE EXCEPTION 'Invalid audit changes' USING ERRCODE='22023'; END IF;
    v_keys := ARRAY[]::TEXT[];
    FOR v_change IN SELECT value FROM jsonb_array_elements(v_event->'changes') LOOP
      v_collection := mali_validation.require_enum(v_change->'collection',ARRAY['accounts','contacts','transactions','deals','debts','procedures','budgets','marketRates'],'audit.collection');
      v_record := mali_validation.require_text(v_change->'recordId','audit.recordId',true);
      v_key := v_collection || ':' || v_record;
      v_before := v_change->'before'; v_after := v_change->'after';
      IF length(v_record)>256 OR v_key=ANY(v_keys) OR (v_collection='marketRates' AND v_record<>'marketRates') OR
         v_before IS NULL OR v_after IS NULL OR
         jsonb_typeof(v_before) NOT IN ('object','null') OR jsonb_typeof(v_after) NOT IN ('object','null') OR
         v_before=v_after OR (v_index=1 AND v_before<>'null'::JSONB) OR
         COALESCE(v_map->v_key,'null'::JSONB)<>v_before THEN
        RAISE EXCEPTION 'Invalid audit before/after evidence' USING ERRCODE='22023';
      END IF;
      IF v_collection<>'marketRates' AND
         ((v_before<>'null'::JSONB AND v_before->>'id' IS DISTINCT FROM v_record) OR
          (v_after<>'null'::JSONB AND v_after->>'id' IS DISTINCT FROM v_record)) THEN
        RAISE EXCEPTION 'Audit record identity mismatch' USING ERRCODE='22023';
      END IF;
      v_keys := array_append(v_keys,v_key);
      IF v_after='null'::JSONB THEN v_map:=v_map-v_key; ELSE v_map:=v_map||jsonb_build_object(v_key,v_after); END IF;
    END LOOP;
  END LOOP;
  IF v_index>0 AND v_map IS DISTINCT FROM mali_audit.record_map(p_payload) THEN
    RAISE EXCEPTION 'Financial audit does not replay to current records' USING ERRCODE='22023';
  END IF;
END;
$$;

-- The private trigger may append server evidence; callers cannot insert claims
-- into the history table, and this function is never an exposed RPC.
-- Definer authority is limited to a NOLOGIN/non-bypass journal writer, while
-- mali_sync_vault retains invoker RLS. Ownership and actor are checked against
-- trusted trigger rows and auth.uid(), then enforced again by writer RLS.
-- See https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker
CREATE FUNCTION mali_audit.capture_snapshot() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner UUID; v_actor UUID := auth.uid(); v_old JSONB; v_new JSONB;
  v_old_events JSONB; v_new_events JSONB; v_delta JSONB; v_client_delta JSONB; v_workspace TEXT; v_stamp TIMESTAMPTZ;
BEGIN
  IF TG_OP='DELETE' THEN v_owner:=OLD.user_id; v_workspace:=OLD.workspace_key; v_stamp:=OLD.updated_at;
  ELSE v_owner:=NEW.user_id; v_workspace:=NEW.workspace_key; v_stamp:=NEW.updated_at; END IF;
  IF v_owner IS NULL OR v_actor IS NULL OR v_actor IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Audit owner mismatch' USING ERRCODE='42501';
  END IF;
  IF TG_OP<>'INSERT' THEN v_old:=OLD.payload; END IF;
  IF TG_OP<>'DELETE' THEN v_new:=NEW.payload; END IF;
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Audit ownership is immutable' USING ERRCODE='42501';
  END IF;
  v_old_events:=COALESCE(v_old->'financialAudit','[]'::JSONB);
  v_new_events:=COALESCE(v_new->'financialAudit','[]'::JSONB);
  IF TG_OP<>'DELETE' THEN
    PERFORM mali_audit.validate_client_events(v_new->'financialAudit',v_new,v_owner);
    IF jsonb_array_length(v_new_events)<jsonb_array_length(v_old_events) OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_old_events) WITH ORDINALITY e(value,n)
      WHERE v_new_events->(e.n::INTEGER-1) IS DISTINCT FROM e.value) THEN
      RAISE EXCEPTION 'Accepted audit prefix cannot be removed or rewritten' USING ERRCODE='22023';
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.mali_financial_history WHERE user_id=v_owner AND workspace_key=v_workspace) THEN
    INSERT INTO public.mali_financial_history(user_id,workspace_key,actor_id,snapshot_updated_at,event_type,changes,observed_state)
      VALUES(v_owner,v_workspace,v_actor,v_stamp,'observed_baseline','[]'::JSONB,mali_audit.financial_state(COALESCE(v_old,v_new)));
  END IF;
  v_delta:=mali_audit.row_changes(v_old,v_new);
  SELECT COALESCE(jsonb_agg(value ORDER BY n),'[]'::JSONB) INTO v_client_delta
    FROM jsonb_array_elements(v_new_events) WITH ORDINALITY e(value,n) WHERE n>jsonb_array_length(v_old_events);
  IF v_delta<>'[]'::JSONB OR v_client_delta<>'[]'::JSONB OR TG_OP='DELETE' THEN
    INSERT INTO public.mali_financial_history(user_id,workspace_key,actor_id,snapshot_updated_at,event_type,changes,client_events)
      VALUES(v_owner,v_workspace,v_actor,v_stamp,CASE WHEN TG_OP='DELETE' THEN 'snapshot_deleted' ELSE 'cloud_commit' END,v_delta,v_client_delta);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
-- AFTER lets the invoker's existing snapshot RLS checks run first. Any append
-- or prefix-check failure still rolls back the complete RPC transaction.
CREATE TRIGGER mali_snapshot_financial_history AFTER INSERT OR UPDATE OR DELETE ON public.mali_vault_snapshots
  FOR EACH ROW EXECUTE FUNCTION mali_audit.capture_snapshot();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mali_audit FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mali_audit.financial_state(JSONB),mali_audit.record_map(JSONB),
  mali_audit.row_changes(JSONB,JSONB),mali_audit.validate_client_events(JSONB,JSONB,UUID) TO mali_history_writer;
GRANT CREATE ON SCHEMA mali_audit TO mali_history_writer;
ALTER FUNCTION mali_audit.capture_snapshot() OWNER TO mali_history_writer;
REVOKE CREATE ON SCHEMA mali_audit FROM mali_history_writer;
COMMIT;
