#!/usr/bin/env bash
set -euo pipefail

mkdir -p android-standalone-evidence
APK="android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -s "$APK" ]]; then
  echo "FAIL: self-contained Android release candidate is missing"
  exit 1
fi
if unzip -Z1 "$APK" | grep -Eq '^assets/index.android.bundle$'; then
  echo "PASS: production JavaScript bundle is embedded in standalone APK"
else
  echo "FAIL: no embedded JS bundle; standalone app could depend on Metro"
  exit 1
fi

adb wait-for-device
adb logcat -c
adb install -r "$APK"
adb shell am force-stop com.aybholiday.mali || true
adb shell monkey -p com.aybholiday.mali -c android.intent.category.LAUNCHER 1
sleep 25
FIRST_PID="$(adb shell pidof com.aybholiday.mali | tr -d '\r')"
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

adb shell am force-stop com.aybholiday.mali
sleep 2
adb logcat -c
adb shell monkey -p com.aybholiday.mali -c android.intent.category.LAUNCHER 1
sleep 20
SECOND_PID="$(adb shell pidof com.aybholiday.mali | tr -d '\r')"
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
