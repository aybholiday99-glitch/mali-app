import assert from 'node:assert/strict';
import test from 'node:test';
import { createFileExportService } from '../src/utils/fileExportCore.ts';

for(const stage of ['before','availability','file','share'])test('native archive export fences session cancellation at '+stage,async()=>{
  let active=stage!=='before';const calls=[];
  const ports={available:async()=>{calls.push('available');if(stage==='availability')active=false;return true;},textFile:async()=>{calls.push('file');if(stage==='file')active=false;return 'file:///private/known-export.json';},share:async()=>{calls.push('share');if(stage==='share')active=false;},remove:async uri=>{assert.equal(uri,'file:///private/known-export.json');calls.push('remove');}};
  assert.equal(await createFileExportService(ports,()=>active).text('archive.json','{}','application/json'),false);
  assert.deepEqual(calls,stage==='before'?[]:stage==='availability'?['available']:stage==='file'?['available','file','remove']:['available','file','share']);
});
