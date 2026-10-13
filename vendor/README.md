# DEP-101 dependency remediation candidate

Expo 57.0.28 and React Native 0.86.3 remain unchanged. Braces is removed through
a genuine narrow Metro matching adapter. Forge uses a transparent local security
backport while retaining the original `node-forge@1.4.0` identity and version.
The full licenses, reviewable source, exact proposed upstream RSA patch and
immutable install tarballs are tracked here. No source depends on ignored files.

The registry still publishes braces 3.0.3 and forge 1.4.0 with no fixed release
for GHSA-vfj7-8cjw-p6xm and GHSA-86w9-cpqp-85rv. Forge PR 1159 remains unmerged.
This candidate does not claim either advisory is fixed upstream.

The actual graph has two forge consumers (`@expo/cli@57.0.29` and
`@expo/code-signing-certificates@0.0.6`) and one matcher consumer
(`metro-file-map@0.84.5`, using only `micromatch.some`). Replacing the synchronous
certificate/CSR API with Node crypto would require a larger construction API
rewrite; this backport preserves those established operations.

`securityProvenance.json` records source, license/package hashes, upstream commit,
tarball integrity and actual consumer source hashes. The mandatory gate checks
both tracked source and every installed forge copy, both forge consumers, the
matcher, exact consumer inventory/source and lockfile archive pointers. It fails
for modified files, modified archives, unexpected unpatched copies or new consumers.

Raw `npm audit --audit-level=high` is unchanged and still fails with **4 high
affected package entries for one forge advisory**. The original 15 high entries
included the eliminated braces chain. There are no advisory filters, version
inflations, audit exceptions or scanner suppression. This is partial remediation;
the release dependency gate remains blocked. Registry audits may have limited
coverage of local packages, so audit alone cannot certify backports or adapters.

Mandatory verification:

```sh
npm ci --ignore-scripts
node scripts/verifyDependencyOverrides.mjs
npm run test:dependencies
npm audit --audit-level=high
npx expo install --check
npx expo config --type introspect --json
npm run typecheck
npm run build:web
```

The six dependency tests include 22,704 recorded differential matcher outcomes
(11,352 each with explicit Windows and POSIX path semantics),
the real Metro watcher, original-CVE deep patterns, hash/extra-copy negative
controls, actual Expo and CLI signature/certificate/CSR operations and an
independent Node crypto oracle. All keys are generated in memory per test; no
private keys or certificates are stored. A preparation negative control against
the verified original npm archive confirmed its RSA and actual certificate
verification accept the malformed nested DigestAlgorithm signature that native
crypto and this backport reject.

Windows clean installs and the scoped tests/checks/build passed during candidate
preparation. Linux CI subsequently passed clean installation, installed-source
integrity and the Expo/CLI crypto checks. Its matcher fixture failure exposed a
Windows-only oracle: the original matcher also uses different default backslash
semantics on POSIX. Both complete oracles are now recorded from verified original
npm archives. The adapter is checked against both explicit modes; the real Metro
consumer is checked against the host's oracle. No cases are omitted. Linux CI
qualification of this fixture repair remains pending. Successful scoped checks
do not establish native device, store signing or production deployment readiness.

To regenerate the matching fixture, extract the exact official npm archives
listed in `tests/fixtures/metroMatcherBaseline.json` into an isolated directory's
`node_modules`, after verifying each listed SHA-512 integrity. Save that archive
metadata as `origins.json` in the directory. Run
`node scripts/recordMatcherBaseline.mjs <directory>`; it checks the original
versions and micromatch source SHA-256 before executing the original matcher.
The vulnerable baseline packages are test preparation inputs only and are never
installed into the application or included in its dependency graph.

Installation uses root local tarball dependencies and npm `$dependency` override
references. Relative transitive tarball overrides and linked directory dependency
resolution were rejected during preparation; only the reproducible tarball graph
is retained. Package-lock changes are confined to these substitutes and removal
of their unused brace dependencies.

For a future update, prefer a maintained upstream fixed release. Otherwise review
the exact origin/patch, rebuild the archives with `npm pack --ignore-scripts`,
update provenance/consumer hashes, regenerate the lock through Expo install and
rerun every mandatory gate. Changing the provenance requires independent review;
it is not an automatic bless-new-bytes operation.
