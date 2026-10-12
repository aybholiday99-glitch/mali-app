import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

const stored = new Map();
globalThis.maliTestStorage = {
  setItem: async (key,value) => { stored.set(key,value); },
  getItem: async key => stored.get(key) ?? null,
  removeItem: async key => { stored.delete(key); },
  multiRemove: async keys => { keys.forEach(key => stored.delete(key)); },
};
globalThis.maliTestPlatform = { OS: 'web' };
let auth, options;
globalThis.maliTestCreateClient = (_url,_key,opts) => { options = opts; return { auth }; };
installNativeTestLoader();
const service = await import('../src/services/authService.ts');
const user = { id:'user-B',email:'b@test.invalid',created_at:'2026-10-12',app_metadata:{provider:'email'} };

test('real auth service serializes logout cleanup before a later login', async () => {
  const events = [];
  let release;
  const pending = new Promise(resolve => { release=resolve; });
  auth = {
    signOut: async () => { events.push('logout'); await pending; },
    signInWithPassword: async () => { events.push('login'); return {data:{user,session:{user}},error:null}; },
  };
  const logout=service.clearAuthSession();
  const login=service.loginWithEmail('b@test.invalid','test-password');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['logout']);
  release();
  await logout;
  assert.equal((await login).user.id,'user-B');
  assert.deepEqual(events,['logout','login']);
  assert.equal(options.auth.detectSessionInUrl,false);
  assert.ok(options.auth.storageKey.includes('evcwoaerlykghgdevrhb.supabase.co'));
});

test('one PKCE callback exchange completes once for concurrent callers', async () => {
  let exchanges=0,notifications=0,release;
  const pending = new Promise(resolve=>{release=resolve;});
  auth.exchangeCodeForSession=async () => { exchanges++; await pending; return {error:null}; };
  auth.getUser=async () => ({data:{user},error:null});
  globalThis.document={title:'test'};
  globalThis.window={
    location:{href:'https://example.test/mali/?code=one-time-code',origin:'https://example.test',pathname:'/mali/',hash:''},
    history:{replaceState:()=>{}},
    opener:{postMessage:message=>{assert.equal(message.hasError,false);notifications++;}},
    close:()=>{},
  };
  const first=service.consumeOAuthRedirectIfPresent();
  const second=service.consumeOAuthRedirectIfPresent();
  assert.equal(first,second);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(exchanges,1);
  release();
  assert.equal((await first).id,user.id);
  assert.equal(notifications,1);
  delete globalThis.window;
  delete globalThis.document;
});
