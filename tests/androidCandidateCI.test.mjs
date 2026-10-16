import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Android emulator acceptance installs self-contained test-signed release instead of requiring Metro', () => {
  const workflow = read('../.github/workflows/android-acceptance.yml');
  const standalone = read('../scripts/androidStandaloneSmoke.sh');
  const releaseBuild = read('../.github/workflows/android-standalone.yml');

  assert.match(workflow, /:app:assembleRelease\b/);
  assert.match(workflow, /-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64/);
  assert.match(workflow, /script: bash scripts\/androidStandaloneSmoke\.sh/);
  assert.match(workflow, /android\/app\/build\/outputs\/apk\/release\/app-release\.apk/);
  assert.doesNotMatch(workflow, /:app:assembleDebug|scripts\/androidSmoke\.sh|adb reverse|expo start/);

  assert.match(standalone, /assets\/index\.android\.bundle/);
  assert.match(standalone, /check_app "first"/);
  assert.match(standalone, /check_app "second"/);
  assert.match(standalone, /dumpsys window windows/);
  assert.match(standalone, /Mali is not the resumed Activity/);
  assert.match(standalone, /Android ANR dialog has focus/);
  assert.match(standalone, /Mali is not the focused window/);
  assert.match(standalone, /Failed to connect to development server/);
  assert.doesNotMatch(standalone, /adb reverse|expo start/);
  assert.match(releaseBuild, /apksigner/);
});

test('auth screen has no preset personal account chooser and browser requires login', () => {
  const screen = read('../src/screens/AuthScreen.tsx');
  const browser = read('../scripts/acceptWebBrowser.mjs');
  assert.equal(screen.includes('@gmail.com'), false);
  assert.doesNotMatch(screen, /socialModalProvider|handleQuickSelectSocialAccount/);
  assert.match(screen, /launchSocialOAuthWindow/);
  assert.equal(browser.includes('authenticated email/password sign-in controls after provider bootstrap'), true);
  assert.doesNotMatch(browser, /offline guest entry after provider bootstrap/);
});