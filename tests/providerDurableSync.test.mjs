import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import React from 'react';
import renderer,{act} from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
import { fakeSyncScheduler,settle } from './fakeSyncScheduler.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const stored=new Map(),listeners=new Set();let writeFailure=false,noOpWrite=false,identityChanged;
globalThis.maliTestPlatform={OS:'ios'};
globalThis.maliTestAppState={currentState:'active',addEventListener:(_event,callback)=>{listeners.add(callback);return{remove:()=>listeners.delete(callback)};}};
globalThis.maliTestStorage={getItem:async key=>stored.get(key)??null,setItem:async(key,value)=>{
  if(writeFailure)throw new Error('synthetic storage failure');if(!noOpWrite)stored.set(key,value);
}};
globalThis.maliProviderAuth={clearAuthSession:async()=>{},consumeOAuthRedirectIfPresent:async()=>null,getPersistedSessionUser:async()=>null,
  savePersistedSessionUser:async()=>{},subscribeToAuthIdentity:callback=>{identityChanged=callback;return()=>{};}};
const offline={ok:false,success:false,failureKind:'transient',message:'offline'};
let push=async()=>offline,pull=async()=>offline;
globalThis.maliProviderSync={pull:(...args)=>pull(...args),push:(...args)=>push(...args)};
installNativeTestLoader({provider:true});
registerHooks({resolve(specifier,context,next){
  if(specifier==='react-native')return{url:'data:text/javascript,'+encodeURIComponent('export const Platform=globalThis.maliTestPlatform;export const AppState=globalThis.maliTestAppState;'),shortCircuit:true};
  return next(specifier,context);
}});
const {MaliProvider,useMali}=await import('../src/context/MaliContext.tsx');
const {financialStorage}=await import('../src/services/financialStorage.ts');
const {appendFinancialAudit}=await import('../src/services/financialAudit.ts');
const {createChunkedFinancialStorage}=await import('../src/services/chunkedFinancialStorage.ts');
const cloud={id:'11111111-1111-4111-8111-111111111111',isLocalOnly:false,name:'A',email:'a@example.invalid',provider:'email',createdAt:'2026-10-13'};
const other={...cloud,id:'22222222-2222-4222-8222-222222222222',name:'B'};
const key=user=>'@mali_app_state_v2_'+user.id;
const cash={name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#000000'};
const timestamp='2026-10-13T00:01:00.123456+00:00';
const success=stamp=>({ok:true,success:true,updatedAt:stamp,message:'saved'});
let api;
function Probe(){api=useMali();return null;}
async function mount(clock){let tree;await act(async()=>{tree=renderer.create(React.createElement(MaliProvider,{syncScheduler:clock.scheduler},React.createElement(Probe)));});return tree;}
async function advance(clock,ms){await act(async()=>{await clock.advance(ms);});}
function reset(){globalThis.maliTestPlatform.OS='ios';stored.clear();writeFailure=false;noOpWrite=false;push=async()=>offline;pull=async()=>offline;globalThis.maliTestAppState.currentState='active';}
const cache=async user=>JSON.parse(await financialStorage.getItem(key(user)));

test('actual provider persists latest payload before upload and resumes bounded retries after restart',async()=>{
  reset();const clock=fakeSyncScheduler();let calls=0;
  push=async state=>{calls++;const disk=await cache(cloud);assert.equal(disk.cloudOutbox.pending.revision,state.localRevision);assert.equal(disk.cloudOutbox.attempts,calls);return calls===1?offline:success(timestamp);};
  let tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{assert.equal(await api.addAccount(cash),true);});
  assert.equal((await cache(cloud)).cloudOutbox.pending.payload.accounts.length,1);assert.equal(calls,0);
  await advance(clock,0);assert.equal(calls,1);assert.equal(api.cloudSyncStatus.phase,'retrying');
  const due=(await cache(cloud)).cloudOutbox.nextAttemptAt;await act(async()=>{tree.unmount();});assert.equal(clock.size(),0);
  tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});assert.equal(api.state.accounts.length,1);
  await advance(clock,due-clock.now()-1);assert.equal(calls,1);await advance(clock,1);assert.equal(calls,2);
  assert.equal((await cache(cloud)).cloudOutbox.pending,null);assert.equal(api.state.pendingCloudSync,false);assert.equal(api.state.supabaseConfig.lastSyncedAt,timestamp);
  await act(async()=>{tree.unmount();});
});
test('actual provider uploads newer edits serially using the preceding server acknowledgement',async()=>{
  reset();const clock=fakeSyncScheduler();let release,secondRelease;const calls=[];
  push=async(state,cfg)=>{calls.push({state,cfg});return new Promise(resolve=>{if(calls.length===1)release=resolve;else secondRelease=resolve;});};
  const tree=await mount(clock);await act(async()=>{api.loginUser(cloud);await api.addAccount(cash);});
  await act(async()=>{await api.addAccount({...cash,name:'First'});});await advance(clock,0);
  await act(async()=>{await api.addAccount({...cash,name:'Second'});});assert.equal(calls.length,1);assert.equal((await cache(cloud)).cloudOutbox.pending.revision,2);
  await act(async()=>{release(success(timestamp));await settle();});assert.equal(api.state.pendingCloudSync,true);assert.equal(api.state.accounts.length,2);
  await advance(clock,0);assert.equal(calls.length,2);assert.equal(calls[1].state.accounts.length,2);assert.equal(calls[1].cfg.lastSyncedAt,timestamp);
  await act(async()=>{secondRelease(success('2026-10-13T00:02:00.987654+00:00'));await settle();});assert.equal(api.state.pendingCloudSync,false);
  await act(async()=>{tree.unmount();});
});
test('actual provider persists CAS stop and both versions across edits, ordinary push, config change and restart',async()=>{
  reset();const clock=fakeSyncScheduler();let calls=0,remote;
  push=async state=>{calls++;remote=appendFinancialAudit(state,{...state,accounts:state.accounts.map(a=>({...a,name:'Remote'}))},{ownerId:cloud.id,action:'remote_edit',reason:'synthetic remote rename'});return{...offline,conflictDetected:true,cloudState:remote,updatedAt:timestamp};};
  let tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{await api.addAccount(cash);});await advance(clock,0);
  const attempted=(await cache(cloud)).cloudOutbox.stop.attempted.payload;await act(async()=>{await api.addAccount({...cash,name:'Newer local'});});
  assert.equal(api.cloudSyncStatus.phase,'blocked');assert.equal((await cache(cloud)).cloudOutbox.pending.payload.accounts.length,2);assert.deepEqual((await cache(cloud)).cloudOutbox.stop.attempted.payload,attempted);
  await act(async()=>{assert.equal((await api.syncToCloud()).conflictDetected,true);await api.updateSupabaseConfig({url:'https://other-project.example.invalid'});});
  await advance(clock,120000);assert.equal(calls,1);assert.equal((await cache(cloud)).cloudOutbox.stop.reason,'conflict');assert.deepEqual((await cache(cloud)).cloudOutbox.stop.result.cloudState,JSON.parse(JSON.stringify(remote)));
  await act(async()=>{tree.unmount();});tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});
  assert.equal(api.state.accounts.length,2);assert.equal(api.cloudSyncStatus.phase,'blocked');await act(async()=>{assert.equal((await api.syncToCloud()).conflictDetected,true);});
  assert.equal(calls,1);await act(async()=>{tree.unmount();});
});
test('actual provider cancels upload on logout and cannot adopt an old acknowledgement in another owner',async()=>{
  reset();const clock=fakeSyncScheduler();let release,signal,calls=0;
  push=async(_state,_cfg,_user,options)=>{calls++;signal=options.signal;return new Promise(r=>{release=r;});};
  const tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{await api.addAccount(cash);});await advance(clock,0);
  await act(async()=>{await api.logoutUser();});assert.equal(signal.aborted,true);assert.equal(clock.size(),0);
  await act(async()=>{api.loginUser(other);release(success(timestamp));await settle();});assert.equal(api.state.accounts.length,0);assert.equal(api.state.supabaseConfig.lastSyncedAt,undefined);
  assert.equal((await cache(cloud)).pendingCloudSync,true);assert.equal((await cache(cloud)).cloudOutbox.syncedAt,undefined);assert.equal(calls,1);
  await act(async()=>{tree.unmount();});
});
test('actual provider blocks retries after expiry until a fresh login, including foreground recovery',async()=>{
  reset();const clock=fakeSyncScheduler();let calls=0;push=async()=>{calls++;return{...offline,failureKind:'session'};};
  const tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{await api.addAccount(cash);});await advance(clock,0);
  assert.equal((await cache(cloud)).cloudOutbox.stop.reason,'session');await advance(clock,120000);await act(async()=>{await api.syncToCloud();for(const fn of listeners)fn('active');await settle();});assert.equal(calls,1);
  await act(async()=>{identityChanged(null);});assert.equal(api.currentUser,null);
  push=async()=>{calls++;return success(timestamp);};pull=async()=>({...offline,isEmpty:true,identityVerified:true});await act(async()=>{api.loginUser(cloud);});await advance(clock,0);assert.equal(calls,2);assert.equal(api.state.pendingCloudSync,false);
  await act(async()=>{tree.unmount();});
});
test('actual provider prevents network on failed or unverified local writes and can explicitly retry preserved edits',async()=>{
  for(const failure of ['throw','no-op']){
    reset();const clock=fakeSyncScheduler();let calls=0;push=async()=>{calls++;return success(timestamp);};
    const tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});writeFailure=failure==='throw';noOpWrite=failure==='no-op';
    await act(async()=>{assert.equal(await api.addAccount(cash),false);});await advance(clock,120000);assert.equal(calls,0);assert.equal(api.state.accounts.length,0);assert.equal(api.cloudSyncStatus.phase,'storage-error');
    writeFailure=false;noOpWrite=false;await act(async()=>{assert.equal(await api.retryPendingMutation(),true);assert.equal((await api.syncToCloud()).ok,true);});assert.equal(calls,1);assert.equal((await cache(cloud)).accounts.length,1);assert.equal(api.state.pendingCloudSync,false);
    await act(async()=>{tree.unmount();});
  }
});
for(const os of ['ios','web'])test('actual '+os+' provider pauses in background and reconnects through its platform lifecycle',async()=>{
  reset();globalThis.maliTestPlatform.OS=os;
  const lockDescriptor=Object.getOwnPropertyDescriptor(globalThis.navigator,'locks');
  if(os==='web')Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:(_key,_options,action)=>action()}});
  const handlers=new Map();globalThis.window=os==='web'?{addEventListener:(name,callback)=>handlers.set(name,callback),removeEventListener:name=>handlers.delete(name)}:{};
  const clock=fakeSyncScheduler();let calls=0;push=async()=>{calls++;return offline;};
  const tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{await api.addAccount(cash);});await advance(clock,0);
  await act(async()=>{for(const fn of listeners)fn('background');});await advance(clock,120000);assert.equal(calls,1);
  await act(async()=>{for(const fn of listeners)fn('active');await settle();});assert.equal(calls,2);
  push=async()=>{calls++;return success(timestamp);};
  await act(async()=>{if(os==='web')handlers.get('online')();else for(const fn of listeners)fn('active');await settle();});
  assert.equal(calls,3);assert.equal(api.state.pendingCloudSync,false);
  await act(async()=>{tree.unmount();});assert.equal(handlers.size,0);delete globalThis.window;
  if(lockDescriptor)Object.defineProperty(globalThis.navigator,'locks',lockDescriptor);else delete globalThis.navigator.locks;
  globalThis.maliTestPlatform.OS='ios';
});
test('actual provider cancels prior project upload when configuration changes and requires explicit repair',async()=>{
  reset();const clock=fakeSyncScheduler();let release,signal,calls=0;push=async(_state,_cfg,_user,options)=>{calls++;signal=options.signal;return new Promise(r=>{release=r;});};
  const tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{await api.addAccount(cash);});await advance(clock,0);
  await act(async()=>{await api.updateSupabaseConfig({url:'https://new-project.example.invalid'});});assert.equal(signal.aborted,true);assert.equal((await cache(cloud)).cloudOutbox.stop.reason,'configuration');
  await act(async()=>{release(success(timestamp));await settle();await api.syncToCloud();});assert.equal(calls,1);assert.equal(api.state.pendingCloudSync,true);assert.equal(api.state.supabaseConfig.lastSyncedAt,undefined);
  await act(async()=>{tree.unmount();});
});
test('corrupt or foreign owner outbox cannot replace preserved cache or reach the network',async()=>{
  reset();const clock=fakeSyncScheduler();let tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{await api.addAccount(cash);});await act(async()=>{tree.unmount();});
  const invalid=(await cache(cloud));invalid.cloudOutbox.ownerId=other.id;const raw=JSON.stringify(invalid);await financialStorage.setItem(key(cloud),raw);
  let calls=0;push=async()=>{calls++;return success(timestamp);};tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{assert.equal(await api.addAccount(cash),false);});
  await advance(clock,120000);assert.equal(calls,0);assert.equal(await financialStorage.getItem(key(cloud)),raw);assert.equal(await financialStorage.getItem(key(cloud)+'_recovery'),raw);await act(async()=>{tree.unmount();});
});

