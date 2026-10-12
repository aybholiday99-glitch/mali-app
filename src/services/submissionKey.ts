let sequence = 0;
/** A form retains this key until React commits the successful submission reset. */
export function nextSubmissionKey(): string {
  return 'mali-' + Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2);
}
