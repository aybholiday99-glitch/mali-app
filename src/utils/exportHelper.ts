import { Platform } from 'react-native';
import type { MaliState } from '../types/mali';
import { generateFinancialStatementHtml } from './exportCore';
import { createFileExportService, prepareTextExport } from './fileExportCore';
import { nativeExportPorts } from './nativeFileExport';

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
  mimeType: string = 'text/csv;charset=utf-8;',
  canContinue: () => boolean = () => true
): Promise<boolean> {
  try {
    if (!canContinue()) return false;
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof document === 'undefined') return false;
      const file=prepareTextExport(filename,content,mimeType);
      const blob=new Blob([file.content],{type:file.mimeType+';charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      try {
        link.href=url;link.setAttribute('download',file.filename);document.body.appendChild(link);
        if (!canContinue()) return false;
        link.click();return canContinue();
      } finally { link.remove();URL.revokeObjectURL(url); }
    }
    const ports = await nativeExportPorts();
    if (!canContinue()) return false;
    const exported = await createFileExportService(ports, canContinue).text(filename,content,mimeType);
    return canContinue() && exported;
  } catch { return false; }
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

/** True means printing/sharing was initiated, not that another app saved the file. */
export async function printFinancialStatement(state: MaliState): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return printFinancialStatementWeb(state);
    return await createFileExportService(await nativeExportPorts()).pdf(generateFinancialStatementHtml(state));
  } catch { return false; }
}
