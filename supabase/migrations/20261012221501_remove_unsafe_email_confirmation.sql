-- Stop bypassing email ownership. Does not modify existing auth users or financial rows.
BEGIN;
DROP TRIGGER IF EXISTS trg_mali_auto_confirm_user ON auth.users;
-- Keep the legacy function for compatibility, but make any future invocation harmless.
CREATE OR REPLACE FUNCTION public.handle_mali_auto_confirm_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_mali_auto_confirm_user() FROM PUBLIC, anon, authenticated;
COMMIT;
