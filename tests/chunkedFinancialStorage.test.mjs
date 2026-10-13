import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { createChunkedFinancialStorage } from '../src/services/chunkedFinancialStorage.ts';

const KEY='@mali_app_state_v2_11111111-1111-4111-8111-111111111111';
function fixture(){
  const values=new Map();let writes=0,failAt=Infinity;
  const backend={getItem:async key=>values.get(key)??null,setItem:async(key,value)=>{
    writes++;if(writes===failAt) throw new Error('simulated disk failure');
    assert.ok(Buffer.byteLength(value)<200_000);values.set(key,value);
  },removeItem:async key=>values.delete(key),getAllKeys:async()=>[...values.keys()]};
  return {values,backend,store:createChunkedFinancialStorage(backend),failAfter:n=>{failAt=writes+n;}};
}
test('Arabic and supplementary characters in a vault over2MiB survive chunking and restart',async()=>{
  const f=fixture(),raw=JSON.stringify({accounts:[],receipt:'مالي💰'.repeat(350000)});
  assert.ok(Buffer.byteLength(raw)>2*1024*1024);
  await f.store.setItem(KEY,raw);assert.equal(await createChunkedFinancialStorage(f.backend).getItem(KEY),raw);
  assert.equal(f.values.get(KEY),undefined);
});
test('every interrupted replacement retains the exact previously committed vault',async()=>{
  for(let step=1;step<=5;step++) {
    const f=fixture(),old='old vault evidence',replacement='new'.repeat(70000);
    await f.store.setItem(KEY,old);f.failAfter(step);
    if(step<=5) await assert.rejects(f.store.setItem(KEY,replacement));
    assert.equal(await createChunkedFinancialStorage(f.backend).getItem(KEY),old);
  }
});
test('lost commit acknowledgement is accepted only after complete exact read-back',async()=>{
  const f=fixture();await f.store.setItem(KEY,'old');
  const real=f.backend.setItem;
  f.backend.setItem=async(key,value)=>{await real(key,value);if(key.endsWith(':head'))throw new Error('lost acknowledgement');};
  const store=createChunkedFinancialStorage(f.backend);await store.setItem(KEY,'new');assert.equal(await store.getItem(KEY),'new');
});
test('chunk boundaries preserve surrogate pairs through native UTF-8 storage',async()=>{
  const f=fixture(),raw='A'.repeat(65535)+'💰'+'B'.repeat(65535)+'💰';
  const real=f.backend.setItem;
  f.backend.setItem=(key,value)=>real(key,Buffer.from(value,'utf8').toString('utf8'));
  await f.store.setItem(KEY,raw);assert.equal(await f.store.getItem(KEY),raw);
});
test('a silent chunk write cannot commit or remove legacy bytes',async()=>{
  const f=fixture();f.values.set(KEY,'legacy originals');
  f.backend.setItem=async()=>{};
  await assert.rejects(f.store.setItem(KEY,'new'));assert.equal(await f.store.getItem(KEY),'legacy originals');
});
test('corrupt or missing current chunks fail closed without a stale legacy fallback',async()=>{
  for(const mutation of ['corrupt','missing','head']){
    const f=fixture();await f.store.setItem(KEY,'new originals');f.values.set(KEY,'old stale vault');
    const key=[...f.values.keys()].find(key=>key.endsWith(':0:0'));
    if(mutation==='corrupt')f.values.set(key,'bad originals');
    if(mutation==='missing')f.values.delete(key);
    if(mutation==='head')f.values.set([...f.values.keys()].find(key=>key.endsWith(':head')),'{}');
    await assert.rejects(f.store.getItem(KEY));await assert.rejects(f.store.setItem(KEY,'blank replacement'));
    assert.equal(f.values.get(KEY),'old stale vault');
  }
});
test('large failed first migration and legacy cleanup failures preserve original data',async()=>{
  const f=fixture();f.values.set(KEY,'legacy');f.failAfter(2);
  await assert.rejects(f.store.setItem(KEY,'new'.repeat(70000)));assert.equal(f.values.get(KEY),'legacy');
  const other=fixture();other.values.set(KEY,'legacy');other.backend.removeItem=async()=>{throw new Error('cleanup failure');};
  await other.store.setItem(KEY,'verified new');assert.equal(other.values.get(KEY),'legacy');assert.equal(await other.store.getItem(KEY),'verified new');
});
test('owner queues isolate failures and serialize each complete write and read',async()=>{
  const f=fixture();const first=f.store.setItem(KEY,'first'.repeat(30000));
  const second=f.store.setItem(KEY,'second');const read=f.store.getItem(KEY);
  await Promise.all([first,second,f.store.setItem(KEY+'_other','other')]);
  assert.equal(await read,'second');assert.equal(await f.store.getItem(KEY+'_other'),'other');
});
test('cross-tab lock covers the full read and commit operation',async()=>{
  const f=fixture();let locks=0,inLock=false;
  const store=createChunkedFinancialStorage(f.backend,async(key,action)=>{
    assert.equal(key,KEY);assert.equal(inLock,false);inLock=true;locks++;try{return await action();}finally{inLock=false;}
  });
  await store.setItem(KEY,'verified');assert.equal(await store.getItem(KEY),'verified');assert.equal(locks,2);
});
test('a missing enrolled head cannot resurrect stale legacy after cleanup failed',async()=>{
  const f=fixture();f.values.set(KEY,'stale legacy');f.backend.removeItem=async()=>{throw new Error('cleanup failure');};
  await f.store.setItem(KEY,'current vault');f.values.delete([...f.values.keys()].find(key=>key.endsWith(':head')));
  await assert.rejects(f.store.getItem(KEY));await assert.rejects(f.store.setItem(KEY,'blank'));
  assert.equal(f.values.get(KEY),'stale legacy');
});
test('two adapters sharing the native backend serialize acknowledged commits',async()=>{
  const f=fixture();await f.store.setItem(KEY,'original');
  const other=createChunkedFinancialStorage(f.backend);
  await Promise.all([f.store.setItem(KEY,'from A'),other.setItem(KEY,'from B')]);
  assert.equal(await f.store.getItem(KEY),'from B');
});
test('inactive large chunk tails are pruned while the current and prior vault stay intact',async()=>{
  const f=fixture();await f.store.setItem(KEY,'L'.repeat(1024*1024));
  await f.store.setItem(KEY,'small');await f.store.setItem(KEY,'tiny');
  const parts=[...f.values].filter(([key])=>/:[01]:\d+$/.test(key));
  assert.equal(parts.reduce((sum,[,value])=>sum+value.length,0),9);assert.equal(await f.store.getItem(KEY),'tiny');
});
test('explicit recovery preserves corrupt owned evidence before replacing metadata',async()=>{
  const f=fixture();await f.store.setItem(KEY,'original');
  const headKey=[...f.values.keys()].find(key=>key.endsWith(':head'));f.values.set(headKey,'corrupt original head');
  f.values.set('unrelated-auth-token','never touch');
  const evidenceKey=await f.store.recoverItem(KEY,'validated replacement');
  assert.equal(await f.store.getItem(KEY),'validated replacement');
  const evidence=JSON.parse(await f.store.getItem(evidenceKey));
  assert.ok(evidence.originals.some(row=>row.key===headKey && row.value==='corrupt original head'));
  assert.equal(evidence.originals.some(row=>row.key==='unrelated-auth-token'),false);assert.equal(f.values.get('unrelated-auth-token'),'never touch');
});
test('failed recovery evidence write cannot overwrite any corrupt original key',async()=>{
  const f=fixture();await f.store.setItem(KEY,'original');
  const headKey=[...f.values.keys()].find(key=>key.endsWith(':head'));f.values.set(headKey,'corrupt original head');
  const old=new Map(f.values);f.failAfter(1);
  await assert.rejects(f.store.recoverItem(KEY,'validated replacement'));
  for(const [key,value] of old)assert.equal(f.values.get(key),value);
});
