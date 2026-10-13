import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import React from 'react';
import renderer,{act} from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
import { fixture,OWNER,OTHER } from './recoveryArchiveFixture.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.maliTestPlatform={OS:'android'};
let storage,exporter;
globalThis.maliTestStorage={getItem:key=>storage.getItem(key),getAllKeys:()=>storage.getAllKeys(),setItem:()=>{throw Error('Read-only panel cannot write');}};
globalThis.recoveryPanelExport=(...args)=>exporter(...args);
installNativeTestLoader({ui:true});
registerHooks({resolve(specifier,context,next){
  let source;
  if(specifier.endsWith('/context/MaliContext'))source='export const useMali=()=>globalThis.recoveryPanelApi;';
  if(specifier.endsWith('/utils/exportHelper'))source='export const exportFileOrShare=(...a)=>globalThis.recoveryPanelExport(...a);';
  return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(specifier,context);
}});
const {RecoveryArchivePanel}=await import('../src/components/RecoveryArchivePanel.tsx');
const button=(tree,label)=>tree.root.findAllByType('TouchableOpacity').find(row=>row.props.accessibilityLabel===label||row.findAllByType('Text').some(text=>text.children.join('').includes(label)));
const text=tree=>tree.root.findAllByType('Text').map(row=>row.children.join('')).join('\n');
function identity(owner=OWNER,generation=1){globalThis.recoveryPanelApi={theme:{text:'#111',textSecondary:'#444',primary:'#075',card:'#fff',cardAlt:'#eee',border:'#999'},currentUser:owner?{id:owner}:null,mutationSessionGeneration:generation};}
async function mount(f){storage=f.backend;identity();exporter=async()=>true;let tree;await act(async()=>{tree=renderer.create(React.createElement(RecoveryArchivePanel));});return tree;}
async function open(tree){await act(async()=>{button(tree,'النسخ المحفوظة قبل').props.onPress();});}
async function select(tree){await act(async()=>{button(tree,'عرض النسخ المتاحة').props.onPress();});}
const close=async tree=>act(async()=>tree.unmount());

test('actual archive panel selects prior vault and exports its complete validated JSON without applying it',async()=>{
  const f=fixture(),{previous}=await f.archive(),tree=await mount(f);f.writes.length=0;
  await open(tree);await select(tree);let exported;
  exporter=async(filename,content,mime,canContinue)=>{assert.equal(canContinue(),true);exported={filename,content,mime};return true;};
  await act(async()=>{button(tree,'تصدير الخزنة السابقة على هذا الجهاز').props.onPress();});
  assert.deepEqual(JSON.parse(exported.content).financialAudit,previous.financialAudit);assert.deepEqual(JSON.parse(exported.content).deals,previous.deals);
  assert.equal(exported.mime,'application/json');assert.ok(!exported.content.includes('PRIVATE-CONNECTION'));
  assert.ok(text(tree).includes('استخدم استرجاع النسخة'));assert.equal(f.writes.length,0);
  for(const node of tree.root.findAllByType('TouchableOpacity'))assert.equal(node.props.accessibilityRole,'button');
  await close(tree);
});
test('unreadable prior bytes have an explicit message and no export action while other versions remain available',async()=>{
  const f=fixture();await f.archive(OWNER,{previous:'{corrupt'});const tree=await mount(f);await open(tree);await select(tree);
  assert.ok(text(tree).includes('غير قابلة للقراءة'));assert.equal(button(tree,'تصدير الخزنة السابقة على هذا الجهاز'),undefined);
  assert.ok(button(tree,'تصدير النسخة المختارة وقت الحفظ'));await close(tree);
});
test('owner/generation change during held read prevents old archive details and export from appearing',async()=>{
  const f=fixture();await f.archive();await f.archive(OTHER);const tree=await mount(f);await open(tree);
  let release;storage={...f.backend,getItem:async key=>new Promise(resolve=>{release=()=>resolve(f.saved.get(key)??null);})};
  await act(async()=>{button(tree,'عرض النسخ المتاحة').props.onPress();await Promise.resolve();});
  await act(async()=>{identity(OTHER,2);tree.update(React.createElement(RecoveryArchivePanel));});
  await act(async()=>{release();await Promise.resolve();});
  assert.ok(!text(tree).includes('الخزنة السابقة'));assert.equal(button(tree,'تصدير هذه النسخة'),undefined);await close(tree);
});
test('export double taps are serialized and A logout A invalidates sharing predicate and late success',async()=>{
  const f=fixture();await f.archive();const tree=await mount(f);await open(tree);await select(tree);
  let release,allowed,calls=0;exporter=async(_name,_content,_mime,canContinue)=>{calls++;allowed=canContinue;return new Promise(resolve=>{release=resolve;});};
  await act(async()=>{const click=button(tree,'تصدير الخزنة السابقة على هذا الجهاز').props.onPress;click();click();});
  assert.equal(calls,1);assert.equal(allowed(),true);
  await act(async()=>{identity(OWNER,3);tree.update(React.createElement(RecoveryArchivePanel));});
  assert.equal(allowed(),false);await act(async()=>{release(true);});
  assert.ok(!text(tree).includes('تم فتح تنزيل'));assert.ok(!text(tree).includes('الخزنة السابقة'));await close(tree);
});
test('archive pages remain bounded and logout removes even an already selected archive',async()=>{
  const f=fixture();for(let i=0;i<7;i++)await f.archive();const tree=await mount(f);await open(tree);
  const choices=()=>tree.root.findAllByType('TouchableOpacity').filter(row=>row.findAllByType('Text').some(t=>t.children.join('')==='عرض النسخ المتاحة'));
  assert.equal(choices().length,5);await act(async()=>{button(tree,'عرض نسخ أقدم').props.onPress();});assert.equal(choices().length,2);
  await select(tree);await act(async()=>{identity(null,2);tree.update(React.createElement(RecoveryArchivePanel));});
  assert.equal(tree.toJSON(),null);await close(tree);
});
