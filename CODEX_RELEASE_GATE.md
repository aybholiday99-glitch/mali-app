# Mali release gate

**NOT PRODUCTION READY.** Updated 2026-10-13.
Validated source d4bf8bee57379d7bfce722570ec6b5a8a1d4c596; draft PR2.
Earlier MALI_FINAL_AUDIT/MALI_RELEASE_READINESS completion claims are superseded.

| Required acceptance | Evidence/state |
|---|---|
| No critical/high issue | FAIL: email bypass fixed live; remaining dependency/financial-history/recovery work |
| Reliable auth/data protection | PARTIAL: server identity/PKCE/session/native secure-storage tests pass; actual devices/full E2E remain |
| Correct RLS CRUD | PASS isolated six-table matrix and live catalog; latest validator passed PG17; repeated in candidate CI |
| No exposed secrets; old credentials revoked | PARTIAL: SAST clean; prior Google revocation unproved |
| Accurate finance | PARTIAL: exact cost/reversal/compound/input/quote/idempotency/ref tests; immutable audit/full acceptance missing |
| No loss/duplication; reliable conflict recovery | PARTIAL: CAS/atomic/cache/ack/session tests; durable reconnect worker and usable conflict resolution missing |
| Proven backup/restore | PARTIAL: actualPG17.11 synthetic full dump/restore10tables/owner/RLS/CAS/21legacy copies PASS; production backup/device restore unproved |
| All UI/RTL/accessibility | FAIL: focused browser tests pass; native/routing/all controls/accessibility/performance remain |
| Compatible secure dependencies | FAIL:4high entries/one forge advisory; braces removed, reviewed backport/6consumer tests PASS; raw audit unchanged |
| Mandatory tests and CI | FAIL: GitHub38318773035 app273 andPG17SQL83/build/SASTPASS, dependency gateFAIL15high; broader acceptance incomplete |
| Latest approved production published/tested | FAIL: main/Pages unchanged; PR2 draft, no candidate deployment |
| Critical/high debt closed | FAIL: register tracks outstanding work |

Live changes were limited to unsafe Auth trigger/function, confirmation/password settings and migration-history metadata.
No financial SQL replay, ownership attribution or data deletion. Atomic migration remains unapplied.
Coordinate legacy owner-preserving recovery and new client/schema cutover only after acceptance passes.
No merge/publish with failing or pending gates.

Resumed candidate4e40385 includes the tested durable-worker, dependency replacement/backport and immutable
history candidates. Worker repair review, client journal enrollment, chunked cache integration, usable
conflict resolution and native development-build acceptance remain in progress. Final integrated gates
have not been rerun; this document does not inherit green status from earlier source SHAs.

Remaining advisories: [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
Scoped [UUID repair](https://github.com/advisories/GHSA-w5hq-g745-h8pq) is tested through its actual Xcode consumer.
