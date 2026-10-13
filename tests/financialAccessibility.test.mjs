import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { registerHooks } from 'node:module';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.maliTestPlatform = { OS: 'web' };
const memory = new Map();
globalThis.maliTestStorage = { getItem: async key => memory.get(key) ?? null, setItem: async (key, value) => memory.set(key, value) };
globalThis.maliProviderAuth = { clearAuthSession: async () => {}, consumeOAuthRedirectIfPresent: async () => null,
  getPersistedSessionUser: async () => null, savePersistedSessionUser: async () => {}, subscribeToAuthIdentity: () => () => {} };
globalThis.maliProviderSync = { pull: async () => ({ isEmpty: true }), push: async () => ({ ok: false }) };
installNativeTestLoader({ provider: true, ui: true });
// Receipt picking/export I/O has its own native integration suite; it is not exercised here.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/components/ReceiptImageAttachment')) return { url: 'data:text/javascript,export const ReceiptAttachmentField=()=>null,ReceiptInlineStrip=()=>null;', shortCircuit: true };
  const resolved = nextResolve(specifier, context);
  if (specifier === 'react-native') return { ...resolved, url: resolved.url + encodeURIComponent('\nexport const Linking={openURL:async()=>{throw new Error("External navigation forbidden in this suite");}};') };
  return resolved;
} });
const { MaliProvider, useMali } = await import('../src/context/MaliContext.tsx');
const { AccountsScreen } = await import('../src/screens/AccountsScreen.tsx');
const { ContactsScreen } = await import('../src/screens/ContactsScreen.tsx');
const { DashboardScreen } = await import('../src/screens/DashboardScreen.tsx');
const { ExpensesScreen } = await import('../src/screens/ExpensesScreen.tsx');
const { ProceduresDebtsScreen } = await import('../src/screens/ProceduresDebtsScreen.tsx');
const { UsdDealsScreen } = await import('../src/screens/UsdDealsScreen.tsx');
let api;
async function mount(Screen) {
  memory.clear(); const focused = []; let tree;
  function Probe() { api = useMali(); return React.createElement(Screen, { onNavigate: () => {} }); }
  await act(async () => { tree = renderer.create(React.createElement(MaliProvider, null, React.createElement(Probe)), {
    createNodeMock: node => node.type === 'TextInput' ? { focus: () => focused.push(node.props.accessibilityLabel) } : null,
  }); });
  await act(async () => { api.loginUser({ id: 'a11y-guest', isLocalOnly: true, name: 'Test', email: 'test@local.invalid', provider: 'email', createdAt: '2026-10-13' }); });
  return { tree, focused };
}
const buttons = tree => tree.root.findAllByType('TouchableOpacity');
const handler = (tree, name) => buttons(tree).find(node => node.props.onPress?.name === name);
const input = (tree, label) => tree.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel?.startsWith(label));
const alerts = tree => tree.root.findAllByType('Text').filter(node => node.props.accessibilityRole === 'alert').map(node => node.children.join('')).join(' ');
const flattenStyle = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

test('all six actual financial screens expose named editable fields and named actions with 48dp touch bounds', async () => {
  for (const Screen of [AccountsScreen, ContactsScreen, DashboardScreen, ExpensesScreen, ProceduresDebtsScreen, UsdDealsScreen]) {
    const { tree } = await mount(Screen);
    for (const node of tree.root.findAllByType('TextInput')) {
      assert.ok(node.props.accessibilityLabel?.trim(), `${Screen.name}: unnamed field`);
      const style = flattenStyle(node.props.style);
      assert.ok(style.minHeight >= 48 && style.minWidth >= 48, `${Screen.name}: small field ${node.props.accessibilityLabel}`);
    }
    for (const node of buttons(tree).filter(node => node.props.accessible !== false)) {
      assert.ok(['button', 'tab', 'checkbox', 'radio'].includes(node.props.accessibilityRole), `${Screen.name}: unclassified action`);
      const label = node.props.accessibilityLabel || node.findAllByType('Text').flatMap(text => text.children).filter(text => typeof text === 'string').join(' ');
      assert.ok(label.trim(), `${Screen.name}: unnamed action`);
      const style = flattenStyle(node.props.style);
      assert.ok((style.minHeight || style.height) >= 48 && (style.minWidth || style.width) >= 48, `${Screen.name}: small action ${label}`);
    }
    await act(async () => { tree.unmount(); });
  }
});