test('restart retains candidate and outbox at the same revision when storage acknowledgement is interrupted',async()=>{
  reset();const clock=fakeSyncScheduler();const originalSet=globalThis.maliTestStorage.setItem;
  let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});let once=false,lastPayload;
  globalThis.maliTestStorage.setItem=async(name,value)=>{
    stored.set(name,value);let parsed;try{parsed=JSON.parse(value);}catch{parsed={};}
    if(parsed.localRevision===2&&parsed.cloudOutbox?.pending?.revision===2)lastPayload=parsed;
    if(!once&&name.endsWith(':head')&&lastPayload){once=true;entered();await held;}
  };
  let tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});
  await act(async()=>{assert.equal(await api.addAccount({...cash,name:'First'}),true);});
  let pending;await act(async()=>{pending=api.addAccount({...cash,name:'Second'});await started;});
  assert.equal(api.state.accounts.length,1);
  const crashedRead=createChunkedFinancialStorage({getItem:async name=>stored.get(name)??null,setItem:async()=>{throw new Error('crashed runtime is read-only');}});
  const crashed=JSON.parse(await crashedRead.getItem(key(cloud)));assert.equal(crashed.localRevision,2);assert.equal(crashed.cloudOutbox.pending.revision,2);
  await act(async()=>{tree.unmount();});
  await act(async()=>{release();assert.equal(await pending,false);await settle();});globalThis.maliTestStorage.setItem=originalSet;
  const uploads=[];push=async state=>{uploads.push(state);return success(timestamp);};tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});
  assert.equal(api.state.accounts.length,2);assert.equal((await cache(cloud)).cloudOutbox.pending.revision,2);
  await advance(clock,0);assert.equal(uploads.length,1);assert.equal(uploads[0].accounts.length,2);assert.equal(uploads[0].localRevision,2);
  await act(async()=>{release();await settle();});assert.equal((await cache(cloud)).pendingCloudSync,false);assert.equal((await cache(cloud)).cloudOutbox.pending,null);
  await act(async()=>{tree.unmount();});
});

