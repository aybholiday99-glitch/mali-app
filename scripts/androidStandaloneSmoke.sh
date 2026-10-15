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
# Separate APK transfer from package-manager install to diagnose stuck ADB stream.
# On slow GitHub-hosted emulators the previous four-minute adb install timed out.
timeout 300 adb push "$APK" /data/local/tmp/mali-release.apk ||
  fail "APK transfer to emulator timed out"
if ! timeout 300 adb shell pm install -r /data/local/tmp/mali-release.apk > android-standalone-evidence/install.txt 2>&1; then
  cat android-standalone-evidence/install.txt
  fail "Android package manager rejected APK (see install.txt)"
fi
if ! grep -q 'Success' android-standalone-evidence/install.txt; then
  cat android-standalone-evidence/install.txt
  fail "Android package manager did not confirm successful installation"
fi
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