test('actual quick-expense form announces malformed and rejected amounts, focuses the invalid field, and keeps its value', async () => {
  const { tree, focused } = await mount(ExpensesScreen);
  await act(async () => { await api.addAccount({ name: 'Cash', bankName: 'Cash', category: 'cash_lyd', currency: 'LYD', balance: 100, isCash: true, color: '#fff' }); });
  const amount = () => tree.root.findAllByType('TextInput').find(node => node.props.placeholder?.startsWith('أدخل المبلغ المسحوب'));
  await act(async () => { amount().props.onChangeText('5junk'); });
  await act(async () => { await handler(tree, 'handleQuickExpenseSubmit').props.onPress(); });
  assert.match(alerts(tree), /مبلغ/); assert.match(focused.at(-1), /المصروف/); assert.equal(amount().props.value, '5junk');
  assert.equal(api.state.transactions.length, 0);
  await act(async () => { amount().props.onChangeText('200'); });
  await act(async () => { await handler(tree, 'handleQuickExpenseSubmit').props.onPress(); });
  assert.match(alerts(tree), /تعذر|راجع/); assert.equal(amount().props.value, '200'); assert.equal(api.state.accounts[0].balance, 100);
  await act(async () => { amount().props.onChangeText('٥'); });
  await act(async () => { await handler(tree, 'handleQuickExpenseSubmit').props.onPress(); });
  assert.equal(api.state.transactions.length, 1); assert.equal(amount().props.value, '');
  await act(async () => { tree.unmount(); });
});

test('accessible account form preserves supported negative bank balances', async () => {
  const { tree } = await mount(AccountsScreen);
  await act(async () => { buttons(tree).find(node => String(node.props.onPress).includes('setAddModalVisible(true)')).props.onPress(); });
  await act(async () => { input(tree, 'اسم الحساب').props.onChangeText('Overdraft bank'); input(tree, 'الرصيد الافتتاحي').props.onChangeText('-12.5'); });
  await act(async () => { await handler(tree, 'handleCreateAccount').props.onPress(); });
  assert.equal(api.state.accounts[0].balance, -12.5); assert.equal(api.state.accounts[0].isCash, false);
  assert.equal(input(tree, 'اسم الحساب').props.value, ''); assert.equal(alerts(tree), '');
  await act(async () => { tree.unmount(); });
});

test('account and contact required-name failures keep their modals open and focus a named editable field', async () => {
  for (const [Screen, openName, saveName, label] of [[AccountsScreen, null, 'handleCreateAccount', 'اسم الحساب'], [ContactsScreen, 'handleOpenAddModal', 'handleSaveContact', 'اسم المتعامل']]) {
    const { tree, focused } = await mount(Screen);
    const open = openName ? handler(tree, openName) : buttons(tree).find(node => String(node.props.onPress).includes('setAddModalVisible(true)'));
    await act(async () => { open.props.onPress(); });
    await act(async () => { await handler(tree, saveName).props.onPress(); });
    assert.match(alerts(tree), /اسم/); assert.equal(focused.at(-1), label); assert.equal(input(tree, label).props.value, '');
    assert.ok(tree.root.findAllByType('Modal').some(node => node.props.visible));
    await act(async () => { tree.unmount(); });
  }
});

