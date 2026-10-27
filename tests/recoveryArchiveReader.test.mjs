import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecoveryArchiveReader,RECOVERY_ARCHIVE_PAGE_SIZE } from '../src/services/recoveryArchiveReader.ts';
import { validateAndSanitizeBackupPayload } from '../src/services/financialEngine.ts';
import { fixture,financialState,OWNER,OTHER,keyFor,physical,copy } from './recoveryArchiveFixture.mjs';

test('actual cold archives export complete old/incoming/source finances and audit without credentials or writes',async()=>{
  const f=fixture(),{id,previous,incoming}=await f.archive();f.writes.length=0;
  const reader=createRecoveryArchiveReader(f.backend,OWNER,()=>true),page=await reader.list();
  assert.deepEqual(page.rows.map(row=>row.id),[id]);
  const inspected=await reader.inspect(id);assert.equal(inspected.source,'backup');
  assert.deepEqual(inspected.versions.map(row=>row.readable),[true,true,true]);
  for(const version of inspected.versions){
    const raw=await reader.exportVersion(id,version.id),backup=JSON.parse(raw);
    for(const key of ['accounts','contacts','transactions','deals','debts','procedures','budgets','marketRates','financialAudit'])assert.deepEqual(backup[key],(version.id==='previous'?previous:incoming)[key]);
    assert.equal(validateAndSanitizeBackupPayload(raw,financialState()).valid,true);
    for(const privateValue of ['PRIVATE-CONNECTION','PRIVATE-OUTBOX','PRIVATE-AUTH','supabaseConfig','cloudOutbox'])assert.ok(!raw.includes(privateValue));
  }
  assert.equal(f.writes.length,0);
});
test('pagination and selection never read or return another owner, malformed aliases or traversal keys',async()=>{
  const f=fixture();for(let i=0;i<7;i++)await f.archive();const foreign=await f.archive(OTHER);
  const own=(await createRecoveryArchiveReader(f.backend,OWNER,()=>true).list()).rows[0].id;
  for(const id of [keyFor(OWNER)+'_recovery_1_1/../secret',keyFor(OWNER)+'_recovery_1_0',keyFor(OWNER)+'_recovery_bad_1'])f.saved.set(physical(id)+':head','bad');
  f.saved.set(physical(own).replace('%40','%40').replace('mali','%6Dali')+':head','alias');
  f.reads.length=0;
  const reader=createRecoveryArchiveReader(f.backend,OWNER,()=>true),first=await reader.list(),second=await reader.list(first.nextCursor);
  assert.equal(first.rows.length,RECOVERY_ARCHIVE_PAGE_SIZE);assert.equal(second.rows.length,2);assert.equal(second.nextCursor,undefined);
  assert.equal(new Set([...first.rows,...second.rows].map(row=>row.id)).size,7);
  assert.equal(f.reads.length,0);
  await assert.rejects(reader.inspect(foreign.id));assert.equal(f.reads.length,0);
  for(const owner of ['../'+OWNER,OWNER+'_recovery_1_1','',null])assert.throws(()=>createRecoveryArchiveReader(f.backend,owner,()=>true));
});
test('physical ownership, duplicate originals, archive version and source owner corruption fail closed',async()=>{
  for(const corrupt of [e=>{e.version=2;},e=>{e.originalKey=keyFor(OTHER);},e=>{e.originals.push({key:keyFor(OTHER),value:'secret'});},e=>{e.originals.push(e.originals[0]);},e=>{e.originals.push({key:physical(keyFor(OWNER))+':0:1/../../auth',value:'secret'});},e=>{e.sourceEvidence=JSON.stringify({version:1,ownerId:OTHER,choice:'keep-local'});}]){
    const f=fixture(),{id}=await f.archive(),raw=JSON.parse(await f.chunks.getItem(id));corrupt(raw);await f.chunks.setItem(id,JSON.stringify(raw));f.writes.length=0;
    await assert.rejects(createRecoveryArchiveReader(f.backend,OWNER,()=>true).inspect(id));assert.equal(f.writes.length,0);
  }
});
test('corrupt old cache is explicitly unreadable and never replaced by incoming or stale legacy bytes',async()=>{
  const f=fixture(),{id}=await f.archive(),raw=JSON.parse(await f.chunks.getItem(id));
  raw.originals.find(row=>row.key.endsWith(':head')).value='{corrupt';
  raw.originals.push({key:keyFor(OWNER),value:JSON.stringify(financialState())});
  await f.chunks.setItem(id,JSON.stringify(raw));const before=copy([...f.saved]);f.writes.length=0;
  const reader=createRecoveryArchiveReader(f.backend,OWNER,()=>true),selected=await reader.inspect(id);
  assert.equal(selected.versions[0].readable,false);assert.equal(selected.versions[1].readable,true);
  await assert.rejects(reader.exportVersion(id,'previous'));
  assert.deepEqual([...f.saved],before);assert.equal(f.writes.length,0);
});
test('conflict archive offers every retained full version after adopt-cloud panel is gone',async()=>{
  const f=fixture(),state=financialState(),evidence={version:1,ownerId:OWNER,choice:'adopt-cloud',attempted:{state},pending:{state},latestLocal:state,originalCloud:state,freshCloud:state,chosen:state};
  const {id}=await f.archive(OWNER,{previous:state,incoming:state,sourceEvidence:JSON.stringify(evidence)}),reader=createRecoveryArchiveReader(f.backend,OWNER,()=>true),selected=await reader.inspect(id);
  assert.equal(selected.source,'conflict');assert.equal(selected.versions.length,8);
  for(const version of selected.versions){assert.equal(version.readable,true);assert.deepEqual(JSON.parse(await reader.exportVersion(id,version.id)).financialAudit,state.financialAudit);}
});
test('guest archives are readable and invalid financial rows or foreign journals cannot become valid exports',async()=>{
  const f=fixture(),guest=await f.archive('local-offline-guest');assert.equal((await createRecoveryArchiveReader(f.backend,'local-offline-guest',()=>true).inspect(guest.id)).versions[0].readable,true);
  for(const invalid of [state=>{state.accounts[0].balance='invalid';},state=>{delete state.budgets;},state=>{state.financialAudit[0].ownerId=OTHER;}]){
    const value=financialState();invalid(value);const {id}=await f.archive(OWNER,{incoming:value});
    const reader=createRecoveryArchiveReader(f.backend,OWNER,()=>true),selected=await reader.inspect(id);
    assert.equal(selected.versions[1].readable,false);await assert.rejects(reader.exportVersion(id,'incoming'));
  }
});
test('session cancellation before/after inventory and each physical read stops all later disclosure',async()=>{
  const f=fixture(),{id}=await f.archive();let active=false;
  const reader=createRecoveryArchiveReader(f.backend,OWNER,()=>active);f.reads.length=0;
  await assert.rejects(reader.list());assert.equal(f.reads.length,0);
  active=true;let calls=0;
  const blocked={...f.backend,getAllKeys:async()=>{active=false;return [...f.saved.keys()];}};
  await assert.rejects(createRecoveryArchiveReader(blocked,OWNER,()=>active).list());
  for(const cancelAt of [1,2,3]){
    active=true;calls=0;const storage={...f.backend,getItem:async key=>{calls++;const raw=f.saved.get(key)??null;if(calls===cancelAt)active=false;return raw;}};
    await assert.rejects(createRecoveryArchiveReader(storage,OWNER,()=>active).exportVersion(id,'previous'));assert.equal(calls,cancelAt);
  }
});
