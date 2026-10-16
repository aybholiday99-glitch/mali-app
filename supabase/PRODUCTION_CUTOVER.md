# Database cutover and recovery

Never reset the linked database or replay migrations that archive existing rows.
Read-only reconciliation on 2026-10-12 proved all 21 unowned rows have exact archive copies.
The original rows still exist behind owner RLS; the archive has no API grants.
Ownership remains unknown. Neither set was modified by this audit.

The missing security_rls_hardening history entry was recorded without re-executing its SQL.
remove_unsafe_email_confirmation was applied and its history aligned to the local ordered filename.
Auth email confirmations were separately enabled through a one-property CLI config diff/push.
Minimum password length was aligned to8 with another minimal diff and verified after propagation.
Existing user records and credentials were not changed.

## Atomic sync migration

20261012221600_atomic_vault_sync.sql is tested locally and in CI before production application.
It adds nullable sync_payload columns, an invoker RPC and a write guard on six tables.
Applying it blocks old clients' direct financial writes; deploy the new client as a coordinated cutover.
Do not apply or publish the client while the release gate is failing.

Existing authenticated relational-only vaults can be read for recovery/export, but cannot initialize
a snapshot through this RPC. They need an explicit, verified owner-preserving migration and backup.
No automatic attribution or replacement of legacy financial data is allowed.

The transaction-local write guard protects API roles. Trusted SQL administrators can set GUCs;
RLS remains the ownership boundary. There is no exposed arbitrary-SQL/GUC RPC in this schema.

An interrupted commit retries safely: a stale baseline returns a conflict; read and compare the
committed snapshot before adopting its server timestamp. It never replays incremental balance deltas.

## Outstanding release evidence

Provider/session and SQL tests use isolated synthetic records. Local SQL rehearsal uses PGlite
(PostgreSQL 18); CI repeats the migration/RLS/RPC suite on PostgreSQL 17 matching production's major.
A production backup exists only as a prior claim until independent restore verification is completed.
No destructive production action is authorized without verified backup and explicit approval.
