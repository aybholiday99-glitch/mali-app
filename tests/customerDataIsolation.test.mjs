import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { emptyFinancialState } from '../src/services/sessionScope.ts';
import { INITIAL_MALI_STATE } from '../src/data/initialData.ts';

const collections = ['accounts', 'contacts', 'transactions', 'deals', 'debts', 'procedures', 'budgets'];

test('unauthenticated and newly authenticated state never inherits unrelated template records', () => {
  for (const collection of collections) assert.deepEqual(INITIAL_MALI_STATE[collection], [], 'Shipped state must not include demo data: ' + collection);
  const blank = emptyFinancialState(INITIAL_MALI_STATE);
  for (const collection of collections) {
    assert.deepEqual(blank[collection], [], `${collection} must not contain sample records`);
  }
  assert.equal(blank.financialAudit, undefined);
  assert.equal(blank.lastModifiedAt, undefined);
  assert.notEqual(blank, INITIAL_MALI_STATE);
});

test('initial context and cloud backup validation use scrubbed state rather than demo data', async () => {
  const context = await readFile(new URL('../src/context/MaliContext.tsx', import.meta.url), 'utf8');
  const sync = await readFile(new URL('../src/services/supabaseSync.ts', import.meta.url), 'utf8');
  assert.match(context, /useState<MaliState>\(\(\) => emptyFinancialState\(INITIAL_MALI_STATE\)\)/);
  assert.match(sync, /fallbackState: emptyFinancialState\(INITIAL_MALI_STATE\)/);
  assert.doesNotMatch(context, /useState<MaliState>\(INITIAL_MALI_STATE\)/);
});

test('switching owners never mutates the source template or inherits another owner records', () => {
  const alice = emptyFinancialState(INITIAL_MALI_STATE);
  alice.contacts.push({ id: 'alice-only', name: 'Alice' });
  alice.budgets.push({ id: 'alice-budget', category: 'private' });
  const bob = emptyFinancialState(INITIAL_MALI_STATE);
  for (const collection of collections) assert.deepEqual(bob[collection], []);
  assert.deepEqual(alice.contacts.map(row => row.id), ['alice-only']);
  assert.deepEqual(INITIAL_MALI_STATE.contacts.map(row => row.id).includes('alice-only'), false);
});
