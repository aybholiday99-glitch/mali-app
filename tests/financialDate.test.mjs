import assert from 'node:assert/strict';
import { test } from 'node:test';
import { financialDate } from '../src/services/financialDate.ts';
import { reconcileDashboardSummary } from '../src/services/financialEngine.ts';
test('ledger dates and monthly budgets use the same Libyan date at month/year rollover', () => {
  assert.equal(financialDate(new Date('2026-09-30T22:30:00Z')),'2026-10-01');
  assert.equal(financialDate(new Date('2026-12-31T22:00:00Z')),'2027-01-01');
  assert.equal(financialDate(new Date('2026-10-12T10:00:00Z')),'2026-10-12');
});
test('the actual dashboard monthly summary includes new-month Libyan ledger dates', () => {
  const state={accounts:[],contacts:[],transactions:[{id:'expense',type:'expense',amount:5,currency:'LYD',category:'test',date:'2026-10-01'}],
    deals:[],debts:[],procedures:[],budgets:[],marketRates:{cashUsdToLyd:6,chequeUsdToLyd:6,defaultChequeDiscountPercent:0},supabaseConfig:{}};
  const summary=reconcileDashboardSummary(state,new Date('2026-09-30T22:30:00Z'));
  assert.equal(summary.currentMonthExpensesLyd,5);
});
