-- تفعيل التأكيد الفوري للحسابات المسجلة في تطبيق مالي (البريد الإلكتروني + حسابات Google و Facebook)
CREATE OR REPLACE FUNCTION public.handle_mali_auto_confirm_user()
RETURNS TRIGGER
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

DROP TRIGGER IF EXISTS trg_mali_auto_confirm_user ON auth.users;
CREATE TRIGGER trg_mali_auto_confirm_user
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_mali_auto_confirm_user();

-- تأكيد أي حسابات حالية غير مؤكدة
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL;
