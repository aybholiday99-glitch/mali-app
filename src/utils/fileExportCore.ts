// Reject oversize backups before creating a file; never truncate financial data.
// Device performance and available storage still require native qualification.
export const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
export interface ExportPorts {
  available: () => Promise<boolean>;
  textFile: (filename: string, content: string) => Promise<string>;
  pdfFile: (filename: string, html: string) => Promise<string>;
  share: (uri: string, options: { mimeType: string; UTI: string }) => Promise<void>;
  remove: (uri: string) => Promise<void>;
}
export function utf8ByteLength(value: string) {
  let bytes=0;
  for (const character of value) {
    const code=character.codePointAt(0)!;
    bytes+=code<=0x7f ? 1 : code<=0x7ff ? 2 : code<=0xffff ? 3 : 4;
  }
  return bytes;
}
export function safeExportFilename(filename: string, extension: 'csv' | 'json' | 'pdf') {
  let base=filename.normalize('NFKC').replace(/\.(csv|json|pdf)$/i,'').replace(/[^\p{L}\p{N} _.-]/gu,'_').replace(/^\.+/,'').replace(/[ .]+$/,'').trim();
  base=Array.from(base).slice(0,80).join('') || 'mali-export';
  while (utf8ByteLength(base) > 180) base=Array.from(base).slice(0,-1).join('');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base='mali-'+base;
  return base+'.'+extension;
}
export function prepareTextExport(filename: string, content: string, mimeType: string) {
  const mime=mimeType.split(';')[0].trim().toLowerCase();
  if (mime !== 'text/csv' && mime !== 'application/json') throw new Error('unsupported export format');
  const body=mime === 'text/csv' && !content.startsWith('\ufeff') ? '\ufeff'+content : content;
  if (!content || utf8ByteLength(body) > MAX_EXPORT_BYTES) throw new Error('export too large');
  if (mime === 'application/json') JSON.parse(content);
  return {filename:safeExportFilename(filename,mime === 'text/csv' ? 'csv' : 'json'),
    content:body,
    mimeType:mime,UTI:mime === 'text/csv' ? 'public.comma-separated-values-text' : 'public.json'};
}
export function createFileExportService(ports: ExportPorts) {
  async function perform(prepare: () => Promise<string>, options: {mimeType:string;UTI:string}) {
    let uri: string | undefined;
    try {
      if (!await ports.available()) return false;
      uri=await prepare();
      if (!uri.startsWith('file://')) throw new Error('export must be a local file');
      await ports.share(uri,options);
      // Keep successful files in bounded private cache so receiving apps can read them.
      return true;
    } catch {
      if (uri) await ports.remove(uri).catch(()=>{});
      return false;
    }
  }
  return {
    async text(filename: string,content: string,mimeType = 'text/csv;charset=utf-8;') {
      try {
        const file=prepareTextExport(filename,content,mimeType);
        return await perform(()=>ports.textFile(file.filename,file.content),{mimeType:file.mimeType,UTI:file.UTI});
      } catch { return false; }
    },
    async pdf(html: string) {
      if (!html || utf8ByteLength(html) > MAX_EXPORT_BYTES) return false;
      return perform(()=>ports.pdfFile('mali-financial-statement.pdf',html),{mimeType:'application/pdf',UTI:'com.adobe.pdf'});
    },
  };
}
