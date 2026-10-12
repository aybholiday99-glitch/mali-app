import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

const legacy=new Map(),secure=new Map(),optionsSeen=[];
let available=true,deleteFailure=false,capturedOptions;
globalThis.maliTestPlatform={OS:'ios'};
globalThis.maliTestStorage={
  getItem:async key=>legacy.get(key)??null,
  setItem:async(key,value)=>{legacy.set(key,value);},
  removeItem:async key=>{legacy.delete(key);},
  multiRemove:async keys=>{for(const key of keys)legacy.delete(key);},
  getAllKeys:async()=>[...legacy.keys()],
};
globalThis.maliTestSecureStore={
  isAvailableAsync:async()=>available,
  getItemAsync:async(key,options)=>{optionsSeen.push(options);return secure.get(key)??null;},
  setItemAsync:async(key,value,options)=>{optionsSeen.push(options);secure.set(key,value);},
  deleteItemAsync:async(key,options)=>{optionsSeen.push(options);if(deleteFailure&&/\.[ab]\.[0-9]+$/.test(key))throw new Error('native cleanup denied');secure.delete(key);},
};
const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid',created_at:'2026-10-12T00:00:00Z',user_metadata:{full_name:'Native'},app_metadata:{provider:'email'}};
const session={access_token:'synthetic access',refresh_token:'synthetic refresh',expires_at:Math.ceil(Date.now()/1000)+3600,user};
globalThis.maliTestCreateClient=(_url,_key,options)=>{
  capturedOptions=options;
  const storage=options.auth.storage,key=options.auth.storageKey;
  return {auth:{
    getSession:async()=>{const raw=await storage.getItem(key);return {data:{session:raw?JSON.parse(raw):null},error:null};},
    getUser:async()=>({data:{user},error:null}),
    signOut:async()=>{throw new Error('simulated offline network');},
    signInWithPassword:async()=>{await storage.setItem(key,JSON.stringify(session));return {data:{session,user},error:null};},
  }};
};
installNativeTestLoader();
// This test owns its native-module hook; no device, credentials or network call.
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='expo-secure-store')return {url:'data:text/javascript,'+encodeURIComponent(
    'const s=globalThis.maliTestSecureStore;export const WHEN_UNLOCKED_THIS_DEVICE_ONLY=5;export const isAvailableAsync=(...a)=>s.isAvailableAsync(...a);export const getItemAsync=(...a)=>s.getItemAsync(...a);export const setItemAsync=(...a)=>s.setItemAsync(...a);export const deleteItemAsync=(...a)=>s.deleteItemAsync(...a);'
  ),shortCircuit:true};
  return nextResolve(specifier,context);
}});
const auth=await import('../src/services/authService.ts');
const config={url:'https://native.example.invalid',anonKey:'publishable-test',workspaceKey:'unused',autoSync:false};
const key='mali_supabase_auth_native.example.invalid';
const flowSuffix='-flow-'+ 'a'.repeat(32) +'-code-verifier';
function reset(){legacy.clear();secure.clear();optionsSeen.length=0;available=true;deleteFailure=false;globalThis.maliTestPlatform.OS='ios';}

test('real native auth service migrates an existing session without loss and uses device-only secure options',async()=>{
  reset();legacy.set(key,JSON.stringify(session));
  const result=await auth.getStoredAuthSession(config);
  assert.equal(result.id,user.id);
  assert.equal(legacy.has(key),false);
  assert.notEqual(capturedOptions.auth.storage,globalThis.maliTestStorage);
  assert.equal(capturedOptions.auth.flowType,'pkce');
  assert.equal(capturedOptions.auth.detectSessionInUrl,false);
  assert.ok(optionsSeen.length>0);
  for(const options of optionsSeen){assert.equal(options.keychainService,'mali.supabase.auth.v1');assert.equal(options.keychainAccessible,5);assert.equal(options.requireAuthentication,false);}
  assert.equal(await capturedOptions.auth.storage.getItem(key),JSON.stringify(session));
});

