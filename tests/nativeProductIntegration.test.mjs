import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';
import React from 'react';
import renderer,{act} from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.maliTestPlatform={OS:'android'};
globalThis.nativeProductContext={theme:new Proxy({}, {get:()=> '#333333'})};
const memory=new Map(), calls={library:[],camera:[],cameraPermission:0,libraryPermission:0,manipulate:[],share:[],print:[],deleted:[]};
const jpeg=Buffer.from([255,216,255,217]).toString('base64');
const asset={uri:'file:///cache/ImagePicker/source.jpg',width:4000,height:3000,type:'image',fileSize:1000};
let copyGate=()=>Promise.resolve();
let pickerResult={canceled:false,assets:[asset]},cameraAllowed=true,sharingAvailable=true,shareError=false,writeTruncated=false,pdfOversized=false;
function uriOf(parts){const values=parts.map(p=>typeof p==='string'?p:p.uri);return values[0].replace(/\/+$/,'')+values.slice(1).map(value=>'/'+value.replace(/^\/+|\/+$/g,'')).join('');}
class Directory {
  constructor(...parts){this.uri=uriOf(parts);}
  get name(){return this.uri.split('/').at(-1);}
  get exists(){return memory.get(this.uri)?.directory===true;}
  create(){memory.set(this.uri,{directory:true});}
  list(){const prefix=this.uri+'/';return [...memory.keys()].filter(uri=>uri.startsWith(prefix)&&!uri.slice(prefix.length).includes('/')).map(uri=>memory.get(uri).directory?new Directory(uri):new File(uri));}
  delete(){for(const uri of [...memory.keys()])if(uri===this.uri||uri.startsWith(this.uri+'/'))memory.delete(uri);calls.deleted.push(this.uri);}
}
class File {
  constructor(...parts){this.uri=uriOf(parts);}
  get name(){return this.uri.split('/').at(-1);}
  get exists(){return memory.has(this.uri);}
  get size(){const data=memory.get(this.uri);return data?.size??(typeof data?.content==='string'?Buffer.byteLength(data.content):data?.content?.length??0);}
  create(){memory.set(this.uri,{content:''});}
  write(content){memory.set(this.uri,{content:writeTruncated?content.slice(0,-1):content});}
  async copy(destination){await copyGate();assert.ok(memory.has(this.uri),'printer source must remain until copy completes');assert.ok(memory.get(destination.uri.slice(0,destination.uri.lastIndexOf('/')))?.directory,'destination directory must exist until copy completes');memory.set(destination.uri,{...memory.get(this.uri)});}
  delete(){memory.delete(this.uri);calls.deleted.push(this.uri);}
}
globalThis.nativeProductFS={File,Directory,Paths:{cache:new Directory('file:///cache')}};
globalThis.nativeProductIO={
  async library(options){calls.library.push(options);return await pickerResult;},
  async camera(options){calls.camera.push(options);return await pickerResult;},
  async cameraPermission(){calls.cameraPermission++;return{granted:cameraAllowed};},
  async libraryPermission(){calls.libraryPermission++;return{granted:true};},
  manipulate(uri){
    const record={uri,released:false};calls.manipulate.push(record);
    return {resize(dimensions){record.dimensions=dimensions;},release(){record.released=true;},
      async renderAsync(){if(!memory.has(uri))throw new Error('missing local file');return{release(){record.imageReleased=true;},
        async saveAsync(options){record.options=options;const output='file:///cache/ImageManipulator/output-'+calls.manipulate.length+'.jpg';memory.set(output,{size:4});return{uri:output,base64:jpeg,...record.dimensions};}};}};
  },
  async available(){return sharingAvailable;},
  async share(uri,options){if(shareError)throw new Error('sharing failed');calls.share.push({uri,options,content:memory.get(uri)?.content});},
  async print(options){calls.print.push(options);const uri='file:///cache/Print/report.pdf';memory.set(uri,{content:Buffer.from('%PDF-1.7 isolated I/O fixture'),...(pdfOversized?{size:64*1024*1024+1}:{})});return{uri,numberOfPages:1};},
};
installNativeTestLoader({ui:true});
registerHooks({resolve(specifier,context,next){
  let source;
  if(specifier==='react-native')source="export const Platform=globalThis.maliTestPlatform;export const View='View',Text='Text',ScrollView='ScrollView',TouchableOpacity='TouchableOpacity',TextInput='TextInput',Modal='Modal',Image='Image';export const StyleSheet={create:s=>s};";
  if(specifier.endsWith('/context/MaliContext'))source='export const useMali=()=>globalThis.nativeProductContext;';
  if(specifier==='expo-image-picker')source='export const launchImageLibraryAsync=o=>globalThis.nativeProductIO.library(o),launchCameraAsync=o=>globalThis.nativeProductIO.camera(o),requestCameraPermissionsAsync=()=>globalThis.nativeProductIO.cameraPermission(),requestMediaLibraryPermissionsAsync=()=>globalThis.nativeProductIO.libraryPermission();';
  if(specifier==='expo-image-manipulator')source="export const ImageManipulator={manipulate:u=>globalThis.nativeProductIO.manipulate(u)},SaveFormat={JPEG:'jpeg'};";
  if(specifier==='expo-file-system')source='export const File=globalThis.nativeProductFS.File,Directory=globalThis.nativeProductFS.Directory,Paths=globalThis.nativeProductFS.Paths;';
  if(specifier==='expo-sharing')source='export const isAvailableAsync=()=>globalThis.nativeProductIO.available(),shareAsync=(u,o)=>globalThis.nativeProductIO.share(u,o);';
  if(specifier==='expo-print')source='export const printToFileAsync=o=>globalThis.nativeProductIO.print(o);';
  if(source)return{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};return next(specifier,context);
}});
const {pickReceiptImagesFromDevice}=await import('../src/utils/receiptPicker.ts');
const {ReceiptAttachmentField,ReceiptInlineStrip}=await import('../src/components/ReceiptImageAttachment.tsx');
const {exportFileOrShare,printFinancialStatement}=await import('../src/utils/exportHelper.ts');
function reset(){copyGate=()=>Promise.resolve();memory.clear();memory.set('file:///cache',{directory:true});memory.set(asset.uri,{size:1000});for(const key of Object.keys(calls)){if(Array.isArray(calls[key]))calls[key].length=0;else calls[key]=0;}pickerResult={canceled:false,assets:[asset]};cameraAllowed=true;sharingAvailable=true;shareError=false;writeTruncated=false;pdfOversized=false;globalThis.maliTestPlatform.OS='android';}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const state={accounts:[{id:'cash',name:'<unsafe> حساب',bankName:'Cash',category:'cash_lyd',currency:'LYD',balance:5,isCash:true}],contacts:[],deals:[],debts:[],procedures:[],transactions:[],budgets:[],marketRates:{cashUsdToLyd:6,chequeUsdToLyd:6.3,defaultChequeDiscountPercent:2},supabaseConfig:{}};

