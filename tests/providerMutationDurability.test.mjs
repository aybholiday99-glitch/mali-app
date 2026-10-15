import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
import { fakeSyncScheduler, settle } from './fakeSyncScheduler.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.maliTestPlatform = { OS: 'ios' };
const stored = new Map();
let write = async (key, value) => stored.set(key, value), pushes = [];
globalThis.maliTestStorage = {
  getItem: async key => stored.get(key) ?? null,
  setItem: (...args) => write(...args),
  getAllKeys: async () => [...stored.keys()], removeItem: async key => stored.delete(key),
};
globalThis.maliProviderAuth = {
  clearAuthSession: async () => {}, consumeOAuthRedirectIfPresent: async () => null,
  getPersistedSessionUser: async () => null, savePersistedSessionUser: async () => {}, subscribeToAuthIdentity: () => () => {},
};
let push = async payload => { pushes.push(payload); return { ok: false, success: false, failureKind: 'transient', message: 'offline' }; };
let pull = async () => ({ ok: true, success: true, isEmpty: true, identityVerified: true, message: 'verified empty vault' });
globalThis.maliProviderSync = { pull: (...args) => pull(...args), push: (...args) => push(...args) };
installNativeTestLoader({ provider: true });
const { MaliProvider, useMali } = await import('../src/context/MaliContext.tsx');
const { financialStorage } = await import('../src/services/financialStorage.ts');
const guest = { id: 'durable-guest', isLocalOnly: true, name: 'A', email: 'a@local.invalid', provider: 'email', createdAt: '2026-10-13' };
const cloud = { ...guest, id: '11111111-1111-4111-8111-111111111111', isLocalOnly: false };
const cash = { name: 'Cash', bankName: 'Cash', category: 'cash_lyd', currency: 'LYD', balance: 100, isCash: true, color: '#fff' };
let api;
function Probe() { api = useMali(); return null; }
async function mount(user = guest) {
  stored.clear(); pushes = []; write = async (key, value) => stored.set(key, value);
  push = async payload => { pushes.push(payload); return { ok: false, success: false, failureKind: 'transient', message: 'offline' }; };
  pull = async () => ({ ok: true, success: true, isEmpty: true, identityVerified: true, message: 'verified empty vault' });
  const clock = fakeSyncScheduler(); let tree;
  await act(async () => { tree = renderer.create(React.createElement(MaliProvider, { syncScheduler: clock.scheduler }, React.createElement(Probe))); });
  await act(async () => { api.loginUser(user); });
  await act(async () => { assert.equal(await api.addAccount(cash), true); });
  return { tree, clock };
}
const disk = async user => JSON.parse(await financialStorage.getItem('@mali_app_state_v2_' + user.id));
const expense = (amount = 5, key = 'durable-expense') => ({ title: 'Expense', type: 'expense', amount, currency: 'LYD', category: 'test', accountId: api.state.accounts[0].id, paymentMethod: 'cash', idempotencyKey: key });
function holdNextWrite() {
  let release, entered; const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  let once = true; write = async (key, value) => { if (once) { once = false; entered(); await held; } stored.set(key, value); };
  return { release, started };
}

test('financial acknowledgement is a Promise and neither balances nor audit publish before verified guest storage', async () => {
  const { tree } = await mount(), before = api.state, gate = holdNextWrite(); let result;
  await act(async () => { result = api.addTransaction(expense()); await gate.started; });
  assert.equal(typeof result?.then, 'function'); assert.equal(api.state, before); assert.equal(api.mutationStatus.phase, 'saving');
  await act(async () => { gate.release(); assert.equal(await result, true); });
  assert.equal(api.state.accounts[0].balance, 95); assert.equal((await disk(guest)).accounts[0].balance, 95);
  assert.deepEqual((await disk(guest)).financialAudit, api.state.financialAudit);
  await act(async () => { tree.unmount(); });
});

