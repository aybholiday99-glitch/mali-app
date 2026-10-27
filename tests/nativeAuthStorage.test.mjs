import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { createNativeAuthStorage } from '../src/services/nativeAuthStorageCore.ts';

const KEY = 'mali_supabase_auth_example.supabase.co';
const hex = key => [...key].map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
const prefix = key => 'mali_auth_secure_v1.' + hex(KEY) + '.' + hex(key);
const flow = id => `${KEY}-flow-${id.repeat(32)}-code-verifier`;
function fixture({ secure = new Map(), legacy = new Map() } = {}) {
  let available = true, operations = 0, crashAt = null, hook = null, legacyFailure = false;
  const secureOp = async (kind,key,value) => {
    if (hook) await hook(kind,key,value);
    let result;
    if (kind === 'set') secure.set(key,value);
    if (kind === 'remove') secure.delete(key);
    if (kind === 'get') result=secure.get(key)??null;
    operations++;
    if (operations===crashAt) throw new Error('native error containing synthetic secret');
    return result;
  };
  const deps = {
    secure: { getItem:key=>secureOp('get',key), setItem:(key,value)=>secureOp('set',key,value), removeItem:key=>secureOp('remove',key) },
    legacy: {
      getItem:async key=>legacy.get(key)??null,
      setItem:async(key,value)=>{ legacy.set(key,value); },
      removeItem:async key=>{ if(legacyFailure)throw new Error('legacy unavailable'); legacy.delete(key); },
      getAllKeys:async()=>[...legacy.keys()],
    },
    isAvailable:async()=>available,
  };
  return { secure,legacy,deps, adapter:()=>createNativeAuthStorage(KEY,deps),
    reset:()=>{operations=0;crashAt=null;}, count:()=>operations,
    crash:n=>{operations=0;crashAt=n;}, available:value=>{available=value;},
    hook:value=>{hook=value;}, legacyFailure:value=>{legacyFailure=value;},
  };
}

test('native migration verifies exact committed secure read-back before removing plaintext',async()=>{
  const f=fixture(), value=JSON.stringify({access_token:'synthetic',refresh_token:'refresh',user:{name:'اسم 😀'}});
  f.legacy.set(KEY,value);
  let committed=false;
  f.hook(async(kind,key)=>{
    if(kind==='set'&&key.endsWith('.head'))assert.equal(f.legacy.get(KEY),value);
    if(kind==='get'&&key.endsWith('.head')&&f.secure.has(key))committed=true;
  });
  assert.equal(await f.adapter().getItem(KEY),value);
  assert.equal(committed,true);
  assert.equal(f.legacy.has(KEY),false);
  assert.equal(await f.adapter().getItem(KEY),value);
});

test('large multilingual payloads use values below native 2KB limits without changing one code unit',async()=>{
  const f=fixture();
  const value='😀اسم\n\t\0'.repeat(1800)+'\ud800';
  f.hook(async(kind,_key,raw)=>{if(kind==='set')assert.ok(Buffer.byteLength(raw,'utf8')<2048);});
  await f.adapter().setItem(KEY,value);
  assert.equal(await f.adapter().getItem(KEY),value);
  assert.equal(f.legacy.size,0);
});

test('unavailable native storage never returns or writes plaintext credentials',async()=>{
  const f=fixture();f.legacy.set(KEY,'retained original');f.available(false);
  await assert.rejects(f.adapter().getItem(KEY),/Secure authentication storage/);
  await assert.rejects(f.adapter().setItem(KEY,'new token'),/Secure authentication storage/);
  assert.equal(f.legacy.get(KEY),'retained original');
  assert.equal(f.secure.size,0);
});

test('failed read-back retains plaintext and exposes only a generic error',async()=>{
  const f=fixture();f.legacy.set(KEY,'sensitive synthetic content');
  f.hook(async(kind,key)=>{if(kind==='get'&&key.endsWith('.a.0'))throw new Error('sensitive synthetic content');});
  await assert.rejects(f.adapter().getItem(KEY),error=>!error.message.includes('sensitive')&&/could not be verified/.test(error.message));
  assert.equal(f.legacy.get(KEY),'sensitive synthetic content');
  assert.equal(f.secure.has(prefix(KEY)+'.head'),false);
});