test('actual SDK adapter is permission-on-tap, requests no broad library access and persists JPEG data rather than source URI',async()=>{
  reset();assert.equal(calls.cameraPermission,0);
  const selected=await pickReceiptImagesFromDevice(0);
  assert.equal(selected.status,'selected');assert.equal(selected.images[0],'data:image/jpeg;base64,'+jpeg);
  assert.equal(JSON.parse(JSON.stringify(selected.images))[0],selected.images[0]);assert.equal(calls.libraryPermission,0);
  assert.equal(calls.library[0].selectionLimit,4);assert.deepEqual(calls.library[0].mediaTypes,['images']);
  assert.deepEqual(calls.manipulate[0].dimensions,{width:1280,height:960});assert.equal(calls.manipulate[0].options.format,'jpeg');
  assert.equal(calls.manipulate[0].options.base64,true);assert.equal(calls.manipulate[0].released,true);assert.equal(calls.manipulate[0].imageReleased,true);
  assert.equal(memory.has(asset.uri),false);assert.ok(calls.deleted.some(uri=>uri.includes('ImageManipulator')));
  reset();cameraAllowed=false;const denied=await pickReceiptImagesFromDevice(0,'camera');
  assert.equal(denied.status,'error');assert.match(denied.message,/الكاميرا/);assert.equal(calls.cameraPermission,1);assert.equal(calls.camera.length,0);
  reset();pickerResult={canceled:true,assets:null};assert.equal((await pickReceiptImagesFromDevice()).status,'cancelled');
});
test('actual receipt field keeps existing images on permission rejection and exposes an accessible recovery message',async()=>{
  reset();cameraAllowed=false;let updates=0,tree;
  await act(async()=>{tree=renderer.create(React.createElement(ReceiptAttachmentField,{images:['existing'],onChange:()=>{updates++;}}));});
  assert.equal(calls.cameraPermission,0);
  const camera=tree.root.findAllByType('TouchableOpacity').find(n=>n.props.accessibilityLabel==='التقاط صورة إيصال بالكاميرا');
  await act(async()=>{camera.props.onPress();await flush();});
  assert.equal(updates,0);assert.ok(tree.root.findAllByType('Text').some(n=>n.props.accessibilityRole==='alert'&&n.children.some(t=>typeof t==='string'&&t.includes('الكاميرا'))));
  await act(async()=>tree.unmount());
});
test('actual receipt field fences duplicate presses and stale completion after unmount',async()=>{
  reset();let release,updates=0,tree;pickerResult=new Promise(resolve=>{release=resolve;});
  await act(async()=>{tree=renderer.create(React.createElement(ReceiptAttachmentField,{images:[],onChange:()=>{updates++;}}));});
  const button=tree.root.findAllByType('TouchableOpacity').find(n=>n.props.accessibilityLabel==='اختيار صور إيصال من المعرض');
  await act(async()=>{button.props.onPress();button.props.onPress();await flush();});assert.equal(calls.library.length,1);
  await act(async()=>tree.unmount());await act(async()=>{release({canceled:false,assets:[asset]});await flush();});assert.equal(updates,0);
});
test('actual receipt field preserves reset fields and surfaces storage rejection without reporting an attachment',async()=>{
  reset();let release,updates=0,tree;const onChange=()=>{updates++;return false;};pickerResult=new Promise(resolve=>{release=resolve;});
  await act(async()=>{tree=renderer.create(React.createElement(ReceiptAttachmentField,{images:[],onChange}));});
  const gallery=()=>tree.root.findAllByType('TouchableOpacity').find(n=>n.props.accessibilityLabel==='اختيار صور إيصال من المعرض');
  await act(async()=>{gallery().props.onPress();await flush();});
  await act(async()=>{tree.update(React.createElement(ReceiptAttachmentField,{images:[],onChange}));});
  await act(async()=>{release({canceled:false,assets:[asset]});await flush();});assert.equal(updates,0);
  assert.ok(tree.root.findAllByType('Text').some(n=>n.props.accessibilityRole==='alert'&&n.children.some(t=>typeof t==='string'&&t.includes('تغيّرت'))));
  reset();await act(async()=>{gallery().props.onPress();await flush();});assert.equal(updates,1);
  assert.ok(tree.root.findAllByType('Text').some(n=>n.props.accessibilityRole==='alert'&&n.children.some(t=>typeof t==='string'&&t.includes('بالخزنة'))));
  await act(async()=>tree.unmount());
});
test('inline receipt waits for durable acknowledgement and retries the same selected images without reopening the picker',async()=>{
  reset();let resolveSave,tree;const attempts=[];
  function Host(){const [images,setImages]=React.useState(['original']);return React.createElement(ReceiptInlineStrip,{images,title:'Transfer',onUpdateImages:async next=>{
    attempts.push(next);if(attempts.length===1)return new Promise(resolve=>{resolveSave=resolve;});setImages(next);return true;
  }});}
  await act(async()=>{tree=renderer.create(React.createElement(Host));});
  const gallery=()=>tree.root.findAllByType('TouchableOpacity').find(node=>node.props.accessibilityLabel?.includes('صور إيصال من المعرض'));
  await act(async()=>{gallery().props.onPress();gallery().props.onPress();await flush();});
  assert.equal(attempts.length,1);assert.equal(calls.library.length,1);assert.equal(gallery().props.disabled,true);
  await act(async()=>{resolveSave(false);await flush();});
  assert.ok(tree.root.findAllByType('Text').some(node=>node.props.accessibilityRole==='alert'&&node.children.some(value=>typeof value==='string'&&value.includes('تعذر حفظ'))));
  await act(async()=>{await gallery().props.onPress();await flush();});
  assert.equal(attempts.length,2);assert.deepEqual(attempts[1],attempts[0]);assert.equal(calls.library.length,1);
  assert.equal(attempts[1][0],'original');assert.equal(attempts[1][1],'data:image/jpeg;base64,'+jpeg);
  await act(async()=>tree.unmount());
});
test('actual native exporter writes UTF8 CSV/unchanged JSON files and shares with correct MIME, returning false on failure',async()=>{
  reset();assert.equal(await exportFileOrShare('../كشف\u202e.csv','العنوان,القيمة'),true);
  const csv=calls.share[0];assert.ok(csv.uri.startsWith('file:///cache/mali-exports/export-'));assert.ok(csv.uri.endsWith('.csv'));assert.equal(csv.options.mimeType,'text/csv');assert.equal(csv.content,'\ufeffالعنوان,القيمة');
  const backup='{"accounts":[],"auditEvents":[{"id":"test-event"}]}\n';
  assert.equal(await exportFileOrShare('خزنة.json',backup,'application/json'),true);assert.equal(calls.share[1].content,backup);assert.equal(calls.share[1].options.UTI,'public.json');
  shareError=true;assert.equal(await exportFileOrShare('r.csv','a,b'),false);assert.equal(calls.share.length,2);
  sharingAvailable=false;assert.equal(await exportFileOrShare('r.csv','a,b'),false);
});
test('actual native PDF path sends escaped CSP report to Expo Print, shares a PDF file and releases printer cache',async()=>{
  reset();assert.equal(await printFinancialStatement(state),true);
  assert.ok(calls.print[0].html.includes('Content-Security-Policy'));assert.ok(calls.print[0].html.includes('&lt;unsafe&gt;'));assert.equal(calls.print[0].base64,false);
  assert.equal(calls.share[0].options.mimeType,'application/pdf');assert.equal(calls.share[0].options.UTI,'com.adobe.pdf');assert.ok(calls.share[0].uri.endsWith('/mali-financial-statement.pdf'));
  assert.equal(memory.has('file:///cache/Print/report.pdf'),false);assert.ok(Buffer.isBuffer(calls.share[0].content));
});
test('actual native exporters fence incomplete writes, oversized PDFs and a full recent cache without deleting unrelated files',async()=>{
  reset();writeTruncated=true;
  assert.equal(await exportFileOrShare('r.csv','العنوان,القيمة'),false);assert.equal(calls.share.length,0);
  assert.equal([...memory.keys()].some(uri=>/mali-exports\/export-/.test(uri)),false);
  reset();pdfOversized=true;assert.equal(await printFinancialStatement(state),false);assert.equal(calls.share.length,0);
  assert.equal(memory.has('file:///cache/Print/report.pdf'),false);
  reset();const cache='file:///cache/mali-exports';memory.set(cache,{directory:true});
  const unrelated=cache+'/unrelated';memory.set(unrelated,{directory:true});memory.set(unrelated+'/keep.txt',{content:'keep'});
  const expired=cache+`/export-${Date.now()-86400001}-old`;memory.set(expired,{directory:true});memory.set(expired+'/r.csv',{content:'old'});
  for(let index=0;index<8;index++)memory.set(cache+`/export-${Date.now()}-recent${index}`,{directory:true});
  assert.equal(await exportFileOrShare('r.csv','a,b'),false);assert.equal(calls.share.length,0);
  assert.equal(memory.has(expired),false);assert.equal(memory.has(unrelated+'/keep.txt'),true);
});
test('existing web picker uses bounded canvas JPEG and reports cancellation without returning original file bytes',async()=>{
  reset();globalThis.maliTestPlatform.OS='web';let cancelled=false,revoked=0,contentType='image/png';
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
  URL.createObjectURL=()=> 'blob:receipt-fixture';URL.revokeObjectURL=()=>{revoked++;};
  globalThis.window={addEventListener(){},removeEventListener(){},setTimeout,
    Image:class{naturalWidth=800;naturalHeight=600;set src(_value){queueMicrotask(()=>this.onload());}}};
  globalThis.document={body:{appendChild(){}},createElement(type){if(type==='canvas')return{getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,'+jpeg};return{style:{},files:[{type:contentType,size:100}],remove(){},click(){queueMicrotask(()=>cancelled?this.oncancel():this.onchange());}};}};
  try{assert.equal((await pickReceiptImagesFromDevice()).images[0],'data:image/jpeg;base64,'+jpeg);assert.equal(revoked,1);cancelled=true;assert.equal((await pickReceiptImagesFromDevice()).status,'cancelled');cancelled=false;contentType='image/svg+xml';assert.equal((await pickReceiptImagesFromDevice()).status,'error');assert.equal(revoked,1);}
  finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;delete globalThis.window;delete globalThis.document;}
});

for(const fail of [false,true])test('native PDF '+(fail?'copy rejection is handled':'share waits for complete asynchronous copy')+' without early source/destination cleanup',async()=>{
  reset();let release,entered;const started=new Promise(resolve=>entered=resolve);
  copyGate=()=>{entered();return new Promise((resolve,reject)=>{release=()=>fail?reject(new Error('copy failed')):resolve();});};
  const pending=printFinancialStatement(state);await started;
  assert.equal(calls.share.length,0);assert.equal(memory.has('file:///cache/Print/report.pdf'),true);
  assert.ok([...memory.entries()].some(([key,value])=>/mali-exports\/export-/.test(key)&&value.directory));
  release();assert.equal(await pending,!fail);assert.equal(calls.share.length,fail?0:1);
  assert.equal(memory.has('file:///cache/Print/report.pdf'),false);
  if(fail)assert.equal([...memory.keys()].some(key=>/mali-exports\/export-/.test(key)),false);
  else assert.deepEqual(calls.share[0].content,Buffer.from('%PDF-1.7 isolated I/O fixture'));
});
