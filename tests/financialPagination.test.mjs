import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { performance } from 'node:perf_hooks';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.maliTestPlatform = { OS: 'web' };
installNativeTestLoader({ ui: true });
const exportCore = new URL('../src/utils/exportCore.ts', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/context/MaliContext')) return { url: 'data:text/javascript,export const useMali=()=>globalThis.maliPaginationContext;', shortCircuit: true };
  if (specifier.endsWith('/utils/exportHelper')) return { url: 'data:text/javascript,' + encodeURIComponent(`export * from ${JSON.stringify(exportCore)}; export const exportFileOrShare=async(...args)=>{globalThis.maliPaginationExport=args;return true;}; export const printContactStatement=async()=>true, printContactStatementWeb=()=>true;`), shortCircuit: true };
  if (specifier.endsWith('/components/ReceiptImageAttachment')) return { url: 'data:text/javascript,export const ReceiptAttachmentField=()=>null,ReceiptInlineStrip=()=>null;', shortCircuit: true };
  const resolved = nextResolve(specifier, context);
  if (specifier === 'react-native') return { ...resolved, url: resolved.url + encodeURIComponent('\nexport const Linking={openURL:async()=>{throw new Error("External navigation forbidden");}};') };
  return resolved;
} });
const { INITIAL_MALI_STATE } = await import('../src/data/initialData.ts');
const { AccountsScreen } = await import('../src/screens/AccountsScreen.tsx');
const { ContactsScreen } = await import('../src/screens/ContactsScreen.tsx');
const { DashboardScreen } = await import('../src/screens/DashboardScreen.tsx');
const { ExpensesScreen } = await import('../src/screens/ExpensesScreen.tsx');
const { ProceduresDebtsScreen } = await import('../src/screens/ProceduresDebtsScreen.tsx');
const { UsdDealsScreen } = await import('../src/screens/UsdDealsScreen.tsx');
const { CalmDropdown } = await import('../src/components/CalmDropdown.tsx');
const { generateTransactionsCsv, generateDealsCsv, generateContactStatementCsv, formatMoney } = await import('../src/utils/exportCore.ts');
const suffix = i => String(i).padStart(5, '0');
const date = '2026-10-13';
const account = i => ({ id: `account-${i}`, name: `ACCOUNT-${suffix(i)}`, bankName: 'Cash', category: 'cash_lyd', currency: 'LYD', balance: 1, isCash: true, color: '#123456', updatedAt: date });
const contact = i => ({ id: `contact-${i}`, name: `CONTACT-${suffix(i)}`, phone: `091${suffix(i)}`, role: 'تاجر عملة', createdAt: date });
const sale = i => ({ id: `sale-${i}`, dealId: `deal-${i}`, usdAmount: 0.5, sellRate: 6, grossLyd: 3, commissionLyd: 0,
  netLydReceived: 3, costBasisLyd: 2.5, profitLyd: 0.5, paymentMethod: 'cash', targetLydAccountId: 'account-0', sourceUsdAccountId: 'usd',
  contactId: `contact-${i}`, buyerName: `BUYER-${suffix(i)}`, date, notes: `SALE-${suffix(i)}` });
const deal = i => ({ id: `deal-${i}`, dealNumber: `DEAL-${suffix(i)}`, title: `DEAL-TITLE-${suffix(i)}`, contactId: `contact-${i}`,
  counterparty: `CONTACT-${suffix(i)}`, buyDate: date, totalUsdBought: 1, buyRate: 5, grossLydCost: 5, buyCommissionLyd: 0,
  totalLydCost: 5, effectiveBuyRate: 5, buyPaymentMethod: 'cash', sourceLydAccountId: 'account-0', usdHoldingAccountId: 'usd',
  soldUsd: 0.5, personalTakenUsd: 0, remainingUsd: 0.5, totalLydReceived: 3, realizedProfitLyd: 0.5, status: 'partial', sales: [sale(i)] });
const debt = i => ({ id: `debt-${i}`, contactId: `contact-${i}`, personName: `DEBT-${suffix(i)}`, direction: 'receivable', currency: 'LYD',
  totalAmount: 2, paidAmount: 0, remainingAmount: 2, status: 'active', installments: [], createdAt: date, notes: `DEBT-NOTE-${suffix(i)}` });
const procedure = i => ({ id: `procedure-${i}`, title: `PROCEDURE-${suffix(i)}`, procedureType: 'إجراء مصرفي عام', bankOrEntity: 'Bank', status: 'pending',
  stages: [{ id: `stage-${i}`, title: `STAGE-${suffix(i)}`, completed: false }], createdAt: date });
