# التقرير الختامي الشامل للتدقيق والإصلاح الهندسي والأمني والمالي — منظومة مالي (Mali App)

- **تاريخ الإنجاز**: 2026-10-12
- **المشروع**: `mali-app`
- **المستودع الرسمي**: `https://github.com/aybholiday99-glitch/mali-app`
- **قاعدة بيانات Supabase**: `evcwoaerlykghgdevrhb` (`eu-west-1`)
- **التقنيات المعتمدة**: Expo 57، React Native 0.86، TypeScript 6، Supabase PostgreSQL & Auth (PKCE).

---

## 1. الملخص التنفيذي (Executive Summary)

تم تنفيذ مراجعة أمنية وهندسية ومحاسبية شاملة لمنظومة **مالي (Mali App)** عبر ست مراحل متكاملة، شملت أخذ نسخ احتياطية موثقة للملفات وقاعدة البيانات، وسد جميع الثغرات الحرجة والعالية وفق معايير **OWASP Top 10**، وإعادة بناء المحرك المالي بدقة عشرية صارمة (`src/services/financialEngine.ts`)، وتحصين سياسات عزل المستخدمين (`Row Level Security - RLS`) في قاعدة بيانات Supabase، وتأمين نظام المزامنة والنسخ الاحتياطي، وإعداد خط أنابيب التكامل المستمر (`GitHub Actions CI`)، ونشر الإصدار المحصّن.

---

## 2. سجل الإصلاحات المنفذة حسب المراحل

### المرحلة 1: الفحص والحماية والنسخ الاحتياطي
1. **النسخ الاحتياطي الموثق**:
   - تم أخذ نسخة احتياطية كاملة لـ 49 ملفاً مصدرياً وتكوينياً قبل أي تعديل.
   - تم أخذ نسخة احتياطية كاملة لجميع جداول قاعدة بيانات Supabase الستة (`mali_vault_snapshots`, `mali_accounts`, `mali_contacts`, `mali_usd_deals`, `mali_transactions`, `mali_debts`) وسياسات `pg_policies` والتحقق برمجياً من سلامتها وقابليتها للاستعادة.
2. **التدقيق الأمني (`SECURITY_AUDIT.md`)**:
   - تم توثيق جميع الثغرات الأمنية (`SEC-01` إلى `SEC-04`) والأخطاء المحاسبية والمنطقية (`FIN-01` إلى `FIN-04`) مع عدم طباعة أي كلمات مرور أو رموز سرية أو بيانات عملاء خاصة.

---

### المرحلة 2: إصلاح الثغرات الأمنية الحرجة

#### أولاً: تحصين سياسات Supabase RLS وأذونات الأدوار (`20261012221500_security_rls_hardening.sql`)
- **المشكلة السابقة**: كانت السياسات الست تحتوي على الشرط `(user_id IS NULL AND char_length(workspace_key) >= 6)` مع صلاحيات `GRANT ALL` للدور المجهول (`anon`)، مما كان يسمح بالوصول لأي سجل بدون مالك بمجرد معرفة `workspace_key`.
- **الإصلاح المنفذ فعلياً على قاعدة البيانات `evcwoaerlykghgdevrhb`**:
  1. إنشاء جدول حجر صحي محمي (`public.mali_legacy_unowned_archive`) مفعل عليه `FORCE ROW LEVEL SECURITY` ومسحوب منه كافة الصلاحيات (`REVOKE ALL FROM PUBLIC, anon, authenticated`)، ونقل السجلات القديمة غير المنسوبة لمالك (21 سجلاً) إليه بأمان تام دون حذفها أو نسبتها لمستخدم خاطئ.
  2. تحويل العمود `user_id` في الجداول الستة إلى `NOT NULL DEFAULT auth.uid()`.
  3. سحب كافة الصلاحيات من الدور المجهول (`REVOKE ALL ON TABLE ... FROM PUBLIC, anon;`) بحيث أصبح عدد صلاحيات `anon` على الجداول المالية يساوي **صفراً (`anon_grants = 0`)**.
  4. إنشاء **24 سياسة RLS منفصلة** (4 سياسات `SELECT`, `INSERT`, `UPDATE`, `DELETE` لكل جدول من الجداول الستة) مخصصة للدور `authenticated` حصرياً، تشترط جميعها `auth.uid() IS NOT NULL AND auth.uid() = user_id` في كلٍ من `USING` و `WITH CHECK` مع تفعيل `FORCE ROW LEVEL SECURITY`.

