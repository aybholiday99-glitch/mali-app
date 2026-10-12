import { Platform, Share } from 'react-native';
import type { MaliState } from '../types/mali';
import { generateFinancialStatementHtml } from './exportCore';

export {
  formatMoney,
  formatRate,
  getPaymentMethodLabel,
  getTransactionTypeLabel,
  generateTransactionsCsv,
  generateDealsCsv,
  generateContactStatementCsv,
  matchesContact,
} from './exportCore';

export async function exportFileOrShare(
  filename: string,
  content: string,
  mimeType: string = 'text/csv;charset=utf-8;'
): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } else {
    await Share.share({
      title: filename,
      message: content,
    });
    return true;
  }
}

export function printFinancialStatementWeb(state: MaliState): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const printWin = window.open('', '_blank', 'width=960,height=720');
  if (!printWin) return false;
  printWin.opener = null;
  printWin.document.open();
  printWin.addEventListener('load', () => printWin.print(), { once: true });
  printWin.document.write(generateFinancialStatementHtml(state));
  printWin.document.close();
  return true;
}
