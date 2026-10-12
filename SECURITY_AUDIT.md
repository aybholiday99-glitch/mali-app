# تقرير التدقيق الأمني والهندسي والمالي الشامل — تطبيق مالي (Mali App)

- **تاريخ التدقيق**: 2026-10-12
- **المشروع**: `mali-app` (`evcwoaerlykghgdevrhb`)
- **النطاق**: الكود المصدري (`src/`)، قاعدة بيانات Supabase PostgreSQL وسياسات RLS، المصادقة والجلسات، المحرك المالي والمحاسبي، المزامنة السحابية، وخطوط النشر (GitHub Actions & GitHub Pages).
- **المرجعية**: OWASP Top 10 (2021) & OWASP Mobile Top 10 (2024).

---

## 1. ملخص النسخة الاحتياطية قبل التعديل (Verified Pre-Audit Backup)

تم أخذ نسخة احتياطية كاملة وموثقة قبل إجراء أي تعديلات:
- **نسخة ملفات المشروع**: 49 ملفاً مصدرياً وتكوينياً محفوظة خارج المستودع في مجلد النسخ الاحتياطي الآمن.
- **نسخة قاعدة البيانات (Supabase `evcwoaerlykghgdevrhb`)**: تم سحب وتوثيق جميع الجداول الستة (`mali_vault_snapshots`: سجلان، `mali_accounts`: 10 سجلات، `mali_contacts`: 12 سجلاً، `mali_usd_deals`: 4 سجلات، `mali_transactions`: 10 سجلات، `mali_debts`: 4 سجلات) بالإضافة إلى سياسات `pg_policies` الست، وتم التحقق برمجياً من سلامة ملف JSON وقابليته للاستعادة الفورية.

---

## 2. سجل الثغرات والمشكلات المكتشفة (Findings Register)

### [SEC-01] سياسات RLS تسمح بالوصول غير المصرح للسجلات ذات `user_id IS NULL` (خطورة: حرجة — Critical)
- **التصنيف**: OWASP A01:2021 — Broken Access Control
- **الموقع**: `supabase/migrations/20261012164600_init_mali_schema.sql` و `src/services/supabaseSync.ts`
- **الوصف والأثر**:
  تحتوي الجداول الستة (`mali_accounts`, `mali_contacts`, `mali_debts`, `mali_transactions`, `mali_usd_deals`, `mali_vault_snapshots`) على سياسة واحدة بصيغة:
  `USING ((user_id IS NULL AND char_length(workspace_key) >= 6) OR (auth.uid() = user_id))`
  مع منح صلاحيات كاملة (`GRANT ALL`) لدور `anon`. هذا يسمح لأي مستخدم مجهول أو مستخدم آخر بقراءة أو تعديل أو حذف البيانات المالية إذا كان `user_id IS NULL` بمجرد معرفة أو تخمين `workspace_key` (مثل القيمة الافتراضية `mali-personal-vault`).
- **الإصلاح المطلوب**:
  1. سحب جميع الصلاحيات (`REVOKE ALL`) من الدور `anon` و `PUBLIC` على الجداول الستة.
  2. عزل السجلات القديمة التي تحمل `user_id IS NULL` في جدول أرشيف محمي (`mali_legacy_quarantine`) لا يمكن الوصول إليه من الواجهة العامة، دون حذف أي بيان.
  3. جعل العمود `user_id` إلزامياً (`NOT NULL DEFAULT auth.uid()`) في الجداول الستة.
  4. إنشاء سياسات منفصلة وصارمة (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) للدور `authenticated` فقط تشترط `auth.uid() IS NOT NULL AND auth.uid() = user_id`.

---

