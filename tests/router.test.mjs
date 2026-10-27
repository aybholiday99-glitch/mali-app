import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { createRequire,registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import React from 'react';
import renderer,{act} from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
import { canEnterVault,pathForSection,sectionFromPath,VAULT_ROUTES } from '../src/navigation/routes.ts';

const require=createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.maliRouterReact=React;
globalThis.maliTestPlatform={OS:'web'};
const stored=new Map();let bootExchanges=0,api;
globalThis.maliTestStorage={getItem:async key=>stored.get(key)??null,setItem:async(key,value)=>stored.set(key,value),getAllKeys:async()=>[...stored.keys()],removeItem:async key=>stored.delete(key)};
globalThis.maliProviderAuth={clearAuthSession:async()=>{},consumeOAuthRedirectIfPresent:async()=>{bootExchanges++;return null;},getPersistedSessionUser:async()=>null,savePersistedSessionUser:async()=>{},subscribeToAuthIdentity:()=>()=>{}};
globalThis.maliProviderSync={pull:async()=>({ok:false,success:false,isEmpty:true,message:'empty'}),push:async()=>({ok:true,success:true})};
globalThis.maliRouterPath='/dashboard';
globalThis.maliRealValidator=require('expo-router/build/react-navigation/core/validatePathConfig').validatePathConfig;
installNativeTestLoader({provider:true,ui:true});
registerHooks({resolve(specifier,context,next){
  let source;
  if(specifier==='react-native')source="export const Platform=globalThis.maliTestPlatform;export const View='View',Text='Text',ScrollView='ScrollView',TouchableOpacity='TouchableOpacity',StatusBar='StatusBar',Modal='Modal',ActivityIndicator='ActivityIndicator',Switch='Switch',TextInput='TextInput',KeyboardAvoidingView='KeyboardAvoidingView',useWindowDimensions=()=>({width:412,height:914});export const StyleSheet={create:s=>s};";
  if(specifier==='react-native-safe-area-context')source="export const SafeAreaView='SafeAreaView',useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});";
  if(specifier==='expo-router')source="export const router={navigate:p=>{globalThis.maliRouterPath=p;}},usePathname=()=>globalThis.maliRouterPath,Link='Link',Slot='Slot',Redirect='Redirect';export function Stack({children}){globalThis.maliRouterProbe?.();return globalThis.maliRouterReact.createElement('Stack',null,children);}Stack.Screen='RouteEntry';Stack.Protected=({children,guard})=>guard?children:null;";
  if(specifier==='expo-router/js-tabs')source="export function Tabs({children}){return globalThis.maliRouterReact.createElement('Tabs',null,children);}Tabs.Screen='TabRouteEntry';";
  if(specifier.endsWith('/services/authService')&&context.parentURL?.includes('/navigation/'))source='export const launchSocialOAuthWindow=async()=>({success:false,message:"isolated failure"});';
  const screen=specifier.match(/\/screens\/(\w+)(\.tsx?)?$/)?.[1];
  if(screen)source=`export const ${screen}='${screen}';`;
  // Re-export the actual bundled validator without importing its unrelated
  // native navigation barrel into Node; parsing logic remains production code.
  if(specifier==='../react-navigation/native'&&context.parentURL?.includes('/expo-router/build/fork/'))return{url:'mali-router-test:validator',format:'commonjs',shortCircuit:true};
  if(source)return{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};
  return next(specifier,context);
},load(url,context,next){
  if(url==='mali-router-test:validator')return{format:'commonjs',source:'module.exports={validatePathConfig:globalThis.maliRealValidator};',shortCircuit:true};
  return next(url,context);
}});
const {useMali}=await import('../src/context/MaliContext.tsx');
globalThis.maliRouterProbe=function useRouterProviderProbe(){api=useMali();};
const {default:App}=await import('../App.tsx');
const {MaliVaultShell}=await import('../src/navigation/MaliVaultShell.tsx');
const {getRoutes}=require('expo-router/build/getRoutesCore');
const {getReactNavigationConfig}=require('expo-router/build/getReactNavigationConfig');
const {getStateFromPath}=require('expo-router/build/fork/getStateFromPath');
const {getPathFromState}=require('expo-router/build/fork/getPathFromState');
const {StackRouter}=require('expo-router/build/react-navigation/routers/StackRouter');
const {TabRouter}=require('expo-router/build/react-navigation/routers/TabRouter');
const appDirectory=fileURLToPath(new URL('../src/app/',import.meta.url));
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const modules=new Map();
for(const file of files(appDirectory).filter(file=>file.endsWith('.tsx')))modules.set('./'+path.relative(appDirectory,file).replaceAll('\\','/'),await import(pathToFileURL(file).href));
const context=key=>modules.get(key);context.keys=()=>[...modules.keys()];
const graph=getRoutes(context,{platform:'web',importMode:'sync',skipGenerated:true,sitemap:false,getSystemRoute:()=>{throw new Error('unexpected generated route');}});
// Match getLinkingConfig's production default: route metadata is excluded.
const config=getReactNavigationConfig(graph,true);
const focused=state=>{const route=state.routes[state.index??state.routes.length-1];return route.state?focused(route.state):route.name;};

test('actual Expo Router discovers all six real vault modules and the public callback in the source route tree',()=>{
  const vault=graph.children.find(route=>route.route==='(vault)');
  assert.deepEqual(vault.children.map(route=>route.route).sort(),Object.keys(VAULT_ROUTES).sort());
  assert.equal(vault.initialRouteName,'dashboard');assert.equal(graph.initialRouteName,'index');
  assert.ok(graph.children.find(route=>route.route==='(auth)').children.some(route=>route.route==='auth/callback'));
});
test('actual SDK path/state parsers round-trip six deep links under the production web base',()=>{
  const previous=process.env.EXPO_BASE_URL,mode=process.env.NODE_ENV;
  process.env.EXPO_BASE_URL='/mali-app';process.env.NODE_ENV='production';
  try{for(const [section,href] of Object.entries(VAULT_ROUTES)){
    const state=getStateFromPath('/mali-app'+href,config);assert.equal(focused(state),section);
    assert.equal(getPathFromState(state,config),'/mali-app'+href);
  }assert.equal(focused(getStateFromPath('/mali-app/auth/callback?code=synthetic',config)),'auth/callback');}
  finally{if(previous===undefined)delete process.env.EXPO_BASE_URL;else process.env.EXPO_BASE_URL=previous;if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode;}
});
test('SDK stack history supports back and removes unavailable financial routes after owner access is revoked',()=>{
  const router=StackRouter({initialRouteName:'dashboard'}),options={routeNames:Object.keys(VAULT_ROUTES),routeParamList:{},routeGetIdList:{}};
  let state=router.getInitialState(options);
  for(const name of ['accounts','expenses'])state=router.getStateForAction(state,{type:'NAVIGATE',payload:{name}},options);
  assert.equal(focused(state),'expenses');state=router.getStateForAction(state,{type:'GO_BACK'},options);assert.equal(focused(state),'accounts');
  state=router.getStateForRouteNamesChange(state,{...options,routeNames:['sign-in'],routeKeyChanges:[]});
  assert.deepEqual(state.routes.map(route=>route.name),['sign-in']);assert.equal(router.getStateForAction(state,{type:'GO_BACK'}, {...options,routeNames:['sign-in']}),null);
});
test('actual SDK tab navigation retains route identity and nested state across home and other sections',()=>{
  const router=TabRouter({initialRouteName:'dashboard',backBehavior:'history'}),options={routeNames:Object.keys(VAULT_ROUTES),routeParamList:{},routeGetIdList:{}};
  let state=router.getInitialState(options);
  state=router.getStateForAction(state,{type:'NAVIGATE',payload:{name:'expenses'}},options);
  const original=state.routes.find(route=>route.name==='expenses');
  const nested={stale:false,type:'stack',key:'form-stack',index:0,routeNames:['form'],routes:[{key:'form',name:'form'}]};
  state={...state,routes:state.routes.map(route=>route.name==='expenses'?{...route,state:nested}:route)};
  for(const name of ['dashboard','contacts','expenses'])state=router.getStateForAction(state,{type:'NAVIGATE',payload:{name}},options);
  const retained=state.routes.find(route=>route.name==='expenses');
  assert.equal(retained.key,original.key);assert.deepEqual(retained.state,nested);assert.equal(state.routes.length,6);
  state=router.getStateForAction(state,{type:'GO_BACK'},options);assert.equal(focused(state),'contacts');
});
test('route guard rejects bootstrap/logout cleanup and all navigation targets stay within the six-route allowlist',()=>{
  assert.equal(canEnterVault(null,false,false),false);assert.equal(canEnterVault({id:'owner'},true,false),false);assert.equal(canEnterVault({id:'owner'},false,true),false);
  assert.equal(canEnterVault({id:'local-guest'},false,false),true);
  for(const [section,href] of Object.entries(VAULT_ROUTES)){assert.equal(pathForSection(section),href);assert.equal(sectionFromPath(href),section);}
  assert.equal(pathForSection('https://invalid.example'),'/dashboard');assert.equal(pathForSection('__proto__'),'/dashboard');
});
test('actual provider survives six navigation changes and logout retains the original guest wallet cache with one callback bootstrap',async()=>{
  stored.clear();bootExchanges=0;let tree;
  await act(async()=>{tree=renderer.create(React.createElement(App));});
  assert.equal(bootExchanges,1);
  const guest={id:'local-router-guest',isLocalOnly:true,name:'Synthetic',email:'test@local.invalid',provider:'email',createdAt:'2026-10-13'};
  await act(async()=>api.loginUser(guest));
  await act(async()=>assert.equal(await api.addAccount({name:'Synthetic wallet',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:125,isCash:true}),true));
  const wallet=api.state.accounts[0];
  for(const href of Object.values(VAULT_ROUTES)){globalThis.maliRouterPath=href;await act(async()=>tree.update(React.createElement(App)));assert.equal(api.state.accounts[0].id,wallet.id);assert.equal(api.state.accounts[0].balance,125);}
  assert.equal(bootExchanges,1);const cacheBefore=new Map(stored);
  assert.ok([...cacheBefore.keys()].some(key=>key.includes(guest.id)));
  await act(async()=>assert.equal(await api.logoutUser(),true));assert.equal(api.currentUser,null);assert.equal(api.state.accounts.length,0);
  for(const [key,value] of cacheBefore)if(key.includes(guest.id))assert.equal(stored.get(key),value);
  await act(async()=>tree.unmount());
});
test('actual route shell derives active controls from the URL and renders safe link targets while preserving header actions',async()=>{
  stored.clear();
  globalThis.maliRouterPath='/accounts';
  const Probe=()=>{api=useMali();return React.createElement(MaliVaultShell,null,React.createElement('Screen'));};
  const {MaliProvider}=await import('../src/context/MaliContext.tsx');
  let shell;await act(async()=>{shell=renderer.create(React.createElement(MaliProvider,null,React.createElement(Probe)));});
  assert.equal(shell.root.findAllByType('Link').length,0);
  await act(async()=>api.loginUser({id:'local-shell',isLocalOnly:true,name:'Synthetic',email:'test@local.invalid',provider:'email',createdAt:'2026-10-13'}));
  assert.deepEqual(shell.root.findAllByType('Link').map(link=>link.props.href),['/dashboard','/expenses','/deals','/contacts']);
  const controls=shell.root.findAllByType('TouchableOpacity');
  assert.ok(controls.some(control=>control.props.accessibilityLabel==='المصاريف والحسابات'&&control.props.accessibilityState.selected));
  assert.ok(controls.some(control=>control.props.accessibilityLabel==='تصدير التقارير والنسخ الاحتياطي'));
  const theme=controls.find(control=>control.props.accessibilityLabel==='تفعيل المظهر الداكن');
  await act(async()=>theme.props.onPress());assert.equal(api.isDarkMode,true);
  await act(async()=>shell.unmount());
});