test('guest failed storage keeps accepted RAM unchanged and retry writes the same candidate without repeating IDs or audit', async () => {
  const { tree } = await mount(), before = api.state; let attempted;
  write = async (_key, value) => { if (value.includes('durable-expense')) attempted = JSON.parse(value); throw new Error('unavailable'); };
  await act(async () => { assert.equal(await api.addTransaction(expense()), false); });
  assert.equal(api.state, before); assert.equal((await disk(guest)).accounts[0].balance, 100); assert.equal(api.mutationStatus.phase, 'storage-error');
  assert.equal(attempted.localRevision, before.localRevision + 1);
  const originalCandidate = attempted;
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.retryPendingMutation(), true); });
  assert.deepEqual((await disk(guest)).transactions, originalCandidate.transactions);
  assert.deepEqual((await disk(guest)).financialAudit, originalCandidate.financialAudit);
  assert.equal(api.state.localRevision, originalCandidate.localRevision); assert.equal(api.state.accounts[0].balance, 95);
  await act(async () => { tree.unmount(); });
});

test('cloud no-op storage acknowledgement publishes nothing, makes no network request, and matching submission retries exact outbox', async () => {
  const { tree, clock } = await mount(cloud), before = api.state, input = expense(); write = async () => {};
  await act(async () => { assert.equal(await api.addTransaction(input), false); await clock.advance(120000); });
  assert.equal(api.state, before); assert.equal(pushes.length, 0); assert.equal((await disk(cloud)).accounts[0].balance, 100);
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.addTransaction(input), true); });
  const saved = await disk(cloud); assert.equal(saved.accounts[0].balance, 95); assert.equal(saved.cloudOutbox.pending.payload.accounts[0].balance, 95);
  assert.equal(saved.localRevision, saved.cloudOutbox.pending.revision); assert.deepEqual(saved.financialAudit, saved.cloudOutbox.pending.payload.financialAudit);
  await act(async () => { tree.unmount(); });
});

test('concurrent financial requests compute serially from the last durable commit', async () => {
  const { tree } = await mount(), gate = holdNextWrite(); let first, second;
  await act(async () => { first = api.addTransaction(expense(60, 'first')); second = api.addTransaction(expense(60, 'second')); await gate.started; });
  assert.equal(api.state.accounts[0].balance, 100);
  await act(async () => { gate.release(); assert.equal(await first, true); assert.equal(await second, false); });
  assert.equal(api.state.accounts[0].balance, 40); assert.equal(api.state.transactions.length, 1); assert.equal((await disk(guest)).accounts[0].balance, 40);
  await act(async () => { tree.unmount(); });
});

test('session switch during storage cannot acknowledge or publish the old owner candidate', async () => {
  const { tree } = await mount(), gate = holdNextWrite(); let result;
  await act(async () => { result = api.addTransaction(expense()); await gate.started; });
  await act(async () => { await api.logoutUser(); api.loginUser({ ...guest, id: 'durable-other' }); gate.release(); assert.equal(await result, false); await settle(); });
  assert.equal(api.currentUser.id, 'durable-other'); assert.equal(api.state.accounts.length, 0); assert.equal(api.mutationStatus.phase, 'idle');
  await act(async () => { tree.unmount(); });
});

test('a failed candidate blocks a different request and config change until explicit retry', async () => {
  const { tree } = await mount(), before = api.state; write = async () => { throw new Error('unavailable'); };
  await act(async () => { assert.equal(await api.addTransaction(expense()), false); });
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.addTransaction(expense(1, 'different')), false); assert.equal(await api.updateSupabaseConfig({ url: 'https://other.example.invalid' }), false); });
  assert.equal(api.state, before);
  await act(async () => { assert.equal(await api.retryPendingMutation(), true); });
  assert.equal(api.state.transactions.length, 1); assert.equal(api.state.transactions[0].idempotencyKey, 'durable-expense');
  await act(async () => { tree.unmount(); });
});

