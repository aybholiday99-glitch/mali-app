import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const script = readFileSync(new URL('../scripts/androidStandaloneSmoke.sh', import.meta.url), 'utf8');
const start = script.indexOf('echo "Step 2: install signed standalone APK"');
const end = script.indexOf('echo "Step 3: launch Mali Android release with no Metro"', start);
assert.ok(start >= 0 && end > start, 'isolated Android install section must be present');
const installer = script.slice(start, end);

test('AOSP smoke waits for PackageManager and retries only transport errors, never APK rejection', () => {
  assert.match(installer, /service check package/);
  assert.match(installer, /for attempt in 1 2/);
  assert.match(installer, /Broken pipe/);
  assert.match(installer, /grep -Eq '\^Success\[\[:space:\]\]\*\$'/);
  assert.match(installer, /pm path com\.aybholiday\.mali/);
  assert.match(installer, /fail "Android rejected APK or package installer failed/);
  assert.doesNotMatch(installer, /\|\| true\s*\n\s*installed=true/);
});

// Exercise the exact CI shell installer against a mock adb, without a device,
// network, production credentials, or a real APK.
test('AOSP isolated installer recovers once from Broken pipe and verifies installed package', {
  skip: process.platform !== 'linux',
}, () => {
  const result = runMock('transient');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.installs, 2);
  assert.match(result.stdout, /Detected transient emulator package-service disconnect/);
});
test('AOSP isolated installer immediately rejects invalid APK and never retries it', {
  skip: process.platform !== 'linux',
}, () => {
  const result = runMock('invalid');
  assert.notEqual(result.status, 0);
  assert.equal(result.installs, 1);
  assert.match(result.stderr, /Android rejected APK/);
});
test('AOSP isolated installer fails closed if PackageManager service never becomes available', {
  skip: process.platform !== 'linux',
}, () => {
  const result = runMock('unavailable');
  assert.notEqual(result.status, 0);
  assert.equal(result.installs, 0);
  assert.match(result.stderr, /did not become ready/);
});

function runMock(mode) {
  const root = mkdtempSync(path.join(tmpdir(), 'mali-android-install-'));
  try {
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const log = path.join(root, 'adb.log');
    const adb = path.join(bin, 'adb');
    writeFileSync(adb, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MALI_MOCK_LOG"
case "$*" in
  'shell service check package')
    if [[ "$MALI_MOCK_MODE" == unavailable ]]; then echo 'Service package: not found'; else echo 'Service package: found'; fi ;;
  'push '*|'shell ls -l '*|'shell rm '*|'wait-for-device') echo OK ;;
  'shell pm install '*)
    count="$(grep -c '^shell pm install ' "$MALI_MOCK_LOG")"
    if [[ "$MALI_MOCK_MODE" == invalid ]]; then
      echo 'Failure [INSTALL_FAILED_NO_MATCHING_ABIS]'; exit 1
    elif [[ "$MALI_MOCK_MODE" == transient && "$count" == 1 ]]; then
      echo 'cmd: Failure calling service package: Broken pipe (32)'; exit 1
    fi
    echo Success ;;
  'shell pm path com.aybholiday.mali') echo 'package:/data/app/com.aybholiday.mali/base.apk' ;;
  *) echo "Unexpected adb command $*" >&2; exit 7 ;;
esac
`);
    chmodSync(adb, 0o755);
    writeFileSync(path.join(root, 'test.apk'), 'isolated-placeholder');
    const wrapper = `set -euo pipefail
mkdir -p android-standalone-evidence
APK=test.apk
adb_call() { adb "$@"; }
sleep() { :; }
capture() { :; }
fail() { echo "FAIL: $1" >&2; exit 41; }
${installer}
`;
    writeFileSync(path.join(root, 'fixture.sh'), wrapper);
    execFileSync('bash', ['-n', path.join(root, 'fixture.sh')]);
    const result = spawnSync('bash', [path.join(root, 'fixture.sh')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, MALI_MOCK_LOG: log, MALI_MOCK_MODE: mode },
    });
    const commands = readFileSync(log, 'utf8').split('\n');
    return { ...result, installs: commands.filter(x => x.startsWith('shell pm install ')).length };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
