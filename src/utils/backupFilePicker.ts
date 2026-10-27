import {Platform} from 'react-native';
import {MAX_EXPORT_BYTES,utf8ByteLength} from './fileExportCore';
interface ReadableBackup {name:string;size:number;text():Promise<string>}
export type BackupFileResult={status:'selected';content:string;name:string;bytes:number}|{status:'cancelled'}|{status:'error';message:string};

/** Validate length before and after reading; selection never changes the vault. */
export async function readBackupFile(file:ReadableBackup):Promise<BackupFileResult>{
  try{
    if(!Number.isSafeInteger(file.size) || file.size<=0 || file.size>MAX_EXPORT_BYTES || !file.name.toLowerCase().endsWith('.json'))throw Error('Unsupported backup');
    const content=await file.text(),bytes=utf8ByteLength(content);
    if(bytes<=0 || bytes>MAX_EXPORT_BYTES || bytes!==file.size)throw Error('Incomplete read');
    return {status:'selected',content,name:file.name.slice(0,120),bytes};
  }catch{return {status:'error',message:'تعذر قراءة نسخة JSON كاملة بحجم آمن. اختر ملفاً صحيحاً وتحقق من مساحة التخزين.'};}
}
export async function pickBackupFile():Promise<BackupFileResult>{
  try{
    if(Platform.OS!=='web'){
      const {File}=await import('expo-file-system');
      const picked=await File.pickFileAsync({mimeTypes:['application/json','text/plain'],multipleFiles:false});
      if(picked.canceled)return {status:'cancelled'};
      const file=picked.result;
      return await readBackupFile({name:file.name,size:file.size,text:()=>file.text()});
    }
    if(typeof document==='undefined' || typeof window==='undefined')throw Error('Picker unavailable');
    return await new Promise<BackupFileResult>(resolve=>{
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.style.display='none';
      let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
      const done=(result:BackupFileResult)=>{if(settled)return;settled=true;clearTimeout(timer);window.removeEventListener('focus',focus);input.remove();resolve(result);};
      const focus=()=>{timer=setTimeout(()=>{if(!input.files?.length)done({status:'cancelled'});},1000);};
      input.addEventListener('cancel',()=>done({status:'cancelled'}),{once:true});
      input.onchange=()=>{clearTimeout(timer);const file=input.files?.[0];if(!file)done({status:'cancelled'});else void readBackupFile(file).then(done);};
      window.addEventListener('focus',focus);document.body.appendChild(input);
      try{input.click();}catch{done({status:'error',message:'تعذر فتح اختيار الملف.'});}
    });
  }catch{return {status:'error',message:'تعذر فتح النسخة الاحتياطية. أعد اختيار ملف JSON أو الصق محتواه.'};}
}