test('dashboard rejects malformed market rates with focus and preserves the prior rates', async () => {
  const { tree, focused } = await mount(DashboardScreen); const before = api.state.marketRates;
  const open = buttons(tree).find(node => String(node.props.onPress).includes('setRateModalOpen(true)'));
  await act(async () => { open.props.onPress(); });
  await act(async () => { input(tree, 'سعر الدولار النقدي').props.onChangeText('5junk'); });
  await act(async () => { await handler(tree, 'handleSaveRates').props.onPress(); });
  assert.match(alerts(tree), /سعر/); assert.match(focused.at(-1), /النقدي/); assert.deepEqual(api.state.marketRates, before);
  assert.equal(input(tree, 'سعر الدولار النقدي').props.value, '5junk');
  await act(async () => { tree.unmount(); });
});

test('changing displayed currency updates mutually exclusive checked states without creating a financial record', async () => {
  const { tree } = await mount(DashboardScreen);
  const group = () => tree.root.findAllByType('View').find(node => node.props.accessibilityRole === 'radiogroup' && node.props.accessibilityLabel === 'عملة عرض صافي الرصيد');
  const choices = () => group().findAllByType('TouchableOpacity');
  const before = api.state;
  assert.deepEqual(choices().map(node => node.props.accessibilityState.checked), [true, false]);
  await act(async () => { choices()[1].props.onPress(); });
  assert.deepEqual(choices().map(node => node.props.accessibilityState.checked), [false, true]);
  assert.equal(api.state, before);
  await act(async () => { tree.unmount(); });
});

test('debt and installment errors focus the named amount field and preserve the unpaid balance', async () => {
  const { tree, focused } = await mount(ProceduresDebtsScreen);
  await act(async () => { buttons(tree).find(node => String(node.props.onPress).includes('setNewDebtModal(true)')).props.onPress(); });
  await act(async () => { input(tree, 'اسم صاحب الدين').props.onChangeText('Synthetic customer'); input(tree, 'قيمة الدين').props.onChangeText('5junk'); });
  await act(async () => { await handler(tree, 'handleSaveDebt').props.onPress(); });
  assert.match(alerts(tree), /مبلغ دين/); assert.equal(focused.at(-1), 'قيمة الدين'); assert.equal(api.state.debts.length, 0);
  await act(async () => { input(tree, 'قيمة الدين').props.onChangeText('10'); });
  const wallet = () => buttons(tree).find(node => node.props.accessibilityRole === 'checkbox' && node.props.accessibilityLabel === 'تحديث رصيد الحساب عند تسجيل الدين');
  if (wallet().props.accessibilityState.checked) await act(async () => { wallet().props.onPress(); });
  await act(async () => { await handler(tree, 'handleSaveDebt').props.onPress(); });
  assert.equal(api.state.debts[0].remainingAmount, 10);
  await act(async () => { buttons(tree).find(node => String(node.props.onPress).includes('setActiveDebtForPay(debt)')).props.onPress(); });
  await act(async () => { input(tree, 'قيمة الدفعة').props.onChangeText('-1'); });
  await act(async () => { await handler(tree, 'handleSaveInstallment').props.onPress(); });
  assert.match(alerts(tree), /دفعة/); assert.equal(focused.at(-1), 'قيمة الدفعة');
  assert.equal(input(tree, 'قيمة الدفعة').props.value, '-1'); assert.equal(api.state.debts[0].remainingAmount, 10);
  await act(async () => { tree.unmount(); });
});

test('USD purchase and immediate-sale checkbox are named and invalid quantity stays available for correction', async () => {
  const { tree, focused } = await mount(UsdDealsScreen);
  await act(async () => { handler(tree, 'handleOpenNewDealModal').props.onPress(); });
  const toggle = () => buttons(tree).find(node => node.props.accessibilityRole === 'checkbox' && node.props.accessibilityLabel?.includes('البيع الفوري'));
  assert.equal(toggle().props.accessibilityState.checked, false);
  await act(async () => { toggle().props.onPress(); }); assert.equal(toggle().props.accessibilityState.checked, true);
  await act(async () => { input(tree, 'كمية الدولار المشتراة').props.onChangeText('0'); });
  await act(async () => { await handler(tree, 'handleCreateDeal').props.onPress(); });
  assert.match(alerts(tree), /كمية/); assert.match(focused.at(-1), /المشتراة/); assert.equal(input(tree, 'كمية الدولار المشتراة').props.value, '0');
  assert.equal(api.state.deals.length, 0); await act(async () => { tree.unmount(); });
});

