import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import renderer,{act} from 'react-test-renderer';
import {installNativeTestLoader} from './nativeModuleTestLoader.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const saved=new Map();
globalThis.maliTestPlatform={OS:'ios'};
globalThis.maliTestStorage={getItem:async key=>saved.get(key)??null,setItem:async(key,value)=>saved.set(key,value)};
globalThis.maliProviderAuth={clearAuthSession:async()=>{},consumeOAuthRedirectIfPresent:async()=>null,getPersistedSessionUser:async()=>null,savePersistedSessionUser:async()=>{},subscribeToAuthIdentity:()=>()=>{}};
globalThis.maliProviderSync={pull:async()=>({ok:false,isEmpty:true}),push:async()=>({ok:false})};
installNativeTestLoader({provider:true,ui:true});
const {MaliProvider,useMali}=await import('../src/context/MaliContext.tsx');
const {FinancialHistoryPanel}=await import('../src/components/FinancialHistoryPanel.tsx');
const user={id:'history-owner',isLocalOnly:false,name:'Test',email:'test@local.invalid',provider:'email',createdAt:'2026-10-13'};
let api;
function Probe(){api=useMali();return React.createElement(FinancialHistoryPanel);}
async function mount(){saved.clear();let tree;await act(async()=>{tree=renderer.create(React.createElement(MaliProvider,null,React.createElement(Probe)));});await act(async()=>{api.loginUser(user);});return tree;}
const text=tree=>tree.root.findAllByType('Text').map(n=>n.children.join('')).join('\n');
const button=(tree,label)=>tree.root.findAllByType('TouchableOpacity').find(n=>n.findAllByType('Text').some(t=>t.children.join('').includes(label)));
test('actual financial history is read-only, retains reversal evidence and distinguishes device from server time',async()=>{
  const tree=await mount();await act(async()=>{await api.addAccount({name:'Cash',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:100,isCash:true,color:'#000'});});
  await act(async()=>{await api.addTransaction({title:'Audit expense',type:'expense',amount:5,currency:'LYD',accountId:api.state.accounts[0].id,paymentMethod:'cash',category:'test',idempotencyKey:'history-ui-once'});});
  await act(async()=>{await api.deleteTransaction(api.state.transactions[0].id);});
  await act(async()=>{button(tree,'السجل المالي').props.onPress();});
  assert.ok(text(tree).includes('عكس حركة'));assert.ok(text(tree).includes('وقت الجهاز'));assert.ok(text(tree).includes('الدليل محفوظ'));
  assert.equal(tree.root.findAllByType('TextInput').length,0);
  assert.ok(!tree.root.findAllByType('TouchableOpacity').some(n=>n.findAllByType('Text').some(t=>/حذف|تعديل/.test(t.children.join('')))));
  await act(async()=>{tree.unmount();});
});
test('actual panel drops an unresolved owner-history request on logout and never shows its late result',async()=>{
  let release,calls=0;
  const client={auth:{getUser:()=>{calls++;return new Promise(resolve=>{release=resolve;});}},from:()=>{throw Error('No stale query allowed');}};
  globalThis.maliTestCreateClient=()=>client;
  const tree=await mount();await act(async()=>{button(tree,'السجل المالي').props.onPress();});
  let reading;await act(async()=>{reading=button(tree,'قراءة تواريخ').props.onPress();await Promise.resolve();});assert.equal(calls,1);
  await act(async()=>{await api.logoutUser();});
  await act(async()=>{release({data:{user:{id:user.id}},error:null});await reading;});
  assert.ok(!text(tree).includes('تواريخ القبول التالية'));assert.equal(api.currentUser,null);
  await act(async()=>{tree.unmount();});
});
test('same-batched A logout and A login resets history review by session generation',async()=>{
  let release,queried=0;
  globalThis.maliTestCreateClient=()=>({auth:{getUser:()=>new Promise(resolve=>{release=resolve;})},from:()=>{queried++;throw Error('Stale read');}});
  const tree=await mount(),before=api.mutationSessionGeneration;
  await act(async()=>{button(tree,'السجل المالي').props.onPress();});
  await act(async()=>{button(tree,'قراءة تواريخ').props.onPress();await Promise.resolve();});
  await act(async()=>{await api.logoutUser();api.loginUser(user);});
  assert.ok(api.mutationSessionGeneration>before);
  await act(async()=>{release({data:{user:{id:user.id}},error:null});await Promise.resolve();});
  assert.equal(queried,0);assert.ok(!text(tree).includes('تواريخ القبول التالية'));assert.equal(button(tree,'قراءة تواريخ'),undefined);
  await act(async()=>{tree.unmount();});
});