test('real native logout clears session and PKCE secrets even when remote sign-out is offline',async()=>{
  reset();auth.getSharedSupabaseClient(config);
  const storage=capturedOptions.auth.storage;
  for(const suffix of ['', '-user','-code-verifier',flowSuffix])await storage.setItem(key+suffix,'synthetic secret');
  await storage.setItem(key+'-flows-code-verifier',JSON.stringify(['a'.repeat(32)]));
  legacy.set('mali_auth_session_v2','summary');legacy.set('mali_supabase_auth_token','old global');
  legacy.set('mali_supabase_auth_token-flow-'+ 'b'.repeat(32) +'-code-verifier','old verifier');
  await auth.clearAuthSession(config);
  for(const suffix of ['', '-user','-code-verifier',flowSuffix,'-flows-code-verifier'])assert.equal(await storage.getItem(key+suffix),null);
  assert.equal(legacy.size,0);
  for(const [name,raw] of secure)if(!name.endsWith('.epoch'))assert.equal(JSON.parse(raw).state,'deleted');
});

test('real auth logout propagates failed native cleanup and its tombstone blocks session restore',async()=>{
  reset();auth.getSharedSupabaseClient(config);const storage=capturedOptions.auth.storage;
  await storage.setItem(key,JSON.stringify(session));deleteFailure=true;
  await assert.rejects(auth.clearAuthSession(config),/تعذر تأكيد إزالة/);
  deleteFailure=false;
  assert.equal(await storage.getItem(key),null);
  assert.equal(await auth.getStoredAuthSession(config),null);
  await auth.clearAuthSession(config);
});

test('real native login fails closed when secure storage is unavailable and creates no plaintext session',async()=>{
  reset();available=false;
  const result=await auth.loginWithEmail('test@example.invalid','Password-Only-A-Fake',config);
  assert.equal(result.success,false);
  assert.equal(legacy.has(key),false);
  assert.equal(secure.size,0);
});

test('real web auth client retains the existing AsyncStorage backend',async()=>{
  reset();globalThis.maliTestPlatform.OS='web';
  auth.getSharedSupabaseClient({...config,url:'https://web.example.invalid'});
  const storage=capturedOptions.auth.storage,webKey=capturedOptions.auth.storageKey;
  await storage.setItem(webKey,JSON.stringify(session));
  assert.equal(legacy.get(webKey),JSON.stringify(session));
  assert.equal(await storage.getItem(webKey),JSON.stringify(session));
  assert.equal(optionsSeen.length,0);
});

test('real native logout failure while unavailable blocks recovery until successful cleanup retry',async()=>{
  reset();auth.getSharedSupabaseClient(config);const storage=capturedOptions.auth.storage;
  await storage.setItem(key,JSON.stringify(session));await storage.setItem(key+flowSuffix,'unindexed verifier');
  available=false;
  await assert.rejects(auth.clearAuthSession(config),/تعذر تأكيد إزالة/);
  available=true;
  assert.equal(await auth.getStoredAuthSession(config),null);
  assert.equal(await storage.getItem(key+flowSuffix),null);
  const blocked=await auth.loginWithEmail('test@example.invalid','Password-Only-A-Fake',config);
  assert.equal(blocked.success,false);
  await auth.clearAuthSession(config);
  const login=await auth.loginWithEmail('test@example.invalid','Password-Only-A-Fake',config);
  assert.equal(login.success,true);
});

test('real web SDK reads, replacements and logout preserve foreign custom-host session keys',async()=>{
  for(const suffix of ['-secondary','-user','-code-verifier','-flows-code-verifier']){
    reset();globalThis.maliTestPlatform.OS='web';
    const webConfig={...config,url:'https://web.example.invalid'};
    auth.getSharedSupabaseClient(webConfig);
    const storage=capturedOptions.auth.storage,base=capturedOptions.auth.storageKey,foreign=base+suffix,value=JSON.stringify(session);
    legacy.set(foreign,value);
    if(suffix==='-secondary')await assert.rejects(storage.getItem(foreign));
    else {
      assert.equal(await storage.getItem(foreign),null);
      await assert.rejects(storage.setItem(foreign,'overwrite'));
      await storage.removeItem(foreign);
    }
    await auth.clearAuthSession(webConfig);
    assert.equal(legacy.get(foreign),value);
    assert.equal(optionsSeen.length,0);
  }
});

test('historical global suffix cleanup preserves ambiguous project sessions',async()=>{
  reset();auth.getSharedSupabaseClient(config);
  const foreign='mali_supabase_auth_token-code-verifier',value=JSON.stringify(session);
  legacy.set(foreign,value);
  await auth.clearAuthSession(config);
  assert.equal(legacy.get(foreign),value);
});
