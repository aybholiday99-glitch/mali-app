/** Ledger dates use the Libyan business calendar; sync timestamps remain UTC instants. */
export function financialDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Tripoli', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return value('year') + '-' + value('month') + '-' + value('day');
}
