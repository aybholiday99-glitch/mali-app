#!/usr/bin/env bash
set -euo pipefail

mkdir -p android-standalone-evidence
APK="android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -s "$APK" ]]; then
  echo "FAIL: self-contained Android release candidate is missing"
  exit 1
fi
# Materialize the ZIP listing before grep: with pipefail, grep -q can close
# the pipe early and mark a valid ZIP reader as failed (SIGPIPE).
APK_LIST="$(unzip -Z1 "$APK")"
if grep -Fxq 'assets/index.android.bundle' <<< "$APK_LIST"; then
  echo "PASS: production JavaScript bundle is embedded in standalone APK"
else
  echo "FAIL: no embedded JS bundle; standalone app could depend on Metro"
  exit 1
fi

echo "Step 1: wait for emulator ADB connection"
timeout 60 adb wait-for-device
echo "Step 2: clear logcat"
timeout 45 adb logcat -c
echo "Step 3: install standalone APK"
timeout 240 adb install -r "$APK"
echo "Step 4: force-stop before fresh launch"
timeout 45 adb shell am force-stop com.aybholiday.mali || true
echo "Step 5: launch native Mali app"
timeout 60 adb shell monkey -p com.aybholiday.mali -c android.intent.category.LAUNCHER 1
sleep 25
echo "Step 6: check initial app process"
FIRST_PID="$(timeout 45 adb shell pidof com.aybholiday.mali | tr -d '\r')"
adb logcat -d -t 2000 > android-standalone-evidence/first-launch-logcat.txt
adb shell dumpsys activity activities > android-standalone-evidence/first-activity.txt
adb shell uiautomator dump /sdcard/mali-release-first.xml || true
adb pull /sdcard/mali-release-first.xml android-standalone-evidence/first-ui.xml || true
adb shell screencap -p /sdcard/mali-release-first.png
adb pull /sdcard/mali-release-first.png android-standalone-evidence/first-screen.png
if [[ -z "$FIRST_PID" ]]; then
  echo "FAIL: standalone app process did not survive initial start"
  tail -n 100 android-standalone-evidence/first-launch-logcat.txt
  exit 1
fi

# A standalone binary must not rely on Metro, which is not started in this test.
if grep -Eqi 'Unable to load script|Failed to connect to development server|Could not connect to development server' android-standalone-evidence/first-launch-logcat.txt; then
  echo "FAIL: standalone APK attempted development server connection"
  exit 1
fi

echo "Step 7: simulate force-stop"
timeout 45 adb shell am force-stop com.aybholiday.mali
sleep 2
timeout 45 adb logcat -c
echo "Step 8: relaunch Android app with no Metro"
timeout 60 adb shell monkey -p com.aybholiday.mali -c android.intent.category.LAUNCHER 1
sleep 20
echo "Step 9: verify app process after restart"
SECOND_PID="$(timeout 45 adb shell pidof com.aybholiday.mali | tr -d '\r')"
adb logcat -d -t 2000 > android-standalone-evidence/second-launch-logcat.txt
adb shell dumpsys activity activities > android-standalone-evidence/second-activity.txt
adb shell uiautomator dump /sdcard/mali-release-second.xml || true
adb pull /sdcard/mali-release-second.xml android-standalone-evidence/second-ui.xml || true
adb shell screencap -p /sdcard/mali-release-second.png
adb pull /sdcard/mali-release-second.png android-standalone-evidence/second-screen.png
if [[ -z "$SECOND_PID" ]]; then
  echo "FAIL: standalone app process did not survive restart"
  tail -n 100 android-standalone-evidence/second-launch-logcat.txt
  exit 1
fi
if grep -Eqi 'Unable to load script|Failed to connect to development server|Could not connect to development server' android-standalone-evidence/second-launch-logcat.txt; then
  echo "FAIL: standalone app attempted development server after restart"
  exit 1
fi
echo "PASS: standalone release candidate, signed using test-only debug signing, survived install and force-stop/relaunch WITHOUT Metro"
echo "NOTE: this is not proof of physical-device financial flows, production signing or data recovery"
