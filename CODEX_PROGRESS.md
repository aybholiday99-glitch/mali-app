# Mali progress

Updated 2026-10-13. Accepted main baseline: ac18b18052e67438c1cb92328831186829f45e0b.
Earlier fully validated source: d4bf8bee57379d7bfce722570ec6b5a8a1d4c596; current phased integration follows below.

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
GitHub run38318773035 at3386818:273app tests and83PG17SQL tests PASS; build/SASTPASS;
dependency gateFAIL15high. No merge, atomic production migration or new Pages publish.
Release remains NOT READY. Full restore, immutable audit, reconnect/conflict workflow, native device builds,
all-control accessibility/RTL/performance acceptance, old credential evidence and remaining dependencies are open.

## Resumed execution, 2026-10-13

- Reconciled c829fa40f6d1910153041fd8e094838b44d3a053 on codex/mali-production-audit; tracked tree clean.
- SYNC-107 implementation owns the new mali-durable-retry worktree from that SHA: durable pending vault,
  bounded backoff, lifecycle/session cancellation and persisted CAS stop. Independent review follows tests.
- DEP-101 research owns mali-dependency-remediation with a private dependency installation. No npm audit
  filter, forced SDK downgrade or advisory suppression is allowed. Integration follows the worker test gate.
- FIN-110 design/review owns mali-immutable-audit. No edits to accepted financial history or production.
- Root owns continuity, independent integration review, conflict UX and isolated backup/restore rehearsal.
- No adb/EAS executable or attached native test device was found. Existing release ZIPs are older web/source
  artifacts, not Android/iOS build evidence. Native device acceptance remains pending.

### Resumed phase evidence

- Integrated durable worker8e4f6c7 (source8ca9a75):55 focused checks PASS. Independent review found a P2
  false success when configuration changed before sending. Targeted repair4e40385 (source964267f)
  passes17 worker checks; independent repair review pending. No payload was lost by that defect.
- Integrated dependency88baa1a (source2daf1c5): braces chain removed; original forge1.4.0 identity retained
  with reviewable pinned RSA backport. Clean npm ci, integrity gate and6 actual-consumer checks PASS.
  Raw audit remains FAIL4high/0moderate, one primary forge advisory; no filters/version inflation.
- Integrated immutable-history candidate408958b (source0db2fe3): owner-only immutable server journal,
  dedicated restricted writer and exact client evidence validation. Client Context/sync/export enrollment
  is not yet integrated. Agent verified84 SQL checks on actual isolated PostgreSQL17.11 and39 client checks.
- Root installed official portable PostgreSQL17.11 and ran actual pg_dump/pg_restore independently:
 10 tables,21 synthetic null-owner originals+21 exact archive rows, data/history/functions/ownership/
  grants/policies/triggers/constraints equality and post-restore owner isolation/CAS/source preservation PASS.
  This is a candidate synthetic rehearsal, not evidence of a restored production backup.
- Root chunked cache candidate11 tests PASS; independent review found and root repaired shared-adapter
  concurrency and stale legacy fallback after a missing head. Re-review pending; Context still uses its
  safe1.8MB native entry guard until integration. Plugin config raises native SQLite capacity through CNG.
- Android Studio2026.2.1.8 portable and command-line tools downloaded from Google with official SHA256
  verification. Emulator37.2.12 reports WHPX installed and usable. SDK/system-image installation ongoing;
  no Android application build/test has been claimed. PRODUCT-101 native picker/export candidate in progress.
- Current integration HEAD4e403852bc1d61a2b2ad1ae680e034c094b37289; root-owned storage/CI/rehearsal/continuity
  changes remain uncommitted until scoped validation. Production/main/Pages remain untouched.

### Journal/cache/native checkpoint

- Worker repair independently56checks/probes PASS. Chunked storage integrated into owner cache/recovery;
  dual-slot verified commits, enrollment fence, tail pruning and cold recovery copies preserve corrupt
  originals and complete supplied backup evidence. Client journal accompanies mutations/cloud/JSON.
