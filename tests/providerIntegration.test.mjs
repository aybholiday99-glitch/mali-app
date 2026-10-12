import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
import { fakeSyncScheduler } from './fakeSyncScheduler.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const stored = new Map();
let read = async key => stored.get(key) ?? null, identityChanged;
globalThis.maliTestStorage={
  getItem: key=>read(key),
  setItem: async (key,value)=>{stored.set(key,value);},
};
globalThis.maliProviderAuth={
  clearAuthSession:async()=>{},consumeOAuthRedirectIfPresent:async()=>null,
  getPersistedSessionUser:async()=>null,savePersistedSessionUser:async()=>{},
  subscribeToAuthIdentity:callback=>{identityChanged=callback;return()=>{};},
};
let pull=async()=>({ok:false,success:false,isEmpty:true,message:'empty'});
globalThis.maliProviderSync={pull:(...args)=>pull(...args),push:async()=>({ok:true,success:true,updatedAt:'2026-10-12T22:00:00.000Z',message:'saved'})};
installNativeTestLoader({provider:true});
const { MaliProvider,useMali } = await import('../src/context/MaliContext.tsx');
const guest={id:'local-offline-guest',isLocalOnly:true,name:'Test',email:'test@local.invalid',provider:'email',createdAt:'2026-10-12'};
const cloud={...guest,id:'cloud-A',isLocalOnly:false};
let api;
function Probe(){api=useMali();return null;}
async function mount(clock){let tree;await act(async()=>{tree=renderer.create(React.createElement(MaliProvider,{syncScheduler:clock?.scheduler},React.createElement(Probe)));});return tree;}
const account={name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#fff'};

test('real provider ignores a cache result arriving after logout and blocks hydration writes',async()=>{
  stored.clear();
  const tree=await mount();
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  read=key=>key.includes(guest.id)?pending:Promise.resolve(null);
  await act(async()=>{api.loginUser(guest);});
  assert.equal(api.isLoading,true);
  await act(async()=>{api.addAccount(account);api.logoutUser();});
  await act(async()=>{release(null);});
  assert.equal(api.currentUser,null);
  assert.equal(api.state.accounts.length,0);
  read=async key=>stored.get(key)??null;
  await act(async()=>{tree.unmount();});
});

test('real provider preserves local mutation during a delayed pull, including same timestamp',async()=>{
  stored.clear();
  pull=async()=>({ok:false,success:false,isEmpty:true,message:'empty'});
  const tree=await mount();
  await act(async()=>{api.loginUser(cloud);});
  assert.equal(api.state.accounts.length,0);
  await act(async()=>{await api.updateSupabaseConfig({autoSync:false});});
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  pull=()=>pending;
  let result;
  await act(async()=>{result=api.pullFromCloud();await Promise.resolve();});
  await act(async()=>{api.addAccount(account);});
  await act(async()=>{release({ok:true,success:true,state:{accounts:[]},updatedAt:'2026-10-12T22:00:00Z',message:'loaded'});await result;});
  assert.equal(api.state.accounts.length,1);
  assert.equal((await result).conflictDetected,true);
  await act(async()=>{identityChanged(null);});
  assert.equal(api.currentUser,null);
  assert.equal(api.state.accounts.length,0);
  await act(async()=>{tree.unmount();});
});

test('real provider never auto-uploads demonstration balances for a new cloud account',async()=>{
  stored.clear();
  let writes=0;
  globalThis.maliProviderSync.push=async()=>{writes++;return{ok:true,success:true,message:'saved'};};
  pull=async()=>({ok:false,success:false,isEmpty:true,message:'empty'});
  const tree=await mount();
  await act(async()=>{api.loginUser(cloud);});
  assert.equal(api.isLoading,false);
  for(const key of ['accounts','transactions','deals','debts','contacts','procedures'])assert.equal(api.state[key].length,0);
  assert.equal(writes,0);
  await act(async()=>{tree.unmount();});
});

test('real provider rejects compound immediate-sale failure without any purchase or contact side effect',async()=>{
  stored.clear();
  const tree=await mount();
  await act(async()=>{api.loginUser(guest);});
  await act(async()=>{assert.equal(api.addAccount(account),true); assert.equal(api.addAccount({...account,name:'USD',category:'cash_usd',currency:'USD',balance:0}),true);});
  const before=api.state;
  let result;
  await act(async()=>{result=api.createUsdDeal({
    title:'Compound',counterparty:'Seller',totalUsdBought:5,buyRate:6,buyCommissionLyd:0,
    buyPaymentMethod:'cash',sourceLydAccountId:before.accounts.find(a=>a.currency==='LYD').id,
    usdHoldingAccountId:before.accounts.find(a=>a.currency==='USD').id,
    immediateSale:{usdAmount:6,sellRate:7,commissionLyd:0,paymentMethod:'cash',targetLydAccountId:before.accounts.find(a=>a.currency==='LYD').id,buyerName:'Buyer'},
  });});
  assert.equal(result,false);
  assert.equal(api.state,before);
  assert.equal(api.state.deals.length,0);
  assert.equal(api.state.transactions.length,0);
  assert.equal(api.state.contacts.length,0);
  await act(async()=>{assert.equal(api.addTransaction({title:'Too much',type:'expense',amount:500,currency:'LYD',category:'test',accountId:before.accounts.find(a=>a.currency==='LYD').id,paymentMethod:'cash'}),false);});
  assert.equal(api.state,before);
  await act(async()=>{tree.unmount();});
});

test('stale mutation callbacks cannot act across A to B to A session generations',async()=>{
  stored.clear();
  pull=async()=>({ok:false,success:false,isEmpty:true,message:'empty'});
  const tree=await mount();
  await act(async()=>{api.loginUser(cloud);});
  const staleAdd=api.addAccount;
  await act(async()=>{api.loginUser({...cloud,id:'cloud-B'});});
  await act(async()=>{assert.equal(staleAdd(account),false);});
  assert.equal(api.state.accounts.length,0);
  await act(async()=>{api.loginUser(cloud);});
  await act(async()=>{assert.equal(staleAdd(account),false);});
  assert.equal(api.state.accounts.length,0);
  await act(async()=>{tree.unmount();});
});

test('corrupt owner cache remains recoverable and cannot be overwritten by new blank-state edits',async()=>{
  stored.clear();
  const key='@mali_app_state_v2_' + guest.id;
  const corrupt='{"accounts":[{"id":"private-original","balance":"invalid"}]}';
  stored.set(key,corrupt);
  const tree=await mount();
  await act(async()=>{api.loginUser(guest);});
  await act(async()=>{assert.equal(api.addAccount(account),false);});
  assert.equal(stored.get(key),corrupt);
  assert.equal(stored.get(key+'_recovery'),corrupt);
  await act(async()=>{assert.equal(await api.updateSupabaseConfig({autoSync:false}),false);});
  await act(async()=>{assert.equal((await api.pullFromCloud()).ok,false);});
  assert.equal(stored.get(key),corrupt);
  assert.equal(api.state.accounts.length,0);
  await act(async()=>{tree.unmount();});
});

test('failed logout cleanup is visible, blocks late identity adoption and permits retry using the original project',async()=>{
  stored.clear();
  const originalClear=globalThis.maliProviderAuth.clearAuthSession;
  const calls=[];
  globalThis.maliProviderAuth.clearAuthSession=async cfg=>{calls.push(cfg.url);throw new Error('native credential removal denied');};
  const tree=await mount();
  await act(async()=>{api.loginUser(guest);});
  await act(async()=>{assert.equal(await api.updateSupabaseConfig({url:'https://logout.example.invalid'}),true);});
  await act(async()=>{assert.equal(await api.logoutUser(),false);});
  assert.equal(api.currentUser,null);
  assert.equal(api.authCleanupPending,true);
  assert.match(api.lastSyncMessage,/إزالة بيانات الدخول/);
  await act(async()=>{identityChanged(cloud);});
  assert.equal(api.currentUser,null);
  globalThis.maliProviderAuth.clearAuthSession=async cfg=>{calls.push(cfg.url);};
  await act(async()=>{assert.equal(await api.logoutUser(),true);});
  assert.equal(api.authCleanupPending,false);
  assert.deepEqual(calls,['https://logout.example.invalid','https://logout.example.invalid']);
  await act(async()=>{tree.unmount();});
  globalThis.maliProviderAuth.clearAuthSession=originalClear;
});

test('malformed JSON and unreadable owner caches cannot be silently replaced',async()=>{
  stored.clear();
  const key='@mali_app_state_v2_' + guest.id;
  stored.set(key,'{malformed JSON');
  const tree=await mount();
  await act(async()=>{api.loginUser(guest);});
  await act(async()=>{assert.equal(api.addAccount(account),false);});
  assert.equal(stored.get(key),'{malformed JSON');
  assert.equal(stored.get(key+'_recovery'),'{malformed JSON');
  read=async()=>{throw new Error('device storage unavailable');};
  await act(async()=>{api.loginUser({...cloud,id:'unreadable'});});
  await act(async()=>{assert.equal(api.addAccount(account),false);});
  read=async key=>stored.get(key)??null;
  await act(async()=>{tree.unmount();});
});

test('an older upload acknowledgement cannot mark newer local edits clean or discard them on relogin',async()=>{
  const clock=fakeSyncScheduler();
  stored.clear();
  pull=async()=>({ok:false,success:false,isEmpty:true,message:'empty'});
  let releasePush,releaseStorage,signalStorage;
  const pendingPush=new Promise(resolve=>{releasePush=resolve;});
  const pendingStorage=new Promise(resolve=>{releaseStorage=resolve;});
  const storageStarted=new Promise(resolve=>{signalStorage=resolve;});
  let uploaded,pushes=0;
  globalThis.maliProviderSync.push=async state=>{pushes++;uploaded=state;return pendingPush;};
  const originalSet=globalThis.maliTestStorage.setItem;
  globalThis.maliTestStorage.setItem=async(key,value)=>{
    stored.set(key,value);
    const parsed=JSON.parse(value);
    if(parsed.supabaseConfig?.lastSyncedAt==='2030-01-01T00:00:00.000Z') {
      signalStorage();
      await pendingStorage;
    }
  };
  const tree=await mount(clock);
  await act(async()=>{api.loginUser(cloud);});
  await act(async()=>{api.addAccount({...account,name:'First'});await clock.advance(0);});
  await act(async()=>{api.addAccount({...account,name:'Second'});});
  await act(async()=>{releasePush({ok:true,success:true,message:'saved',updatedAt:'2030-01-01T00:00:00.000Z'});await storageStarted;});
  assert.equal(api.state.accounts.length,2);
  assert.equal(api.state.pendingCloudSync,true);
  await act(async()=>{api.logoutUser();releaseStorage();});
  globalThis.maliTestStorage.setItem=originalSet;
  pull=async()=>({ok:true,success:true,state:uploaded,updatedAt:'2030-01-01T00:00:00.000Z',snapshotUpdatedAt:'2030-01-01T00:00:00.000Z',message:'loaded'});
  await act(async()=>{api.loginUser(cloud);});
  assert.equal(api.state.accounts.length,2);
  assert.equal(api.state.pendingCloudSync,true);
  assert.equal(pushes,1);
  await act(async()=>{tree.unmount();});
  globalThis.maliProviderSync.push=async()=>({ok:true,success:true,updatedAt:'2026-10-12T22:00:00Z',message:'saved'});
});

test('real provider rejects invalid fees/commissions and combines independently rounded minor units',async()=>{
  stored.clear();
  const tree=await mount();
  await act(async()=>{api.loginUser(guest);api.addAccount(account);});
  // The hydration fence intentionally rejects the above early mutation.
  await act(async()=>{api.addAccount(account);});
  const cash=api.state.accounts[0];
  const before=api.state;
  for(const fee of [Infinity,NaN,-1]) {
    await act(async()=>{assert.equal(api.addTransaction({title:'Invalid fee',type:'expense',amount:10,currency:'LYD',category:'test',accountId:cash.id,paymentMethod:'cash',feeAmount:fee}),false);});
    assert.equal(api.state,before);
  }
  await act(async()=>{assert.equal(api.addTransaction({title:'Exact fee',type:'expense',amount:10.075,currency:'LYD',category:'test',accountId:cash.id,paymentMethod:'cash',feeAmount:0.01}),true);});
  assert.equal(api.state.transactions[0].amount,10.09);
  assert.equal(api.state.accounts[0].balance,89.91);
  await act(async()=>{api.addAccount({...account,name:'USD',category:'cash_usd',currency:'USD',balance:0});});
  const snapshot=api.state;
  await act(async()=>{assert.equal(api.createUsdDeal({title:'Invalid commission',counterparty:'Test',totalUsdBought:1,buyRate:6,buyCommissionLyd:NaN,buyPaymentMethod:'cash',sourceLydAccountId:cash.id,usdHoldingAccountId:snapshot.accounts.find(a=>a.currency==='USD').id}),false);});
  assert.equal(api.state,snapshot);
  await act(async()=>{tree.unmount();});
});
