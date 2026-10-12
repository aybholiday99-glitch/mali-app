import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.maliTestPlatform={OS:'web'};
const storage=new Map();
globalThis.maliTestStorage={getItem:async key=>storage.get(key)??null,setItem:async(key,value)=>storage.set(key,value)};
globalThis.maliProviderAuth={clearAuthSession:async()=>{},consumeOAuthRedirectIfPresent:async()=>null,
  getPersistedSessionUser:async()=>null,savePersistedSessionUser:async()=>{},subscribeToAuthIdentity:()=>()=>{}};
globalThis.maliProviderSync={pull:async()=>({isEmpty:true}),push:async()=>({ok:false})};
installNativeTestLoader({provider:true,ui:true});
const {MaliProvider,useMali}=await import('../src/context/MaliContext.tsx');
const {ExpensesScreen}=await import('../src/screens/ExpensesScreen.tsx');
const {CloudAndExportModal}=await import('../src/screens/CloudAndExportModal.tsx');
let api;
function Probe(){api=useMali();return api.state.accounts.length ? React.createElement(ExpensesScreen) : null;}

test('actual expense form preserves rejection and deduplicates repeated press before render, then accepts a new submission',async()=>{
  let tree;
  await act(async()=>{tree=renderer.create(React.createElement(MaliProvider,null,React.createElement(Probe)));});
  await act(async()=>{api.loginUser({id:'form-guest',isLocalOnly:true,name:'Test',email:'test@local.invalid',provider:'email',createdAt:'2026-10-12'});});
  await act(async()=>{api.addAccount({name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#fff'});});
  const amountInput=()=>tree.root.findAllByType('TextInput').find(node=>node.props.placeholder?.startsWith('أدخل المبلغ المسحوب'));
  const saveButton=()=>tree.root.findAllByType('TouchableOpacity').find(node=>node.props.onPress?.name==='handleQuickExpenseSubmit');
  await act(async()=>{amountInput().props.onChangeText('200');});
  await act(async()=>{saveButton().props.onPress();});
  assert.equal(amountInput().props.value,'200');
  assert.equal(api.state.transactions.length,0);
  assert.equal(api.state.accounts[0].balance,100);
  for(const input of ['5junk','1,000']) {
    await act(async()=>{amountInput().props.onChangeText(input);});
    await act(async()=>{saveButton().props.onPress();});
    assert.equal(amountInput().props.value,input);
    assert.equal(api.state.transactions.length,0);
    assert.equal(api.state.accounts[0].balance,100);
  }
  await act(async()=>{amountInput().props.onChangeText('٥');});
  const doublePress=saveButton().props.onPress;
  await act(async()=>{doublePress();doublePress();});
  assert.equal(api.state.transactions.length,1);
  assert.equal(api.state.accounts[0].balance,95);
  assert.equal(amountInput().props.value,'');
  const firstKey=api.state.transactions[0].idempotencyKey;
  assert.ok(firstKey);
  await act(async()=>{amountInput().props.onChangeText('5');});
  await act(async()=>{saveButton().props.onPress();});
  assert.equal(api.state.transactions.length,2);
  assert.equal(api.state.accounts[0].balance,90);
  assert.notEqual(api.state.transactions[0].idempotencyKey,api.state.transactions[1].idempotencyKey);
  await act(async()=>{tree.unmount();});
});

test('actual cloud Pull control restores a clean vault without marking configuration as financial edits',async()=>{
  storage.clear();
  let tree;
  await act(async()=>{tree=renderer.create(React.createElement(MaliProvider,null,React.createElement(Probe)));});
  await act(async()=>{api.loginUser({id:'cloud-form',isLocalOnly:false,name:'Test',email:'test@cloud.invalid',provider:'email',createdAt:'2026-10-12'});});
  const before=api.state;
  let pushes=0;
  globalThis.maliProviderSync.push=async()=>{pushes++;return{ok:false};};
  await act(async()=>{assert.equal(await api.updateSupabaseConfig({autoSync:false}),true);});
  assert.equal(api.state.pendingCloudSync,before.pendingCloudSync);
  assert.equal(api.state.lastModifiedAt,before.lastModifiedAt);
  assert.equal(pushes,0);
  const cloudState={...api.state,accounts:[{id:'cloud-cash',name:'Cloud',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:25,isCash:true,color:'#fff'}]};
  globalThis.maliProviderSync.pull=async()=>({ok:true,success:true,state:cloudState,updatedAt:'2030-01-01T00:00:00.000Z',snapshotUpdatedAt:'2030-01-01T00:00:00.000Z',message:'loaded'});
  function CloudProbe(){api=useMali();return React.createElement(CloudAndExportModal,{visible:true,onClose:()=>{}});}
  await act(async()=>{tree.update(React.createElement(MaliProvider,null,React.createElement(CloudProbe)));});
  const pullButton=tree.root.findAllByType('TouchableOpacity').find(node=>node.props.onPress?.name==='handlePull');
  await act(async()=>{await pullButton.props.onPress();});
  assert.equal(api.state.accounts[0].id,'cloud-cash');
  assert.equal(api.state.accounts[0].balance,25);
  assert.equal(api.state.pendingCloudSync,false);
  assert.equal(pushes,0);
  let sentConfig;
  globalThis.maliProviderSync.push=async(_state,cfg)=>{sentConfig=cfg;return {ok:false,message:'isolated upload'};};
  const urlInput=tree.root.findAllByType('TextInput').find(node=>node.props.value===api.state.supabaseConfig.url);
  await act(async()=>{urlInput.props.onChangeText('https://other.example.invalid');});
  const pushButton=tree.root.findAllByType('TouchableOpacity').find(node=>node.props.onPress?.name==='handlePush');
  await act(async()=>{await pushButton.props.onPress();});
  assert.equal(sentConfig.url,'https://other.example.invalid');
  assert.equal(sentConfig.lastSyncedAt,undefined);
  const save=globalThis.maliTestStorage.setItem;
  globalThis.maliTestStorage.setItem=async()=>{throw new Error('storage unavailable');};
  const saveButton=tree.root.findAllByType('TouchableOpacity').find(node=>node.props.onPress?.name==='handleSaveConfig');
  await act(async()=>{await saveButton.props.onPress();});
  assert.ok(tree.root.findAllByType('Text').some(node=>node.children.some(text=>typeof text==='string'&&text.includes('تعذر حفظ الإعدادات'))));
  globalThis.maliTestStorage.setItem=save;
  await act(async()=>{tree.unmount();});
});