### [SEC-02] دالة `public.handle_mali_auto_confirm_user()` تعمل بـ `SECURITY DEFINER` ومتاحة للعامة (خطورة: عالية — High)
- **التصنيف**: OWASP A04:2021 / A05:2021 — Security Misconfiguration & Privilege Escalation
- **الموقع**: `supabase/migrations/20261012190800_auto_confirm_users.sql`
- **الوصف والأثر**:
  الدالة معرفة بـ `SECURITY DEFINER` دون تثبيت `search_path`، وبصلاحيات تنفيذ افتراضية متاحة لـ `PUBLIC` و `anon` و `authenticated`، مما يظهر كتحذير أمني في Supabase Security Advisor.
- **الإصلاح المطلوب**:
  1. إعادة تعريف الدالة مع `SET search_path = ''` والتحقق من أن الاستدعاء يتم حصراً عبر Trigger على `auth.users`.
  2. تنفيذ `REVOKE ALL ON FUNCTION public.handle_mali_auto_confirm_user() FROM PUBLIC, anon, authenticated;`.

---

### [SEC-03] تضمين بيانات اعتماد Google OAuth في كود العميل واستخدام `postMessage('*')` غير المقيد (خطورة: حرجة — Critical)
- **التصنيف**: OWASP A02:2021 — Cryptographic Failures & OWASP A07:2021 — Identification and Authentication Failures
- **الموقع**: `src/services/authService.ts` و `src/services/supabaseSync.ts`
- **الوصف والأثر**:
  1. وجود متغيرات مرمزة بـ Base64 معكوس لبيانات اعتماد Google OAuth ورموز تحديث داخل كود الواجهة الأمامية.
  2. استخدام `window.opener.postMessage(..., '*')` واستقبال رسائل `message` دون التحقق الصارم من `event.origin` و `event.source`.
  3. توليد كلمة مرور حتمية (`deterministicOAuthSecret`) مشتقة من البريد الإلكتروني لتسجيل الدخول الاجتماعي البديل، مما يسمح بانتحال الهوية بمجرد معرفة البريد الإلكتروني.
- **الإصلاح المطلوب**:
  1. إزالة جميع الأسرار المضمنة ورموز التحديث والمسار البديل غير الآمن بالكامل من الكود المصدري.
  2. إبطال وحذف بيانات الاعتماد المكشوفة من Google Cloud وتنظيف إعدادات Supabase Auth.
  3. الاعتماد حصراً على تدفق OAuth الرسمي والآمن عبر `@supabase/supabase-js` (`flowType: 'pkce'`).
  4. تقييد `postMessage` للتحقق الصارم من `event.origin === window.location.origin` و `event.source === popupWindow`.

---

### [SEC-04] ضعف آلية تخزين كلمات المرور المحلية وقبول النص الصريح وإعادة التعيين غير الموثقة (خطورة: عالية — High)
- **التصنيف**: OWASP A07:2021 — Identification and Authentication Failures
- **الموقع**: `src/services/authService.ts`
- **الوصف والأثر**:
  1. استخدام ملح ثابت (`PASSWORD_SALT_PREFIX`) مع SHA-256 وخوارزمية بديلة غير قياسية (`Math.imul`).
  2. وجود الشرط `return storedHash === plainPassword;` الذي يقبل كلمة المرور النصية.
  3. دالة `resetUserPasswordLocal` تسمح بتغيير كلمة المرور لأي بريد محلي دون التحقق من الهوية أو رمز استرداد.
  4. إمكانية الخلط بين الجلسة المحلية (وضع الضيف) والجلسة السحابية الموثقة.
- **الإصلاح المطلوب**:
  1. اعتماد مصادقة Supabase Auth الرسمية (`supabase.auth.signUp`, `signInWithPassword`, `resetPasswordForEmail`, `signOut`) كمصدر وحيد للمصادقة السحابية.
  2. إزالة قبول كلمات المرور النصية وإزالة التصفير المحلي غير الموثق لكلمات المرور.
  3. عزل وضع العمل المحلي (`isLocalOnly: true`) بحيث لا يمنح أي صلاحيات سحابية ولا يرسل طلبات بدون جلسة JWT موثقة.

---

