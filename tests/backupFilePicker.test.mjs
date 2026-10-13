import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {Buffer} from 'node:buffer';
import {installNativeTestLoader} from './nativeModuleTestLoader.mjs';
globalThis.maliTestPlatform={OS:'android'};
installNativeTestLoader();
let result;
registerHooks({resolve(specifier,context,next){if(specifier==='expo-file-system')return {url:'data:text/javascript,'+encodeURIComponent('export const File={pickFileAsync:(...args)=>globalThis.backupPickerMock(...args)};'),shortCircuit:true};return next(specifier,context);}});
globalThis.backupPickerMock=async options=>{assert.deepEqual(options,{mimeTypes:['application/json','text/plain'],multipleFiles:false});return result;};
const {readBackupFile,pickBackupFile}=await import('../src/utils/backupFilePicker.ts');
const raw='{"name":"مالي","financialAudit":[]}';
const file={name:'backup.json',size:Buffer.byteLength(raw),text:async()=>raw};
test('actual Expo57 picker reads a complete UTF8 JSON file without applying or altering it',async()=>{
  result={canceled:false,result:file};const chosen=await pickBackupFile();assert.equal(chosen.status,'selected');assert.equal(chosen.content,raw);assert.equal(chosen.bytes,file.size);
});
test('native picker cancellation and I/O errors retain vault data and disclose no paths or error details',async()=>{
  result={canceled:true,result:null};assert.equal((await pickBackupFile()).status,'cancelled');
  result={canceled:false,result:{...file,text:async()=>{throw Error('PRIVATE-PATH-KEY');}}};const failed=await pickBackupFile();assert.equal(failed.status,'error');assert.ok(!failed.message.includes('PRIVATE'));
});
test('backup file rejects unknown/oversize/partial lengths and wrong extensions before importing',async()=>{
  let reads=0;
  for(const size of [0,-1,NaN,64*1024*1024+1])assert.equal((await readBackupFile({...file,size,text:async()=>{reads++;return raw;}})).status,'error');
  assert.equal(reads,0);assert.equal((await readBackupFile({...file,name:'photo.jpg'})).status,'error');
  assert.equal((await readBackupFile({...file,size:file.size+1})).status,'error');
});
