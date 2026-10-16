# Mali Android — pre-publication handoff (2026-10-16)

**Status: RELEASE BLOCKED / DEVELOPMENT CANDIDATE ONLY.**
Repository: `aybholiday99-glitch/mali-app`, branch `codex/mali-production-audit`, Draft PR #2.
This document records evidence and a sequence of **future approvals**, not permission to change production.

## Verified live environment (read-only)
- Production Supabase project: `evcwoaerlykghgdevrhb`.
- Five migration versions currently recorded, ending with `20261012221501_remove_unsafe_email_confirmation`.
- Seven `public.mali_*` tables, all with forced RLS. This alone does **not** prove complete two-account isolation of RPC, Storage, admin access, and authenticated user flows.
- **Zero** `public.mali_*` RPC functions. The transactional server-authoritative vault service is therefore not deployed to this production schema.
- **Zero** expected private receipts buckets. Private receipt deployment still pending.
- **21** rows in `public.mali_legacy_unowned_archive`. Do not modify, move, link or delete them as part of a trial.
- Security advisor still warns that leaked-password protection is disabled.
- No Supabase development branches existed at this read-only check. Creating a branch may incur recurring fees and requires separate cost confirmation.

## Candidate verification evidence
- Latest application head before this handoff: `3d229b2`.
- GitHub CI `38822394207`: TypeScript/lint/tests/web build, PostgreSQL isolated RLS and source/secret scan **PASS**, mandatory raw `npm audit --audit-level=high` **FAIL** (GHSA-86w9-cpqp-85rv; four HIGH reported via affected node-forge 1.4.0).
- Registry's node-forge latest published version at this check: `1.4.0`, no official advisory-fixed release. Local patch and exploit regressions remain useful compensating controls but **do not** clear npm audit.
- Separate Android workflow `38808850340` previously passed standalone emulator smoke. The AOSP workflow `38808850428` built and signed an **isolated test-signed APK**, then the emulator package manager returned `Broken pipe (32)` during install. This is not a proven APK defect; the stricter smoke script now waits for PackageManager, retries **only once** after a transport error, and fails closed for invalid APK, missing installation or bad launch. Fresh CI on the updated head must verify it.
- The standalone candidate is test-signed, **not** a production-signed customer release. Real device OAuth, security and offline behavior must be verified before customer release.

## Order of work to reach the publishing decision

1. **Source/CI:** Clean install, maintain full unit/integration and PostgreSQL isolated tests, security provenance, web/browser test, both Android candidate workflows, and signature checks. Reject unexplained failures. Publish only a test artifact to CI, not to the public.
2. **Registry security:** Require `npm audit --audit-level=high` to pass without a deceptive alias, omitted scanner, or forced incompatible Expo downgrade. Independently test signed certificate/CSR and RSA forgery attacks.
3. **Isolated Supabase rehearsal:** On a dedicated, approved development environment, apply each pending schema, central vault, RBAC and private receipt migration. Create two *synthetic* real Supabase Auth users. Prove deny-by-default anonymous access, user A cannot read/write/list B's rows/receipts, owner admin RBAC, CAS/idempotency atomicity, receipt upload MIME/size and expiry controls, login/logout/account switching, and no cross-account data.
4. **Backups and migration:** Take and independently restore a verifiable production backup; inventory all existing local vaults and unowned archive records; validate ownership, counts and checksums. Test legacy-to-central migration, recovery and rollback without data loss. Ensure old mobile clients cannot continue diverging financial writes during cutover. **No existing phone data may be deleted until an approved, independently verified server migration.**
5. **Central-only mode:** After central services are proven available and existing customers are migrated, enable `EXPO_PUBLIC_MALI_CENTRAL_ONLY=true` in the approved build. Recheck that no durable financial payloads, receipts, reports or outboxes remain on customer devices; session tokens and transient RAM/OS caches remain a distinct issue. Current default flag is false and **must not be represented as compliant with central-only storage**.
6. **Device acceptance:** Test the installable candidate on a physical Android phone with properly configured Google/Facebook sign-in, standard and denied permissions, resume/restart, offline lock, upgrade from legacy device vault, Arabic RTL, 2+ device sizes and account switching. Archive evidence, APK checksum and signing certificate identity.
7. **Final sign-off:** Obtain explicit owner confirmation for paid staging (if any), verified backup/maintenance window and production migrations, PR merge, production signing credentials, and publication. Each permission is separate; no approval is implied by the request to prepare for release.

## Current approval / blocker matrix

| Item | State |
|---|---|
| Candidate code and tests | Subject to latest PR CI |
| Native emulator validation | Prior successful run; fresh retry-protected AOSP run pending |
| Published node-forge security fix / green raw audit | BLOCKED |
| Nonproduction isolated cloud end-to-end rehearsal | NOT DONE |
| Production central vault and private receipts | NOT DEPLOYED |
| Verified production backup and real ownership cutover | NOT APPROVED |
| Physical Android sign-in and upgrade proof | NOT DONE |
| Owner authorization for production migrations/merge/publication | NOT GRANTED |

Never upgrade the above entries based on simulated tests or assumptions; link to independent evidence first.
