# MALI — centrally owned customer financial data / Android server-authoritative migration

Decision (owner request): **All durable customer financial records belong in the centrally administered backend, NOT on customer devices.** The supported mobile mode will be **online-required, authenticated, server-authoritative**. This supersedes the previously documented offline-first behavior, but does not authorize deleting any customer files or applying production migrations.

## Source audit (2026-10-13)
- Today, `src/services/financialStorage.ts` persists Android finance to AsyncStorage (with chunking, checkpoint and recovery). `MaliContext.tsx` writes financial state/outbox on device, then synchronizes opportunistically. `AuthScreen.tsx` offers a local guest mode. The current APKs are NOT compliant with the new owner requirement.
- `src/services/supabaseSyncCore.ts` already has an ownership-verified cloud pull and `mali_sync_vault` atomic compare-and-swap RPC, but this RPC is pending deployment (production migrations end at `20261012221501_remove_unsafe_email_confirmation`).
- Sensitive receipt images/backup exports can be written locally by app flows; their migration and secure serving must be completed before the no-device-data promise can be made.
- `src/services/centralVaultSession.ts` and its Node tests implement the new online-only core. `MaliContext.tsx` now contains an **opt-in feature-flagged** integration: authenticated remote-first login, server ACK before publishing updates, no new financial cache/outbox writes, and a migration stop if legacy device records exist. `AuthScreen` hides guest login and customer-managed cloud settings in this mode; `exportHelper` blocks customer-side file export/print. It is **NOT ENABLED in the shipped Android builds**.

## Target data flows
1. Customer signs up/signs in via Supabase Auth. Do not issue local guest sessions. Keep only a minimal refresh/session token in platform-secured auth storage; do not persist financial payloads, reports, photos or cloud mutation outboxes on Android.
2. Server validates JWT and user identity for every fetch/write. Browser and Android use only the public anon/publishable key and user access token. **Never embed the service-role key, DB password, or cross-customer admin credentials in APK.**
3. Login performs a server read. Only verified data is rendered; remote unavailable -> read/update blocked, explain internet required. No cached offline fallback for financial values.
4. Financial mutations must commit atomically on server, with ownership checks, immutable audit trail, optimistic concurrency/CAS or idempotency keys. Client treats a request as complete **only after a verifiable server ACK**. Timeout or conflict -> read-only until authoritative refresh; never retry an uncertain write as a new operation ID.
5. Server returns only the authenticated customer's records via strict RLS/tenant membership. An owner/admin portal with MFA may view permitted customers through server-side RBAC and audited queries; cross-customer access is **never** obtained by disabling RLS for mobile clients.
6. Attachments and receipts upload to **private** Supabase Storage buckets with tenant-scoped object policies, short-lived signed URLs and retention policy. The device may transiently hold image data to upload/render, but should not persist financial files. Block unguarded local export/share features until owner explicitly enables them with clear warnings.
7. Production encryption in transit + at rest, least-privilege admin access, backup retention, recovery drills and audit of accesses.

## Existing customers: migration MUST precede deletion
- Preserve existing chunked/legacy local snapshots and pending outboxes in their current installations. Do **not** auto-delete or abandon them.
- Obtain verified owner authentication, enumerate legacy state safely, validate original owner, obtain any user consent required for transfer, upload with idempotency/CAS to a migration endpoint, verify counts/hashes/server immutability, create a separate restorable server backup, and only then schedule device-data cleanup in a later separately approved update.
- If migration fails, block writes and show recovery guidance. Do not silently start a second fresh vault or overwrite a cloud vault.
- Old device clients cannot be remotely guaranteed to stop persisting until upgraded. A coordinated server/API minimum version gate is needed.

## Release gates: do not deploy before all pass
- [ ] Complete/test the feature-flagged central-only provider and safely enable `EXPO_PUBLIC_MALI_CENTRAL_ONLY=true` **only after** legacy migration, server RPC and private media are validated. The current integration still reads *old* on-device data to detect migration requirements, never deletes it, and blocks customers until migrated.
- [ ] Disable guest UI and serverless finance actions on Android; enforce authenticated online session on routes and API.
- [ ] Replace automatic async push with direct authenticated RPC ACK prior to UI success; test concurrent devices, network loss, duplicate replay and session switch.
- [ ] Audit third-party SDKs (logs, crash reporters, analytics), Android backup policy, screenshots, and OS-managed caching for financial data.
- [ ] Deploy and validate atomic financial SQL/RLS migration to a **separate environment first**; independently restore a verified production backup before any production change.
- [ ] Build owner-only audited admin dashboard; validate no ordinary customer can fetch another customer's data.
- [ ] Verify account creation, real-device login, remote-only finance CRUD, data retrieval on fresh second phone, reinstall behavior, photo upload and backup restoration.
- [ ] Resolve `node-forge` security gate and native Android candidate tests; sign production Android APK with stable protected keystore only at approved release.
- [ ] Notify affected customers of the changed storage model, privacy controls and online-only requirement; obtain any necessary contractual/regulatory review.

## Security/operational caution
A phone necessarily receives displayed data in **RAM**, an authenticated session token (platform storage) and transient OS/network caches. "No data stored on device" is correctly implemented as **no persistent local financial database, documents or recovery copies after verified legacy migration**; a mathematical guarantee of zero physical bytes ever touching a customer phone is not possible.

Current release status: **NON-COMPLIANT, NOT PRODUCTION-READY, NO CUSTOMER MIGRATION PERFORMED.** No live Supabase migration or legacy cleanup is authorized by this document.