test('an older in-flight ACK merges only metadata while a newer candidate is being verified', async () => {
  let acknowledge;
  const { tree, clock } = await mount(cloud);
  push = async payload => { pushes.push(payload); return new Promise(resolve => { acknowledge = resolve; }); };
  await act(async () => { await clock.advance(0); }); assert.equal(pushes.length, 1);
  const gate = holdNextWrite(); let result;
  await act(async () => { result = api.addTransaction(expense()); await gate.started; });
  const timestamp = '2026-10-13T00:01:00.123456+00:00';
  await act(async () => { acknowledge({ ok: true, success: true, updatedAt: timestamp, message: 'saved' }); await settle(); });
  assert.equal(api.state.accounts[0].balance, 100);
  await act(async () => { gate.release(); assert.equal(await result, true); await settle(); });
  const saved = await disk(cloud);
  assert.equal(api.state.accounts[0].balance, 95); assert.equal(api.state.transactions.length, 1); assert.equal(api.state.pendingCloudSync, true);
  assert.equal(saved.accounts[0].balance, 95); assert.equal(saved.cloudOutbox.pending.payload.accounts[0].balance, 95);
  assert.equal(saved.localRevision, saved.cloudOutbox.pending.revision); assert.equal(saved.cloudOutbox.syncedAt, timestamp);
  assert.equal(api.state.supabaseConfig.lastSyncedAt, timestamp); assert.notEqual(api.cloudSyncStatus.phase, 'storage-error');
  await act(async () => { tree.unmount(); });
});

test('unkeyed contact creation retries the original generated contact and returns its durable identity', async () => {
  const { tree } = await mount(), before = api.state; let original;
  write = async (_key, value) => { if (value.includes('Pending contact')) original = JSON.parse(value); throw new Error('unavailable'); };
  const input = { name: 'Pending contact', phone: '0910000000', role: 'شريك تجاري' };
  await act(async () => { assert.equal(await api.addContact(input), null); });
  assert.equal(api.state, before); assert.equal(api.state.contacts.length, 0);
  write = async (key, value) => stored.set(key, value); let contact;
  await act(async () => { contact = await api.addContact(input); });
  assert.equal(contact.id, original.contacts[0].id); assert.deepEqual((await disk(guest)).contacts, original.contacts);
  assert.deepEqual((await disk(guest)).financialAudit, original.financialAudit);
  assert.equal(api.state.localRevision, original.localRevision);
  await act(async () => { tree.unmount(); });
});

test('no-op mutation does not write, append audit evidence, advance revision, or leave the mutation queue locked', async () => {
  const { tree } = await mount(), before = api.state; let writes = 0;
  write = async () => { writes++; throw new Error('no-op must not write'); };
  await act(async () => { assert.equal(await api.updateAccountBalance(before.accounts[0].id, 100), false); });
  assert.equal(api.state, before); assert.equal(writes, 0); assert.equal(api.mutationStatus.phase, 'idle');
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.addTransaction(expense()), true); });
  assert.equal(api.state.localRevision, before.localRevision + 1);
  await act(async () => { tree.unmount(); });
});

test('delayed cloud pull cannot replace accepted state while a local candidate is still awaiting storage', async () => {
  const { tree } = await mount(); const before = api.state; let releasePull, pulled;
  pull = async () => new Promise(resolve => { releasePull = resolve; });
  await act(async () => { pulled = api.pullFromCloud(); await settle(); });
  const gate = holdNextWrite(); let saved;
  await act(async () => { saved = api.addTransaction(expense()); await gate.started; });
  await act(async () => { releasePull({ ok: true, success: true, state: { ...before, accounts: [] }, updatedAt: '2026-10-13T01:00:00Z' });
    assert.equal((await pulled).conflictDetected, true); });
  assert.equal(api.state, before);
  await act(async () => { gate.release(); assert.equal(await saved, true); });
  assert.equal(api.state.accounts[0].balance, 95); assert.equal((await disk(guest)).accounts[0].balance, 95);
  await act(async () => { tree.unmount(); });
});

