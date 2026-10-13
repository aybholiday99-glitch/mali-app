import assert from 'node:assert/strict';
import test from 'node:test';
import {performNativeOAuth,NATIVE_OAUTH_REDIRECT} from '../src/services/nativeOAuthCore.ts';
import {SerialQueue} from '../src/services/serialQueue.ts';

const KEY='mali_supabase_auth_native.example.invalid',FLOW='0123456789abcdef0123456789abcdef',NEXT='abcdef0123456789abcdef0123456789';
const USER={id:'user-A',email:'a@example.invalid'},SESSION={user:USER,access_token:'synthetic own token'};
const slot=id=>`${KEY}-flow-${id}-code-verifier`;
const tick=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
function fixture(){
  const storage=new Map(),queue=new SerialQueue(),controller=new AbortController(),calls=[];let session=null,current=true,response={type:'success',url:NATIVE_OAUTH_REDIRECT+'?code=synthetic-code'},verify=USER,dismissed=0,accepted=0;
  const authorization=new URL('https://native.example.invalid/auth/v1/authorize');
  for(const [key,value]of Object.entries({provider:'google',redirect_to:NATIVE_OAUTH_REDIRECT,code_challenge_method:'s256',code_challenge:'a'.repeat(43)}))authorization.searchParams.set(key,value);
  const client={auth:{
    getSession:async()=>({data:{session},error:null}),
    signInWithOAuth:async options=>{calls.push(['prepare',options]);storage.set(slot(FLOW),'"own verifier"');storage.set(KEY+'-code-verifier','"own verifier"');storage.set(KEY+'-flows-code-verifier',JSON.stringify([FLOW]));return{data:{url:authorization.toString(),flowId:FLOW},error:null};},
    exchangeCodeForSession:async(code,options)=>{calls.push(['exchange',code,options]);session=SESSION;return{data:{session:SESSION,user:USER},error:null};},
    getUser:async token=>{calls.push(['verify',token]);return{data:{user:verify},error:null};},
    signOut:async options=>{calls.push(['signOut',options]);session=null;return{error:null};},
  }};
  const deps={client,provider:'google',supabaseUrl:'https://native.example.invalid',storageKey:KEY,
    storage:{getItem:async key=>storage.get(key)??null,setItem:async(key,value)=>{storage.set(key,value);},removeItem:async key=>{storage.delete(key);}},
    browser:{prepareRedirect:()=>NATIVE_OAUTH_REDIRECT,open:async(url,redirect)=>{calls.push(['browser',url,redirect]);return response;},dismiss:()=>{dismissed++;}},
    signal:controller.signal,isCurrent:()=>current,serialize:action=>queue.run(action),acceptVerified:async user=>{accepted++;return{id:user.id,name:'Verified',provider:'google'};}};
  return{deps,client,storage,calls,controller,response:value=>{response=value;},current:value=>{current=value;},session:value=>{session=value;},verify:value=>{verify=value;},accepted:()=>accepted,dismissed:()=>dismissed,run:()=>performNativeOAuth(deps)};
}

