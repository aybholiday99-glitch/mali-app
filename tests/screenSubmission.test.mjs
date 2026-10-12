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
  await act(async()=>{amountInput().props.onChangeText('5');});
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
