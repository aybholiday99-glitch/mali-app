# Mali production completion plan

Updated 2026-10-13, Africa/Tripoli. Accepted main baseline ac18b18052e67438c1cb92328831186829f45e0b.
Working branch codex/mali-production-audit, draft PR2. Release status NOT READY.
User authorizes routine repairs/tests/PRs/useful parallel worktrees. Protected production
financial/account/credential changes require verified backup and explicit approval.

| Phase | Completed evidence | Remaining |
|---|---|---|
| Discovery | Correct Mali root/origin, live PG17.11 schema/history/settings checked | Complete all-path audit |
| Security | Safe email fixes live; RLS CRUD/session/PKCE/export and secure native-token repairs verified | Native device proof, old-secret evidence, full ASVS and dependency gate |
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
Current source d4bf8be:273tests,83PG17SQL checks, build/type/lint/SASTPASS; CI dependencyFAIL15high.
Register:52findings,37verified locally +4verified live,8open +3externally blocked.
Next implementation phase: durable reconnect retry/backoff, session cancellation and CAS-conflict stop.
Then explicit conflict resolution, immutable history and full backup/device/UI/performance acceptance.

Resume checkpoint: worker/dependency/history candidates integrated through4e40385, with scoped tests and
independent targeted review/repair. Raw audit improved15->4high but remains a mandatory failure. Portable
PG17 enables actual synthetic full restore; Android Studio/SDK installation and WHPX verification progressed.
Continue journal/cache/conflict/native product integration and review; do not redelegate completed fixes.
