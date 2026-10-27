import assert from 'node:assert/strict';
import test from 'node:test';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
installNativeTestLoader();
const { snapshotFinancialInput } = await import('../src/services/financialInputSnapshot.ts');

test('immutable snapshot detaches nested records and arrays while preserving explicit undefined properties', () => {
  const input = { notes: undefined, amount: 5, immediateSale: { receipts: ['original'] } };
  const snapshot = snapshotFinancialInput(input);
  input.amount = 30; input.immediateSale.receipts.push('later'); delete input.notes;
  assert.equal(snapshot.value.amount, 5); assert.deepEqual(snapshot.value.immediateSale.receipts, ['original']);
  assert.equal(Object.hasOwn(snapshot.value, 'notes'), true); assert.equal(snapshot.value.notes, undefined);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.value)); assert.ok(Object.isFrozen(snapshot.value.immediateSale.receipts));
  assert.throws(() => { snapshot.value.immediateSale.receipts.push('mutation'); });
});

test('tagged fingerprint distinguishes absent/undefined/null and numeric strings without depending on property order', () => {
  const fingerprint = value => snapshotFinancialInput(value).fingerprint;
  assert.notEqual(fingerprint({}), fingerprint({ notes: undefined }));
  assert.notEqual(fingerprint({ notes: undefined }), fingerprint({ notes: null }));
  assert.notEqual(fingerprint({ amount: 5 }), fingerprint({ amount: '5' }));
  assert.equal(fingerprint({ notes: undefined, name: 'A' }), fingerprint({ name: 'A', notes: undefined }));
  assert.notEqual(fingerprint({ amount: -0 }), fingerprint({ amount: 0 }));
});

test('cycles, accessors, toJSON, class instances and other nonserializable values fail without executing user code', () => {
  let executed = 0;
  const accessor = Object.defineProperty({}, 'amount', { enumerable: true, get() { executed++; return 5; } });
  const toJSON = { toJSON() { executed++; return { amount: 5 }; } };
  const cycle = {}; cycle.child = cycle;
  class Command { amount = 5; }
  const invalid = [accessor, toJSON, cycle, new Command(), new Date(), { amount: NaN }, { amount: Infinity }, { amount: -Infinity },
    { value: 1n }, { value: Symbol('input') }, { value: () => 5 }, Object.create({ amount: 5 }),
    Object.defineProperty({}, 'amount', { value: 5 }), { [Symbol('key')]: 5 }];
  for (const input of invalid) assert.throws(() => snapshotFinancialInput(input));
  assert.equal(executed, 0);
});

test('arrays reject holes, extra properties, undefined elements and wrong root shape; repeated plain references remain safe', () => {
  const extra = ['receipt']; extra.custom = 'unsupported';
  for (const array of [Array(1), [undefined], extra]) assert.throws(() => snapshotFinancialInput(array, 'array'));
  assert.throws(() => snapshotFinancialInput([], 'object')); assert.throws(() => snapshotFinancialInput({}, 'array'));
  const shared = { notes: undefined, amount: 5 };
  const snapshot = snapshotFinancialInput({ a: shared, b: shared });
  shared.amount = 10; assert.equal(snapshot.value.a.amount, 5); assert.equal(snapshot.value.b.amount, 5);
});