test('restart still reconciles a legacy cache whose latest financial revision is newer than its saved outbox',async()=>{
  reset();const clock=fakeSyncScheduler();let tree=await mount(clock);
  await act(async()=>{api.loginUser(cloud);});await act(async()=>{assert.equal(await api.addAccount({...cash,name:'First'}),true);});
  const older=(await cache(cloud)).cloudOutbox;
  await act(async()=>{assert.equal(await api.addAccount({...cash,name:'Second'}),true);});
  const latest=await cache(cloud),history=JSON.stringify(latest.financialAudit);
  await act(async()=>{tree.unmount();});
  await financialStorage.setItem(key(cloud),JSON.stringify({...latest,cloudOutbox:older}));
  const uploads=[];push=async state=>{uploads.push(state);return success(timestamp);};
  tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});
  assert.equal(api.state.accounts.length,2);assert.equal((await cache(cloud)).cloudOutbox.pending.revision,2);
  assert.equal(JSON.stringify(api.state.financialAudit),history);
  await advance(clock,0);assert.equal(uploads.length,1);assert.equal(uploads[0].accounts.length,2);assert.equal(uploads[0].localRevision,2);
  assert.equal((await cache(cloud)).pendingCloudSync,false);
  await act(async()=>{tree.unmount();});
});