test('a fulfilled native write with changed bytes fails verification and preserves the legacy source',async()=>{
  const f=fixture();f.legacy.set(KEY,'original source');
  const write=f.deps.secure.setItem;
  f.deps.secure.setItem=(key,value)=>write(key,key.endsWith('.a.0')?JSON.stringify('corrupt payload'):value);
  await assert.rejects(f.adapter().getItem(KEY));
  assert.equal(f.legacy.get(KEY),'original source');
  assert.equal(f.secure.has(prefix(KEY)+'.head'),false);
});

test('a fulfilled native deletion that retains bytes cannot report successful logout cleanup',async()=>{
  const f=fixture();await f.adapter().setItem(KEY,'stored');
  const remove=f.deps.secure.removeItem;
  f.deps.secure.removeItem=key=>key.endsWith('.a.0')?Promise.resolve():remove(key);
  await assert.rejects(f.adapter().removeItem(KEY));
  assert.equal(await f.adapter().getItem(KEY),null);
});

test('every interrupted replacement preserves a complete old or new secure value after restart',async t=>{
  const old='old'.repeat(150), next='new😀'.repeat(180);
  const initial=fixture();await initial.adapter().setItem(KEY,old);
  const before=new Map(initial.secure);
  const reference=fixture({secure:new Map(before)});await reference.adapter().setItem(KEY,next);
  for(let n=1;n<=reference.count();n++)await t.test('interruption at secure operation '+n,async()=>{
    const f=fixture({secure:new Map(before)});f.crash(n);
    await assert.rejects(f.adapter().setItem(KEY,next));f.reset();
    const restored=await f.adapter().getItem(KEY);
    assert.ok(restored===old||restored===next);
  });
});

test('every interrupted migration retains exact legacy bytes or verified secure bytes',async t=>{
  const value='migration😀'.repeat(140), reference=fixture();reference.legacy.set(KEY,value);
  await reference.adapter().getItem(KEY);
  for(let n=1;n<=reference.count();n++)await t.test('migration interruption '+n,async()=>{
    const f=fixture();f.legacy.set(KEY,value);f.crash(n);
    await assert.rejects(f.adapter().getItem(KEY));f.reset();
    if(f.legacy.has(KEY))assert.equal(f.legacy.get(KEY),value);
    assert.equal(await f.adapter().getItem(KEY),value);
  });
});

test('corrupt secure manifests and missing active chunks fail closed rather than resurrecting legacy tokens',async()=>{
  for(const corruption of ['head','chunk']){
    const f=fixture();await f.adapter().setItem(KEY,'stored token');
    f.legacy.set(KEY,'old plaintext');
    if(corruption==='head')f.secure.set(prefix(KEY)+'.head','{invalid');
    else f.secure.delete(prefix(KEY)+'.a.0');
    await assert.rejects(f.adapter().getItem(KEY));
    assert.equal(f.legacy.get(KEY),'old plaintext');
  }
});

test('logout tombstone survives failed chunk cleanup and blocks old plaintext after restart',async()=>{
  const f=fixture();await f.adapter().setItem(KEY,'stored token');f.legacy.set(KEY,'old plaintext');
  f.hook(async(kind,key)=>{if(kind==='remove'&&key.endsWith('.a.0'))throw new Error('delete unavailable');});
  await assert.rejects(f.adapter().removeItem(KEY));f.hook(null);
  f.legacy.set(KEY,'old writer reappeared');
  assert.equal(await f.adapter().getItem(KEY),null);
  assert.equal(f.legacy.has(KEY),false);
  await f.adapter().removeItem(KEY);
  assert.equal([...f.secure.keys()].some(k=>k.startsWith(prefix(KEY)+'.a.')),false);
});