test('successful cloud replacement and its CAS baseline publish together only after verified storage', async () => {
  const { tree } = await mount(cloud), before = api.state;
  // Seed a clean accepted acknowledgement without contacting any real service.
  push = async () => ({ ok: true, success: true, updatedAt: '2026-10-13T00:01:00Z', message: 'saved' });
  await act(async () => { assert.equal((await api.syncToCloud()).ok, true); });
  const clean = api.state, timestamp = '2026-10-13T02:00:00Z';
  const { appendFinancialAudit } = await import('../src/services/financialAudit.ts');
  const remote = appendFinancialAudit(clean, { ...clean, accounts: clean.accounts.map(row => ({ ...row, balance: 80 })) }, { ownerId: cloud.id, action: 'balance_correction', reason: 'isolated remote correction' });
  pull = async () => ({ ok: true, success: true, state: remote, updatedAt: timestamp, snapshotUpdatedAt: timestamp, message: 'loaded' });
  const gate = holdNextWrite(); let result;
  await act(async () => { result = api.pullFromCloud(); await gate.started; });
  assert.equal(api.state.accounts[0].balance, before.accounts[0].balance);
  await act(async () => { gate.release(); assert.equal((await result).ok, true); });
  const saved = await disk(cloud); assert.equal(api.state.accounts[0].balance, 80); assert.equal(saved.accounts[0].balance, 80);
  assert.equal(saved.supabaseConfig.lastSyncedAt, timestamp); assert.equal(saved.cloudOutbox.syncedAt, timestamp);
  await act(async () => { tree.unmount(); });
});

test('queued transaction uses invocation-time amount and receipt array even when caller mutates both immediately', async () => {
  const { tree } = await mount(); const input = { ...expense(), receiptImages: ['original-receipt'] }; let result;
  await act(async () => { result = api.addTransaction(input); input.amount = 30; input.title = 'Changed later'; input.receiptImages.push('later-receipt'); assert.equal(await result, true); });
  assert.equal(api.state.accounts[0].balance, 95); assert.equal(api.state.transactions[0].amount, 5);
  assert.equal(api.state.transactions[0].title, 'Expense'); assert.deepEqual(api.state.transactions[0].receiptImages, ['original-receipt']);
  await act(async () => { tree.unmount(); });
});

test('held queue binds original input to its retry key, then write failure reuses exact candidate despite caller mutation', async () => {
  const { tree } = await mount(), gate = holdNextWrite(); let first, second, original;
  const input = expense(5, 'detached-retry');
  await act(async () => { first = api.addTransaction(expense(1, 'queue-first')); await gate.started; second = api.addTransaction(input); input.amount = 30; });
  // Let the first commit finish; fail only the queued original five-unit submission.
  write = async (key, value) => { if (value.includes('detached-retry')) { original = JSON.parse(value); throw new Error('unavailable'); } stored.set(key, value); };
  await act(async () => { gate.release(); assert.equal(await first, true); assert.equal(await second, false); });
  assert.equal(api.state.accounts[0].balance, 99); assert.equal(original.transactions[0].amount, 5);
  const retry = { ...expense(5, 'detached-retry') }; write = async (key, value) => stored.set(key, value);
  let saved; await act(async () => { saved = api.addTransaction(retry); retry.amount = 80; assert.equal(await saved, true); });
  const committed = await disk(guest); assert.equal(committed.accounts[0].balance, 94);
  assert.deepEqual(committed.transactions, original.transactions); assert.deepEqual(committed.financialAudit, original.financialAudit); assert.equal(committed.localRevision, original.localRevision);
  await act(async () => { tree.unmount(); });
});

test('explicit undefined contact clears survive snapshot and cannot be confused with an absent-property retry', async () => {
  const { tree } = await mount(); let contact;
  await act(async () => { contact = await api.addContact({ name: 'Clear contact', phone: '091', role: 'شريك تجاري', bankDetails: 'Original bank', notes: 'Original notes' }); });
  const before = api.state, clear = { bankDetails: undefined, notes: undefined }; let original, result;
  write = async (_key, value) => { if (value.includes('Clear contact')) original = JSON.parse(value); throw new Error('unavailable'); };
  await act(async () => { result = api.updateContact(contact.id, clear); clear.bankDetails = 'Later bank'; clear.notes = 'Later notes'; assert.equal(await result, false); });
  assert.equal(api.state, before); assert.equal(original.contacts[0].bankDetails, undefined); assert.equal(original.contacts[0].notes, undefined);
  write = async (key, value) => stored.set(key, value);
  await act(async () => { assert.equal(await api.updateContact(contact.id, {}), false); });
  assert.equal(api.state, before); assert.equal(api.mutationStatus.phase, 'storage-error');
  await act(async () => { assert.equal(await api.updateContact(contact.id, { notes: undefined, bankDetails: undefined }), true); });
  assert.equal(api.state.contacts[0].bankDetails, undefined); assert.equal(api.state.contacts[0].notes, undefined);
  assert.deepEqual((await disk(guest)).financialAudit, original.financialAudit);
  await act(async () => { tree.unmount(); });
});

