import { roundFinancialPreview } from '../services/financialEngine.ts';

interface FinancialInputOptions {
  /** Only explicitly optional fields, such as a commission, may default to zero. */
  optional?: boolean;
}

/**
 * Read the whole input, using dot/Arabic decimal and comma/Arabic grouping.
 * Commas always mean thousands, so ambiguous decimal-comma input is rejected.
 * This parses notation only; the financial engine owns amount/rate constraints.
 */
export function parseFinancialInput(input: string, options: FinancialInputOptions = {}): number | null {
  const text = input.trim();
  if (!text) return options.optional ? 0 : null;
  const normalized = text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit.charCodeAt(0) <= 0x0669 ? 0x0660 : 0x06f0)));
  const match = /^([+-]?)([0-9,\u066c]*)(?:([.\u066b])([0-9]+))?$/.exec(normalized);
  if (!match || (!match[2] && !match[4])) return null;
  const [, sign, whole, , fraction] = match;
  if (whole.includes(',') && whole.includes('\u066c')) return null;
  const grouped = whole.replace(/\u066c/g, ',');
  if (grouped.includes(',') && !/^[0-9]{1,3}(?:,[0-9]{3})+$/.test(grouped)) return null;
  const digits = grouped.replace(/,/g, '') || '0';
  const value = Number(`${sign}${digits}${fraction === undefined ? '' : `.${fraction}`}`);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
  // A nonzero decimal too small for a JS number must not silently become zero.
  if (value === 0 && /[1-9]/.test(digits + (fraction || ''))) return null;
  return value;
}

/** Display-only fallback; never substitute this value in a submission payload. */
export function financialPreview(value: number | null, decimalPlaces = 2): number {
  if (value === null || !Number.isFinite(value) || !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 || decimalPlaces > 10 || Math.abs(value) * 10 ** decimalPlaces > Number.MAX_SAFE_INTEGER) return 0;
  return roundFinancialPreview(value, decimalPlaces);
}