test('logout refuses successful credential-removal acknowledgement when legacy removal fails',async()=>{
  const f=fixture();await f.adapter().setItem(KEY,'stored');f.legacy.set(KEY,'old');f.legacyFailure(true);
  await assert.rejects(f.adapter().removeItem(KEY));
  assert.equal(JSON.parse(f.secure.get(prefix(KEY)+'.head')).state,'deleted');
  f.legacyFailure(false);assert.equal(await f.adapter().getItem(KEY),null);
});

test('logout clears current session, user, fixed verifier and indexed flow slots after restart',async()=>{
  const f=fixture(), adapter=f.adapter();
  const keys=[KEY,KEY+'-user',KEY+'-code-verifier',flow('a'),flow('b')];
  for(const key of keys)await adapter.setItem(key,'synthetic value for '+key);
  await adapter.setItem(KEY+'-flows-code-verifier',JSON.stringify(['a'.repeat(32),'b'.repeat(32)]));
  f.legacy.set(flow('c'),'unmigrated legacy verifier');
  await f.adapter().clearAll();
  for(const key of [...keys,KEY+'-flows-code-verifier',flow('c')])assert.equal(await f.adapter().getItem(key),null);
  assert.equal(f.legacy.size,0);
  for(const [name,raw] of f.secure)if(!name.endsWith('.epoch'))assert.equal(JSON.parse(raw).state,'deleted');
});

test('operations serialize so a delayed write cannot complete after logout and recreate credentials',async()=>{
  const f=fixture(),adapter=f.adapter();let release,entered;
  const blocked=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});let once=false;
  f.hook(async(kind,key)=>{if(!once&&kind==='set'&&key.endsWith('.a.0')){once=true;entered();await blocked;}});
  const write=adapter.setItem(KEY,'new token');await started;
  const remove=adapter.removeItem(KEY);release();await write;await remove;
  assert.equal(await f.adapter().getItem(KEY),null);
});

test('value limits and namespace isolation preserve existing credentials on rejection',async()=>{
  const f=fixture(),adapter=f.adapter();await adapter.setItem(KEY,'original');
  await assert.rejects(adapter.setItem(KEY,'x'.repeat(256*512+1)));
  await assert.rejects(adapter.getItem('other-project-auth'));
  assert.equal(await adapter.getItem(KEY),'original');
});

test('empty strings are copied exactly and stale inactive tails are removed on shorter replacements',async()=>{
  const f=fixture(),adapter=f.adapter();
  await adapter.setItem(KEY,'long'.repeat(300));await adapter.setItem(KEY,'other'.repeat(100));
  await adapter.setItem(KEY,'');assert.equal(await adapter.getItem(KEY),'');
  assert.equal([...f.secure.keys()].filter(k=>/\.[ab]\.[0-9]+$/.test(k)).length,0);
});

test('namespace revocation blocks an unindexed PKCE verifier after restart and successful logout',async()=>{
  const f=fixture();
  // Actual SDK order: write the flow slot, then write its discoverable index.
  await f.adapter().setItem(flow('d'),'orphaned synthetic verifier');
  await f.adapter().clearAll();
  assert.equal(await f.adapter().getItem(flow('d')),null);
  // Even an old plaintext writer cannot resurrect an already revoked slot.
  f.legacy.set(flow('d'),'old plaintext verifier');
  assert.equal(await f.adapter().getItem(flow('d')),null);
  assert.equal(f.legacy.has(flow('d')),false);
});

test('unavailable secure logout persists a credential-free fence across restart until proven cleanup',async()=>{
  const f=fixture();await f.adapter().setItem(KEY,'stored');await f.adapter().setItem(flow('e'),'verifier');
  f.available(false);
  await assert.rejects(f.adapter().clearAll());
  const fence='@mali_auth_logout_fence_v1_'+hex(KEY);
  assert.equal(f.legacy.get(fence),'logout-pending');
  f.available(true);
  const restarted=f.adapter();
  assert.equal(await restarted.getItem(KEY),null);
  assert.equal(await restarted.getItem(flow('e')),null);
  await assert.rejects(restarted.setItem(KEY,'new login before cleanup'));
  await restarted.clearAll();
  assert.equal(f.legacy.has(fence),false);
  assert.equal(await f.adapter().getItem(KEY),null);
  assert.equal(await f.adapter().getItem(flow('e')),null);
  await restarted.setItem(KEY,'new login after cleanup');
  assert.equal(await restarted.getItem(KEY),'new login after cleanup');
});

