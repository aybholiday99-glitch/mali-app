-- Migration: 20261014120000_central_admin_rbac_and_maintenance.sql
-- Enforces central server-authoritative RBAC, immutable admin audit logging,
-- and server-enforced emergency maintenance gating.

BEGIN;

-- 1. Ensure auth.users has metadata columns for test harness & local PostgreSQL
DO $$
BEGIN
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data JSONB;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data JSONB;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT clock_timestamp();
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

-- 2. System Administrator Roles Table (RBAC)
CREATE TABLE IF NOT EXISTS public.mali_admin_roles (
  user_id UUID PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'auditor')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  granted_by UUID
);

ALTER TABLE public.mali_admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_admin_roles FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mali_admin_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mali_admin_roles TO authenticated;

DROP POLICY IF EXISTS mali_admin_roles_self_read ON public.mali_admin_roles;
CREATE POLICY mali_admin_roles_self_read ON public.mali_admin_roles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Helper function: Is current user an administrator?
CREATE OR REPLACE FUNCTION public.mali_is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mali_admin_roles
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.mali_is_admin() TO authenticated;

-- 3. Central System Settings Table (Maintenance Mode, Global Flags)
CREATE TABLE IF NOT EXISTS public.mali_system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by UUID
);

ALTER TABLE public.mali_system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_system_settings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mali_system_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mali_system_settings TO anon, authenticated;

DROP POLICY IF EXISTS mali_system_settings_read ON public.mali_system_settings;
CREATE POLICY mali_system_settings_read ON public.mali_system_settings FOR SELECT TO anon, authenticated
  USING (true);

-- Seed default maintenance mode state (disabled)
INSERT INTO public.mali_system_settings (key, value, updated_at)
VALUES ('maintenance_mode', '{"active": false, "reason": null}'::jsonb, clock_timestamp())
ON CONFLICT (key) DO NOTHING;

-- 4. Central Immutable Admin Audit Log
CREATE TABLE IF NOT EXISTS public.mali_admin_audit_log (
  log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_ip TEXT
);

ALTER TABLE public.mali_admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mali_admin_audit_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mali_admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mali_admin_audit_log TO authenticated;

DROP POLICY IF EXISTS mali_admin_audit_log_admin_read ON public.mali_admin_audit_log;
CREATE POLICY mali_admin_audit_log_admin_read ON public.mali_admin_audit_log FOR SELECT TO authenticated
  USING (public.mali_is_admin() = true);

-- 5. Admin RPC: Check Admin Role Status
CREATE OR REPLACE FUNCTION public.mali_check_admin_role()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID;
  v_role TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('is_admin', false, 'role', null);
  END IF;
  SELECT role INTO v_role FROM public.mali_admin_roles WHERE user_id = v_uid;
  IF v_role IS NOT NULL AND v_role IN ('owner', 'admin') THEN
    RETURN jsonb_build_object('is_admin', true, 'role', v_role, 'user_id', v_uid);
  END IF;
  RETURN jsonb_build_object('is_admin', false, 'role', v_role, 'user_id', v_uid);
END;
$$;
REVOKE ALL ON FUNCTION public.mali_check_admin_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mali_check_admin_role() TO authenticated;

