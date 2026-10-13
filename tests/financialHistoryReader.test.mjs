import assert from 'node:assert/strict';
import test from 'node:test';
import {readFinancialHistory} from '../src/services/financialHistoryReader.ts';

const user={id:'owner-A',isLocalOnly:false};
const config={workspaceKey:'own-workspace'};
const row=id=>({history_id:id,user_id:user.id,workspace_key:config.workspaceKey,actor_id:user.id,accepted_at:'2026-10-13T01:00:00.123456+00:00',snapshot_updated_at:'2026-10-13T00:59:00.123456+00:00',event_type:'cloud_commit'});
function fixture(rows=[row(30)]){
  let current=true,identity=user.id,count=0,result={data:rows,error:null};const calls=[];
  const query=new Proxy({}, {get:(_target,name)=>name==='then'?(resolve=>Promise.resolve(result).then(resolve)):(...args)=>{calls.push([name,...args]);return query;}});
  const controller=new AbortController();
  const client={auth:{getUser:async()=>{count++;return {data:{user:{id:identity}},error:null};}},from:table=>{calls.push(['from',table]);return query;}};
  return {client,calls,controller,setIdentity:id=>{identity=id;},setCurrent:v=>{current=v;},getCount:()=>count,setResult:v=>{result=v;},read:(before)=>readFinancialHistory(client,config,user,{before,signal:controller.signal,isCurrent:()=>current})};
}

test('server history reads only verified owner/workspace summaries with exact timestamps and descending cursor',async()=>{
  const f=fixture(Array.from({length:30},(_,i)=>row(80-i)));
  const result=await f.read(90);assert.equal(result.ok,true);assert.equal(result.nextCursor,51);assert.equal(f.getCount(),2);
  assert.ok(f.calls.some(c=>c[0]==='eq' && c[1]==='user_id' && c[2]===user.id));
  assert.ok(f.calls.some(c=>c[0]==='eq' && c[1]==='workspace_key' && c[2]===config.workspaceKey));
  assert.ok(f.calls.some(c=>c[0]==='lt' && c[2]===90));
  assert.ok(f.calls.some(c=>c[0]==='limit' && c[1]===30));
  assert.equal(result.rows[0].accepted_at,row(80).accepted_at);
  assert.ok(f.calls.filter(c=>c[0]==='select').every(c=>!c[1].includes('changes') && !c[1].includes('client_events')));
});
test('history cannot query unauthenticated, guest, expired or invalid cursor sessions',async()=>{
  const f=fixture();f.setIdentity('other');assert.equal((await f.read()).ok,false);assert.equal(f.calls.length,0);
  for(const before of [-1,NaN,1.1,Number.MAX_SAFE_INTEGER+1])assert.equal((await f.read(before)).ok,false);
  const result=await readFinancialHistory(f.client,config,{...user,isLocalOnly:true},{signal:f.controller.signal,isCurrent:()=>true});assert.equal(result.ok,false);
});
test('history rejects foreign ownership, workspace, invalid chronology, duplicate order and unsafe ids',async()=>{
  for(const rows of [[{...row(20),user_id:'other'}],[{...row(20),workspace_key:'other'}],[{...row(20),actor_id:'other'}],[{...row(20),accepted_at:'tomorrow'}],[row(20),row(20)],[row(20),row(21)],[row(Number.MAX_SAFE_INTEGER+1)]]){
    assert.equal((await fixture(rows).read()).ok,false);
  }
});
test('session/owner change after query cannot publish history from an earlier user',async()=>{
  const f=fixture();let reads=0;
  f.client.auth.getUser=async()=>({data:{user:{id:++reads===1?user.id:'owner-B'}},error:null});
  assert.equal((await f.read()).ok,false);
});
test('cancelled unresolved identity request returns promptly and never queries data',async()=>{
  const f=fixture();let release;
  f.client.auth.getUser=()=>new Promise(resolve=>{release=resolve;});
  const reading=f.read();f.controller.abort();assert.equal((await reading).ok,false);
  release({data:{user:{id:user.id}},error:null});await Promise.resolve();assert.equal(f.calls.length,0);
});
test('missing journal/network failures are redacted without pretending the server accepted local evidence',async()=>{
  const f=fixture();f.setResult({data:null,error:{message:'sensitive token=do-not-display'}});
  const result=await f.read();assert.equal(result.ok,false);assert.ok(!result.message.includes('do-not-display'));
});
