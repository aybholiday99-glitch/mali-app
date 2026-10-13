import { Platform } from 'react-native';
import { pickBoundedReceipts, ReceiptInputError, MAX_RECEIPT_SOURCE_BYTES, type ReceiptPickerPorts, type ReceiptSource } from './receiptCore';

async function nativePorts(): Promise<ReceiptPickerPorts> {
  const Picker = await import('expo-image-picker');
  const Manipulator = await import('expo-image-manipulator');
  const { File, Paths } = await import('expo-file-system');
  let sources: string[] = [];
  const removeCached = (uri: string) => {
    if (uri.startsWith(Paths.cache.uri.endsWith('/') ? Paths.cache.uri : Paths.cache.uri + '/')) {
      const file = new File(uri);
      if (file.exists) file.delete();
    }
  };
  return {
    async select(source,limit) {
      if (source === 'camera' && !(await Picker.requestCameraPermissionsAsync()).granted) {
        throw new ReceiptInputError('يلزم السماح بالكاميرا لالتقاط إيصال. افتح إعدادات الهاتف أو اختر صورة من المعرض.');
      }
      const options = { mediaTypes:['images'] as const,allowsEditing:false,base64:false,exif:false,quality:1,shouldDownloadFromNetwork:false };
      const result = source === 'camera' ? await Picker.launchCameraAsync({...options,mediaTypes:['images']}) :
        await Picker.launchImageLibraryAsync({...options,mediaTypes:['images'],allowsMultipleSelection:true,selectionLimit:limit});
      sources = result.assets?.map(asset=>asset.uri) || [];
      return result;
    },
    async sourceSize(asset) { return new File(asset.uri).size || asset.fileSize || 0; },
    async compress(asset,dimensions,quality) {
      const context = Manipulator.ImageManipulator.manipulate(asset.uri);
      let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      try {
        context.resize(dimensions);
        image = await context.renderAsync();
        const saved = await image.saveAsync({format:Manipulator.SaveFormat.JPEG,compress:quality,base64:true});
        try { return {base64:saved.base64,width:saved.width,height:saved.height}; }
        finally { removeCached(saved.uri); }
      } finally { image?.release(); context.release(); }
    },
    async cleanup() { for (const uri of sources) { try { removeCached(uri); } catch { /* OS cache cleanup can retry. */ } } },
  };
}

function webPorts(): ReceiptPickerPorts {
  const files = new Map<string,File>();
  return {
    select(source,limit) {
      return new Promise((resolve,reject) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.multiple = source !== 'camera' && limit > 1;
        if (source === 'camera') input.capture = 'environment';
        input.style.display = 'none';
        let settled = false, processing = false;
        const cleanup = () => { input.remove(); window.removeEventListener('focus',focus); };
        const finish = (result: {canceled:boolean;assets?:{uri:string;width:number;height:number;type:string}[]}) => {
          if (!settled) { settled=true;cleanup();resolve(result); }
        };
        const focus = () => { window.setTimeout(()=>{if (!processing && !input.files?.length) finish({canceled:true});},300); };
        input.oncancel = () => finish({canceled:true});
        input.onchange = async () => {
          processing=true;
          const selected=Array.from(input.files || []);
          if (!selected.length) { finish({canceled:true});return; }
          if (selected.length > limit) { cleanup();reject(new ReceiptInputError('اختر صوراً لا تتجاوز الحد المتبقي من 4 صور.'));return; }
          try {
            const assets = [];
            for (const file of selected) {
              if (!/^image\/(jpeg|png|webp|gif|bmp|x-ms-bmp|heic|heif|avif)$/i.test(file.type)) throw new ReceiptInputError('اختر صورة فوتوغرافية مدعومة لإرفاق الإيصال.');
              if (file.size <= 0 || file.size > MAX_RECEIPT_SOURCE_BYTES) throw new ReceiptInputError('الصورة كبيرة جداً. اختر نسخة أصغر.');
              const uri = URL.createObjectURL(file);files.set(uri,file);
              const image = await loadWebImage(uri);
              assets.push({uri,width:image.naturalWidth,height:image.naturalHeight,type:'image'});
            }
            finish({canceled:false,assets});
          } catch (error) { cleanup();reject(error); }
        };
        document.body.appendChild(input);window.addEventListener('focus',focus);
        try { input.click(); } catch (error) { cleanup();reject(error); }
      });
    },
    async sourceSize(asset) { return files.get(asset.uri)?.size || 0; },
    async compress(asset,dimensions,quality) {
      const image = await loadWebImage(asset.uri);
      const canvas=document.createElement('canvas');canvas.width=dimensions.width;canvas.height=dimensions.height;
      const context=canvas.getContext('2d');
      if (!context) throw new ReceiptInputError('تعذر تجهيز الصورة في هذا المتصفح. جرّب صورة أخرى.');
      context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/jpeg',quality);
      return {base64:data.startsWith('data:image/jpeg;base64,') ? data.slice(23) : null,width:canvas.width,height:canvas.height};
    },
    async cleanup() { for (const uri of files.keys()) URL.revokeObjectURL(uri);files.clear(); },
  };
}
function loadWebImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve,reject)=>{
    const image=new window.Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new ReceiptInputError('تعذر قراءة الصورة. اختر صورة أخرى.'));image.src=uri;
  });
}

export async function pickReceiptImagesFromDevice(existingCount = 0, source: ReceiptSource = 'library') {
  try {
    if (Platform.OS === 'web' && (typeof document === 'undefined' || typeof window === 'undefined')) throw new Error('picker unavailable');
    return await pickBoundedReceipts(Platform.OS === 'web' ? webPorts() : await nativePorts(),existingCount,source);
  } catch { return {status:'error' as const,images:[],message:'تعذر فتح الصور. حاول مجدداً.'}; }
}
