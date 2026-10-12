# Mali progress

Updated 2026-10-13. Accepted main baseline: ac18b18052e67438c1cb92328831186829f45e0b.
Validated source candidate: d4bf8bee57379d7bfce722570ec6b5a8a1d4c596.

## Live safeguards

- Verified correct Mali Git root, origin and task branch. Tamwel unchanged.
- Supabase PostgreSQL 17.11: six financial tables FORCE RLS, four owner policies each, anon DML false.
- Removed unsafe automatic-confirmation trigger; legacy function inert/invoker and API execute revoked.
- Separately enabled Auth email confirmations and aligned minimum password length from 6 to 8; read back.
- Reconciled missing hardening history without replaying SQL; removal history version aligned.
- Verified exact archive copies of all 21 null-owner originals. Both sets retained; no owners inferred.
- No production financial records, existing accounts or credentials changed.

## Candidate implementation and independent review

- Exact rational/BigInt money, commission cost conservation, USD personal modes and centralized reversals.
- Atomic compound operations, reference/identity guards, retained-contact/account protection.
- Strict localized numeric input, safe exact previews, stable form submission keys and rejected-field retention.
- Invoker atomic cloud RPC, exact server CAS, owner validation, rollback/pruning and pre-write financial validation.
- Session generations, single PKCE callback, serialized operations, durable dirty revisions and corruption recovery.
- Secure native tokens with verified replacements/migration, exact namespaces and persistent logout revocation.
- Logout failure visible with retry; device configuration saves no longer create fake financial edits.
- HTML/CSP/opener and CSV formula protection; correct contact identity/installment statement matching.
- New vaults empty, destructive demo reset removed; wallet/method/USD selector and receipt/status fixes.
- Independent reviews reproduced and repaired dirty-ack loss, malformed-cache replacement, UTC-month mismatch,
  special SQL dates, orphan PKCE flows/custom-host collisions, and USD/cheque preview rounding differences.

## Verification

- npm test: **273/273 PASS** on source candidate d4bf8be.
- Typecheck, web build, Expo compatibility and iOS/Android config introspection: PASS.
- ESLint: 0 errors, 12 existing warnings. Semgrep: 0 findings/errors, 28 source files scanned.
- Native storage/auth tests: 110 PASS; 568 additional independent SDK grammar probes.
- Financial review: 24 PASS plus actual USD/cheque preview-to-persistence reproduction.
- Actual local browser: mobile 390x844 expense rejection, exact 10.075->10.08, reversal and reload;
  Arabic quantity ٢٫٣ at 1.15 shows 2.65. All records synthetic; no production transaction submitted.
- Previous GitHub bf326dd run38314982309: 145 app tests and 82 PostgreSQL17 SQL tests PASS;
  build/SAST PASS, dependency job FAIL. Latest candidate repeats 273 app tests and 83 PG17 SQL tests.
- Scoped Xcode UUID11.1.1 override removes seven moderate affected paths; actual parser/editor/writer
  and 2,000 generated IDs passed. Audit now 15 high, 0 moderate, from two primary advisories.

Draft PR2: https://github.com/aybholiday99-glitch/mali-app/pull/2.
Final CI results are recorded in CODEX_HANDOFF. No merge, atomic production migration or new Pages publish.
Release remains NOT READY. Full restore, immutable audit, reconnect/conflict workflow, native device builds,
all-control accessibility/RTL/performance acceptance, old credential evidence and remaining dependencies are open.
