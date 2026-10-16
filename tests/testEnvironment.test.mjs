import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolatedSupabaseEnvironment } from './testEnvironment.mjs';

test('mutating tests reject missing and every non-loopback endpoint', () => {
  assert.throws(() => isolatedSupabaseEnvironment({}));
  for (const url of ['https://evcwoaerlykghgdevrhb.supabase.co', 'https://localhost.evil.test', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost:54321']) {
    assert.throws(() => isolatedSupabaseEnvironment({ MALI_TEST_SUPABASE_URL: url, MALI_TEST_SUPABASE_ANON_KEY: 'test-only' }));
  }
});
test('disposable local endpoints are accepted', () => {
  for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321']) {
    assert.equal(isolatedSupabaseEnvironment({ MALI_TEST_SUPABASE_URL: url, MALI_TEST_SUPABASE_ANON_KEY: 'test-only' }).url, url);
  }
});