test('native PKCE code exchange uses only its flow and accepts server-verified current identity',async()=>{
  const f=fixture();const result=await f.run();assert.equal(result.success,true);assert.equal(result.user.id,USER.id);
  assert.deepEqual(f.calls.find(c=>c[0]==='exchange'),['exchange','synthetic-code',{flowId:FLOW}]);
  assert.equal(f.calls.find(c=>c[0]==='verify')[1],SESSION.access_token);assert.equal(f.calls.filter(c=>c[0]==='exchange').length,1);
  assert.equal(f.calls.find(c=>c[0]==='prepare')[1].options.skipBrowserRedirect,true);assert.equal(f.storage.size,0);
});
test('cancel, dismiss, locked and provider errors are typed and clear only their verifier',async()=>{
  for(const [type,expected]of [['cancel','cancelled'],['dismiss','dismissed'],['locked','busy'],['error','provider']]){
    const f=fixture();f.response({type,error:'synthetic secret'});const result=await f.run();assert.equal(result.failureKind,expected);assert.equal(f.accepted(),0);assert.equal(f.storage.size,0);assert.equal(f.calls.some(c=>c[0]==='exchange'),false);assert.ok(!JSON.stringify(result).includes('synthetic secret'));
  }
});
test('callback target, error query, duplicate code, token and flow mismatch fail without any exchange',async()=>{
  for(const url of ['other://auth/callback?code=x','mali://attacker/callback?code=x','mali://auth/callback-extra?code=x','mali://auth/callback?code=x&code=y','mali://auth/callback?access_token=sensitive','mali://auth/callback?error_description=sensitive','mali://auth/callback?code=x#access_token=sensitive','mali://auth/callback?code=x&sb_flow_id='+NEXT]){
    const f=fixture();f.response({type:'success',url});const result=await f.run();assert.equal(result.success,false);assert.equal(f.calls.some(c=>c[0]==='exchange'),false);assert.ok(!JSON.stringify(result).includes('sensitive'));
  }
});
test('SDK authorization endpoint, SHA256 challenge and native redirect are checked before browser opens',async()=>{
  for(const mutate of [url=>url.origin.replace('native','foreign')+url.pathname+url.search,url=>{url.searchParams.set('code_challenge_method','plain');return url.toString();}]){
    const f=fixture(),prepare=f.client.auth.signInWithOAuth;f.client.auth.signInWithOAuth=async options=>{const result=await prepare(options);result.data.url=mutate(new URL(result.data.url));return result;};
    assert.equal((await f.run()).success,false);assert.equal(f.calls.some(c=>c[0]==='browser'),false);
  }
  const f=fixture();f.deps.browser.prepareRedirect=()=> 'exp://unavailable';assert.equal((await f.run()).failureKind,'unsupported');assert.equal(f.calls.length,0);
});
test('cancelled browser returns promptly and late callback never exchanges or adopts user',async()=>{
  const f=fixture();let release;f.deps.browser.open=()=>new Promise(r=>{release=r;});const pending=f.run();await tick();f.controller.abort();
  assert.equal((await pending).failureKind,'stale');assert.equal(f.dismissed(),1);release({type:'success',url:NATIVE_OAUTH_REDIRECT+'?code=late'});await tick();assert.equal(f.calls.some(c=>c[0]==='exchange'),false);
});
test('newer identity before callback prevents exchange and preserves its PKCE flow and session',async()=>{
  const f=fixture();f.deps.browser.open=async()=>{
    f.session({user:{id:'user-B'},access_token:'newer token'});f.storage.set(slot(NEXT),'"new verifier"');f.storage.set(KEY+'-code-verifier','"new verifier"');f.storage.set(KEY+'-flows-code-verifier',JSON.stringify([FLOW,NEXT]));
    return{type:'success',url:NATIVE_OAUTH_REDIRECT+'?code=old'};
  };
  assert.equal((await f.run()).failureKind,'stale');assert.equal(f.calls.some(c=>c[0]==='exchange'),false);assert.equal(f.calls.some(c=>c[0]==='signOut'),false);
  assert.equal(f.storage.get(slot(NEXT)),'"new verifier"');assert.equal(f.storage.get(KEY+'-code-verifier'),'"new verifier"');assert.equal(f.storage.get(KEY+'-flows-code-verifier'),JSON.stringify([NEXT]));
});
test('failed server verification clears its exchanged session but never a newer user session',async()=>{
  const failed=fixture();failed.verify({id:'wrong-server-user'});assert.equal((await failed.run()).failureKind,'verification');assert.equal(failed.calls.filter(c=>c[0]==='signOut').length,1);assert.equal(failed.accepted(),0);
  const newer=fixture();newer.client.auth.getUser=async()=>{newer.session({user:{id:'user-B'},access_token:'newer token'});return{data:{user:USER},error:null};};
  assert.equal((await newer.run()).failureKind,'verification');assert.equal(newer.calls.some(c=>c[0]==='signOut'),false);assert.equal(newer.accepted(),0);
});
test('intent change during exchange cannot acknowledge the stale result or sign out a newer queued user',async()=>{
  const f=fixture();let release;f.client.auth.exchangeCodeForSession=()=>new Promise(r=>{release=r;});const pending=f.run();await tick();f.current(false);
  const next=f.deps.serialize(async()=>{f.session({user:{id:'user-B'},access_token:'newer token'});});release({data:{session:SESSION,user:USER},error:null});await next;
  assert.equal((await pending).failureKind,'stale');assert.equal(f.accepted(),0);assert.equal(f.calls.some(c=>c[0]==='signOut'),false);
});
test('credential cleanup failure is observable and browser/native error text is generic',async()=>{
  const f=fixture();f.response({type:'cancel'});f.deps.storage.removeItem=async()=>{throw new Error('synthetic secret')};assert.equal((await f.run()).failureKind,'cleanup');
  const broken=fixture();broken.deps.browser.open=async()=>{throw new Error('synthetic secret')};const result=await broken.run();assert.equal(result.failureKind,'unavailable');assert.ok(!JSON.stringify(result).includes('synthetic secret'));
});
test('a newer intent during final verifier cleanup cannot receive an old successful user result',async()=>{
  const f=fixture(),read=f.deps.storage.getItem;
  f.deps.storage.getItem=async key=>{if(f.accepted()&&key===KEY+'-flows-code-verifier')f.current(false);return read(key);};
  assert.equal((await f.run()).failureKind,'stale');
});