- Compatible same-owner imports retain exact deleted history; divergent/foreign journals archived before
  rebasing. All retained compound keys reject replay. Independent four actual-provider repair probes PASS.
- Focused native/journal/cache/provider61tests PASS; typecheck PASS; scoped lint0errors/3existingwarnings.
- Native receipt/files/PDF5512e12 integrated; awaited export feedback reports share/download initiation.
- Android16 AVD boot complete; ADB emulator-5554 ready. Actual APK/native acceptance next.
- GitHub2f61437 PG17 SQL/full real restore and SAST PASS. Linux Metro baseline correctedc5079a5;
  mandatory audit remains FAIL4high. New Router/native dependencies being qualified.
- Further review exposed pre-durability success: async mutation/uncertain retry/form preservation OPEN.

- Native OAuth6d64bc3 integrated: exact mali://auth/callback, secure S256 PKCE bridge, owned browser code
  exchange, server user/session proof, cancellation and redacted failures;134agent-focused tests PASS.
  Root source review and45new-native/consumer dependency checks PASS; real provider/deep-link proof pending.
- Added matching Expo57 Router/native system UI dependencies and pinned reanimated4.5.1/worklets0.10.1
  from bundled compatibility map. Official fixed decoder0.5.0 is ESM, incompatible with actual query-string7.
  Module-format-only CJS conversion preserves the exact official fixed algorithm and archive/license;
  mandatory provenance gate qualifies all copies/consumer source, actual Arabic/PKCE/array/malformed input
  tests PASS. Clean npm ci --ignore-scripts PASS; raw audit still4high/0moderate, forge advisory unchanged.
- Native CNG config defines candidate com.aybholiday.mali /scheme mali, image-picker purpose strings and
  microphone removal; sharing/webbrowser/storage plugins. No native source manually edited or publication.

- GitHub run38328473640 at6b79ee0:392app tests/types/lint/Expo/web build PASS; actualPG17 RLS16 +financial
  validation67 and full real restore PASS; SAST PASS; supply integrity/consumer tests PASS on Linux.
  Raw npm audit FAIL4high is the only failure in that checkpoint, no audit suppression.
- Added read-only financial history UI: retained event/reversal descriptions and device timestamps are
  separate from owner-filtered, before/after authenticated server acceptance timestamps. Keyset pages
  omit financial image payloads, reject foreign/malformed rows, cancel late owner responses and redact
  remote errors. Focused actual panel/reader/existing Cloud UI10tests PASS; actualPG17 audit17PASS.
  CI now explicitly repeats immutable audit17 against PG17 rather than only in-memory SQL emulation.

- Pure conflict preparation integratedf21e0f3 (sourcecd04606):48new cases/71focused PASS, exact CAS/session/
  owner/config review, full original/pending/attempted/latest/fresh evidence, audited keep-local rebase,
  exact cloud adoption and renewed review on changed CAS. Provider locking/archive/UI integration pending.
- Root support diagnostics use explicit nonfinancial metadata/count allowlist, and transport/Auth/UI error
  messages no longer echo remote payloads. Typed sync failure categories remain intact.63focused actual
  auth/sync/worker/screen/native checks PASS; no remote monitoring service or sensitive logging added.

- Independent support/reader review caught permissive Date.parse accepting private date comments;
  strict calendar-valid absolute timestamp repair and explicit7-field server projection PASS13tests,
  independent original exploit/calendar/extra-field probes,30+1pagination/owner/unmount tests.
  Official decoder identity/archive/license/exact one-export substitution reviewed independently;
  363 malformed/Arabic/emoji/query comparisons through actual Router equal official ESM0.5.0.
- Added user-selected JSON file restore via already-installed Expo57 File.pickFileAsync typed result;
  selection alone never changes a vault, safe length checked before/after read, explicit confirmation
  preserves source/original evidence. No giant file is bound into a native TextInput.18focused tests PASS;
  real Android file picker/round-trip still pending. No new native dependency or production request.
