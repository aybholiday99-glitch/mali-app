import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

globalThis.maliTestPlatform={OS:'android'};
installNativeTestLoader();
registerHooks({resolve(specifier,context,next){
  if(specifier.endsWith('/nativeFileExport'))return{url:'data:text/javascript,'+encodeURIComponent('export const nativeExportPorts=()=>globalThis.archiveExportPorts();'),shortCircuit:true};
  return next(specifier,context);
}});
const {exportFileOrShare}=await import('../src/utils/exportHelper.ts');
test('actual export helper checks session again after asynchronous native port creation',async()=>{
  let active=true,release,calls=0;
  globalThis.archiveExportPorts=()=>new Promise(resolve=>{release=()=>resolve({available:async()=>{calls++;return true;}});});
  const result=exportFileOrShare('archive.json','{}','application/json',()=>active);
  await Promise.resolve();active=false;release();assert.equal(await result,false);assert.equal(calls,0);
});
test('actual native helper passes the owner fence through file preparation before sharing',async()=>{
  let active=true,shares=0,removed=0;
  globalThis.archiveExportPorts=async()=>({available:async()=>true,textFile:async()=>{active=false;return 'file:///owned/archive.json';},share:async()=>{shares++;},remove:async()=>{removed++;}});
  assert.equal(await exportFileOrShare('archive.json','{}','application/json',()=>active),false);
  assert.equal(shares,0);assert.equal(removed,1);
});
test('actual web helper checks the fence immediately before initiating the download',async()=>{
  let active=true,clicks=0,removed=0,revoked=0;
  const before={window:globalThis.window,document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  globalThis.maliTestPlatform.OS='web';globalThis.window={};
  globalThis.document={createElement:()=>({setAttribute(){},click(){clicks++;},remove(){removed++;}}),body:{appendChild(){active=false;}}};
  URL.createObjectURL=()=> 'blob:synthetic';URL.revokeObjectURL=()=>{revoked++;};
  try{assert.equal(await exportFileOrShare('archive.json','{}','application/json',()=>active),false);assert.equal(clicks,0);assert.equal(removed,1);assert.equal(revoked,1);}
  finally{globalThis.maliTestPlatform.OS='android';globalThis.window=before.window;globalThis.document=before.document;URL.createObjectURL=before.create;URL.revokeObjectURL=before.revoke;}
});
