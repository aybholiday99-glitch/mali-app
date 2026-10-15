# Mali release gate

**ANDROID-ONLY RELEASE CANDIDATE — NOT PRODUCTION READY.** Updated 2026-10-13. Draft PR2; main/Pages unchanged. The owner explicitly excludes iOS from the current release scope.
Earlier MALI_FINAL_AUDIT/MALI_RELEASE_READINESS completion claims are superseded.
Each source needs its own validation; prior CI is not the final integrated gate.

| Required acceptance | Current evidence / remaining requirement |
|---|---|
| No critical/high issue | FAIL: upstream dependency gate and sensitive production acceptance remain |
| Reliable auth/data protection | PARTIAL: owner/PKCE/session/SecureStore/native OAuth/generation tests PASS; server-authoritative admin dashboard (RBAC, RLS, central maintenance trigger code 55000, immutable admin audit log) & offline mutation blocking verified; real device/provider flows remain |
| Correct RLS CRUD | PASS isolated PG17 six-table CRUD, full nested financial SQL validation and ownership-safe full restore |
| No exposed secrets; old credentials revoked | PARTIAL: SAST/redaction/provenance PASS; Google credential revocation unproved |
| Accurate finance/immutable evidence | PASS candidate exact money/cost/reversal/compound/audit/client/history regressions; production cutover unapproved |
| Durable local acknowledgement | PASS independent serial verified candidate/outbox, immutable inputs/exact failed retry; native fault acceptance remains |
| Reconnect/backoff/cancellation | PASS candidate durable owner outbox/timers/session/CAS stops and chunked integration; offline banner and write guard verified |
| Usable conflict recovery | PARTIAL: verified archive+single decision/outbox commit, changed CAS renewed review/no force,independent review8probes PASS atd2db769; archive retrieval UI ongoing |
| Proven backup/restore | PARTIAL: safe legacy migration wizard with SHA-256 checksum & atomic cloud sync PASS (5/5 tests); actual PG17 full dump/restore 10 tables/owner/ACL/RLS/CAS/21originals+21archives PASS local+CI; atomic local restore faults PASS; browser actual JSON download/explicit restore PASS; production backup/native round-trip remain |
| All UI/RTL/accessibility/performance | PARTIAL: real Chromium 2026-10-13 verified UI mount, offline guest navigation, lossless IndexedDB migration, 1k/10k/50k record persistence and 50k full reload; accessibility/RTL source tests pass (10/10 PASS with 48dp bounds); Unified Financial Profiles dossier & dual-mode contact picker integrated; every screen and fault-path on physical devices still requires acceptance |
| Compatible secure dependencies | FAIL: braces absent and Expo57 consumers PASS; truthful forge1.4.0 backport passes all security/consumer tests but raw audit reports 4 high due to unreleased upstream fix |
| Mandatory tests and CI | PARTIAL: 707/707 app tests PASS (100% across all 60 test suites), PostgreSQL 17.11 143/143 PASS, real browser storage/guest acceptance PASS, dump/restore rehearsal PASS, web build PASS; unpatched node-forge advisory keeps npm audit and aggregate CI FAIL |
| Android acceptance | PARTIAL: Linux Gradle built debug APK; GitHub Actions Run 38457703515 (android-standalone.yml) assembled and test-signed the ARM64 standalone release APK (app-release.apk, uploaded as artifact mali-android-arm64-standalone-apk); full physical native financial/biometric/OAuth and persistence acceptance still required |
| iOS acceptance | OUT OF SCOPE: owner requested Android-only; no iOS builds or tests are required for this Android-targeted release. |
| Approved production published/tested | FAIL: PR2 draft; no merge/publication/financial migration deployment |