#### ثانياً: تحصين دالة قاعدة البيانات `public.handle_mali_auto_confirm_user()`
- **المشكلة السابقة**: كانت الدالة تعمل بنمط `SECURITY DEFINER` بمسار بحث قابل للتغيير ومتاحة للتنفيذ العام من `PUBLIC` و `anon` و `authenticated`.
- **الإصلاح المنفذ**:
  - إعادة تعريف الدالة مع تثبيت `SET search_path = ''`.
  - سحب صلاحيات التنفيذ العامة بالكامل: `REVOKE ALL ON FUNCTION public.handle_mali_auto_confirm_user() FROM PUBLIC, anon, authenticated;`.
  - التحقق عملياً من رفض استدعائها عبر `rpc('handle_mali_auto_confirm_user')`.

#### ثالثاً: إزالة أسرار Google OAuth المضمنة وتأمين `postMessage` (`src/services/authService.ts`)
- **المشكلة السابقة**: وجود متغيرات `GOOGLE_CID_REV` و `GOOGLE_SEC_REV` و `GOOGLE_REF_REV` المرمزة بـ Base64 معكوس في كود العميل، واستخدام `postMessage(..., '*')` بدون قيود.
- **الإصلاح المنفذ**:
  1. إزالة جميع الأسرار ورموز التحديث المضمنة ودوال فك الترميز ومزامنة Google Cloud Datastore المباشرة من `src/services/authService.ts` و `src/services/supabaseSync.ts`.
  2. إبطال وحذف عملاء OAuth المكشوفين (`735307667382-08jq1a...` و `mali-web-oauth`) من Google Cloud وتنظيف إعدادات Supabase Auth (`external_google_enabled = false` حتى يتم إدخال بيانات اعتماد جديدة مدورة يدوياً في لوحة تحكم Supabase).
  3. اعتماد تدفق **Supabase Auth PKCE** الرسمي (`flowType: 'pkce'`, `supabase.auth.signInWithOAuth`, `supabase.auth.exchangeCodeForSession`).
  4. تقييد التراسل عبر النوافذ (`postMessage`) بتحقق صارم من `event.origin === window.location.origin` و `event.source === popup`، وعدم الوثوق بمحتوى الرسالة لإنشاء جلسة بل التحقق من الخادم عبر `supabase.auth.getUser()`.

#### رابعاً: تأمين كلمات المرور والجلسات
- **المشكلة السابقة**: استخدام SHA-256 بملح ثابت محلياً، وخوارزمية `Math.imul` البديلة، وقبول مقارنة النص الصريح (`storedHash === plainPassword`)، وتغيير كلمة المرور محلياً بدون تحقق.
- **الإصلاح المنفذ**:
  1. إزالة نظام التجزئة المحلي وسجل المستخدمين المحلي (`@mali_users_db_v1`) وقبول النص الصريح بالكامل، وتطهير أي مفاتيح تخزين قديمة تلقائياً (`purgeLegacyInsecureStorage`).
  2. استخدام مصادقة Supabase Auth الرسمية (`signUp`, `signInWithPassword`, `resetPasswordForEmail`, `updateUser`, `signOut`) مع فرض قوة كلمة المرور (8 أحرف على الأقل ومنع كلمات المرور الشائعة).
  3. عزل وضع الضيف المحلي (`startOfflineGuestSession` -> `isLocalOnly: true`) بحيث لا يمنح أي صلاحيات سحابية على الإطلاق.
  4. ملاحظة بخصوص ميزة فحص كلمات المرور المسربة (HIBP) في Supabase: تتطلب خطة Supabase Pro المدفوعة (`HTTP 402 Payment Required` على الخطة المجانية)، ولذلك تمت إضافة فحص محلي صارم ضد كلمات المرور الشائعة والضعيفة في `validatePasswordStrength`.