const transaction = i => ({ id: `transaction-${i}`, title: `TX-${suffix(i)}`, type: 'expense', amount: 1, currency: 'LYD', category: 'Other',
  accountId: 'account-0', paymentMethod: 'cash', date });
const array = (count, factory) => Array.from({ length: count }, (_, i) => factory(i));
const stateWith = overrides => ({ ...structuredClone(INITIAL_MALI_STATE), accounts: [account(0), { ...account(1), id: 'usd', currency: 'USD', category: 'cash_usd' }], ...overrides });
const theme = new Proxy({}, { get: () => '#333333' });
let tree;
async function mount(Screen, state, props = {}) {
  globalThis.maliPaginationContext = { state, theme, mutationStatus: { phase: 'idle' }, mutationSessionGeneration: 1 };
  await act(async () => { tree = renderer.create(React.createElement(Screen, { onNavigate: () => {}, ...props })); });
  return tree;
}
const buttons = () => tree.root.findAllByType('TouchableOpacity');
const pageButton = (label, position) => buttons().find(node => node.props.accessibilityLabel === `${label}: الصفحة ${position}`);
const allText = () => tree.root.findAllByType('Text').flatMap(node => node.children).filter(child => typeof child === 'string').join(' ');
const exactText = pattern => tree.root.findAllByType('Text').flatMap(node => node.children).filter(child => typeof child === 'string' && pattern.test(child));
const field = label => tree.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label);
const hosts = () => tree.root.findAll(node => typeof node.type === 'string').length;
const pressPage = async (label, position) => { await act(async () => { pageButton(label, position).props.onPress(); }); };
const unmount = async () => { await act(async () => { tree.unmount(); }); };

test('100, 1000 and 10000 real ledger rows keep a constant rendered tree, retain full totals and export all data', async t => {
  const measurements = [];
  for (const count of [100, 1000, 10000]) {
    const state = stateWith({ transactions: array(count, transaction) });
    const before = JSON.stringify(state); const started = performance.now();
    await mount(ExpensesScreen, state);
    measurements.push({ count, hosts: hosts(), text: tree.root.findAllByType('Text').length, ms: Math.round(performance.now() - started) });
    assert.equal(exactText(/^TX-\d+$/).length, 20);
    assert.ok(hosts() < 800, 'only one ledger page may be rendered');
    assert.ok(allText().includes(formatMoney(count, 'LYD')), 'the summary must include off-page transactions');
    await act(async () => { field('قيمة المصروف السريع').props.onChangeText('7.77'); });
    await pressPage('سجل الحركات', 'الأخيرة');
    assert.ok(allText().includes(`TX-${suffix(count - 1)}`)); assert.ok(!allText().includes('TX-00000'));
    assert.equal(field('قيمة المصروف السريع').props.value, '7.77');
    assert.equal(pageButton('سجل الحركات', 'الأخيرة').props.disabled, true);
    await act(async () => { buttons().find(node => String(node.props.onPress).includes('generateTransactionsCsv')).props.onPress(); });
    assert.equal(globalThis.maliPaginationExport[1], generateTransactionsCsv(state));
    assert.ok(globalThis.maliPaginationExport[1].includes(`TX-${suffix(count - 1)}`));
    assert.equal(JSON.stringify(state), before);
    await unmount();
  }
  assert.equal(new Set(measurements.map(value => value.hosts)).size, 1);
  t.diagnostic(`Host renderer only; not native frame timings: ${JSON.stringify(measurements)}`);
});

test('filter changes reset immediately, shrink clamps, growth stays on the clamped page and session changes reset navigation', async () => {
  const state = stateWith({ transactions: array(10000, transaction) });
  await mount(ExpensesScreen, state); await pressPage('سجل الحركات', 'الأخيرة');
  await act(async () => { field('البحث عن حركة بالغرض أو الحساب').props.onChangeText('TX-09999'); });
  assert.deepEqual(exactText(/^TX-\d+$/), ['TX-09999']);
  await act(async () => { field('البحث عن حركة بالغرض أو الحساب').props.onChangeText(''); });
  assert.ok(allText().includes('TX-00000')); await pressPage('سجل الحركات', 'الأخيرة');
  globalThis.maliPaginationContext.state = { ...state, transactions: state.transactions.slice(0, 25) };
  await act(async () => { tree.update(React.createElement(ExpensesScreen)); });
  assert.deepEqual(exactText(/^TX-\d+$/), array(5, i => `TX-${suffix(20 + i)}`));
  globalThis.maliPaginationContext.state = { ...state, transactions: state.transactions.slice(0, 50) };
  await act(async () => { tree.update(React.createElement(ExpensesScreen)); });
  assert.equal(exactText(/^TX-\d+$/)[0], 'TX-00020');
  globalThis.maliPaginationContext.mutationSessionGeneration = 2;
  await act(async () => { tree.update(React.createElement(ExpensesScreen)); });
  assert.equal(exactText(/^TX-\d+$/)[0], 'TX-00000');
  await unmount();
});

