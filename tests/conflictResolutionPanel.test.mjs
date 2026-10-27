import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.maliTestPlatform = { OS: 'android' };
installNativeTestLoader({ ui: true });
registerHooks({ resolve(specifier, context, next) {
  let source;
  if (specifier.endsWith('/context/MaliContext')) source = 'export const useMali=()=>globalThis.conflictPanelApi;';
  if (specifier.endsWith('/utils/exportHelper')) source = 'export const exportFileOrShare=(...a)=>globalThis.conflictPanelExport(...a);';
  return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : next(specifier, context);
} });
const { ConflictResolutionPanel } = await import('../src/components/ConflictResolutionPanel.tsx');
const snapshot = balance => ({ accounts: [{ currency: 'LYD', balance }], contacts: [], transactions: [], deals: [], debts: [], procedures: [], budgets: [], marketRates: {}, financialAudit: [] });
const review = { token: { configId: 'DO-NOT-EXPORT', cloudTimestamp: '2026-10-13T00:00:00.123456Z' }, local: snapshot(85), attempted: snapshot(90), cloud: snapshot(80), originalCloud: snapshot(80) };
const button = (tree, label) => tree.root.findAllByType('TouchableOpacity').find(row => row.findAllByType('Text').some(text => text.children.join('').includes(label)));
const text = tree => tree.root.findAllByType('Text').map(row => row.children.join('')).join('\n');
async function mount(resolve = async () => ({ ok: true, success: true, message: 'saved' })) {
  globalThis.conflictPanelApi = { theme: {}, inspectCloudConflict: () => review, resolveCloudConflict: resolve };
  let tree; await act(async () => { tree = renderer.create(React.createElement(ConflictResolutionPanel)); });
  await act(async () => { button(tree, 'عرض النسخة').props.onPress(); }); return tree;
}
test('actual conflict UI requires a reason, prevents double choice, then requires a new decision on changed cloud', async () => {
  let release, calls = []; const tree = await mount((...args) => { calls.push(args); return new Promise(resolve => { release = resolve; }); });
  assert.equal(button(tree, 'اعتماد النسخة المحلية').props.disabled, true);
  await act(async () => { tree.root.findByType('TextInput').props.onChangeText('Reviewed local'); });
  let first; await act(async () => { const handler = button(tree, 'اعتماد النسخة المحلية').props.onPress; first = handler(); handler(); });
  assert.equal(calls.length, 1); assert.equal(button(tree, 'اعتماد النسخة السحابية').props.disabled, true);
  await act(async () => { release({ ok: false, message: 'changed cloud', review: { ...review, token: { ...review.token, cloudTimestamp: '2026-10-13T00:01:00.654321Z' }, cloud: snapshot(75) } }); await first; });
  assert.ok(text(tree).includes('75.00')); assert.ok(text(tree).includes('654321Z'));
  assert.equal(tree.root.findByType('TextInput').props.value, ''); assert.equal(button(tree, 'اعتماد النسخة السحابية').props.disabled, true);
  await act(async () => tree.unmount());
});
test('version export contains every full financial snapshot and excludes the connection token', async () => {
  let exported; globalThis.conflictPanelExport = async (...args) => { exported = args; return true; };
  const tree = await mount(); await act(async () => { await button(tree, 'تنزيل جميع النسخ').props.onPress(); });
  const data = JSON.parse(exported[1]); assert.deepEqual(data.local, review.local); assert.deepEqual(data.attempted, review.attempted); assert.deepEqual(data.originalCloud, review.originalCloud);
  assert.ok(!exported[1].includes('DO-NOT-EXPORT')); assert.equal(exported[2], 'application/json');
  assert.ok(text(tree).includes('احفظها')); await act(async () => tree.unmount());
});
test('late conflict decision does not update an unmounted review', async () => {
  let release; const tree = await mount(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { tree.root.findByType('TextInput').props.onChangeText('Choose cloud'); });
  let result; await act(async () => { result = button(tree, 'اعتماد النسخة السحابية').props.onPress(); });
  await act(async () => tree.unmount()); await act(async () => { release({ ok: true, message: 'saved' }); await result; });
  assert.equal(tree.toJSON(), null);
});