test('the actual account menu announces expansion and selection, changes the form account, and disables selection during a held save', async () => {
  const { tree } = await mount(ExpensesScreen);
  for (const name of ['Cash One', 'Cash Two']) await act(async () => { await api.addAccount({ name, bankName: 'Cash', category: 'cash_lyd', currency: 'LYD', balance: 100, isCash: true, color: '#fff' }); });
  const trigger = () => buttons(tree).find(node => node.props.accessibilityLabel?.startsWith('3. سُحبت من أي حساب؟'));
  assert.equal(trigger().props.accessibilityRole, 'button'); assert.equal(trigger().props.accessibilityState.expanded, false);
  await act(async () => { trigger().props.onPress(); }); assert.equal(trigger().props.accessibilityState.expanded, true);
  const option = buttons(tree).find(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel?.startsWith('Cash Two'));
  await act(async () => { option.props.onPress(); }); assert.match(trigger().props.accessibilityLabel, /Cash Two/);
  await act(async () => { trigger().props.onPress(); });
  assert.equal(buttons(tree).find(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel?.startsWith('Cash Two')).props.accessibilityState.checked, true);
  const close = buttons(tree).find(node => node.props.accessibilityLabel === 'إغلاق قائمة 3. سُحبت من أي حساب؟');
  await act(async () => { close.props.onPress(); input(tree, 'قيمة المصروف السريع').props.onChangeText('5'); });
  const original = globalThis.maliTestStorage.setItem; let release, entered; const started = new Promise(resolve => { entered = resolve; }); const held = new Promise(resolve => { release = resolve; }); let once = true;
  globalThis.maliTestStorage.setItem = async (key, value) => { if (once) { once = false; entered(); await held; } return original(key, value); };
  let save; await act(async () => { save = handler(tree, 'handleQuickExpenseSubmit').props.onPress(); await started; });
  assert.equal(trigger().props.disabled, true); assert.equal(trigger().props.accessibilityState.disabled, true);
  await act(async () => { release(); await save; }); globalThis.maliTestStorage.setItem = original;
  assert.equal(api.state.transactions[0].accountId, api.state.accounts.find(row => row.name === 'Cash Two').id);
  await act(async () => { tree.unmount(); });
});

test('procedure stage exposes checked state only after durable acknowledgement and retains it on storage failure', async () => {
  const { tree } = await mount(ProceduresDebtsScreen);
  await act(async () => { assert.equal(await api.addProcedure({ title: 'Bank transfer', procedureType: 'إجراء مصرفي عام', stages: ['Review documents'] }), true); });
  const tab = buttons(tree).find(node => String(node.props.onPress).includes("setActiveTab('procedures')"));
  await act(async () => { tab.props.onPress(); });
  const stage = () => buttons(tree).find(node => node.props.accessibilityRole === 'checkbox' && node.props.accessibilityLabel?.includes('Review documents'));
  assert.equal(stage().props.accessibilityState.checked, false);
  const original = globalThis.maliTestStorage.setItem; globalThis.maliTestStorage.setItem = async () => { throw new Error('offline storage failure'); };
  await act(async () => { await stage().props.onPress(); }); assert.equal(stage().props.accessibilityState.checked, false); assert.match(alerts(tree), /تعذر/);
  globalThis.maliTestStorage.setItem = original; await act(async () => { await stage().props.onPress(); });
  assert.equal(stage().props.accessibilityState.checked, true); assert.equal(api.state.procedures[0].stages[0].completed, true);
  assert.equal(buttons(tree).find(node => String(node.props.onPress).includes("setActiveTab('procedures')")).props.accessibilityState.selected, true);
  await act(async () => { tree.unmount(); });
});
