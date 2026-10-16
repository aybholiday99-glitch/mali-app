#!/usr/bin/env bash
set -euo pipefail

mkdir -p android-standalone-evidence
APK="android/app/build/outputs/apk/release/app-release.apk"
test -s "$APK" || { echo "FAIL: standalone release candidate missing"; exit 1; }

# Inspect once; zip/unzip piped through grep -q can falsely fail with SIGPIPE.
APK_CONTENTS="$(unzip -Z1 "$APK")"
grep -Fxq 'assets/index.android.bundle' <<< "$APK_CONTENTS" || {
  echo "FAIL: standalone APK missing embedded JS"; exit 1;
}
grep -Eq '^lib/(arm64-v8a|armeabi-v7a)/[^/]+[.]so$' <<< "$APK_CONTENTS" || {
  echo "FAIL: standalone APK missing native Android phone libraries"; exit 1;
}
echo "PASS: standalone JS bundle and native phone libraries verified"

# Emulator is an isolated CI runner. Do not start Metro or connect to production.
adb_call() { timeout 75 adb "$@"; }
capture() {
  local label="$1"
  timeout 60 adb logcat -d -t 1500 > "android-standalone-evidence/$label-logcat.txt" || true
  timeout 45 adb shell dumpsys activity activities > "android-standalone-evidence/$label-activity.txt" || true
  timeout 45 adb shell screencap -p /sdcard/mali-ci-screen.png || true
  timeout 45 adb pull /sdcard/mali-ci-screen.png "android-standalone-evidence/$label-screen.png" || true
}
fail() {
  echo "FAIL: $1"
  capture "failure" || true
  exit 1
}
check_app() {
  local label="$1" pid activities
  # Slow cold boot and GC on CI hosts: check for process after Android has settled.
  sleep 20
  pid="$(adb_call shell pidof com.aybholiday.mali | tr -d '\r')" || fail "$label: adb pidof timed out"
  [[ -n "$pid" ]] || fail "$label: Mali did not stay running"
  echo "PASS: $label process id $pid"
  capture "$label"
  activities="$(cat "android-standalone-evidence/$label-activity.txt" 2>/dev/null || true)"
  if [[ "$activities" == *"ResumedActivity: ActivityRecord"* ]]; then
    grep -qE 'ResumedActivity: .*com[.]aybholiday[.]mali' <<< "$activities" ||
      fail "$label: app not in foreground"
  fi
  if grep -Eqi 'Unable to load script|Failed to connect to development server|Could not connect to development server' \
      "android-standalone-evidence/$label-logcat.txt"; then
    fail "$label: app attempted Metro/dev server connection"
  fi
}
echo "Step 1: wait for clean emulator"
timeout 90 adb wait-for-device || fail "Android emulator ADB unavailable"
adb_call shell input keyevent KEYCODE_WAKEUP || true
adb_call shell wm dismiss-keyguard || true
adb_call logcat -c || true
echo "Step 2: install signed standalone APK"
# The emulator runner can report boot-completed before Android package manager
# has recovered from its cold-start workload. Wait for that service explicitly.
wait_package_manager() {
  local attempt result
  for attempt in $(seq 1 15); do
    result="$(timeout 20 adb shell service check package 2>&1 || true)"
    if [[ "$result" == *"Service package: found"* ]]; then
      return 0
    fi
    echo "Waiting for Android package service ($attempt/15): $result"
    sleep 5
  done
  return 1
}
wait_package_manager || fail "Android package manager service did not become ready"
# ADB push is separate from PackageManager to distinguish transfer errors from
# installation failures. Verify the file exists on the isolated emulator.
timeout 300 adb push "$APK" /data/local/tmp/mali-release.apk ||
  fail "APK transfer to emulator timed out"
adb_call shell ls -l /data/local/tmp/mali-release.apk > android-standalone-evidence/pushed-apk.txt ||
  fail "Transferred APK missing on emulator"
# Retry at most once ONLY for an emulator service transport interruption.
# INSTALL_FAILED_* and signature/package validation errors are hard failures.
installed=false
for attempt in 1 2; do
  if timeout 240 adb shell pm install -r /data/local/tmp/mali-release.apk > android-standalone-evidence/install.txt 2>&1; then
    if grep -Eq '^Success[[:space:]]*$' android-standalone-evidence/install.txt; then
      installed=true
      break
    fi
  fi
  echo "APK install attempt $attempt failed:"
  cat android-standalone-evidence/install.txt
  cp android-standalone-evidence/install.txt "android-standalone-evidence/install-attempt-$attempt.txt"
  if [[ "$attempt" -eq 2 ]] ||
    ! grep -Eqi 'Broken pipe|Failure calling service package|DeadObjectException|Package manager has died|service package.*not found' android-standalone-evidence/install.txt; then
    fail "Android rejected APK or package installer failed (see install-attempt-$attempt.txt)"
  fi
  echo "Detected transient emulator package-service disconnect; retrying once after recovery."
  timeout 45 adb wait-for-device || fail "Emulator ADB did not recover"
  wait_package_manager || fail "Package manager did not recover after transient disconnect"
  sleep 10
done
[[ "$installed" == true ]] || fail "APK installation did not succeed"
adb_call shell pm path com.aybholiday.mali > android-standalone-evidence/installed-package.txt ||
  fail "PackageManager cannot report Mali APK after installation"
grep -q '^package:' android-standalone-evidence/installed-package.txt ||
  fail "PackageManager has no installed Mali package after installation"
adb_call shell rm /data/local/tmp/mali-release.apk || true
echo "Step 3: launch Mali Android release with no Metro"
adb_call shell am force-stop com.aybholiday.mali || true
adb_call shell am start -n com.aybholiday.mali/.MainActivity ||
  fail "Mali MainActivity could not start"
check_app "first"
echo "Step 4: force-stop and relaunch independently"
adb_call shell am force-stop com.aybholiday.mali ||
  fail "force-stop unsuccessful"
adb_call logcat -c || true
adb_call shell am start -n com.aybholiday.mali/.MainActivity ||
  fail "restart failed"
check_app "second"
echo "PASS: Mali ARM64-capable standalone Android APK installed and launched twice without Metro"
echo "NOTE: simulator smoke proof only; production signing, full native finance E2E and real-device acceptance remain separate"
