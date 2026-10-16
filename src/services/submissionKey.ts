let sequence = 0;
function secureRandomHex(bytes: number = 6): string {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buffer = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(buffer);
    return Array.from(buffer, b => b.toString(16).padStart(2, '0')).join('');
  }
  return (++sequence).toString(16).padStart(bytes * 2, '0');
}
/** A form retains this key until React commits the successful submission reset. */
export function nextSubmissionKey(): string {
  return 'mali-' + Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + secureRandomHex(6);
}
