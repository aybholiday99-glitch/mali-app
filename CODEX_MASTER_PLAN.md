# Mali production completion plan

Updated 2026-10-13, Africa/Tripoli. Accepted main baseline ac18b18052e67438c1cb92328831186829f45e0b.
Working branch codex/mali-production-audit, draft PR2. Release status NOT READY.
User authorizes routine repairs/tests/PRs/useful parallel worktrees. Protected production
financial/account/credential changes require verified backup and explicit approval.

| Phase | Completed evidence | Remaining |
|---|---|---|
| Discovery | Correct Mali root/origin, live PG17.11 schema/history/settings checked | Complete all-path audit |
| Security | Safe email fixes live; independent RLS CRUD; session/PKCE/export protection | Native secure tokens, old-secret evidence, full ASVS and dependency gate |
| Database |21 exact archive copies; history recorded without replay; tested invoker RPC | Owner-preserving recovery, verified restore, coordinated schema/client cutover |
| Finance | Exact arithmetic/cost/reversal/compound/idempotent form tests | Immutable audit/corrections and complete business acceptance |
| Sync/offline | Atomic CAS, fail-closed reads/cache/session/ack recovery | Reconnect outbox/backoff and conflict-resolution UI |
| Backup/export | Strict financial schemas, escaped HTML/CSV, cache recovery | Independent DB/device restore and native files |
| UI/architecture | Actual local mobile browser tests; testable sync/export/queue/date modules | Expo Router, all controls/native paths/RTL/accessibility/drafts/performance |
| Verification | Isolated engine/provider/auth/SQL/export, pinned CI/Semgrep, PG17 job | Broader E2E/device/performance coverage and supply-chain fixes |
| Release | Draft PR2, main/Pages unchanged | All gates green, review, coordinated cutover, merge/publish and deployed E2E |

Root owns context/auth/UI/test infrastructure/continuity. Financial/sync/export worktrees have separate
file ownership; independent reviewers check integrated source. Continue safe work during external blocks.
Resume from CODEX_HANDOFF and Git, do not restart completed changes. Build/CI alone cannot prove readiness.