test('ten thousand contacts and deals remain searchable and pageable with complete deal and contact exports', async () => {
  const state = stateWith({ contacts: array(10000, contact), deals: array(10000, deal), debts: array(10000, debt) });
  await mount(ContactsScreen, state);
  assert.ok(hosts() < 1800); await pressPage('المتعاملون', 'الأخيرة');
  assert.ok(buttons().some(node => node.props.accessibilityLabel === 'تعديل بيانات CONTACT-09999'));
  await act(async () => { field('البحث عن متعامل بالاسم أو الهاتف').props.onChangeText('CONTACT-09999'); });
  assert.equal(buttons().filter(node => node.props.accessibilityLabel?.startsWith('تعديل بيانات CONTACT')).length, 1);
  await act(async () => { buttons().find(node => String(node.props.onPress).includes('generateContactStatementCsv')).props.onPress(); });
  assert.equal(globalThis.maliPaginationExport[1], generateContactStatementCsv(state, state.contacts[9999]));
  await unmount();
  await mount(UsdDealsScreen, state);
  assert.ok(hosts() < 2000); assert.ok(allText().includes(formatMoney(5000, 'USD')));
  assert.ok(allText().includes(formatMoney(5000, 'LYD')), 'profit includes every off-page sale');
  await pressPage('صفقات الدولار', 'الأخيرة'); assert.ok(allText().includes('DEAL-09999'));
  await act(async () => { buttons().find(node => String(node.props.onPress).includes('generateDealsCsv')).props.onPress(); });
  assert.equal(globalThis.maliPaginationExport[1], generateDealsCsv(state));
  await act(async () => { field('البحث عن صفقة برقمها أو المتعامل').props.onChangeText('DEAL-09999'); });
  assert.deepEqual(exactText(/^DEAL-\d+$/), ['DEAL-09999']);
  await unmount();
});

test('ten thousand accounts render one page in Accounts and Dashboard while retaining global balances', async () => {
  const state = stateWith({ accounts: array(10000, account) });
  for (const [Screen, label] of [[AccountsScreen, 'الحسابات'], [DashboardScreen, 'حساباتي وخزائني']]) {
    await mount(Screen, state);
    assert.ok(hosts() < 1300); assert.ok(allText().includes(formatMoney(10000, 'LYD')));
    await pressPage(label, 'الأخيرة'); assert.ok(allText().includes('ACCOUNT-09999'));
    assert.ok(hosts() < 1300); await unmount();
  }
});

test('ten thousand debts and procedures remain fully reachable and procedure totals use all stages', async () => {
  const state = stateWith({ debts: array(10000, debt), procedures: array(10000, procedure) });
  await mount(ProceduresDebtsScreen, state);
  assert.ok(hosts() < 1800); assert.ok(allText().includes(formatMoney(20000, 'LYD')));
  await pressPage('الديون', 'الأخيرة'); assert.ok(allText().includes('DEBT-09999'));
  await act(async () => { buttons().find(node => String(node.props.onPress).includes("setActiveTab('procedures')")).props.onPress(); });
  assert.ok(hosts() < 1800); await pressPage('الإجراءات', 'الأخيرة');
  assert.ok(allText().includes('PROCEDURE-09999')); await unmount();
});

