import { MAX_EXPORT_BYTES, utf8ByteLength, type ExportPorts } from './fileExportCore';

function secureRandomHex(bytes: number = 6): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buffer = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(buffer);
    return Array.from(buffer, b => b.toString(16).padStart(2, '0')).join('');
  }
  return Date.now().toString(16).slice(-bytes * 2);
}

export async function nativeExportPorts(): Promise<ExportPorts> {
  const Sharing=await import('expo-sharing');
  const { File,Directory,Paths }=await import('expo-file-system');
  const cache=new Directory(Paths.cache,'mali-exports');
  const prepared=new Map<string,InstanceType<typeof Directory>>();
  const owned=(directory: InstanceType<typeof Directory>) => directory.uri.startsWith(cache.uri.endsWith('/') ? cache.uri : cache.uri+'/') && /^export-\d+-[a-z0-9]+$/.test(directory.name);
  function createJob() {
    cache.create({intermediates:true,idempotent:true});
    const now=Date.now();
    const jobs=cache.list().filter((entry): entry is InstanceType<typeof Directory> => entry instanceof Directory && owned(entry)).sort((a,b)=>a.name.localeCompare(b.name));
    const retained=[];
    for (const job of jobs) {
      const created=Number(job.name.split('-')[1]);
      if (created <= now-86400000) job.delete(); else retained.push(job);
    }
    while (retained.length >= 8) {
      const oldest=retained[0];
      if (Number(oldest.name.split('-')[1]) > now-120000) throw new Error('export cache busy');
      oldest.delete();retained.shift();
    }
    const directory=new Directory(cache,`export-${now}-${secureRandomHex(6)}`);
    directory.create();return directory;
  }
  return {
    available: ()=>Sharing.isAvailableAsync(),
    async textFile(filename,content) {
      const directory=createJob();
      try {
        const file=new File(directory,filename);file.create();file.write(content);
        if (!file.exists || file.size !== utf8ByteLength(content)) throw new Error('incomplete export write');
        prepared.set(file.uri,directory);return file.uri;
      } catch (error) { if (owned(directory)) directory.delete();throw error; }
    },
    async pdfFile(filename,html) {
      const Print=await import('expo-print');
      const directory=createJob();
      let source: InstanceType<typeof File> | undefined;
      try {
        const result=await Print.printToFileAsync({html,base64:false});
        source=new File(result.uri);
        const prefix=Paths.cache.uri.endsWith('/') ? Paths.cache.uri : Paths.cache.uri+'/';
        if (!source.uri.startsWith(prefix) || !source.exists || source.size <= 0 || source.size > MAX_EXPORT_BYTES) throw new Error('invalid PDF output');
        const file=new File(directory,filename);await source.copy(file);
        if (!file.exists || file.size !== source.size) throw new Error('incomplete PDF copy');
        prepared.set(file.uri,directory);return file.uri;
      } catch (error) { if (owned(directory)) directory.delete();throw error; }
      finally {
        const prefix=Paths.cache.uri.endsWith('/') ? Paths.cache.uri : Paths.cache.uri+'/';
        if (source?.uri.startsWith(prefix) && source.exists) source.delete();
      }
    },
    share: (uri,options)=>Sharing.shareAsync(uri,options),
    async remove(uri) { const directory=prepared.get(uri);if (directory && owned(directory) && directory.exists) directory.delete();prepared.delete(uri); },
  };
}
