/** Leave headroom below Android's per-entry read limit until chunked storage. */
export function assertNativeCacheSize(raw: string, maximumBytes = 1_800_000) {
  let bytes = 0;
  for (let i = 0; i < raw.length; i++) {
    const unit = raw.charCodeAt(i);
    if (unit < 0x80) bytes++;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < raw.length && raw.charCodeAt(i + 1) >= 0xdc00 && raw.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > maximumBytes) throw new Error('حجم الخزنة وقائمة الرفع يتجاوز سعة الحفظ الآمن على الجهاز. صدّر نسخة احتياطية قبل المتابعة.');
  }
}
