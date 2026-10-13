# Mali release gate

**NOT PRODUCTION READY.** Updated 2026-10-13. Draft PR2; main/Pages unchanged.
Earlier MALI_FINAL_AUDIT/MALI_RELEASE_READINESS completion claims are superseded.
Each source needs its own validation; prior CI is not the final integrated gate.

| Required acceptance | Current evidence / remaining requirement |
|---|---|
| No critical/high issue | FAIL: upstream dependency gate and sensitive production acceptance remain |
| Reliable auth/data protection | PARTIAL: owner/PKCE/session/SecureStore/native OAuth/generation tests PASS; real device/provider flows remain |
| Correct RLS CRUD | PASS isolated PG17 six-table CRUD, full nested financial SQL validation and ownership-safe full restore |
| No exposed secrets; old credentials revoked | PARTIAL: SAST/redaction/provenance PASS; Google credential revocation unproved |
| Accurate finance/immutable evidence | PASS candidate exact money/cost/reversal/compound/audit/client/history regressions; production cutover unapproved |
| Durable local acknowledgement | PASS independent serial verified candidate/outbox, immutable inputs/exact failed retry; native fault acceptance remains |
| Reconnect/backoff/cancellation | PASS candidate durable owner outbox/timers/session/CAS stops and chunked integration; native E2E remains |
| Usable conflict recovery | PARTIAL: verified archive+single decision/outbox commit, changed CAS renewed review/no force,13provider+3UI tests PASS; independent review pending |
| Proven backup/restore | PARTIAL: actual PG17 full dump/restore10tables/owner/ACL/RLS/CAS/21originals+21archives PASS local+CI; atomic local restore faults PASS; production backup/native round-trip remain |
| All UI/RTL/accessibility/performance | PARTIAL: actual Router/deep links/protection/drafts PASS; semantic-control repair/large-data/native acceptance ongoing |
| Compatible secure dependencies | FAIL: braces absent and Expo57 consumers PASS; truthful forge1.4.0 backport does not clear raw audit4high/0moderate |
| Mandatory tests and CI | FAIL: pushed6b79ee0 CI38328473640 app392/PG17/full restore/SAST/consumer PASS, raw audit FAIL; final candidate CI required |
| Android acceptance | PENDING: booted Android16 emulator; JDK21 fixed prefab configure, cached CNG debug C++ build ongoing |
| iOS acceptance | PENDING: Windows lacks Xcode/iOS device; external hardware required |
| Approved production published/tested | FAIL: PR2 draft; no merge/publication/financial migration deployment |

Earlier live changes only repaired unsafe Auth trigger/function, confirmation/password settings
and migration-history metadata. No financial SQL replay/owner inference/data deletion.
21null-owner originals and21 exact archive copies preserved;6nullable owner columns unresolved.
Both ordered atomic and immutable-history migrations remain unapplied to production.
Remaining registry advisory: [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
Historical [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) is closed on candidate.
No merge/publish/cutover with failing or pending gates. Sensitive production actions require
successful acceptance, proven production backup/data safety and explicit user approval.
