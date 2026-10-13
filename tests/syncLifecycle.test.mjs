import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const platform={OS:'android'};
let change,removed=0;
globalThis.maliLifecycleNative={Platform:platform,AppState:{currentState:'active',addEventListener:(event,callback)=>{assert.equal(event,'change');change=callback;return{remove(){removed++;}};}}};
registerHooks({resolve(specifier,context,next){if(specifier==='react-native')return {url:'data:text/javascript,export const {Platform,AppState}=globalThis.maliLifecycleNative;',shortCircuit:true};return next(specifier,context);}});
const {subscribeSyncLifecycle}=await import('../src/services/syncLifecycle.ts');
for(const os of ['android','ios'])test(os+' Hermes window without DOM methods supports foreground/reconnect and disposal',()=>{
 platform.OS=os;globalThis.window={};const states=[];let reconnects=0;const before=removed;
 const dispose=subscribeSyncLifecycle(active=>states.push(active),()=>reconnects++);
 change('background');change('active');dispose();assert.deepEqual(states,[true,false,true]);assert.equal(reconnects,1);assert.equal(removed,before+1);delete globalThis.window;
});
test('web online listener reconnects and removes the exact subscription',()=>{
 platform.OS='web';let listener,unsubscribed=false,reconnects=0;
 globalThis.window={addEventListener(event,callback){assert.equal(event,'online');listener=callback;},removeEventListener(event,callback){assert.equal(event,'online');assert.equal(callback,listener);unsubscribed=true;}};
 const dispose=subscribeSyncLifecycle(()=>{},()=>reconnects++);listener();assert.equal(reconnects,1);dispose();assert.equal(unsubscribed,true);delete globalThis.window;
});
test('server rendering has no window listener',()=>{platform.OS='web';delete globalThis.window;const dispose=subscribeSyncLifecycle(()=>{},()=>{});dispose();});