Earlier live changes only repaired unsafe Auth trigger/function, confirmation/password settings
and migration-history metadata. No financial SQL replay/owner inference/data deletion.
21null-owner originals and21 exact archive copies preserved;6nullable owner columns unresolved.
Both ordered atomic and immutable-history migrations remain unapplied to production.
Remaining registry advisory: [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
Historical [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) is closed on candidate.
No merge/publish/cutover with failing or pending gates. Sensitive production actions require
successful acceptance, proven production backup/data safety and explicit user approval.

## Independent production isolation review — 2026-10-15

Release status remains **NOT PRODUCTION READY**. This section reflects a read-only review of Supabase project `evcwoaerlykghgdevrhb`, not migration or deployment approval.

- Verified: the seven existing `public.mali_*` financial tables have RLS enabled and forced, with authenticated SELECT/INSERT/UPDATE/DELETE restricted to `auth.uid() = user_id`; the unowned archive has no client policies. The actual JWT cross-owner integration test against production has **not** been performed.
- Blocker: no `public.mali_*` stored procedures were present in production at review time. Candidate RPC-based sync, privileged administrative reads and maintenance enforcement are **not** thereby deployed to production.
- Blocker: no Storage buckets were configured. Receipt uploads must not be declared centrally stored or safe for customers until a **private** tenant-scoped bucket, upload/download RLS and end-to-end integrity tests are implemented and approved.
- Android acceptance: candidate `3eb7667` APK assembled, but Android emulator install/restart CI failed; Chromium device emulation screenshots are not equivalent to native Android UI acceptance.
- Security remediation in subsequent candidate: remove bundled demo contacts/balances/debts/transactions/budgets from `INITIAL_MALI_STATE`; start with a blank vault and blank cloud-validation fallback; do not treat failed cloud reads with no verified local snapshot as proof that the customer vault is empty.
- Expo SDK alignment is a candidate update only. Maintain the npm audit failure and node-forge advisory until conclusively resolved; do not bypass audit.
- Next gates: clean CI, owner-A/owner-B real-server isolation and attachment tests, proven backups, verified migration/cutover, physical Android login/restart/reinstall/failure-mode acceptance, and owner approval before production changes or PR merge.

## Follow-up security and Android release engineering — 2026-10-15

- Fixed administrative UI to show the privileged entry point only after the server RPC `mali_check_admin_role` confirms the precise authenticated user ID and project configuration. A client-provided `role` is insufficient. The admin screen fails closed while authorization is unknown and clears previously loaded privileged records when the authorization scope changes.
- Each admin data fetch/toggle now rechecks the server RPC before invoking the privileged RPC. Removed the unsafe local-only maintenance toggle that could report success without changing the server.
- Removed fabricated uptime/failure/audit metrics: `failedOperationsCount`, `serverUptimeHours`, and `lastSecurityAuditDate` are `null` until genuine telemetry exists. This is a *candidate migration change*, not a live production migration.
- Adjusted Android GitHub Actions emulators to use a smaller AOSP API 30 image and longer boot timeouts. Standalone installation now records separate APK transfer and `pm install` evidence after the prior API 35 emulator needed seven minutes to boot and its four-minute `adb install` timed out. Native emulator success is still **unverified** until the new CI run completes.
- Bounded parallel app test workers to four to reduce CI resource contention; retain failing test and dependency security gates instead of bypassing them.
- Current live Supabase project has five applied migrations; central financial CAS/admin RPC migrations are absent. No production write/migration/merge has been authorized or performed. The published Android build still has server-only storage mode OFF, so the owner-only-central-storage requirement is **not yet met**.
- Existing `node-forge` <=1.4.0 advisory GHSA-86w9-cpqp-85rv has no official patched release as of this review. Vendored backport and source-consumer verification pass, but raw npm audit remains HIGH and blocks production approval.
- Required before production: verified full backup and restore, audited data-ownership migration, private receipt storage or confirmed secure inline receipt storage, server-only cutover, two-account live isolation checks, production OAuth callbacks, native APK install/restart and human physical-device checks, and clean security audit.

## Local regression gate recovery — 2026-10-15

- Full app suite now **725/725 PASS** (`npm test`, Node 24, four test workers, 52.6s), following four fixture corrections where older tests incorrectly treated a failed/unverified remote read as a verified empty customer vault. These changes do **not** relax the production fail-closed policy.
- Hardened integration's synthetic financial-storage write stub to tolerate chunked storage metadata that is intentionally not JSON, and bounded its acknowledgement wait so future regressions surface as failed tests rather than CI hangs.

## Technical Settings Purge & Multi-Account Isolation Hardening — 2026-10-15

- **Purged Technical Settings from UI**:
  - Removed Section 2 from `CloudAndExportModal.tsx`: all text inputs for Supabase URL, Anon Key, Workspace Key, AutoSync checkbox, manual Push and Pull buttons, and manual Save Config button are deleted.
  - Removed SQL Schema toggle button and raw `SUPABASE_SQL_SCHEMA` code container from client view.
  - Replaced with read-only "حالة المزامنة السحابية" (Cloud Sync Status) box showing connection badge, Arabic last-sync time, and sanitized status messages (`sanitizeSyncMessage`).
  - Removed `إعدادات الربط السحابي (Supabase)` from `AuthScreen.tsx` and removed `CloudAndExportModal` from unauthenticated `MaliAuthShell.tsx`.
  - Replaced unauthenticated guest direct start with security notice requiring authenticated login to access the vault.
  - Removed `workspaceKey` display from `MaliVaultShell.tsx` Profile Modal.
- **Private Receipts Storage Migration (`mali-receipts`)**:
  - Created `supabase/migrations/20261015000000_private_receipts_storage.sql` with private bucket (`public = false`), 5MB file ceiling (`5242880` bytes), and strict MIME whitelist (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`).
  - Implemented RLS policies requiring path ownership: `(storage.foldername(name))[1] = auth.uid()::text`.
  - Explicitly revoked all permissions from `anon` on storage objects and buckets.
  - Verified migration in disposable test database (never applied to live production).
- **Two-Account Isolation & Storage Tests**:
  - Added `tests/twoAccountDataIsolation.test.mjs` (37 tests) verifying User A vs User B on all financial tables, workspace_key manipulation defense, anon blocking, and memory session scrub on logout.
  - Added `tests/receiptsStorageSecurity.test.mjs` (26 tests) verifying private bucket tenant isolation, cross-folder upload blocking, file size ceiling, and MIME whitelist.
  - Full test suite now **788/788 PASS** (`npm test`, 100% across all suites).
- `tests/providerIntegration.test.mjs` and `tests/providerMutationDurability.test.mjs` together **32/32 PASS**; finance history and screen submission suites **7/7 PASS**; admin/data isolation earlier **12/12 PASS**.
- Important: successful local tests do **not** establish production readiness; native Android emulator success, real-server two-account isolation, verified production backup/restore and migrations, private attachments, central-only data policy, OAuth providers and unresolved npm high-severity audit remain release blockers.

## Expo SDK 57 compatibility CI repair — 2026-10-15

- Pre-fix PR CI run 38777422108: `npx expo install --check` FAIL (expo 57.0.29, expected ~57.0.30; expo-router 57.0.27, expected ~57.0.28). Typecheck/lint/test passed on that run, but the web build and browser acceptance were skipped.
- Updated only the same SDK 57 family: `expo` 57.0.30, `expo-router` 57.0.28 and the direct CLI override `@expo/cli` 57.0.30, including npm package-lock.json.
- Consumer integrity/provenance reviewed: both tracked CLI code-signing and iOS security source-file SHA256 values are byte-for-byte unchanged from their verified hashes. Updated only the reviewed CLI version and review date in `vendor/securityProvenance.json` so the integrity gate still rejects source edits and unexpected consumers.
- Local `npx expo install --check` PASS; specialized dependency compatibility/integrity/security tests 6/6 PASS; `npm run build:web` PASS; earlier pre-provenance full suite 786/788 PASS, with exactly two expected CLI-version pin failures that the provenance update addresses. Await clean-install full-suite and PR CI for final confirmation.
- `npm audit --audit-level=high` still FAIL: four high findings through node-forge GHSA-86w9-cpqp-85rv, no official patched release. Do not bypass npm audit, apply breaking Expo downgrade, merge PR, publish, or alter Supabase production. APK/device acceptance and approved financial cutover remain pending.

## Authenticated browser and standalone emulator gate repair — 2026-10-15

- PR CI run 38782822649 passed the clean dependency install, static checks, all 788 application tests, Expo dependency alignment, and web export. Its real Chrome step failed only because the previous acceptance script still demanded an offline guest shortcut that was intentionally removed from the login UI. The mandatory raw registry audit still fails on node-forge.
- Revised scripts/acceptWebBrowser.mjs to require visible email/password sign-in controls in a real Chromium instance and to reject exposed developer connection strings on the login UI. No test-user login, bypass or production writes were added. It retains isolated 1k/10k/50k IndexedDB round-trip and reload verification. On the authorized Windows device, real Chrome acceptance PASS including persistence of 50,000 isolated records.
- Deleted a dead Google/Facebook account chooser containing fixed personal email addresses, fixed identity choices and an unused secondary authentication path from AuthScreen.tsx. The actual OAuth launcher through Supabase remains unchanged. Added regression checks that forbid fixed Gmail account choices in this screen and ensure the browser acceptance demands real authentication.
- Previous Android emulator debug smoke relied on Metro launching under a heavily loaded Linux emulator and repeatedly timed out. Changed only the candidate Android emulator workflow to build the test-signed standalone release variant and use existing scripts/androidStandaloneSmoke.sh (self-contained JS, 4 ABIs, local APK install, two cold launches, crash/dev-server detection). This is isolated CI-only candidate verification, not deployment or production signing. Emulator outcome pending fresh GitHub Actions.
- No Supabase production modification, deploy, merge, financial cutover or final release was performed; release remains blocked by registry node-forge advisory, pending emulator/device acceptance, real-user production isolation/storage verification and verified backups with explicit approval.

## Zero-percent cheque-discount accounting correction — 2026-10-15

- Root cause: both the dashboard cheque fee calculator and the bank-to-cash cheque liquidation form applied JavaScript `|| 2.5` to the stored default discount. This silently rewrote an explicitly accepted **0%** discount to 2.5%, causing misleading fee previews and an incorrect liquidation prefill.
- Candidate fix: use the saved numeric `marketRates.defaultChequeDiscountPercent` directly in both screens, respecting the supported 0% rate without changing existing balances, transactions, historical discounts or production records.
- Regression acceptance: rendered DashboardScreen after saving zero percent shows 0% and a zero cheque fee; rendered AccountsScreen pre-fills its cheque discount input with `0`. Tests exercise the actual mounted React Native screen components and persisted candidate mutation.
- Authorized Windows workstation: full `npm test` **792/792 PASS**; `npm run typecheck` PASS; `npm run lint` PASS; `npx expo install --check` PASS; `git diff --check` PASS.
- Remaining release gates unchanged: raw `npm audit` reports node-forge GHSA-86w9-cpqp-85rv HIGH; actual live Supabase has no central vault RPC nor private receipt bucket; native emulator/device E2E and verified production backup/migration/consent are not yet complete. This change is for Draft PR #2 only; no production data operations, deployment or merge.

## GHSA-86w9-cpqp-85rv strict-DER local hardening — 2026-10-15

- Upstream status verified: npm node-forge latest published version is 1.4.0; GitHub advisory GHSA-86w9-cpqp-85rv includes <=1.4.0 and lists **no officially patched version**. Do not misrepresent a local patch as an official upstream release, publish a fake node-forge version, rename its package to bypass advisories, or run the breaking npm audit fix --force downgrade to Expo 44.
- Found an additional behavior in the existing backport: its prefix comparison accepted noncanonical trailing DigestInfo bytes when a caller selected the non-default `_parseAllDigestBytes: false`. A new exploit regression in `tests/dependencyOverrides.test.mjs` failed before the patch and now passes against both Expo CLI and @expo/code-signing-certificates consumers.
- Fixed `vendor/node-forge/lib/rsa.js` to require **complete, canonical DER DigestInfo equality**, even with a relaxed parser flag. Preserved the official 1.4.0 package name/version and BSD-3-Clause/GPL-2.0 dual-license metadata; documented that this is a local improvement beyond upstream PR 1159 and is NOT byte-identical to the upstream commit.
- Repacked tracked `vendor/node-forge-1.4.0.tgz`, updated source SHA-256 inventory, archive SHA-512, and lockfile integrity. Verified no unreviewed signer/CLI copy: `npm ci --ignore-scripts` PASS, `node --test tests/dependencyOverrides.test.mjs` **7/7 PASS** including signature forgery rejection, certificate/CSR lifecycle, and real Expo CLI manifest signing. `npm run typecheck` PASS; `npm run lint` PASS; full `npm test` **793/793 PASS**; `npx expo install --check` PASS.
- The independent registry scan remains intentionally **RED**: `npm audit --audit-level=high` exit 1, 4 HIGH findings, advisory GHSA-86w9-cpqp-85rv, npm suggesting unsafe Expo 44.0.6 downgrade. Keep this required release gate failing until an officially verified fix replaces the local backport (or a separately reviewed, genuinely vulnerability-free dependency replacement eliminates the affected package). Local exploit-test PASS does not close the registry advisory.
- Only a Draft PR development-branch change: no Supabase production migration/data deletion, no deploy, no PR merge, and no final APK release. Production backup/cutover approval and prior Android/Supabase release blockers remain.

## Static Security, SonarCloud Remediation & Cryptographic Hardening — 2026-10-15

- **SonarCloud Quality Gate Remediation**:
  - Addressed all 12 BUGS (`typescript:S9383`, `typescript:S2871`, `javascript:S2871`):
    - Added explicit deterministic string comparators (`localeCompare`) to all `.sort()` calls in `legacyVaultMigrationService.ts`, `financialInputSnapshot.ts`, `conflictResolutionCore.ts`, `financialAudit.ts`, and `verifyDependencyOverrides.mjs`.
    - Marked async IIFE promise in `AdminDashboardScreen.tsx` with `void` operator.
  - Addressed all 10 VULNERABILITIES (`typescript:S2245`, `shell:S6505`, `javascript:S4036`, `jssecurity:S8707`, `githubactions:S6505`, `githubactions:S8543`, `githubactions:S8541`):
    - Replaced pseudorandom `Math.random()` in `financialEngine.ts`, `financialAudit.ts`, `submissionKey.ts`, `durableSyncWorker.ts`, and `nativeFileExport.ts` with cryptographically secure random values via Web Crypto API (`crypto.getRandomValues`).
    - Added `--no-install` to `npx` invocations in `scripts/androidSmoke.sh` and `.github/workflows/ci.yml`.
    - Sanitized `PATH` environment in `scripts/acceptWebBrowser.mjs` `execFileSync`.
    - Added path traversal guards in `scripts/recordMatcherBaseline.mjs`.
    - Added `--only-binary :all:` to `pip install semgrep` in `.github/workflows/ci.yml`.
  - Addressed Code Smells:
    - Replaced `isNaN` with `Number.isNaN` and eliminated super-linear regex backtracking in `CloudAndExportModal.tsx`.
    - Removed unused `onOpenCloudConfig` prop from `AuthScreen.tsx`.
    - Adopted optional chaining in `adminService.ts`.
- **Verification**:
  - Full app test suite: **793 / 793 PASS** (100% across all 60 suites).
  - TypeScript: **0 errors** (`npm run typecheck`).
  - ESLint: **0 errors, 0 warnings** (`npm run lint`).
  - Dependency overrides: **7 / 7 PASS** (`npm run test:dependencies`).
- **Release Status**: Draft PR #2 development branch update. Unpatched upstream `node-forge` registry advisory remains active blocker for raw npm audit. Production migration/cutover approval remains required.
