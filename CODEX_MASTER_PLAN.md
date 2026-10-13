# Mali production completion plan

Updated2026-10-13. Resume existing branchcodex/mali-production-audit and draftPR2.
Acceptedmainac18b180 unchanged. NOT PRODUCTION READY; no merge/publish/financial production migrations.
Do not restart completed phases. CODEX_HANDOFF + Git identify current source and owners.

| Phase | Accepted evidence | Remaining |
|---|---|---|
| Finance | Exact minorunits/cost/reversal/compound/idempotency; verified durable serial save and immutable DTO; journal/server append-only validation and read-only history | Native full business acceptance; approved production cutover |
| Auth | PKCE/session generations, exact owner/RLS/SecureStore isolation, redacted errors; safe prior live trigger/settings fixes | Enabled-provider device flows, oldGoogle revocation evidence, HIBP plan |
| Sync | Persistent outbox/exponential backoff/cancel/CAS stop; reviewed explicit conflict resolution; single archive+candidate/outbox commit and unknown-commit fencing | Read-only archive access, native reconnect flows |
| Backup | Strict whole financial data validation; actualPG17 full dump/restore10tables/ACL/RLS/CAS/21+21fixtures; real browser JSON roundtrip | Production backup proof; native files/recovery |
| UI | ExpoRouter protected6screens/deep links/drafts; controls/accessibility18tests; native files/receipts/PDF/OAuth implementation | Independent UI review, bounded10k rendering, Android/iOS functional acceptance |
| Dependencies | Braces removed with actualMetro consumer tests; truthful forgebackport; SDK57 match; officialdecoder compatibility/provenance; Linux consumer testsPASS | Raw audit4high remains mandatoryFAIL until compatible upstream fix |
| Android | Android16 emulator/WHPX + CNG debugAPK built andinstalled; actual coldstartup/guest entryPASS after lifecyclefix | Real financial/receipt/export/PDF/lifecycle/RTL flows ongoing |
| Validation | Latestpushedf7437ca CI511app +100PG17checks +fullrestore/SAST/consumerPASS | Integrated final gates for latest source; audit stillFAIL |
| Release | PR2draft, main/Pages unchanged, both financial migrations unapplied | All gatesgreen, realbackup/ownerproof, approvals, stagedcutover, releaseE2E |

Root coordinates independent reviews and checkpoints. Parallel work: nativeacceptance; bounded
pagination; read-only archived-version retrieval. Separate worktrees and file ownership. Continue
feasible work while external gates remain blocked. Local/mocked proof is never device/live proof.
21null-owneroriginals+21exactarchivecopies and6nullableownercolumns preserved, no owner inference.
