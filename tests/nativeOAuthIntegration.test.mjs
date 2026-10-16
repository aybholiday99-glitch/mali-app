import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks,createRequire} from 'node:module';
import {randomFillSync,webcrypto} from 'node:crypto';
import {installNativeTestLoader} from './nativeModuleTestLoader.mjs';

const require=createRequire(import.meta.url),sdk=require('../node_modules/@supabase/auth-js/dist/main/lib/helpers.js');
const legacy=new Map(),secure=new Map(),calls=[],subscribers=new Set();
const originalCrypto=Object.getOwnPropertyDescriptor(globalThis,'crypto');
let browserResult,prepareError=false,verifyError=false,exchangeDelay=null,verificationDelay=null,onVerify=null,redirect='mali://auth/callback',secureAvailable=true,randomCalls=0,digestCalls=0;
globalThis.maliTestPlatform={OS:'ios'};
globalThis.maliTestStorage={getItem:async key=>legacy.get(key)??null,setItem:async(key,value)=>{legacy.set(key,value);},removeItem:async key=>{legacy.delete(key);},getAllKeys:async()=>[...legacy.keys()],multiRemove:async keys=>{for(const key of keys)legacy.delete(key);}};
globalThis.maliTestSecureStore={isAvailableAsync:async()=>secureAvailable,getItemAsync:async key=>secure.get(key)??null,setItemAsync:async(key,value)=>{secure.set(key,value);},deleteItemAsync:async key=>{secure.delete(key);}};
globalThis.maliOAuthCrypto={getRandomValues:array=>{randomCalls++;return randomFillSync(array);},digest:async(_algorithm,data)=>{digestCalls++;return webcrypto.subtle.digest('SHA-256',data);}};
globalThis.maliOAuthPlatform={makeRedirectUri:options=>{calls.push(['redirect',options]);return redirect;},dismiss:()=>{calls.push(['dismiss']);},open:async(url,returnUri)=>{calls.push(['browser',url,returnUri]);return typeof browserResult==='function'?browserResult(url,returnUri):browserResult;}};
const oauthUser={id:'11111111-1111-4111-8111-111111111111',email:'oauth@example.invalid',created_at:'2026-10-13T00:00:00Z',user_metadata:{full_name:'OAuth Native'},app_metadata:{provider:'google'}};
const emailUser={...oauthUser,id:'22222222-2222-4222-8222-222222222222',email:'newer@example.invalid',app_metadata:{provider:'email'}};
const sessionFor=user=>({user,access_token:'synthetic-token-'+user.id,refresh_token:'synthetic-refresh-'+user.id,expires_at:Math.ceil(Date.now()/1000)+3600});
let lastOptions,lastClient;
globalThis.maliTestCreateClient=(url,_key,options)=>{
  lastOptions=options;const storage=options.auth.storage,key=options.auth.storageKey;
  const read=async()=>{const raw=await storage.getItem(key);return raw?JSON.parse(raw):null;};
  const auth={
    getSession:async()=>({data:{session:await read()},error:null}),
    signInWithOAuth:async request=>{
      calls.push(['prepare',request]);const[challenge,method,flowId]=await sdk.getCodeChallengeAndMethod(storage,key);
      if(prepareError)return{data:{url:null,flowId},error:new Error('synthetic-provider-secret')};
      const authorization=new URL(url+'/auth/v1/authorize');
      for(const[name,value]of Object.entries({provider:request.provider,redirect_to:request.options.redirectTo,code_challenge:challenge,code_challenge_method:method}))authorization.searchParams.set(name,value);
      return{data:{url:authorization.toString(),flowId},error:null};
    },
    exchangeCodeForSession:async(code,options)=>{
      calls.push(['exchange',code,options]);assert.ok((await sdk.retrievePKCEVerifier(storage,key,options.flowId)).verifier);
      if(exchangeDelay)await exchangeDelay;
      await sdk.removePKCEVerifier(storage,key,options.flowId);const session=sessionFor(oauthUser);await storage.setItem(key,JSON.stringify(session));for(const callback of subscribers)callback('SIGNED_IN',session);return{data:{session,user:oauthUser},error:null};
    },
    getUser:async token=>{calls.push(['verify',token]);if(token&&verificationDelay)await verificationDelay;if(onVerify)await onVerify(storage,key);return{data:{user:verifyError?null:oauthUser},error:verifyError?new Error('synthetic-server-secret'):null};},
    signOut:async request=>{calls.push(['signOut',request]);await storage.removeItem(key);await sdk.removeAllPKCEVerifiers(storage,key);return{error:null};},
    signInWithPassword:async()=>{calls.push(['email']);const session=sessionFor(emailUser);await storage.setItem(key,JSON.stringify(session));return{data:{session,user:emailUser},error:null};},
    onAuthStateChange:callback=>{subscribers.add(callback);return{data:{subscription:{unsubscribe:()=>{subscribers.delete(callback);}}}};},
  };
  lastClient={auth};return lastClient;
};
installNativeTestLoader();
registerHooks({resolve(specifier,context,next){
  const sources={
    'expo-auth-session':'export const makeRedirectUri=(...a)=>globalThis.maliOAuthPlatform.makeRedirectUri(...a);export const dismiss=()=>globalThis.maliOAuthPlatform.dismiss();',
    'expo-web-browser':'export const openAuthSessionAsync=(...a)=>globalThis.maliOAuthPlatform.open(...a);',
    'expo-crypto':'export const getRandomValues=(...a)=>globalThis.maliOAuthCrypto.getRandomValues(...a);export const digest=(...a)=>globalThis.maliOAuthCrypto.digest(...a);export const CryptoDigestAlgorithm={SHA256:"SHA-256"};',
  };
  if(sources[specifier])return{url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};
  return next(specifier,context);
}});
const service=await import('../src/services/authService.ts');
const config={url:'https://native.example.invalid',anonKey:'publishable-test',workspaceKey:'unused',autoSync:false};
function reset(){legacy.clear();secure.clear();calls.length=0;subscribers.clear();prepareError=false;verifyError=false;exchangeDelay=null;verificationDelay=null;onVerify=null;redirect='mali://auth/callback';secureAvailable=true;randomCalls=0;digestCalls=0;
  globalThis.maliTestPlatform.OS='ios';browserResult={type:'success',url:'mali://auth/callback?code=synthetic-code'};
  Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
}
const tick=async()=>{for(let n=0;n<80;n++)await Promise.resolve();};
test.after(()=>{if(originalCrypto)Object.defineProperty(globalThis,'crypto',originalCrypto);else delete globalThis.crypto;});

