export type FinancialAuditCollection = 'accounts' | 'contacts' | 'transactions' | 'deals' | 'debts' | 'procedures' | 'budgets' | 'marketRates';
export interface FinancialAuditChange {
  collection: FinancialAuditCollection;
  recordId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
/** Offline assertions become immutable server evidence only when accepted. */
export interface FinancialAuditEvent {
  version: 1;
  id: string;
  sequence: number;
  ownerId: string;
  action: string;
  reason: string;
  recordedAt: string;
  operationId?: string;
  changes: FinancialAuditChange[];
}
export interface FinancialAuditMetadata {
  ownerId: string;
  action: string;
  reason: string;
  /** Stable submission identity, retained even after an operation is reversed. */
  operationId?: string;
}
