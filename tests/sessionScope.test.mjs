import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionScope, emptyFinancialState } from '../src/services/sessionScope.ts';

test('logout and account switch invalidate delayed login/pull callbacks', async () => {
  const scope = new SessionScope();
  const a = scope.begin('A');
  let resolvePull;
  const pull = new Promise(resolve => { resolvePull = resolve; });
  let applied = false;
  const continuation = pull.then(() => { if (scope.isCurrent(a)) applied = true; });
  scope.begin(null);
  scope.begin('B');
  scope.begin('A');
  resolvePull();
  await continuation;
  assert.equal(applied, false);
  assert.equal(scope.isCurrent(a), false);
  assert.equal(scope.isCurrent(scope.capture()), true);
});
test('new cloud vault never inherits demo balances or financial records', () => {
  const demo = { accounts: [{ balance: 5000 }], contacts: [{}], transactions: [{}], deals: [{}],
    debts: [{}], procedures: [{}], budgets: [{ category: 'food' }], lastModifiedAt: 'old' };
  const cloud = emptyFinancialState(demo);
  for (const key of ['accounts','contacts','transactions','deals','debts','procedures']) assert.deepEqual(cloud[key], []);
  assert.deepEqual(demo.accounts, [{ balance: 5000 }]);
  assert.deepEqual(cloud.budgets, demo.budgets);
});