test('failed secure epoch replacement or chunk cleanup keeps the logout fence through restart',async()=>{
  for(const failure of ['epoch','chunk']){
    const f=fixture();await f.adapter().setItem(KEY,'stored');
    f.hook(async(kind,key)=>{
      if((failure==='epoch'&&kind==='set'&&key.endsWith('.epoch'))
        ||(failure==='chunk'&&kind==='remove'&&key.endsWith('.a.0')))throw new Error('native denied');
    });
    await assert.rejects(f.adapter().clearAll());
    f.hook(null);
    assert.equal(await f.adapter().getItem(KEY),null);
    await assert.rejects(f.adapter().setItem(KEY,'premature login'));
    await f.adapter().clearAll();
    assert.equal(await f.adapter().getItem(KEY),null);
  }
});

test('logout refuses to acknowledge an unverified durable fence',async()=>{
  const f=fixture();await f.adapter().setItem(KEY,'stored');
  f.deps.legacy.setItem=async()=>{};
  await assert.rejects(f.adapter().clearAll());
  // No irreversible native revocation is claimed if the ordinary store itself
  // cannot persist the fence. The caller receives a cleanup failure.
  assert.equal(await f.adapter().getItem(KEY),'stored');
});

test('strict SDK grammar rejects prefix-host keys and preserves their legacy credentials on logout',async()=>{
  const f=fixture(),foreign=KEY+'-secondary',value=JSON.stringify({access_token:'foreign access',refresh_token:'foreign refresh'});
  f.legacy.set(foreign,value);
  await assert.rejects(f.adapter().getItem(foreign));
  await assert.rejects(f.adapter().setItem(foreign,'overwrite'));
  await assert.rejects(f.adapter().removeItem(foreign));
  await f.adapter().clearAll();
  assert.equal(f.legacy.get(foreign),value);
  const other=createNativeAuthStorage(foreign,f.deps);
  assert.equal(await other.getItem(foreign),value);
  await f.adapter().clearAll();
  assert.equal(await other.getItem(foreign),value);
});

test('session-shaped suffix-host credentials cannot be migrated or deleted by the shorter project',async()=>{
  for(const suffix of ['-user','-code-verifier','-flows-code-verifier']){
    const f=fixture(),foreign=KEY+suffix,value=JSON.stringify({access_token:'foreign access',refresh_token:'foreign refresh',user:{id:'foreign'}});
    f.legacy.set(foreign,value);
    assert.equal(await f.adapter().getItem(foreign),null);
    await f.adapter().removeItem(foreign);
    await f.adapter().clearAll();
    assert.equal(f.legacy.get(foreign),value);
    const other=createNativeAuthStorage(foreign,f.deps);
    assert.equal(await other.getItem(foreign),value);
    // The same logical string is an A suffix and B base; secure physical
    // addresses and revocation generations remain separately namespaced.
    const ownValue=suffix==='-flows-code-verifier'?'[]':'own verifier or user';
    await f.adapter().setItem(foreign,ownValue);
    assert.equal(await f.adapter().getItem(foreign),ownValue);
    assert.equal(await other.getItem(foreign),value);
    await f.adapter().clearAll();
    assert.equal(await other.getItem(foreign),value);
  }
});

test('PKCE key grammar matches validated SDK flow IDs and rejects unsupported keys',async()=>{
  const f=fixture(),id='Flow_123-TEST';
  const slot=KEY+'-flow-'+id+'-code-verifier';
  await f.adapter().setItem(slot,'verifier');
  await f.adapter().setItem(KEY+'-flows-code-verifier',JSON.stringify([id]));
  await f.adapter().clearAll();
  assert.equal(await f.adapter().getItem(slot),null);
  for(const invalid of [KEY+'-unrecognized',KEY+'-flow-short-code-verifier',KEY+'-flow-'+ 'x'.repeat(65) +'-code-verifier']){
    await assert.rejects(f.adapter().getItem(invalid));
  }
});
