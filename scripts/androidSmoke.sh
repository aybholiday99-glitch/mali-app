#!/usr/bin/env bash
set -euo pipefail

mkdir -p android-acceptance-evidence
APK="android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -s "$APK" ]]; then
  echo "ERROR: Android debug APK was not built."
  exit 1
fi

adb wait-for-device
adb reverse tcp:8081 tcp:8081
adb logcat -c

# Debug builds require Metro. This process is restricted to the isolated CI runner.
CI=1 EXPO_NO_TELEMETRY=1 npx --no-install expo start --localhost --port 8081 > android-acceptance-evidence/metro.log 2>&1 &
METRO_PID=$!
cleanup() {
  kill "$METRO_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for Metro on 127.0.0.1:8081"
READY=0
for _ in $(seq 1 90); do
  if curl -fsS --max-time 3 http://127.0.0.1:8081/status | grep -q "packager-status:running"; then
    READY=1
    break
  fi
  if ! kill -0 "$METRO_PID" 2>/dev/null; then break; fi
  sleep 2
done
if [[ "$READY" != "1" ]]; then
  tail -n 120 android-acceptance-evidence/metro.log || true
  echo "ERROR: Metro never became ready for the native debug APK."
  exit 1
fi

# Non-streaming install avoids ADB package streaming stalls on cloud emulators.
timeout 360 adb install --no-streaming -r "$APK" > android-acceptance-evidence/install.txt 2>&1 || {
  cat android-acceptance-evidence/install.txt
  echo "ERROR: debug APK installation failed or timed out" >&2
  exit 1
}
grep -q 'Success' android-acceptance-evidence/install.txt || {
  cat android-acceptance-evidence/install.txt
  exit 1
}
adb shell am force-stop com.aybholiday.mali || true
adb shell monkey -p com.aybholiday.mali -c android.intent.category.LAUNCHER 1
sleep 35
APP_PID=$(adb shell pidof com.aybholiday.mali | tr -d '\r')
adb logcat -d -t 1800 > android-acceptance-evidence/logcat.txt
adb shell dumpsys activity activities > android-acceptance-evidence/activity.txt
adb shell uiautomator dump /sdcard/mali-window.xml || true
adb pull /sdcard/mali-window.xml android-acceptance-evidence/mali-window.xml || true
adb shell screencap -p /sdcard/mali-smoke.png
adb pull /sdcard/mali-smoke.png android-acceptance-evidence/mali-smoke.png
if [[ -z "$APP_PID" ]]; then
  tail -n 140 android-acceptance-evidence/logcat.txt
  echo "ERROR: Mali Android native process did not survive launch."
  exit 1
fi
if grep -Eqi 'Unable to load script|Failed to connect to development server|Could not connect to development server|FATAL EXCEPTION.*mali' android-acceptance-evidence/logcat.txt; then
  echo "ERROR: React Native runtime or Metro connection error detected."
  grep -Ei 'Unable to load script|Failed to connect to development server|Could not connect to development server|FATAL EXCEPTION.*mali' android-acceptance-evidence/logcat.txt | tail -n 20
  exit 1
fi
echo "PASS: Android debug APK installed, Metro served bundle and native process survived startup: $APP_PID"
echo "Review screenshot and UI hierarchy artifact for visual acceptance."
