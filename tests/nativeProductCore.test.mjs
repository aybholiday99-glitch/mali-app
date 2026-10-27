import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { MAX_RECEIPT_BYTES, MAX_RECEIPT_SOURCE_BYTES, jpegDataUrl, pickBoundedReceipts, receiptDimensions } from '../src/utils/receiptCore.ts';
import { MAX_EXPORT_BYTES, createFileExportService, prepareTextExport, safeExportFilename, utf8ByteLength } from '../src/utils/fileExportCore.ts';

const jpeg = bytes => {
  const data=Buffer.alloc(bytes);data[0]=255;data[1]=216;data[bytes-2]=255;data[bytes-1]=217;return data.toString('base64');
};
const asset={uri:'file:///cache/ImagePicker/receipt.jpg',width:4000,height:3000,fileSize:1000,type:'image'};
function picker(overrides={}) {
  const calls={select:0,cleanup:0,compress:[]};
  return {calls,ports:{select:async()=>{calls.select++;return{canceled:false,assets:[asset]};},sourceSize:async()=>1000,
    compress:async(_asset,dimensions,quality)=>{calls.compress.push({dimensions,quality});return{...dimensions,base64:jpeg(100)};},
    cleanup:async()=>{calls.cleanup++;},...overrides}};
}
test('receipt output is self-contained bounded JPEG and preserves aspect ratio without upscaling',async()=>{
  const {ports,calls}=picker();const result=await pickBoundedReceipts(ports,0);
  assert.equal(result.status,'selected');assert.equal(result.images[0],jpegDataUrl(jpeg(100)));
  assert.deepEqual(calls.compress[0].dimensions,{width:1280,height:960});assert.equal(calls.cleanup,1);
  assert.deepEqual(receiptDimensions(100,50),{width:100,height:50});
  assert.equal(jpegDataUrl(Buffer.from('not an image').toString('base64')),null);
  assert.equal(jpegDataUrl(jpeg(MAX_RECEIPT_BYTES+1)),null);
});
test('compression retries are bounded and cannot fall back to temporary URI or oversized source',async()=>{
  let attempts=0;const {ports}=picker({compress:async(_asset,dimensions)=>({...dimensions,base64:jpeg(++attempts===1?MAX_RECEIPT_BYTES+1:100)})});
  assert.equal((await pickBoundedReceipts(ports,0)).status,'selected');assert.equal(attempts,2);
  const fail=picker({compress:async(_asset,dimensions)=>({...dimensions,base64:jpeg(MAX_RECEIPT_BYTES+1)})});
  assert.equal((await pickBoundedReceipts(fail.ports,0)).status,'error');assert.equal(fail.calls.cleanup,1);
});
test('count, source bytes/pixels, remote paths and corrupt output reject the entire selection',async()=>{
  for(const overrides of [
    {select:async()=>({canceled:false,assets:[asset,asset]})},
    {sourceSize:async()=>MAX_RECEIPT_SOURCE_BYTES+1},
    {select:async()=>({canceled:false,assets:[{...asset,width:30000,height:30000}]})},
    {select:async()=>({canceled:false,assets:[{...asset,uri:'https://invalid.example/receipt.jpg'}]})},
    {compress:async()=>({uri:asset.uri,width:100,height:100,base64:null})},
  ]) assert.equal((await pickBoundedReceipts(picker(overrides).ports,3)).status,'error');
  const full=picker();assert.equal((await pickBoundedReceipts(full.ports,4)).status,'error');assert.equal(full.calls.select,0);
  const partial=picker({select:async()=>({canceled:false,assets:[asset,{...asset,type:'video'}]})});
  assert.deepEqual((await pickBoundedReceipts(partial.ports,0)).images,[]);
});
test('cancellation and I/O failures are explicit and cleanup runs without a successful payload',async()=>{
  const cancel=picker({select:async()=>({canceled:true,assets:null})});
  assert.equal((await pickBoundedReceipts(cancel.ports,0)).status,'cancelled');assert.equal(cancel.calls.cleanup,1);
  const fail=picker({select:async()=>{throw new Error('private path details');}});
  const result=await pickBoundedReceipts(fail.ports,0);assert.equal(result.status,'error');assert.equal(result.message.includes('private path'),false);
});
test('export transport normalizes safe names/MIME and preserves exact JSON backup bytes',()=>{
  const json='{"accounts":[],"auditEvents":[]}\n';
  assert.equal(prepareTextExport('../خزنة\u202e.json',json,'application/json;charset=utf-8').content,json);
  const csv=prepareTextExport('bad/../name.json','العنوان,المبلغ','text/csv;charset=utf-8;');
  assert.ok(csv.content.startsWith('\ufeff'));assert.equal(csv.mimeType,'text/csv');
  assert.equal(/[\\/\u202e]/.test(csv.filename),false);assert.ok(csv.filename.endsWith('.csv'));
  assert.equal(safeExportFilename('CON.csv','csv'),'mali-CON.csv');assert.equal(utf8ByteLength('ع😀'),Buffer.byteLength('ع😀'));
  assert.equal(safeExportFilename('CON.backup.json','json'),'mali-CON.backup.json');
  assert.throws(()=>prepareTextExport('x.json','broken JSON','application/json'));
  assert.throws(()=>prepareTextExport('x.exe','abc','application/octet-stream'));
});
test('exports share actual local files with format metadata and report errors/unavailability as false',async()=>{
  const calls=[];const ports={available:async()=>true,textFile:async(name,content)=>{calls.push({name,content});return'file:///cache/export/report.csv';},
    pdfFile:async()=> 'file:///cache/export/report.pdf',share:async(uri,options)=>calls.push({uri,options}),remove:async uri=>calls.push({removed:uri})};
  const service=createFileExportService(ports);
  assert.equal(await service.text('report.csv','a,b'),true);assert.equal(calls[1].uri,'file:///cache/export/report.csv');assert.equal(calls[1].options.mimeType,'text/csv');
  assert.equal(await service.pdf('<html>report</html>'),true);assert.equal(calls.at(-1).options.mimeType,'application/pdf');
  assert.equal(await createFileExportService({...ports,available:async()=>false}).text('r.csv','a,b'),false);
  assert.equal(await createFileExportService({...ports,share:async()=>{throw new Error('denied');}}).text('r.csv','a,b'),false);
  assert.equal(calls.at(-1).removed,'file:///cache/export/report.csv');
  assert.equal(await createFileExportService({...ports,textFile:async()=> 'https://invalid.example/report.csv'}).text('r.csv','a,b'),false);
});
test('64 MiB UTF-8 export limit rejects before file I/O and never truncates larger supported backups',async()=>{
  assert.equal(MAX_EXPORT_BYTES,64*1024*1024);
  const backup=JSON.stringify({auditEvents:[],data:'x'.repeat(33*1024*1024)});
  assert.equal(prepareTextExport('backup.json',backup,'application/json').content,backup);
  let io=0;
  const ports={available:async()=>{io++;return true;},textFile:async()=>{io++;return'file:///cache/backup.json';},pdfFile:async()=>{io++;return'file:///cache/report.pdf';},share:async()=>{io++;},remove:async()=>{io++;}};
  assert.equal(await createFileExportService(ports).text('backup.json','ع'.repeat(MAX_EXPORT_BYTES/2+1),'application/json'),false);
  assert.equal(io,0);
});