-- 6. Admin RPC: Toggle Central Maintenance Mode
CREATE OR REPLACE FUNCTION public.mali_admin_toggle_maintenance(p_active BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID;
  v_old_val JSONB;
  v_new_val JSONB;
BEGIN
  v_uid := auth.uid();
  IF NOT public.mali_is_admin() THEN
    RAISE EXCEPTION 'غير مصرح لك بتغيير وضع الصيانة المركزي.' USING ERRCODE = '42501';
  END IF;
  SELECT value INTO v_old_val FROM public.mali_system_settings WHERE key = 'maintenance_mode';
  v_new_val := jsonb_build_object(
    'active', COALESCE(p_active, false),
    'reason', NULLIF(TRIM(p_reason), ''),
    'updated_at', clock_timestamp()
  );
  INSERT INTO public.mali_system_settings (key, value, updated_at, updated_by)
  VALUES ('maintenance_mode', v_new_val, clock_timestamp(), v_uid)
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
  
  INSERT INTO public.mali_admin_audit_log (actor_id, action, details)
  VALUES (v_uid, 'maintenance_toggle', jsonb_build_object(
    'previous', v_old_val,
    'current', v_new_val
  ));
  RETURN v_new_val;
END;
$$;
REVOKE ALL ON FUNCTION public.mali_admin_toggle_maintenance(BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mali_admin_toggle_maintenance(BOOLEAN, TEXT) TO authenticated;

-- 7. Admin RPC: Get System Metrics
CREATE OR REPLACE FUNCTION public.mali_admin_get_system_metrics()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_users_count BIGINT;
  v_vaults_count BIGINT;
  v_tx_count BIGINT;
  v_audit_count BIGINT;
  v_maint_active BOOLEAN;
  v_maint_reason TEXT;
BEGIN
  IF NOT public.mali_is_admin() THEN
    RAISE EXCEPTION 'غير مصرح لك بالوصول إلى لوحة الإدارة.' USING ERRCODE = '42501';
  END IF;
  SELECT COUNT(*) INTO v_users_count FROM auth.users;
  SELECT COUNT(DISTINCT user_id) INTO v_vaults_count FROM public.mali_vault_snapshots;
  SELECT COUNT(*) INTO v_tx_count FROM public.mali_transactions;
  SELECT COUNT(*) INTO v_audit_count FROM public.mali_financial_history;
  
  SELECT COALESCE((value->>'active')::boolean, false), value->>'reason'
  INTO v_maint_active, v_maint_reason
  FROM public.mali_system_settings WHERE key = 'maintenance_mode';
  
  
  RETURN jsonb_build_object(
    'registeredUsersCount', v_users_count,
    'activeVaultsCount', v_vaults_count,
    'totalTransactionsCount', v_tx_count,
    'totalAuditEventsCount', v_audit_count,
    'failedOperationsCount', NULL, -- Not tracked; never claim no failed operations
    'systemHealth', CASE WHEN v_maint_active THEN 'maintenance' ELSE 'healthy' END,
    'serverUptimeHours', NULL, -- No verified uptime telemetry
    'lastSecurityAuditDate', NULL, -- Financial events are not security audit events
    'isEmergencyMaintenanceActive', COALESCE(v_maint_active, false),
    'maintenanceReason', v_maint_reason
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mali_admin_get_system_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mali_admin_get_system_metrics() TO authenticated;

-- 8. Admin RPC: Get User Directory
CREATE OR REPLACE FUNCTION public.mali_admin_get_users()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.mali_is_admin() THEN
    RAISE EXCEPTION 'غير مصرح لك بالوصول إلى قائمة مستخدمي النظام.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'email', COALESCE(u.email, 'لا يوجد بريد'),
        'name', COALESCE(u.raw_user_meta_data->>'name', 'مستخدم مالي'),
        'createdAt', COALESCE(u.created_at, clock_timestamp()),
        'lastActiveAt', COALESCE(s.updated_at, u.created_at, clock_timestamp()),
        'status', CASE WHEN u.banned_until IS NOT NULL AND u.banned_until > clock_timestamp() THEN 'locked' ELSE 'active' END,
        'vaultStatus', CASE WHEN s.user_id IS NOT NULL THEN 'synced' ELSE 'empty' END,
        'accountsCount', (SELECT COUNT(*) FROM public.mali_accounts a WHERE a.user_id = u.id),
        'transactionsCount', (SELECT COUNT(*) FROM public.mali_transactions t WHERE t.user_id = u.id)
      )
    )
    FROM auth.users u
    LEFT JOIN public.mali_vault_snapshots s ON s.user_id = u.id
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.mali_admin_get_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mali_admin_get_users() TO authenticated;

-- 9. Admin RPC: Get Security Events
CREATE OR REPLACE FUNCTION public.mali_admin_get_security_events()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.mali_is_admin() THEN
    RAISE EXCEPTION 'غير مصرح لك بالوصول إلى سجل أحداث الأمان.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', 'evt_' || log_id::text,
        'timestamp', timestamp,
        'eventType', action,
        'severity', CASE
          WHEN action IN ('unauthorized_attempt', 'concurrency_conflict') THEN 'warning'
          WHEN action = 'emergency_lock' THEN 'critical'
          ELSE 'info'
        END,
        'details', CASE
          WHEN action = 'maintenance_toggle' THEN 'تغيير وضع الصيانة المركزي: ' || COALESCE(details->'current'->>'reason', 'بدون سبب')
          ELSE details::text
        END,
        'userEmail', actor_id::text
      )
      ORDER BY log_id DESC
    )
    FROM public.mali_admin_audit_log
    LIMIT 50
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.mali_admin_get_security_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mali_admin_get_security_events() TO authenticated;

-- 10. Database Enforcement: Maintenance Mode blocks financial mutations centrally
CREATE OR REPLACE FUNCTION public.mali_check_maintenance_gate() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.mali_system_settings
    WHERE key = 'maintenance_mode' AND (value->>'active')::boolean = true
  ) THEN
    RAISE EXCEPTION 'نظام مالي في وضع الصيانة المركزية حالياً. العمليات المالية متوقفة مؤقتاً.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mali_vault_snapshots_maintenance_check ON public.mali_vault_snapshots;
CREATE TRIGGER mali_vault_snapshots_maintenance_check
  BEFORE INSERT OR UPDATE OR DELETE ON public.mali_vault_snapshots
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mali_check_maintenance_gate();

COMMIT;