test('one record with ten thousand nested sales, installments or stages also has bounded reachable history', async () => {
  const onlyDeal = { ...deal(0), totalUsdBought: 10001, grossLydCost: 50005, totalLydCost: 50005,
    soldUsd: 5000, remainingUsd: 5001, totalLydReceived: 30000, realizedProfitLyd: 5000,
    sales: array(10000, i => ({ ...sale(i), dealId: 'deal-0' })) };
  await mount(UsdDealsScreen, stateWith({ deals: [onlyDeal] }));
  assert.ok(hosts() < 1000); await pressPage('مبيعات الصفقة', 'الأخيرة'); assert.ok(allText().includes('BUYER-09999'));
  await unmount();
  const onlyDebt = { ...debt(0), totalAmount: 10002, paidAmount: 10000,
    installments: array(10000, i => ({ id: `installment-${i}`, amount: 1, date, paymentMethod: 'cash', notes: `INSTALLMENT-${suffix(i)}` })) };
  const onlyProcedure = { ...procedure(0), status: 'in_progress', stages: array(10000, i => ({ id: `stage-${i}`, title: `STAGE-${suffix(i)}`,
    completed: i % 2 === 0, ...(i % 2 === 0 ? { completedAt: date } : {}) })) };
  await mount(ProceduresDebtsScreen, stateWith({ debts: [onlyDebt], procedures: [onlyProcedure] }));
  assert.ok(hosts() < 900); await pressPage('دفعات الدين', 'الأخيرة'); assert.ok(allText().includes('INSTALLMENT-09999'));
  await act(async () => { buttons().find(node => String(node.props.onPress).includes("setActiveTab('procedures')")).props.onPress(); });
  assert.ok(hosts() < 900); await pressPage('مراحل الإجراء', 'الأخيرة'); assert.ok(allText().includes('STAGE-09999'));
  const stage = buttons().find(node => node.props.accessibilityLabel === 'PROCEDURE-00000: STAGE-09999');
  let target; globalThis.maliPaginationContext.toggleProcedureStage = async (...args) => { target = args; return true; };
  await act(async () => { tree.update(React.createElement(ProceduresDebtsScreen)); });
  await act(async () => { await stage.props.onPress(); });
  assert.deepEqual(target, ['procedure-0', 'stage-9999']); await unmount();
});

test('a contact with ten thousand rows per history section can reach all three last pages', async () => {
  const state = stateWith({ contacts: [contact(0)], deals: array(10000, i => ({ ...deal(i), contactId: 'contact-0', sales: [{ ...sale(i), contactId: 'contact-0' }] })),
    debts: array(10000, i => ({ ...debt(i), contactId: 'contact-0' })) });
  await mount(ContactsScreen, state);
  await act(async () => { buttons().find(node => String(node.props.onPress).includes('setSelectedPerson(person)')).props.onPress(); });
  assert.ok(hosts() < 1300);
  for (const label of ['مشتريات المتعامل', 'مبيعات المتعامل', 'ديون المتعامل']) await pressPage(label, 'الأخيرة');
  assert.ok(allText().includes('DEAL-09999')); assert.ok(allText().includes('DEBT-NOTE-09999')); assert.ok(hosts() < 1300);
  await unmount();
});

test('a ten-thousand-option selector mounts only when open, searches every option and preserves selected identity', async () => {
  const options = array(10000, i => ({ value: `option-${i}`, label: `OPTION-${suffix(i)}` })); let selected;
  await mount(CalmDropdown, stateWith({}), { label: 'Large selector', value: 'option-9999', options, onSelect: value => { selected = value; } });
  assert.ok(hosts() < 20); assert.ok(allText().includes('OPTION-09999'));
  await act(async () => { buttons().find(node => node.props.accessibilityLabel === 'Large selector: OPTION-09999').props.onPress(); });
  assert.equal(buttons().filter(node => node.props.accessibilityRole === 'radio').length, 20); assert.ok(hosts() < 200);
  await pressPage('Large selector', 'الأخيرة');
  assert.equal(buttons().find(node => node.props.accessibilityLabel === 'OPTION-09999').props.accessibilityState.checked, true);
  await act(async () => { field('البحث في Large selector').props.onChangeText('OPTION-09876'); });
  assert.equal(buttons().filter(node => node.props.accessibilityRole === 'radio').length, 1);
  await act(async () => { buttons().find(node => node.props.accessibilityLabel === 'OPTION-09876').props.onPress(); });
  assert.equal(selected, 'option-9876'); assert.ok(hosts() < 20); await unmount();
});

test('paging controls retain the displayed records while a durable save is pending', async () => {
  await mount(ExpensesScreen, stateWith({ transactions: array(10000, transaction) }));
  await pressPage('سجل الحركات', 'التالية');
  assert.equal(exactText(/^TX-\d+$/)[0], 'TX-00020');
  globalThis.maliPaginationContext.mutationStatus = { phase: 'saving' };
  await act(async () => { tree.update(React.createElement(ExpensesScreen)); });
  assert.equal(pageButton('سجل الحركات', 'الأخيرة').props.accessibilityState.disabled, true);
  await pressPage('سجل الحركات', 'الأخيرة');
  assert.equal(exactText(/^TX-\d+$/)[0], 'TX-00020');
  globalThis.maliPaginationContext.mutationStatus = { phase: 'idle' };
  await act(async () => { tree.update(React.createElement(ExpensesScreen)); });
  await pressPage('سجل الحركات', 'السابقة'); assert.equal(exactText(/^TX-\d+$/)[0], 'TX-00000');
  await unmount();
});
