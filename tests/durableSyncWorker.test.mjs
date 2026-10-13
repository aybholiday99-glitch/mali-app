import assert from 'node:assert/strict';
import test from 'node:test';
import { createDurableSyncWorker,retryDelay } from '../src/services/durableSyncWorker.ts';
import { fakeSyncScheduler,settle } from './fakeSyncScheduler.mjs';

const stamp='2026-10-13T00:01:00.123456+00:00';
const saved={ok:true,success:true,updatedAt:stamp,message:'saved'};
const offline={ok:false,success:false,failureKind:'transient',message:'offline'};
function fixture(initial){
  const clock=fakeSyncScheduler(),history=[],calls=[],statuses=[];let disk=initial,result=async()=>saved,fail=false;
  const deps={ownerId:'A',initial,scheduler:clock.scheduler,withBaseline:(payload,baseline)=>({...payload,baseline}),
    persist:async record=>{if(fail)throw new Error('storage denied');disk=structuredClone(record);history.push(disk);},
    send:async(payload,signal)=>{calls.push({payload,signal});assert.equal(disk.pending.revision,payload.revision);assert.ok(disk.attempts>0);return result(payload,signal);},onStatus:s=>statuses.push(s)};
  const worker=createDurableSyncWorker(deps);
  return {clock,history,calls,statuses,worker,deps,disk:()=>disk,result:next=>{result=next;},fail:value=>{fail=value;},enqueue:(revision=1)=>worker.enqueue({revision},revision,'config','baseline')};
}

