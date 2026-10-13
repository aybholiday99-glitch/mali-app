# Mali — Android-only cloud completion plan — 2026-10-13

This branch is a **release candidate**, not a production release. The Windows Desktop Commander host is offline. This plan avoids waiting for a local workstation by using isolated GitHub runners.

## Verified

- GitHub Linux jobs: TypeScript, lint, application tests (619/619), web build, PostgreSQL 17 with 120 checks and isolated dump/restore, and Semgrep source scan.
- Real headless Chromium loaded the Expo build, entered guest workspace, migrated legacy storage into IndexedDB, stored 1k/10k/50k synthetic transactions, and verified all 50k survived a full page reload: see workflow run 38435029382.
- Supabase production migrations remain at five applied versions. The proposed atomic sync and immutable journal **have not been applied**.

## Cloud Android path

Workflow `.github/workflows/android-acceptance.yml` builds an unsigned debug APK from Expo SDK 57 and launches it on an Ubuntu-hosted Android emulator. See runs 38435753028 and 38438170714; require a successful completed job, a screenshot, and APK artifact before accepting Android. A boot/launch smoke test is **not** a complete financial E2E test. Do not deploy the debug APK as production.

## Platform scope: Android only

The user explicitly excluded iOS on 2026-10-13. Do not run or schedule EAS iOS, macOS Actions, iPhone simulator builds or any iOS-specific test. Previously added iOS configuration is dormant and is **not** an Android release requirement.

## Android build and emulator debugging

An isolated Android debug APK assembled successfully in GitHub Actions run 38438170714; the emulator step initially failed because sdkmanager was not on PATH. A second attempt failed trying to install obsolete SDK package `tools`. The active workflow now locates the SDK tools preinstalled on the runner and invokes the pinned Android emulator action and `scripts/androidSmoke.sh` to start Metro, install and launch the APK, inspect logcat, and capture a screenshot. Follow new run 38441593693; do not claim Android emulator success before it finishes.

## Supabase data safety

- No pre-existing Supabase development branches were found. Creating one may incur extra cost: use `get_cost` and confirmation first. Production financial data should never be copied into an insecure branch.
- Use the disposable PostgreSQL 17 test fixture from CI as the default no-cost option.
- Real production backup and independent restoration proof must precede any migration/deployment. Supabase's read-only SQL/MCP tools do not themselves establish a restorable full production pg_dump. If credentials or downloadable backups are needed, obtain them through an authorized secure process; never commit secrets to git.
- Preserve the 21 orphan legacy records until verified ownership exists. Never guess.
- Disable or rotate unsafe credentials / enable leaked-password protection only after authorized production configuration review.

## Security release gate

- `npm audit --audit-level=high` still fails on `node-forge` GHSA-86w9-cpqp-85rv. The GitHub security advisory lists <=1.4.0 affected and no patched release as of this review.
- A locally backported and hashed vendor copy is verified in tests but is **not** a registry-patched release. Do not suppress the failure or falsify metadata. Investigate eliminating affected build-time consumers or obtain an independently verified upstream patch.
- No production data, live Supabase migrations, main/gh-pages branch, or live credentials have been modified by this plan.

## Acceptance order

1. Obtain passing Android cloud APK and emulator evidence.
2. Verify Android APK installation and actual emulator startup, using screenshots and logcat.
3. Add Android crash/force-stop, background/foreground, offline/reconnect and real financial workflow acceptance cases.
4. Close supply-chain risk with verified fix or explicitly keep the release gate closed.
5. Prove independently restorable production backup, compatibility migration rehearsal, safe cutover/rollback and ownership checks.
6. Obtain explicit production approval, coordinate DB migration and client deployment, smoke-test production. Merge PR #2 only after all required gates are complete.

This plan is a continuation checkpoint, not proof of production readiness.