test('rates, accounts, contacts and configuration are detached before their queued state computation', async () => {
  const { tree } = await mount(); let result;
  const rates = { cashUsdToLyd: 6.1234 };
  await act(async () => { result = api.updateMarketRates(rates); rates.cashUsdToLyd = 8; assert.equal(await result, true); });
  assert.equal(api.state.marketRates.cashUsdToLyd, 6.1234);
  const account = { ...cash, name: 'Original account', balance: 20 };
  await act(async () => { result = api.addAccount(account); account.name = 'Changed account'; account.balance = 80; assert.equal(await result, true); });
  assert.equal(api.state.accounts.find(row => row.name === 'Original account').balance, 20);
  const contact = { name: 'Original contact', phone: '091', role: 'شريك تجاري' }; let saved;
  await act(async () => { result = api.addContact(contact); contact.name = 'Changed contact'; saved = await result; });
  assert.equal(saved.name, 'Original contact');
  const partial = { phone: '092' };
  await act(async () => { result = api.updateContact(saved.id, partial); partial.phone = '099'; assert.equal(await result, true); });
  assert.equal(api.state.contacts[0].phone, '092');
  const config = { autoSync: false };
  await act(async () => { result = api.updateSupabaseConfig(config); config.autoSync = true; assert.equal(await result, true); });
  assert.equal(api.state.supabaseConfig.autoSync, false);
  await act(async () => { tree.unmount(); });
});

test('compound buy, sale, and both public receipt-update arrays retain their original nested inputs', async () => {
  const { tree } = await mount();
  await act(async () => { assert.equal(await api.addAccount({ ...cash, name: 'USD', currency: 'USD', category: 'cash_usd', balance: 0 }), true); });
  const lyd = api.state.accounts.find(row => row.currency === 'LYD').id, usd = api.state.accounts.find(row => row.currency === 'USD').id;
  const image = 'data:image/jpeg;base64,/9j/2Q==';
  const input = { title: 'Original deal', totalUsdBought: 10, buyRate: 6, buyCommissionLyd: 0, buyPaymentMethod: 'cash', sourceLydAccountId: lyd, usdHoldingAccountId: usd,
    buyReceiptImages: [image], immediateSale: { usdAmount: 2, sellRate: 7, commissionLyd: 0, paymentMethod: 'cash', targetLydAccountId: lyd, buyerName: 'Original buyer', receiptImages: [image] } };
  let result; await act(async () => { result = api.createUsdDeal(input); input.totalUsdBought = 20; input.immediateSale.sellRate = 20; input.immediateSale.buyerName = 'Changed buyer'; input.immediateSale.receiptImages.push('later'); assert.equal(await result, true); });
  assert.equal(api.state.accounts.find(row => row.id === lyd).balance, 54); assert.equal(api.state.accounts.find(row => row.id === usd).balance, 8);
  const dealId = api.state.deals[0].id;
  assert.equal(api.state.deals[0].sales[0].sellRate, 7); assert.equal(api.state.deals[0].sales[0].buyerName, 'Original buyer'); assert.deepEqual(api.state.deals[0].sales[0].receiptImages, [image]);
  const sale = { dealId, usdAmount: 1, sellRate: 7, commissionLyd: 0, paymentMethod: 'cash', targetLydAccountId: lyd, sourceUsdAccountId: usd, receiptImages: [image] };
  await act(async () => { result = api.recordDealSale(sale); sale.usdAmount = 3; sale.commissionLyd = 1; sale.receiptImages.push('later'); assert.equal(await result, true); });
  assert.equal(api.state.accounts.find(row => row.id === lyd).balance, 61); assert.equal(api.state.deals[0].sales[0].usdAmount, 1);
  const buyImages = [];
  await act(async () => { result = api.updateDealBuyReceipts(dealId, buyImages); buyImages.push('later'); assert.equal(await result, true); });
  assert.equal(api.state.deals[0].buyReceiptImages, undefined);
  const saleId = api.state.deals[0].sales[0].id, saleImages = [];
  await act(async () => { result = api.updateDealSaleReceipts(dealId, saleId, saleImages); saleImages.push('later'); assert.equal(await result, true); });
  assert.equal(api.state.deals[0].sales[0].receiptImages, undefined);
  await act(async () => { tree.unmount(); });
});

