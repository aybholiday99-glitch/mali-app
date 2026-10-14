# Mali release gate

**ANDROID-ONLY RELEASE CANDIDATE — NOT PRODUCTION READY.** Updated 2026-10-13. Draft PR2; main/Pages unchanged. The owner explicitly excludes iOS from the current release scope.
Earlier MALI_FINAL_AUDIT/MALI_RELEASE_READINESS completion claims are superseded.
Each source needs its own validation; prior CI is not the final integrated gate.

| Required acceptance | Current evidence / remaining requirement |
|---|---|
| No critical/high issue | FAIL: upstream dependency gate and sensitive production acceptance remain |
| Reliable auth/data protection | PARTIAL: owner/PKCE/session/SecureStore/native OAuth/generation tests PASS; system owner admin dashboard (RBAC) & offline mutation blocking verified; real device/provider flows remain |
| Correct RLS CRUD | PASS isolated PG17 six-table CRUD, full nested financial SQL validation and ownership-safe full restore |
| No exposed secrets; old credentials revoked | PARTIAL: SAST/redaction/provenance PASS; Google credential revocation unproved |
| Accurate finance/immutable evidence | PASS candidate exact money/cost/reversal/compound/audit/client/history regressions; production cutover unapproved |
| Durable local acknowledgement | PASS independent serial verified candidate/outbox, immutable inputs/exact failed retry; native fault acceptance remains |
| Reconnect/backoff/cancellation | PASS candidate durable owner outbox/timers/session/CAS stops and chunked integration; offline banner and write guard verified |
| Usable conflict recovery | PARTIAL: verified archive+single decision/outbox commit, changed CAS renewed review/no force,independent review8probes PASS atd2db769; archive retrieval UI ongoing |
| Proven backup/restore | PARTIAL: safe legacy migration wizard with SHA-256 checksum & atomic cloud sync PASS (5/5 tests); actual PG17 full dump/restore 10 tables/owner/ACL/RLS/CAS/21originals+21archives PASS local+CI; atomic local restore faults PASS; browser actual JSON download/explicit restore PASS; production backup/native round-trip remain |
| All UI/RTL/accessibility/performance | PARTIAL: real Chromium 2026-10-13 verified UI mount, offline guest navigation, lossless IndexedDB migration, 1k/10k/50k record persistence and 50k full reload; accessibility/RTL source tests pass (10/10 PASS with 48dp bounds); Unified Financial Profiles dossier & dual-mode contact picker integrated; every screen and fault-path on physical devices still requires acceptance |
| Compatible secure dependencies | FAIL: braces absent and Expo57 consumers PASS; truthful forge1.4.0 backport passes all security/consumer tests but raw audit reports 4 high due to unreleased upstream fix |
| Mandatory tests and CI | PARTIAL: 649/649 app tests PASS (100% across all 58 test files), PostgreSQL 17.11 120/120 PASS, real browser storage/guest acceptance PASS, dump/restore rehearsal PASS, web build PASS; unpatched node-forge advisory keeps npm audit and aggregate CI FAIL |
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
