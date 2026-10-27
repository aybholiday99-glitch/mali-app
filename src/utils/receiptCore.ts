export const MAX_RECEIPTS = 4;
export const MAX_RECEIPT_BYTES = 200 * 1024;
export const MAX_RECEIPT_EDGE = 1280;
export const MAX_RECEIPT_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_RECEIPT_SOURCE_PIXELS = 25_000_000;
export type ReceiptSource = 'library' | 'camera';
export type ReceiptPickResult = { status: 'selected' | 'cancelled' | 'error'; images: string[]; message?: string };
export interface ReceiptAsset { uri: string; width: number; height: number; fileSize?: number; type?: string | null }
export interface ReceiptPickerPorts {
  select: (source: ReceiptSource, limit: number) => Promise<{ canceled: boolean; assets?: ReceiptAsset[] | null }>;
  sourceSize: (asset: ReceiptAsset) => Promise<number>;
  compress: (asset: ReceiptAsset, dimensions: { width: number; height: number }, quality: number) => Promise<{ base64?: string | null; width: number; height: number }>;
  cleanup: () => Promise<void>;
}
export class ReceiptInputError extends Error {}

export function receiptDimensions(width: number, height: number, edge = MAX_RECEIPT_EDGE) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function base64ByteLength(value: string): number | null {
  if (!value || value.length > MAX_RECEIPT_SOURCE_BYTES * 4 / 3 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  return value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}
function base64Byte(value: string, index: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const offset = Math.floor(index / 3) * 4;
  const a = alphabet.indexOf(value[offset]), b = alphabet.indexOf(value[offset + 1]);
  const c = alphabet.indexOf(value[offset + 2]), d = alphabet.indexOf(value[offset + 3]);
  return index % 3 === 0 ? (a << 2 | b >> 4) : index % 3 === 1 ? ((b & 15) << 4 | c >> 2) : ((c & 3) << 6 | d);
}
export function jpegDataUrl(base64: string): string | null {
  const bytes = base64ByteLength(base64);
  if (bytes === null || bytes < 4 || bytes > MAX_RECEIPT_BYTES || base64Byte(base64,0) !== 255 || base64Byte(base64,1) !== 216 ||
    base64Byte(base64,bytes - 2) !== 255 || base64Byte(base64,bytes - 1) !== 217) return null;
  return 'data:image/jpeg;base64,' + base64;
}

/** Atomic selection: one failed/oversized image preserves all existing attachments. */
export async function pickBoundedReceipts(ports: ReceiptPickerPorts, existingCount: number, source: ReceiptSource = 'library'): Promise<ReceiptPickResult> {
  const remaining = MAX_RECEIPTS - existingCount;
  if (!Number.isInteger(existingCount) || existingCount < 0 || remaining <= 0) {
    return { status:'error',images:[],message:'يمكن إرفاق 4 صور كحد أقصى. احذف صورة لإضافة أخرى.' };
  }
  try {
    const selection = await ports.select(source,remaining);
    if (selection.canceled || !selection.assets?.length) return { status:'cancelled',images:[],message:'أُلغي اختيار الصور.' };
    if (selection.assets.length > remaining) throw new ReceiptInputError('اختر صوراً لا تتجاوز الحد المتبقي من 4 صور.');
    const images: string[] = [];
    for (const asset of selection.assets) {
      if (!/^(file|content|blob):/.test(asset.uri) || (asset.type && asset.type !== 'image') ||
        !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0 ||
        asset.width * asset.height > MAX_RECEIPT_SOURCE_PIXELS) throw new ReceiptInputError('الصورة غير مدعومة أو كبيرة جداً. اختر نسخة أصغر.');
      const size = await ports.sourceSize(asset);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_RECEIPT_SOURCE_BYTES) throw new ReceiptInputError('الصورة كبيرة جداً أو تعذر قراءتها. اختر نسخة أصغر.');
      let image: string | null = null;
      for (const [edge, quality] of [[1280,0.75],[1280,0.55],[1024,0.5],[768,0.45]]) {
        const result = await ports.compress(asset,receiptDimensions(asset.width,asset.height,edge),quality);
        if (!Number.isFinite(result.width) || !Number.isFinite(result.height) || result.width <= 0 || result.height <= 0 ||
          result.width > MAX_RECEIPT_EDGE || result.height > MAX_RECEIPT_EDGE || !result.base64) throw new ReceiptInputError('تعذر تجهيز الصورة. اختر صورة أخرى.');
        image = jpegDataUrl(result.base64);
        if (image) break;
      }
      if (!image) throw new ReceiptInputError('تعذر تقليل حجم الصورة. اختر صورة أصغر أو قصّها قبل إرفاقها.');
      images.push(image);
    }
    return { status:'selected',images };
  } catch (error) {
    return { status:'error',images:[],message:error instanceof ReceiptInputError ? error.message : 'تعذر اختيار الصور. حاول مجدداً أو اختر صورة أخرى.' };
  } finally {
    await ports.cleanup().catch(() => {});
  }
}
