/** Invalidates asynchronous work whenever identity changes, including A -> B -> A. */
export class SessionScope {
  private generation = 0;
  private userId: string | null = null;

  begin(userId: string | null) {
    this.userId = userId;
    return { generation: ++this.generation, userId };
  }
  capture() {
    return { generation: this.generation, userId: this.userId };
  }
  isCurrent(token: { generation: number; userId: string | null }) {
    return token.generation === this.generation && token.userId === this.userId;
  }
}

export function emptyFinancialState<T extends {
  accounts: unknown[]; contacts: unknown[]; transactions: unknown[]; deals: unknown[];
  debts: unknown[]; procedures: unknown[]; budgets?: unknown[]; lastModifiedAt?: string;
}>(base: T): T {
  return { ...base, accounts: [], contacts: [], transactions: [], deals: [], debts: [],
    procedures: [], ...(Array.isArray(base.budgets) ? { budgets: [] } : {}), financialAudit: undefined, lastModifiedAt: undefined };
}