test('backoff is exponential, jittered and bounded without overflow',()=>{
  assert.equal(retryDelay(1,0),1000);assert.equal(retryDelay(1,1),2000);assert.equal(retryDelay(2,0),2000);
  for(const attempt of [7,16,32,100000]){assert.equal(retryDelay(attempt,1),120000);assert.equal(retryDelay(attempt,0),60000);}
});
test('latest payload and attempt metadata are durable before each network request',async()=>{
  const f=fixture();f.result(async()=>offline);await f.enqueue();f.worker.setActive(true);await f.clock.advance(0);
  assert.equal(f.calls.length,1);assert.equal(f.disk().attempts,1);assert.equal(f.disk().nextAttemptAt,f.clock.now()+1000);
  await f.clock.advance(999);assert.equal(f.calls.length,1);await f.clock.advance(1);assert.equal(f.calls.length,2);
  assert.equal(f.disk().attempts,2);f.worker.dispose();
});
test('restart respects persisted retry time and recovers without a new mutation',async()=>{
  const f=fixture();f.result(async()=>offline);await f.enqueue();await f.worker.flush();f.worker.dispose();
  const restarted=createDurableSyncWorker({...f.deps,initial:f.disk()});restarted.setActive(true);
  await f.clock.advance(999);assert.equal(f.calls.length,1);f.result(async()=>saved);await f.clock.advance(1);
  assert.equal(f.calls.length,2);assert.equal(f.disk().pending,null);restarted.dispose();
});
test('one upload runs at a time and stale acknowledgement rebases the latest revision without losing it',async()=>{
  const f=fixture();let release;f.result(()=>new Promise(r=>{release=r;}));await f.enqueue();const first=f.worker.flush();await settle();
  await f.enqueue(2);assert.equal(f.calls.length,1);assert.equal(f.disk().pending.revision,2);
  release(saved);await first;assert.equal(f.disk().pending.revision,2);assert.equal(f.disk().pending.payload.baseline,stamp);
  f.result(async()=>saved);await f.worker.flush();assert.equal(f.calls.length,2);assert.equal(f.calls[1].payload.revision,2);assert.equal(f.disk().pending,null);f.worker.dispose();
});
test('storage failure prevents any request and retry first persists the latest in-memory payload',async()=>{
  const f=fixture();f.fail(true);await assert.rejects(f.enqueue());assert.equal(f.calls.length,0);assert.equal(f.statuses.at(-1).phase,'storage-error');
  f.fail(false);await f.worker.flush();assert.equal(f.calls.length,1);assert.equal(f.disk().pending,null);f.worker.dispose();
});
test('failed acknowledgement persistence can be retried without sending a second upload',async()=>{
  const f=fixture();await f.enqueue();f.result(async()=>{f.fail(true);return saved;});
  assert.equal((await f.worker.flush()).ok,false);assert.equal(f.calls.length,1);assert.equal(f.disk().pending.revision,1);
  f.fail(false);assert.equal((await f.worker.flush()).ok,true);assert.equal(f.disk().pending,null);assert.equal(f.calls.length,1);f.worker.dispose();
});
test('CAS conflict retains captured local/cloud versions and newer edits, and cannot resume automatically or through manual push',async()=>{
  const f=fixture();let release;await f.enqueue();f.result(()=>new Promise(r=>{release=r;}));const pending=f.worker.flush();await settle();await f.enqueue(2);
  release({...offline,conflictDetected:true,cloudState:{revision:99},updatedAt:stamp});await pending;
  assert.equal(f.disk().stop.reason,'conflict');assert.equal(f.disk().stop.attempted.revision,1);assert.equal(f.disk().pending.revision,2);
  assert.equal(f.disk().stop.result.cloudState.revision,99);await f.enqueue(3);f.worker.setActive(true);f.worker.wake();await f.clock.advance(120000);
  await f.worker.resumeAfterRepair('config');assert.equal((await f.worker.flush()).conflictDetected,true);assert.equal(f.calls.length,1);
  const restarted=createDurableSyncWorker({...f.deps,initial:f.disk()});await restarted.resumeVerifiedSession();restarted.setActive(true);await restarted.flush();assert.equal(f.calls.length,1);
  await restarted.changeConfiguration('other-project');assert.equal(f.disk().stop.reason,'conflict');f.worker.dispose();restarted.dispose();
});
test('resolution requires unchanged blocked record, original owner/config and fresh CAS input',async()=>{
  const f=fixture();f.result(async()=>({...offline,conflictDetected:true,cloudState:{revision:99},updatedAt:stamp}));await f.enqueue();await f.worker.flush();
  const old=f.worker.getRecord();await f.enqueue(2);await assert.rejects(f.worker.resolveConflict(old,{revision:3},3,'config',stamp,true));
  const current=f.worker.getRecord();await assert.rejects(f.worker.resolveConflict(current,{revision:3},3,'other-project',stamp,true));
  await f.worker.resolveConflict(current,{revision:3},3,'config',stamp,true);assert.equal(f.disk().stop,undefined);assert.equal(f.disk().pending.payload.baseline,stamp);
  f.result(async()=>saved);await f.worker.flush();assert.equal(f.disk().pending,null);f.worker.dispose();
});
test('session failures require fresh login; permission/validation/configuration failures do not spin',async()=>{
  for(const kind of ['session','permanent','validation','configuration']){
    const f=fixture();f.result(async()=>({...offline,failureKind:kind}));await f.enqueue();await f.worker.flush();f.worker.setActive(true);f.worker.wake();await f.clock.advance(120000);
    assert.equal(f.calls.length,1);await f.worker.flush();assert.equal(f.calls.length,1);
    if(kind==='session'){await f.worker.resumeAfterRepair('config');assert.equal(f.disk().stop.reason,'session');await f.worker.resumeVerifiedSession();assert.equal(f.disk().stop,undefined);}
    f.worker.dispose();
  }
});
test('logout disposal aborts pending work and ignores every late result',async()=>{
  const f=fixture();let release;f.result(()=>new Promise(r=>{release=r;}));await f.enqueue();const pending=f.worker.flush();await settle();const before=f.history.length;
  f.worker.dispose();const result=await pending;assert.equal(result.ok,false);assert.equal(result.failureKind,'session');assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.clock.size(),0);release(saved);await settle();
  assert.equal(f.history.length,before);assert.equal(f.disk().pending.revision,1);
});
test('foreground suspension cancels scheduling and reconnect wake recovers immediately',async()=>{
  const f=fixture();f.result(async()=>offline);await f.enqueue();f.worker.setActive(true);await f.clock.advance(0);f.worker.setActive(false);
  await f.clock.advance(120000);assert.equal(f.calls.length,1);f.result(async()=>saved);f.worker.setActive(true);f.worker.wake();await settle();
  assert.equal(f.calls.length,2);assert.equal(f.disk().pending,null);f.worker.dispose();
});
test('request timeout aborts transport, preserves pending revision and ignores a later success',async()=>{
  const f=fixture();let release;f.result(()=>new Promise(r=>{release=r;}));await f.enqueue();const pending=f.worker.flush();await settle();await f.clock.advance(30000);
  assert.equal((await pending).failureKind,'transient');assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.disk().pending.revision,1);
  release(saved);await settle();assert.equal(f.disk().syncedAt,'baseline');f.worker.dispose();
});
test('a slow failure waits its backoff after the response instead of immediately spinning',async()=>{
  const f=fixture();let release;f.result(()=>new Promise(r=>{release=r;}));await f.enqueue();const pending=f.worker.flush();await settle();await f.clock.advance(2500);
  release(offline);await pending;assert.equal(f.disk().nextAttemptAt,f.clock.now()+1000);f.worker.dispose();
});
test('config changes cancel in-flight request and persist a stop without replacing its project',async()=>{
  const f=fixture();let release;f.result(()=>new Promise(r=>{release=r;}));await f.enqueue();const pending=f.worker.flush();await settle();await f.worker.changeConfiguration('other');const result=await pending;
  assert.equal(result.ok,false);assert.equal(result.failureKind,'configuration');
  release(saved);await settle();assert.equal(f.disk().stop.reason,'configuration');assert.equal(f.disk().configId,'config');assert.equal(f.disk().syncedAt,'baseline');f.worker.dispose();
});
test('configuration cancellation fences a request still waiting for durable attempt metadata',async()=>{
  const f=fixture();await f.worker.enqueue({revision:1},1,'config',stamp);const original=f.deps.persist;let release,entered;
  const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  f.deps.persist=async record=>{if(record.attempts===1&&!record.stop){entered();await held;}await original(record);};
  const pending=f.worker.flush();await started;const change=f.worker.changeConfiguration('other');release();const result=await pending;await change;
  assert.equal(result.ok,false);assert.equal(result.success,false);assert.equal(result.failureKind,'configuration');
  assert.equal(f.calls.length,0);assert.equal(f.disk().pending.revision,1);assert.equal(f.disk().stop.reason,'configuration');f.worker.dispose();
});
test('observed baseline alone cannot report an accepted-upload acknowledgement retry',async()=>{
  const initial={version:1,ownerId:'A',configId:'config',pending:null,attempts:0,nextAttemptAt:0,syncedAt:stamp};
  const f=fixture(initial);assert.equal((await f.worker.flush()).ok,false);assert.equal(f.calls.length,0);f.worker.dispose();
  const proven=fixture({...initial,acknowledgedRevision:4});assert.equal((await proven.worker.flush()).ok,true);assert.equal(proven.calls.length,0);proven.worker.dispose();
});
