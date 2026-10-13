import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { installNativeTestLoader } from './nativeModuleTestLoader.mjs';

const require = createRequire(import.meta.url);
installNativeTestLoader();
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react-native') return { url: pathToFileURL(require.resolve('react-native-web')).href, shortCircuit: true };
  if (specifier === '@expo/vector-icons') return { url: 'data:text/javascript,export const Ionicons=()=>null;', shortCircuit: true };
  if (specifier.endsWith('/context/MaliContext')) return { url: 'data:text/javascript,export const useMali=()=>globalThis.maliAccessibilityContext;', shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { INITIAL_MALI_STATE } = await import('../src/data/initialData.ts');
const { ExpensesScreen } = await import('../src/screens/ExpensesScreen.tsx');
const { ContactsScreen } = await import('../src/screens/ContactsScreen.tsx');
const { DashboardScreen } = await import('../src/screens/DashboardScreen.tsx');
const { CalmDropdown } = await import('../src/components/CalmDropdown.tsx');
const { FinancialSaveNotice } = await import('../src/hooks/useFinancialSubmission.tsx');
globalThis.maliAccessibilityContext = { state: INITIAL_MALI_STATE, theme: new Proxy({}, { get: () => '#333333' }), mutationStatus: { phase: 'idle' }, mutationSessionGeneration: 1 };

test('actual React Native Web output exposes named expense textbox, actionable button, and selected financial tab', () => {
  const html = renderToStaticMarkup(React.createElement(ExpensesScreen));
  const amount = html.match(/<input[^>]*aria-label="قيمة المصروف السريع"[^>]*>/)?.[0];
  assert.ok(amount, 'screen-reader users must be able to identify the amount field');
  assert.ok(/<button[^>]*role="button"[^>]*>.*?سحب وحفظ المصروف الآن/s.test(html), 'the financial save action must render as a real web button');
  const tabs = [...html.matchAll(/<(?:button|div)[^>]*role="tab"[^>]*>/g)].map(match => match[0]);
  assert.equal(tabs.length, 2); assert.ok(tabs.some(tag => tag.includes('aria-selected="true"'))); assert.ok(tabs.some(tag => tag.includes('aria-selected="false"')));
  assert.match(html, /role="tablist"/);
});

test('actual web search inputs retain searchbox semantics and currency selection exposes a radio group', () => {
  for (const Screen of [ExpensesScreen, ContactsScreen]) {
    const html = renderToStaticMarkup(React.createElement(Screen));
    assert.match(html, /<input[^>]*role="searchbox"[^>]*>/);
    assert.doesNotMatch(html, /<input[^>]*role="search"[^>]*>/);
  }
  const html = renderToStaticMarkup(React.createElement(DashboardScreen, { onNavigate: () => {} }));
  assert.match(html, /aria-label="عملة عرض صافي الرصيد"[^>]*role="radiogroup"/);
  const choices = [...html.matchAll(/<(?:button|div)[^>]*role="radio"[^>]*>/g)].map(match => match[0]);
  assert.equal(choices.length, 2);
  assert.equal(choices.filter(tag => tag.includes('aria-checked="true"')).length, 1);
  assert.equal(choices.filter(tag => tag.includes('aria-checked="false"')).length, 1);
});

test('actual web selector exposes purpose, chosen value, expansion and disabled state instead of an unnamed container', () => {
  const html = renderToStaticMarkup(React.createElement(CalmDropdown, { label: 'الحساب المصدر', value: 'cash', disabled: true,
    options: [{ value: 'cash', label: 'خزينة الدينار' }], onSelect: () => { throw new Error('Selection forbidden'); } }));
  assert.match(html, /aria-label="الحساب المصدر: خزينة الدينار"/); assert.match(html, /role="button"/);
  assert.match(html, /aria-expanded="false"/); assert.match(html, /aria-disabled="true"/);
});

test('idle validation rejection and failed storage remain actual web live alerts while saving is polite', () => {
  let html = renderToStaticMarkup(React.createElement(FinancialSaveNotice, { error: 'أدخل مبلغاً صحيحاً.' }));
  assert.match(html, /role="alert"/); assert.match(html, /aria-live="assertive"/); assert.match(html, /أدخل مبلغاً صحيحاً/);
  globalThis.maliAccessibilityContext.mutationStatus = { phase: 'saving' };
  html = renderToStaticMarkup(React.createElement(FinancialSaveNotice)); assert.match(html, /aria-live="polite"/); assert.doesNotMatch(html, /role="alert"/);
  globalThis.maliAccessibilityContext.mutationStatus = { phase: 'storage-error' };
  globalThis.maliAccessibilityContext.lastSyncMessage = 'تعذر تأكيد الحفظ.';
  html = renderToStaticMarkup(React.createElement(FinancialSaveNotice)); assert.match(html, /role="alert"/); assert.match(html, /تعذر تأكيد الحفظ/);
  globalThis.maliAccessibilityContext.mutationStatus = { phase: 'idle' };
});