test('real native auth consumer uses Expo57 browser, SDK SHA256 PKCE and one verified code exchange with SecureStore',async()=>{
  reset();const result=await service.signInWithSocialProvider('google',undefined,config);
  assert.equal(result.success,true);assert.equal(result.user.id,oauthUser.id);assert.equal(lastOptions.auth.flowType,'pkce');assert.equal(lastOptions.auth.detectSessionInUrl,false);
  const prepare=calls.find(c=>c[0]==='prepare')[1];assert.equal(prepare.options.redirectTo,'mali://auth/callback');assert.equal(prepare.options.skipBrowserRedirect,true);
  const browser=calls.find(c=>c[0]==='browser');assert.equal(browser[2],'mali://auth/callback');assert.equal(new URL(browser[1]).searchParams.get('code_challenge_method'),'s256');
  assert.ok(randomCalls>=2);assert.equal(digestCalls,1);assert.equal(calls.filter(c=>c[0]==='exchange').length,1);assert.match(calls.find(c=>c[0]==='exchange')[2].flowId,/^[0-9a-f]{32}$/);
  assert.equal(calls.find(c=>c[0]==='verify')[1],sessionFor(oauthUser).access_token);assert.equal(legacy.has(lastOptions.auth.storageKey),false);
  assert.equal(JSON.parse(legacy.get('mali_auth_session_v2')).id,oauthUser.id);assert.ok(secure.size>0);
});
test('real Facebook consumer routes the supported provider through the same native code owner',async()=>{
  reset();const result=await service.launchSocialOAuthWindow('facebook',config);assert.equal(result.success,true);assert.equal(calls.find(c=>c[0]==='prepare')[1].provider,'facebook');
});
test('same native request joins one attempt and another provider cannot replace its browser',async()=>{
  reset();let release,entered;const started=new Promise(r=>{entered=r;});browserResult=()=>{entered();return new Promise(r=>{release=r;});};
  const first=service.signInWithSocialProvider('google',undefined,config),second=service.launchSocialOAuthWindow('google',config);await started;
  assert.equal((await service.launchSocialOAuthWindow('facebook',config)).failureKind,'busy');release({type:'success',url:'mali://auth/callback?code=only-once'});
  assert.equal((await first).success,true);assert.equal((await second).success,true);assert.equal(calls.filter(c=>c[0]==='prepare').length,1);assert.equal(calls.filter(c=>c[0]==='exchange').length,1);
});
test('native cancellation and error-query responses are generic and clean PKCE without clearing an existing session',async()=>{
  for(const response of [{type:'cancel'},{type:'dismiss'},{type:'success',url:'mali://auth/callback?error_description=synthetic-secret'}]){
    reset();service.getSharedSupabaseClient(config);await lastOptions.auth.storage.setItem(lastOptions.auth.storageKey,JSON.stringify(sessionFor(emailUser)));browserResult=response;
    const result=await service.launchSocialOAuthWindow('google',config);assert.equal(result.success,false);assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
    assert.equal(calls.some(c=>c[0]==='exchange'),false);assert.equal(calls.some(c=>c[0]==='signOut'),false);
    assert.equal((await lastClient.auth.getSession()).data.session.user.id,emailUser.id);assert.equal(await lastOptions.auth.storage.getItem(lastOptions.auth.storageKey+'-flows-code-verifier'),null);
  }
});
test('logout cancels native browser promptly, late callback is ignored and verifier/session removal remains secure',async()=>{
  reset();let release,entered;const started=new Promise(r=>{entered=r;});browserResult=()=>{entered();return new Promise(r=>{release=r;});};
  const pending=service.launchSocialOAuthWindow('google',config);await started;await service.clearAuthSession(config);
  assert.equal((await pending).failureKind,'stale');release({type:'success',url:'mali://auth/callback?code=late'});await tick();assert.equal(calls.some(c=>c[0]==='exchange'),false);
  assert.equal((await lastClient.auth.getSession()).data.session,null);assert.equal(legacy.has('mali_auth_session_v2'),false);
});
test('new email login cancels waiting native attempt and preserves the newer verified session',async()=>{
  reset();let release,entered;const started=new Promise(r=>{entered=r;});browserResult=()=>{entered();return new Promise(r=>{release=r;});};
  const pending=service.launchSocialOAuthWindow('google',config);await started;const newer=await service.loginWithEmail(emailUser.email,'synthetic-password',config);
  assert.equal(newer.user.id,emailUser.id);assert.equal((await pending).failureKind,'stale');release({type:'success',url:'mali://auth/callback?code=late'});await tick();
  assert.equal((await lastClient.auth.getSession()).data.session.user.id,emailUser.id);assert.equal(JSON.parse(legacy.get('mali_auth_session_v2')).id,emailUser.id);
});
test('intent change during code exchange cannot adopt old user or clear the queued new login',async()=>{
  reset();let release;exchangeDelay=new Promise(r=>{release=r;});const pending=service.launchSocialOAuthWindow('google',config);
  while(!calls.some(c=>c[0]==='exchange'))await new Promise(r=>setImmediate(r));
  const newer=service.loginWithEmail(emailUser.email,'synthetic-password',config);release();assert.equal((await newer).success,true);assert.equal((await pending).failureKind,'stale');
  assert.equal((await lastClient.auth.getSession()).data.session.user.id,emailUser.id);assert.equal(calls.some(c=>c[0]==='signOut'),false);
});
test('failed native identity verification removes only the session written by its exchange',async()=>{
  reset();verifyError=true;const result=await service.launchSocialOAuthWindow('google',config);assert.equal(result.failureKind,'verification');assert.equal((await lastClient.auth.getSession()).data.session,null);assert.equal(legacy.has('mali_auth_session_v2'),false);
  reset();onVerify=async(storage,key)=>{await storage.setItem(key,JSON.stringify(sessionFor(emailUser)));};
  const mismatch=await service.launchSocialOAuthWindow('google',config);assert.equal(mismatch.failureKind,'verification');assert.equal(calls.some(c=>c[0]==='signOut'),false);assert.equal((await lastClient.auth.getSession()).data.session.user.id,emailUser.id);
});
test('Expo Go, unavailable native storage and provider preparation failures never open a browser or leak errors',async()=>{
  reset();redirect='exp://expo-go';assert.equal((await service.launchSocialOAuthWindow('google',config)).failureKind,'unsupported');assert.equal(calls.some(c=>c[0]==='prepare'),false);
  reset();secureAvailable=false;assert.equal((await service.launchSocialOAuthWindow('google',config)).success,false);assert.equal(calls.some(c=>c[0]==='browser'),false);assert.equal(legacy.has('mali_auth_session_v2'),false);
  reset();prepareError=true;const result=await service.launchSocialOAuthWindow('google',config);assert.equal(result.failureKind,'provider');assert.ok(!JSON.stringify(result).includes('synthetic-provider-secret'));assert.equal(calls.some(c=>c[0]==='browser'),false);
});
test('native redirect helper and crypto bridge preserve existing web crypto rather than replacing it',async()=>{
  reset();assert.ok(service.getSupabaseOAuthRedirectUrl('google',config).includes(encodeURIComponent('mali://auth/callback')));
  const {ensureNativePkceCrypto}=await import('../src/services/nativeOAuthPlatform.ts');Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});ensureNativePkceCrypto();assert.equal(globalThis.crypto,webcrypto);assert.equal(randomCalls,0);assert.equal(digestCalls,0);
});
test('native auth events cannot publish an identity before its owning flow is accepted',async()=>{
  reset();let release;verificationDelay=new Promise(r=>{release=r;});const identities=[];
  const unsubscribe=service.subscribeToAuthIdentity(user=>identities.push(user),config),pending=service.launchSocialOAuthWindow('google',config);
  while(!calls.some(c=>c[0]==='verify'&&c[1]))await new Promise(r=>setImmediate(r));
  await new Promise(r=>setTimeout(r,5));assert.equal(identities.length,0);
  verifyError=true;release();assert.equal((await pending).failureKind,'verification');await new Promise(r=>setTimeout(r,5));assert.equal(identities.some(user=>user?.id===oauthUser.id),false);unsubscribe();
});
test('changing the client project cancels a native callback without touching the new project session',async()=>{
  reset();let release,entered;const started=new Promise(r=>{entered=r;});browserResult=()=>{entered();return new Promise(r=>{release=r;});};
  const pending=service.launchSocialOAuthWindow('google',config);await started;
  const nextClient=service.getSharedSupabaseClient({...config,url:'https://other.example.invalid'});await lastOptions.auth.storage.setItem(lastOptions.auth.storageKey,JSON.stringify(sessionFor(emailUser)));
  assert.equal((await pending).failureKind,'stale');release({type:'success',url:'mali://auth/callback?code=late'});await tick();
  assert.equal((await nextClient.auth.getSession()).data.session.user.id,emailUser.id);assert.equal(calls.some(c=>c[0]==='exchange'),false);
});