---

### المرحلة 3 و 5: المحرك المالي الدقيق وإعادة الهيكلة (`src/services/financialEngine.ts`)

تم فصل المنطق المحاسبي والمالي بالكامل عن طبقة العرض (`React Context`) إلى محرك مالي نقي وقابل للاختبار المستقل (`src/services/financialEngine.ts`):
1. **الدقة العشرية الصارمة**:
   - `roundMoney(val)` للتقريب المالي الدقيق إلى منزلتين عشريتين.
   - `roundRate(val)` لتقريب أسعار الصرف إلى 4 منازل عشرية.
2. **منع تكرار العمليات (`Idempotency`)**:
   - دعم `idempotencyKey` في جميع العمليات المالية (صرف، قبض، تحويل، تسييل صكوك، شراء/بيع دولار، إنشاء/سداد دين) لمنع تكرار القيود عند إعادة المحاولة أو ضعف الشبكة.
3. **إصلاح دورة حياة الديون والحركات (`FIN-01` & `FIN-02`)**:
   - عند حذف سجل دين (`deleteDebtMutation`): يتم عكس الأثر المالي لجميع دفعات السداد وأصل الدين على الحسابات المرتبطة وحذف جميع الحركات المرتبطة به ذرياً.
   - عند حذف حركة سداد دين (`deleteTransactionMutation` لنوع `debt_settlement`): يتم عكس رصيد الحساب وإعادة حساب `paidAmount` و `remainingAmount` و `status` وإزالة القسط من سجل الدين المرتبط فوراً.
4. **حماية الحسابات وصفقات الدولار**:
   - منع حذف حساب مرتبط بصفقة دولار مفتوحة.
   - منع بيع أو سحب كمية دولار تتجاوز الرصيد المتبقي في الصفقة (`remainingUsd`).
   - عكس ذري كامل لجميع المبيعات والسحوبات الشخصية وأصل الشراء عند حذف صفقة دولار (`deleteUsdDealMutation`).
5. **مطابقة لوحة المعلومات (`reconcileDashboardSummary`)**:
   - توحيد حسابات `DashboardScreen.tsx` مع المحرك المالي لضمان تطابق الأرصدة النقدية والمصرفية وأرباح الصفقات والديون والمصاريف بنسبة 100%.

---

### المرحلة 4: المزامنة السحابية والنسخ الاحتياطي (`src/services/supabaseSync.ts`)

1. **العزل الكامل للمستخدمين**:
   - التحقق من جلسة Supabase Auth (`getVerifiedCloudUserId`) قبل أي عملية سحب أو رفع، وتخصيص مساحة عمل معزولة لكل مستخدم (`mali-vault-${userId}`).
   - عزل التخزين المحلي على نفس الجهاز لكل مستخدم (`@mali_app_state_v2_${userId}`) وتفريغ الحالة من الذاكرة عند تسجيل الخروج (`logoutUser`).
2. **منع الكتابة فوق النسخة الأحدث (`Conflict Detection`)**:
   - عند تسجيل الدخول (`loginUser`)، يقوم التطبيق بالسحب من السحابة أولاً (`pullStateFromSupabase`) ومقارنة الطابع الزمني (`updated_at` مقابل `lastModifiedAt`) قبل أي رفع.
   - في `pushStateToSupabase`، يتم فحص الطابع الزمني للنسخة السحابية ورفض الكتابة التلقائية فوق نسخة سحابية أحدث.
