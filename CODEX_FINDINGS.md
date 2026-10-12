# Mali findings

Updated 2026-10-13. VERIFIED_LOCAL = repaired/reviewed on the candidate, not deployed.
VERIFIED_LIVE = named production repair read back. OPEN = work required.
BLOCKED = external evidence or compatible upstream fix required.
The register covers inspected paths; full application acceptance remains incomplete.

| ID | Severity | Finding / impact | Status, evidence and remaining action |
|---|---|---|---|
| SEC-101 | Critical | Auth trigger bypassed email ownership | VERIFIED_LIVE: trigger absent; legacy function inert/invoker, API execute revoked |
| SEC-102 | High | Auth service independently enabled mailer_autoconfirm | VERIFIED_LIVE: minimal CLI config enabled confirmations; settings false |
| SEC-103 | Medium | Server minimum password6 contradicted client8 | VERIFIED_LIVE: minimal CLI diff6->8; subsequent diff empty |
| QA-101 | High | Two tests and CI wrote users/rows into production | VERIFIED_LOCAL: removed; synthetic memory/loopback suites reject production endpoints |
| DB-101 | High | Hardening migration absent from live history | VERIFIED_LIVE: exact source recorded without replaying financial SQL; removal version aligned |
| DB-102 | High | Six nullable owner columns and21 null-owner originals remain | OPEN:21 exact archive copies verified; preserve both sets pending backup and owner evidence |
| FIN-101 | High | Personal USD take accepted LYD destination | VERIFIED_LOCAL: USD-only engine/context/form, retained/same-source/transferred cases |
| FIN-102 | High | Personal reversal credited wrong balances | VERIFIED_LOCAL: centralized engine reversal for all target modes |
| FIN-103 | High | Float arithmetic lost cents | VERIFIED_LOCAL: rational BigInt/minor units, bounds and80 oracle combinations |
| FIN-104 | High | Rounded effective rate lost commission cost | VERIFIED_LOCAL: original cost allocation, residual final sale, zero personal profit |
| FIN-105 | High | Duplicate IDs/reference deletion/initial debt reversal corrupted balances | VERIFIED_LOCAL: independent ID checks, retained account protection, exact debt/installment reversal |
| FIN-106 | High | Compound purchase/sale partially persisted or silently clamped | VERIFIED_LOCAL: one mutation, all state/contacts rolled back on rejection |
| FIN-107 | High | Context accepted invalid fees/commissions | VERIFIED_LOCAL: raw finite checks and independent minor-unit rounding, actual-provider tests |
| FIN-108 | High | Forms omitted supported idempotency keys | VERIFIED_LOCAL:9 call sites; actual expense and independently rendered transfer replay |
| FIN-109 | Medium | UTC monthly totals differed from Libya ledger date | VERIFIED_LOCAL: shared Africa/Tripoli date, actual summary rollover regression |
| FIN-110 | High | Deletions/manual balances lack immutable financial audit | OPEN: audited correction/reversal workflow; never silently rewrite real history |
| SYNC-101 | High | Separate table writes could report partial success | VERIFIED_LOCAL: invoker RPC transaction, rollback/cleanup/projections; NOT applied live |
| SYNC-102 | High | Forced/stale pushes overwrote another device | VERIFIED_LOCAL: exact CAS + owner lock; force bypass removed |
| SYNC-103 | High | Guest/mismatched user accepted; failed reads looked empty | VERIFIED_LOCAL: server getUser/owner checks before/after; all reads fail closed |
| SYNC-104 | High | Old upload acknowledgement could discard newer edits | VERIFIED_LOCAL: persisted dirty/revision markers and actual relogin failure test |
| SYNC-105 | High | Corrupt/unreadable cache overwritten by blank edits | VERIFIED_LOCAL: raw validation/recovery copy/write fence, malformed/read-error tests |
| SYNC-106 | Medium | Confirmed empty cloud retained obsolete baseline | VERIFIED_LOCAL: baseline cleared and persisted in login/manual paths |
| SYNC-107 | High | No durable reconnect outbox/retry worker | OPEN: data preserved, but scheduling/backoff and lifecycle recovery remain |
| SYNC-108 | Medium | Conflicts fenced without usable resolution | OPEN: inspectable owner-preserving conflict recovery workflow |
| SYNC-109 | Medium | Cloud config saves marked clean vault dirty; empty pull could replace corrupt main cache; changed-server push reused old CAS | VERIFIED_LOCAL: metadata-only durable settings, recovery guard and normalized Push; actual UI/provider independent12PASS |
| AUTH-101 | High | Late bootstrap/pull/mutations resurrected wrong session | VERIFIED_LOCAL: generations/render-bound mutators/hydration/queues; logout and A->B->A tests |
| AUTH-102 | High | Duplicate PKCE callbacks and logout/login races | VERIFIED_LOCAL: single callback owner, serialized auth, error propagation; real-service tests |
| AUTH-103 | High | Native tokens in AsyncStorage | VERIFIED_LOCAL: SecureStore57.0.4, verified chunk/head replacement and lossless migration, independent110PASS; actual devices remain an acceptance gate |
| AUTH-104 | High | Old Google secret revocation unproved | BLOCKED: disabled provider is not revocation proof; obtain credential-owner evidence |
| AUTH-105 | Medium | Leaked-password protection disabled | BLOCKED: plan/availability evidence required; no billing changes |
| AUTH-106 | High | New secure adapter lost ownership of an interrupted pre-index PKCE verifier on restart | VERIFIED_LOCAL: namespace epoch + durable logout fence; restart/orphan/recovery proofs independentlyPASS |
| AUTH-107 | Medium | New secure adapter broad prefixes overlapped custom-project token keys | VERIFIED_LOCAL: separate physical namespaces, exact SDK grammar, preserve ambiguous session-shaped suffix credentials; independent568grammar probesPASS |
| AUTH-108 | Medium | Logout credential cleanup failure silently ignored; user could not retry | VERIFIED_LOCAL: visible error/retry on Auth screen, original config retained, late identity fenced; actual provider test/review |
| BACKUP-101 | High | Shallow schemas allowed corrupt backups/cloud vaults | VERIFIED_LOCAL: nested financial/reference validation and recovery regressions |
| BACKUP-102 | High | Independent production backup/restore unproved | OPEN: full isolated restore rehearsal; local Docker Linux daemon unavailable |
| EXPORT-101 | High | Untrusted strings executed in print HTML | VERIFIED_LOCAL: escaped builders/CSP/detached opener and malicious-content tests |
| EXPORT-102 | Medium | CSV broken quoting/formula injection | VERIFIED_LOCAL: universal quoting/formula neutralization, numeric money retained |
| EXPORT-103 | Medium | Contact IDs/installments confused statements | VERIFIED_LOCAL: explicit ID precedence/shared matching, installments once |
| UI-101 | Medium | Failure cleared forms; debt wallet/method and USD holding choices absent | VERIFIED_LOCAL: boolean acknowledgements, preserved fields and explicit selectors/errors |
| UI-102 | Medium | New vault uploaded demo balances/destructive reset | VERIFIED_LOCAL: empty new vaults; demo reset removed |
| UI-103 | Medium | Header claimed connection from config; receipt index invalid | VERIFIED_LOCAL: neutral status/local failure feedback, bounded image index |
| SQL-101 | High | RPC accepted financially invalid snapshots | VERIFIED_LOCAL: complete nested/range/precision/reference/derived/journal checks before writes;67 SQL tests |
| SQL-102 | Medium | PostgreSQL special dates accepted but client rejected | VERIFIED_LOCAL: finite absolute calendar/RFC3339 dates; independent repair review67PASS; PG17 CI67PASS |
| PRODUCT-101 | Medium | Native receipts/export/OAuth incomplete or unverified | OPEN: implement remaining paths and test signed development builds/devices |
| UX-101 | Medium | Routing/drafts/accessibility/RTL/performance coverage incomplete | OPEN: Expo Router as repository requires, all controls and large-data acceptance |
| DEP-101 | High | Initially22 affected packages; now15high/0moderate | BLOCKED: two primary advisories braces/forge remain in published compatible versions; no downgrade or suppression |
| DEP-102 | Medium | Xcode transitive UUID vulnerable in7 moderate package paths | VERIFIED_LOCAL: scoped uuid11.1.1 override; actual Xcode parse/edit/write/2000IDs and bounds regression4PASS; Expo native config introspectionPASS |
| OPS-101 | Medium | Monitoring/redaction/alerts not comprehensively proved | OPEN: safe diagnostics, recovery alerts and measured performance |

No production financial record, archive owner, existing account or credential was changed.
Final additional repairs:

| ID | Severity | Finding / impact | Status and evidence |
|---|---|---|---|
| FIN-111 | High | parseFloat accepted partial numbers and grouped1000 as1; invalid fees defaulted0 | VERIFIED_LOCAL: strict localized whole-string parser, malformed amounts/fees rejected, optional blanks explicit; actual forms checked |
| FIN-112 | Medium | Market settings could persist invalid rates/discounts | VERIFIED_LOCAL: central atomic domain validation, supported bounds and exact4decimal rates; regressionPASS |
| FIN-113 | High | Contacts could collide, change identity or be deleted despite financial references | VERIFIED_LOCAL: stable unique IDs, immutable identity/date, retained-reference deletion guard and backup duplicate/orphan rejection; independentPASS |
| FIN-114 | Medium | UI decimal products/rounded-percent quotes disagreed with persisted cents/costs | VERIFIED_LOCAL: shared operand-based product/sum/ratio/cost quotes; actual USD2.65 and cheque123.45 parity; independent24PASS |

No ownership inference for21 legacy records. Local verification does not mean production completion.
