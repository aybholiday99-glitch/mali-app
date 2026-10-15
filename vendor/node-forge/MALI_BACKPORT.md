# Mali Node forge security backport

This preserves node-forge's original package identity and version, 1.4.0.
It is a local backport, not an upstream release or a claim that registry 1.4.0
is safe. The source is the official npm 1.4.0 archive, whose published SHA-512
integrity was verified before extraction. All Node library files and the full
dual-license notice are preserved. Only `lib/rsa.js` changes at runtime.

The base RSA backport derives from official upstream PR 1159, commit
`db05494352dd3c9a5a07c5270333dcc78866cad2`. That PR remains
open/unmerged/unpublished. Mali now adds a separately reviewed local
fail-closed improvement: the decrypted DigestInfo must match the complete
canonical encoding, even when a caller passes the non-default
`_parseAllDigestBytes: false` parser option. The upstream PR used a prefix
comparison for this option, which left extra trailing digest bytes accepted
in that mode; a verified negative regression reproduces that bypass
before the Mali hardening and rejects it afterwards. This is *not*
byte-for-byte upstream code or an official patched npm release.
It rejects non-canonical DigestInfo bytes, including nested extra elements,
nonempty NULL parameters and non-minimal DER lengths. Valid encodings with and
without NULL parameters remain supported.

This package ships the Node library source only. Original prebuilt browser
bundles, Flash files and development scripts/dependencies are omitted so no
unpatched duplicate bundle can be loaded from the substitute. The original
package manifest is retained as `UPSTREAM_PACKAGE.json`; original author,
repository, license, package name, version, main entry and browser mapping stay
unchanged in the installable manifest. `private` prevents accidental publishing.

Sources:
- https://registry.npmjs.org/node-forge/1.4.0
- https://github.com/digitalbazaar/forge/pull/1159
- https://github.com/digitalbazaar/forge/blob/db05494352dd3c9a5a07c5270333dcc78866cad2/lib/rsa.js
- https://github.com/advisories/GHSA-86w9-cpqp-85rv

Local-file dependencies may be omitted from registry advisory matching. A zero
result from raw npm audit does not establish this package's safety. Installed
source integrity, every actual CLI/certificate consumer, malicious signature
regressions and compatibility tests are mandatory release gates. Replacing this
backport with a maintained upstream fix remains the preferred future action.
