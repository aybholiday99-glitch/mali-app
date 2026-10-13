# Mali — direct repair handoff (2026-10-13)

## Scope and provenance
These fixes were authored directly through the connected GitHub repository tools because the authorized Windows Desktop Commander device was **offline**. No AntiGravity sub-agents were launched in this repair session. Existing `MULTI_AGENT_STATUS.md` records six `self` roles, not evidence of six independent sessions.

## Actual changes
- `src/services/financialEngine.ts`: exact `transactionId` / `installmentId` / `debtId` / account / amount / currency matching on installment reversal, including the direct transaction-delete entry point. Refuse unsupported cash reversals when legacy cash has an account reference but no supporting journal. Refuse contradictory non-cash journal references.
- `supabase/migrations/20261012221600_atomic_vault_sync.sql`: explicit modern `cash` and `non_cash` settlement validation; non-cash requires `isNonCash:true`, a substantive `nonCashReason`, no treasury account and no cash journal; cash requires treasury and linked transaction. Legacy records without `settlementType` retain the original backwards-compatible path; malformed overdraft metadata is rejected.
- `src/services/financialEngine.ts` backup validation: apply equivalent contract on imported JSON financial data and verify linked cash transaction currency.
- Regression tests in `tests/debtTreasuryIntegration.test.mjs`, `tests/financialSqlValidation.test.mjs`, and `tests/financialEngine.regression.test.mjs`.

## Evidence and release blockers
- PostgreSQL 17 regression on the prior integrated commit: **16/16 RLS, 87/87 SQL validation, 17/17 audit = 120/120 passing**, including new non-cash negative cases.
- Full workflow on each later commit must be checked individually; **do not claim green CI until the head SHA is checked**.
- Upstream GitHub advisory GHSA-86w9-cpqp-85rv lists `node-forge <=1.4.0` with **no patched version** at the last search. Existing vendor backport tests do not make `npm audit --audit-level=high` green. Do not hide/override audit errors to claim production readiness.
- Required real-device acceptance, real-browser IndexedDB stress/fault tests and production backup/restoration remain unverified in this direct session due to disconnected device and missing production approval.
- Both atomic sync and immutable financial history migrations remain **unapplied on production Supabase**. No production data, credentials, ownership or permissions were changed.
- Main/Pages must remain unchanged; PR #2 stays draft until release gate passes.

## Follow-up
Run CI for the latest SHA; inspect failures and address code regressions. Reconnect an authorized computer for browser/Android E2E, prove production backup restore in isolation, resolve the real `node-forge` dependency risk, validate the planned SQL migrations on isolated PostgreSQL with legacy data, and obtain explicit approval before any production cutover.