- Expo Router06af396 integrated (source5dbdba8): six protected routed screens, one persistent provider,
  native/web back/deep-link/base paths, retained Auth form and no second OAuth exchange. Agent398tests/
  type/lint/web build PASS; local Android CNG debug build in progress, final primary integration pending.

- Prepared local Pages SPA404 fallback from the exact built Router entry with no URL/query/hash redirect,
  preserving deep links/OAuth and protected route checks.7actual Router/fallback checks PASS; this only
  creates build artifacts and does not deploy. Local preview supports direct routed paths.

- Actual IAB reproduced loss of expense draft7.77 on Expenses ->Home ->Expenses with the initial Stack.
  Vault now uses official SDK57 JS Tabs with hidden SDK bar/history/lazy retention. Actual IAB repeat
  retains7.77 without any financial submission; direct /mali-app/expenses loads, runtime error log empty.
  Seven actual SDK route/identity/history/provider checks PASS; type/lint/web build PASS.
- Cloud/backup controls now expose semantic roles, labels, switch state and44px close target; guest
  status explicitly describes local saving. File selection is in the backup section.5focused checks PASS.

- Serialized financial durability4527b7a and immutable invocation repairfd69c5d integrated; independent
  review61/61 PASS, original amount5->30 and explicit-clear/{} collision fixed; all14 DTO/config/receipt
  paths reject getters/coercion without writes. Exact IDs/audit/revision retained. ea7eced generation
  UI/aborted Pull fences late A->logout->A responses.
- Atomic backup/explicit conflict candidate: fresh verified ownership/exact CAS, renewed choice if
  server changed, all versions cold-archived before one verified finance+readyOutbox commit. Keep-local
  normal CAS can re-stop; cloud adoption sends nothing. Unknown commit fences stale RAM/network;
  cancelled archive never replaces main head.129 integrated +3 actual UI tests PASS, types PASS,
  scoped lint0errors/3existing warnings. Independent review pending. No production calls.
- Android cold build failed JBR25 prefab stderr native-access warning despite subprocess EXIT0;
  official hash-verified portable JDK21 fixed configure, cached C++ compilation ongoing. No APK/device
  acceptance claimed. Six-screen accessibility map found unnamed fields/icons/missing states/small
  targets; bounded isolated repair in progress.
- Pushed6b79ee0 CI38328473640 app392/PG17 SQL/actual full restore/SAST/dependency provenance/actual
  Linux consumers PASS; mandatory raw audit FAIL4high, one forge advisory. No suppression.


## 2026-10-13 reviewed recovery, real browser restore and Android startup

9e463a6 fixes audited reversal-import false success and retains full nested marketRates.
d2db769 fences final head publication on session expiry and refuses stale Pull during/after
uncertain import without releasing another recovery lock.46targetedPASS, typesPASS, lint0errors;
independent reviewer8probePASS plus130initialfocusedPASS. No forced sync or audit weakening.
Real browser f7437ca: guest100 ->expense7.77 ->reload92.23/1transaction; read-only2journal events;
JSONdownload1account/1tx/2audit/0connectionfields; actualchooser+explicitrestorePASS. Proof
.audit/web-backup-restore-proof.jpg. Full current data retained and no production requests.
CNG Android16 debugAPK79182575bytes built8m56s with officialTemurin21 inC:/MaliNative; installed.
Actual Hermes startup revealed native window.addEventListener absent; f2afbe5 platform+callable
guard fixes,4regressionsPASS, actual coldstartup+guestentryPASS. Native acceptance continues.
31a4dd9 cherry-picks independent bounded accessibility286299c:6screens+CalmDropdown+submission
and2tests;18PASS/typePASS/lint0errors13baselinewarnings. Root review pending. Next bounded work:
10k-list rendering and accessible archived-version retrieval. Latest completed CI f7437ca run
38334145618 app511PASS, PG1716+67+17/fullrestorePASS, SAST/actualLinuxconsumersPASS; rawaudit4highFAIL.