### [FIN-01] حذف الدين (`deleteDebt`) لا يعكس الأثر المالي ولا ينظف الحركات المرتبطة (خطورة: عالية — High)
- **الموقع**: `src/context/MaliContext.tsx`
- **الوصف والأثر**:
  عند إنشاء دين مع خيار التأثير على الحساب أو تسجيل دفعات سداد (`addDebtInstallment`)، تتغير أرصدة الحسابات وتُضاف حركات `debt_settlement`. لكن عند استدعاء `deleteDebt` يتم حذف سجل الدين فقط مع بقاء الأرصدة والحركات معلقة، مما يسبب اختلالاً محاسبياً.
- **الإصلاح المطلوب**:
  عكس الأثر المالي لحركات الدين وأقساطه (أو منح خيار عكس الأرصدة افتراضياً كما في `deleteUsdDeal`) وحذف حركات `debt_settlement` المرتبطة بـ `debtId`.

---

### [FIN-02] حذف حركة سداد دين (`deleteTransaction`) لا يحدّث رصيد الدين المتبقي (خطورة: عالية — High)
- **الموقع**: `src/context/MaliContext.tsx`
- **الوصف والأثر**:
  عند حذف حركة من نوع `debt_settlement`، يتم عكس رصيد الحساب المصرفي/النقدي، لكن سجل الدين في `state.debts` يبقى على حالته السابقة (`paidAmount` و `remainingAmount` و `status`)، مما يؤدي إلى عدم تطابق كشف الديون مع الأرصدة الفعلية.
- **الإصلاح المطلوب**:
  تحديث سجل الدين المرتبط (`tx.debtId`) تلقائياً عند حذف حركة السداد وإعادة حساب `paidAmount` و `remainingAmount` و `status`.

---

### [FIN-03] غياب التحقق الصارم من صحة المدخلات المالية وتكرار العمليات (خطورة: متوسطة إلى عالية — Medium/High)
- **الموقع**: `src/context/MaliContext.tsx`
- **الوصف والأثر**:
  1. غياب التحقق من القيم السالبة أو الصفرية أو `NaN` في بعض العمليات.
  2. عدم التحقق من تطابق عملة الحساب في التحويلات وتسييل الصكوك وصفقات الدولار.
  3. إمكانية تكرار نفس المعاملة عند النقر السريع المزدوج أو إعادة المحاولة (`Idempotency`).
- **الإصلاح المطلوب**:
  إنشاء محرك مالي مستقل (`src/services/financialEngine.ts`) يطبق حسابات عشرية دقيقة (`roundMoney`, `roundRate`)، ويتحقق من سلامة المدخلات والأرصدة والعملات، ويمنع التكرار عبر بصمة عدم التكرار (`idempotencyKey`).

---

### [FIN-04] خطر الكتابة فوق البيانات السحابية الأحدث عند تسجيل الدخول أو المزامنة (خطورة: عالية — High)
- **الموقع**: `src/context/MaliContext.tsx` و `src/services/supabaseSync.ts`
- **الوصف والأثر**:
  1. عند استدعاء `loginUser`، كان التطبيق يرفع الحالة المحلية الافتراضية فوراً (`pushStateToSupabase`) قبل التحقق مما إذا كان المستخدم يملك نسخة أحدث على السحابة، مما قد يكتب فوق بياناته السحابية عند الدخول من جهاز جديد.
  2. غياب التحقق من الطابع الزمني (`updated_at`) لمنع الكتابة فوق نسخة سحابية أحدث دون قصد.
- **الإصلاح المطلوب**:
  1. عند تسجيل الدخول بحساب سحابي موثق، يقوم التطبيق أولاً بسحب/فحص النسخة السحابية (`pullStateFromSupabase`) ومقارنة الطابع الزمني قبل أي رفع.
  2. إضافة آلية كشف التعارضات (`Conflict Resolution`) في `supabaseSync.ts` تمنع الكتابة الصامتة فوق نسخة سحابية أحدث إلا بطلب صريح (`forceOverwrite`).