test('failed login pull and externally supplied identity cannot clear a persisted expired-session stop',async()=>{
  reset();const clock=fakeSyncScheduler();let calls=0;push=async()=>{calls++;return{...offline,failureKind:'session'};};
  let tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{await api.addAccount(cash);});await advance(clock,0);assert.equal(calls,1);
  await act(async()=>{tree.unmount();});
  for(const failureKind of ['transient','session']){
    pull=async()=>({...offline,failureKind});tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await advance(clock,120000);
    await act(async()=>{await api.syncToCloud();});assert.equal(calls,1);assert.equal((await cache(cloud)).cloudOutbox.stop.reason,'session');await act(async()=>{tree.unmount();});
  }
});

test('actual provider retries failed acknowledgement storage without committing another cloud upload',async()=>{
  reset();const clock=fakeSyncScheduler();let release,calls=0;push=async()=>{calls++;return new Promise(r=>{release=r;});};
  const tree=await mount(clock);await act(async()=>{api.loginUser(cloud);});await act(async()=>{await api.addAccount(cash);});await advance(clock,0);
  writeFailure=true;await act(async()=>{release(success(timestamp));await settle();});assert.equal(api.cloudSyncStatus.phase,'storage-error');assert.equal(api.state.pendingCloudSync,true);
  writeFailure=false;await act(async()=>{assert.equal((await api.syncToCloud()).ok,true);});assert.equal(calls,1);assert.equal(api.state.pendingCloudSync,false);assert.equal((await cache(cloud)).cloudOutbox.pending,null);
  await act(async()=>{tree.unmount();});
});