test('cheque, debt, installment and procedure arrays use invocation-time values', async () => {
  const { tree } = await mount();
  const cashId = api.state.accounts[0].id;
  await act(async () => { assert.equal(await api.addAccount({ ...cash, name: 'Bank', category: 'bank_lyd', isCash: false, balance: 1000 }), true); });
  const bankId = api.state.accounts.find(row => row.name === 'Bank').id, cheque = { sourceBankAccountId: bankId, targetCashAccountId: cashId, chequeAmountLyd: 100, discountPercent: 1 };
  let result; await act(async () => { result = api.liquidateChequeToCash(cheque); cheque.chequeAmountLyd = 200; cheque.discountPercent = 50; assert.equal(await result, true); });
  assert.equal(api.state.accounts.find(row => row.id === bankId).balance, 900); assert.equal(api.state.accounts.find(row => row.id === cashId).balance, 199);
  const debt = { personName: 'Original debtor', direction: 'receivable', currency: 'LYD', totalAmount: 10, affectAccountId: cashId, paymentMethod: 'cash' };
  await act(async () => { result = api.addDebt(debt); debt.totalAmount = 20; debt.personName = 'Changed debtor'; assert.equal(await result, true); });
  assert.equal(api.state.debts[0].totalAmount, 10); assert.equal(api.state.debts[0].personName, 'Original debtor');
  const payment = { debtId: api.state.debts[0].id, amount: 5, accountId: cashId, paymentMethod: 'cash' };
  await act(async () => { result = api.addDebtInstallment(payment); payment.amount = 9; assert.equal(await result, true); });
  assert.equal(api.state.debts[0].remainingAmount, 5); assert.equal(api.state.accounts.find(row => row.id === cashId).balance, 194);
  const procedure = { title: 'Original procedure', procedureType: 'إجراء مصرفي عام', bankOrEntity: 'Bank', amount: 5, stages: ['Original stage'] };
  await act(async () => { result = api.addProcedure(procedure); procedure.title = 'Changed procedure'; procedure.amount = 30; procedure.stages.push('Later stage'); assert.equal(await result, true); });
  assert.equal(api.state.procedures[0].title, 'Original procedure'); assert.equal(api.state.procedures[0].amount, 5); assert.equal(api.state.procedures[0].stages.length, 1);
  await act(async () => { tree.unmount(); });
});

test('invalid numbers, accessors, cycles and unsupported objects resolve failure without executing user code or writing', async () => {
  const { tree } = await mount(), before = api.state; let writes = 0, executed = 0;
  write = async () => { writes++; throw new Error('must not write'); };
  for (const amount of [NaN, Infinity, -Infinity]) await act(async () => { assert.equal(await api.addTransaction({ ...expense(), amount }), false); });
  const accessor = Object.defineProperty({ ...expense() }, 'amount', { enumerable: true, get() { executed++; return 5; } });
  const toJSON = { ...expense(), toJSON() { executed++; return expense(); } };
  const cycle = { ...expense() }; cycle.child = cycle;
  for (const input of [accessor, toJSON, cycle, { ...expense(), custom: 1n }, new Date(), { ...expense(), custom: () => 5 }]) await act(async () => { assert.equal(await api.addTransaction(input), false); });
  assert.equal(executed, 0); assert.equal(writes, 0); assert.equal(api.state, before); assert.equal(api.mutationStatus.phase, 'idle');
  await act(async () => { tree.unmount(); });
});