---

## 3. حالة التنفيذ والتحقق النهائي (Remediation & Verification Status)

| المعرف | المشكلة | الخطورة | الحالة النهائية | دليل التحقق والاختبار |
|---|---|---|---|---|
| **SEC-01** | شرط `user_id IS NULL` وصلاحيات `anon` في سياسات RLS للجداول الستة | حرجة (Critical) | **تم الإصلاح والتحقق** | تم تطبيق الهجرة `20261012221500_security_rls_hardening.sql` (24 سياسة منفصلة لـ `authenticated` فقط، `anon_grants = 0`، حجر 21 سجلاً قديماً في `mali_legacy_unowned_archive`) واجتياز اختبار `tests/supabaseRlsAndSync.test.mjs`. |
| **SEC-02** | دالة `handle_mali_auto_confirm_user` بنمط `SECURITY DEFINER` ومتاحة للعامة | عالية (High) | **تم الإصلاح والتحقق** | تم تثبيت `SET search_path = ''` وسحب صلاحية التنفيذ (`REVOKE ALL ... FROM PUBLIC, anon, authenticated`) والتحقق من رفض استدعاء `rpc` في `tests/supabaseRlsAndSync.test.mjs`. |
| **SEC-03** | تضمين أسرار Google OAuth واستخدام `postMessage('*')` غير المقيد | حرجة (Critical) | **تم الإصلاح والتحقق** | تم حذف جميع الأسرار المضمنة من `src/services/authService.ts` و `src/services/supabaseSync.ts`، وإبطال وحذف عملاء OAuth المكشوفين من Google Cloud وتنظيف إعدادات Supabase Auth، وتطبيق تدفق PKCE مع تحقق صارم من `event.origin` و `event.source`. |
| **SEC-04** | التجزئة المحلية بملح ثابت وقبول النص الصريح وإعادة التعيين غير الموثقة | عالية (High) | **تم الإصلاح والتحقق** | تم استبدالها بالكامل بمصادقة Supabase Auth الرسمية (`signUp`, `signInWithPassword`, `resetPasswordForEmail`, `signOut`) وعزل وضع الضيف المحلي (`isLocalOnly: true`). |
| **FIN-01** | حذف الدين (`deleteDebt`) لا يعكس الأرصدة ولا يحذف الحركات المرتبطة | عالية (High) | **تم الإصلاح والتحقق** | تم تنفيذ `deleteDebtMutation` في `src/services/financialEngine.ts` واجتياز الاختبار الآلي في `tests/financialEngine.test.mjs`. |
| **FIN-02** | حذف حركة سداد دين (`deleteTransaction`) لا يحدّث سجل الدين | عالية (High) | **تم الإصلاح والتحقق** | تم تنفيذ `deleteTransactionMutation` في `src/services/financialEngine.ts` لإعادة حساب `paidAmount` و `remainingAmount` و `status` واجتياز الاختبار في `tests/financialEngine.test.mjs`. |
| **FIN-03** | غياب التقريب العشري الصارم وبصمة منع التكرار (`Idempotency`) | متوسطة/عالية | **تم الإصلاح والتحقق** | تم بناء `src/services/financialEngine.ts` بدوال `roundMoney` و `roundRate` ودعم `idempotencyKey` والتحقق من كافة الحالات الحدية في `tests/financialEngine.test.mjs`. |
| **FIN-04** | خطر الكتابة فوق البيانات السحابية الأحدث وبقاء السجلات المحذوفة | عالية (High) | **تم الإصلاح والتحقق** | تم تحديث `src/services/supabaseSync.ts` و `src/context/MaliContext.tsx` للسحب أولاً عند تسجيل الدخول، وكشف التعارضات الزمنية، وحذف السجلات الملغاة من الجداول العلائقية، واجتياز `tests/syncAndBackup.test.mjs`. |