3. **تنظيف السجلات الملغاة في الجداول العلائقية**:
   - عند مزامنة الجداول الخمسة (`mali_accounts`, `mali_contacts`, `mali_usd_deals`, `mali_transactions`, `mali_debts`)، يتم حذف السجلات التي أزالها المستخدم محلياً حتى تظل الجداول العلائقية مطابقة للخزنة.
4. **حماية النسخ الاحتياطي واستعادته**:
   - تجريد ملف النسخ الاحتياطي المصدّر (`نسخة_احتياطية_مالي.json`) من مفاتيح إعدادات الاتصال السحابي (`supabaseConfig`).
   - التحقق الصارم من بنية وأنواع البيانات عند الاستيراد عبر `validateAndSanitizeBackupPayload`.

---

## 3. نتائج الاختبارات الآلية الشاملة (Automated Verification Suite)

تم إنشاء وتشغيل 3 حزم اختبارات آلية شاملة بالإضافة إلى فحص الأنواع (`tsc --noEmit`):

1. **فحص TypeScript (`npm run typecheck`)**:
   - النتيجة: **ناجح (0 أخطاء)**.
2. **اختبارات المحرك المالي والحالات الحدية (`npm run test:unit` — `tests/financialEngine.test.mjs`)**:
   - فحص الدقة العشرية (`roundMoney`, `roundRate`).
   - فحص إنشاء الحسابات ومنع تكرار المعرفات ومنع حذف حساب مرتبط بصفقة مفتوحة.
   - فحص القبض والصرف والتحويل الداخلي ورفض القيم السالبة والتحويل بين عملتين مختلفتين ومنع التكرار (`idempotencyKey`).
   - فحص خصم تسييل الصكوك وعكس الحركة.
   - فحص دورة حياة صفقة الدولار (شراء، بيع جزئي، سحب شخصي، منع البيع الزائد، وعكس الأرصدة بالكامل عند الحذف).
   - فحص إصلاح `FIN-01` و `FIN-02` على الديون وحركات السداد.
   - النتيجة: **ناجح بالكامل (ALL FINANCIAL ENGINE TESTS PASSED)**.
3. **اختبارات سياسات RLS وعزل المستخدمين الحية (`npm run test:rls` — `tests/supabaseRlsAndSync.test.mjs`)**:
   - اختبار منع المستخدم المجهول (`anon`) من القراءة أو الإضافة في الجداول الستة ومنع استدعاء `handle_mali_auto_confirm_user()`.
   - إنشاء مستخدمين مستقلين (`User A` و `User B`) وإثبات أن `User A` لا يرى أي سجل لـ `User B` والعكس في جميع الجداول الستة.
   - إثبات فشل محاولات انتحال `user_id` أو إدخال `user_id = NULL` أو تعديل/حذف سجلات مستخدم آخر.
   - النتيجة: **ناجح بالكامل (ALL SUPABASE RLS & MULTI-USER ISOLATION TESTS PASSED)**.
4. **اختبارات المزامنة وتغيير الجهاز وتسجيل الخروج والنسخ الاحتياطي (`npm run test:sync` — `tests/syncAndBackup.test.mjs`)**:
   - محاكاة الدخول من جهاز أول ورفع البيانات، ثم الدخول من جهاز ثانٍ وسحب البيانات ومطابقة كافة الأرصدة.
   - التحقق من كاشف التعارضات الزمنية (`Conflict Detection`).
   - التحقق من حذف السجلات الملغاة من الجداول العلائقية في Supabase.
   - التحقق من إبطال الوصول السحابي فور تسجيل الخروج (`signOut`).
   - التحقق من تصدير واستعادة النسخة الاحتياطية الكاملة (`JSON`) ومطابقة الأرصدة.
   - النتيجة: **ناجح بالكامل (ALL SYNC, CONFLICT, LOGOUT & BACKUP TESTS PASSED)**.
