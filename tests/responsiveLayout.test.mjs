import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Responsive System — Design Tokens & Helper exports', async () => {
  const content = await readFile(path.resolve(root, 'src/theme/responsive.ts'), 'utf8');
  assert.ok(content.includes('MIN_TOUCH_TARGET = 48'), 'MIN_TOUCH_TARGET must be 48dp');
  assert.ok(content.includes('BREAKPOINTS'), 'BREAKPOINTS definition exists');
  assert.ok(content.includes('SPACING'), 'SPACING tokens exist');
  assert.ok(content.includes('RADIUS'), 'RADIUS tokens exist');
  assert.ok(content.includes('TYPOGRAPHY'), 'TYPOGRAPHY tokens exist');
  assert.ok(content.includes('useResponsiveLayout'), 'useResponsiveLayout hook exported');
});

test('Navigation Shell — Safe Insets & Responsive Header', async () => {
  const content = await readFile(path.resolve(root, 'src/navigation/MaliVaultShell.tsx'), 'utf8');
  assert.ok(content.includes('useSafeAreaInsets'), 'MaliVaultShell must use safe area insets');
  assert.ok(content.includes('useResponsiveLayout'), 'MaliVaultShell must use responsive layout');
  assert.ok(content.includes('navItem: {'), 'Bottom navigation items must define navItem');
  assert.ok(content.includes('MIN_TOUCH_TARGET'), 'Bottom navigation items must enforce MIN_TOUCH_TARGET');
});

test('Unified Contact Profile Modal — RTL Alignment & Touch Targets', async () => {
  const content = await readFile(path.resolve(root, 'src/components/UnifiedContactProfileModal.tsx'), 'utf8');
  assert.ok(content.includes('useResponsiveLayout'), 'Profile modal uses responsive layout');
  assert.ok(content.includes('MIN_TOUCH_TARGET'), 'Profile modal enforces MIN_TOUCH_TARGET');
  assert.ok(content.includes('KeyboardAvoidingView'), 'Profile modal wraps inputs with KeyboardAvoidingView');
  
  // RTL checks: must use row-reverse for Arabic rows
  assert.ok(content.includes("header: {\n    flexDirection: 'row-reverse'"), 'header must be row-reverse');
  assert.ok(content.includes("headerTitleRow: {\n    flexDirection: 'row-reverse'"), 'headerTitleRow must be row-reverse');
  assert.ok(content.includes("timelineTopRow: {\n    flexDirection: 'row-reverse'"), 'timelineTopRow must be row-reverse');
});

test('Dashboard Screen — Responsive Quick Actions & Keyboard Avoiding Modals', async () => {
  const content = await readFile(path.resolve(root, 'src/screens/DashboardScreen.tsx'), 'utf8');
  assert.ok(content.includes('useResponsiveLayout'), 'DashboardScreen uses responsive layout');
  assert.ok(content.includes('isSmallPhone'), 'DashboardScreen checks small phone breakpoint');
  assert.ok(content.includes("isSmallPhone && { flexWrap: 'wrap' }"), 'Quick actions wrap on small phones');
  assert.ok(content.includes('KeyboardAvoidingView'), 'Dashboard modals wrap with KeyboardAvoidingView');
  assert.ok(content.includes('minHeight: 48'), 'Dashboard buttons have 48dp minHeight');
});

test('Accounts Screen — Responsive Wrap & Keyboard Avoidance', async () => {
  const content = await readFile(path.resolve(root, 'src/screens/AccountsScreen.tsx'), 'utf8');
  assert.ok(content.includes('useResponsiveLayout'), 'AccountsScreen uses responsive layout');
  assert.ok(content.includes('KeyboardAvoidingView'), 'AccountsScreen modals wrap with KeyboardAvoidingView');
  assert.ok(content.includes("maxHeight: '90%'"), 'AccountsScreen modalCard has maxHeight 90%');
  assert.ok(content.includes('minHeight: 48'), 'AccountsScreen buttons have 48dp minHeight');
});

test('Expenses Screen — Touch Targets & Keyboard Avoidance', async () => {
  const content = await readFile(path.resolve(root, 'src/screens/ExpensesScreen.tsx'), 'utf8');
  assert.ok(content.includes('useResponsiveLayout'), 'ExpensesScreen uses responsive layout');
  assert.ok(content.includes('KeyboardAvoidingView'), 'ExpensesScreen modals wrap with KeyboardAvoidingView');
  assert.ok(content.includes("maxHeight: '90%'"), 'ExpensesScreen modalCard has maxHeight 90%');
  assert.ok(content.includes('minHeight: 48'), 'ExpensesScreen buttons have 48dp minHeight');
});

test('USD Deals Screen — Touch Targets & Keyboard Avoidance', async () => {
  const content = await readFile(path.resolve(root, 'src/screens/UsdDealsScreen.tsx'), 'utf8');
  assert.ok(content.includes('useResponsiveLayout'), 'UsdDealsScreen uses responsive layout');
  assert.ok(content.includes('KeyboardAvoidingView'), 'UsdDealsScreen modals wrap with KeyboardAvoidingView');
  assert.ok(content.includes("maxHeight: '90%'"), 'UsdDealsScreen modalCard has maxHeight 90%');
  assert.ok(content.includes('minHeight: 48'), 'UsdDealsScreen buttons have 48dp minHeight');
});

test('Procedures & Debts Screen — RTL Rows & Touch Targets', async () => {
  const content = await readFile(path.resolve(root, 'src/screens/ProceduresDebtsScreen.tsx'), 'utf8');
  assert.ok(content.includes('useResponsiveLayout'), 'ProceduresDebtsScreen uses responsive layout');
  assert.ok(content.includes('KeyboardAvoidingView'), 'ProceduresDebtsScreen modals wrap with KeyboardAvoidingView');
  assert.ok(content.includes("maxHeight: '90%'"), 'ProceduresDebtsScreen modalCard has maxHeight 90%');
  assert.ok(content.includes('minHeight: 48'), 'ProceduresDebtsScreen buttons have 48dp minHeight');
  assert.ok(content.includes("contactModeSelector: {\n    flexDirection: 'row-reverse'"), 'contactModeSelector is RTL');
});

test('Contacts Screen — Responsive Wrap, Touch Targets & Avoidance', async () => {
  const content = await readFile(path.resolve(root, 'src/screens/ContactsScreen.tsx'), 'utf8');
  assert.ok(content.includes('useResponsiveLayout'), 'ContactsScreen uses responsive layout');
  assert.ok(content.includes('KeyboardAvoidingView'), 'ContactsScreen modal wraps with KeyboardAvoidingView');
  assert.ok(content.includes("maxHeight: '90%'"), 'ContactsScreen modalCard has maxHeight 90%');
  assert.ok(content.includes('minHeight: MIN_TOUCH_TARGET') || content.includes('minHeight: 48'), 'ContactsScreen buttons have 48dp minHeight');
});

test('Auth Screen — Keyboard Avoiding & Touch Targets', async () => {
  const content = await readFile(path.resolve(root, 'src/screens/AuthScreen.tsx'), 'utf8');
  assert.ok(content.includes('KeyboardAvoidingView'), 'AuthScreen wraps with KeyboardAvoidingView');
  assert.ok(content.includes('MIN_TOUCH_TARGET'), 'AuthScreen uses MIN_TOUCH_TARGET');
  assert.ok(content.includes("maxHeight: '90%'"), 'AuthScreen modalCard has maxHeight 90%');
});

test('Calm Dropdown — Touch Targets & RTL Layout', async () => {
  const content = await readFile(path.resolve(root, 'src/components/CalmDropdown.tsx'), 'utf8');
  assert.ok(content.includes('minHeight: 48'), 'CalmDropdown trigger has minHeight 48');
  assert.ok(content.includes('minWidth: 48'), 'CalmDropdown trigger has minWidth 48');
  assert.ok(content.includes("flexDirection: 'row-reverse'"), 'CalmDropdown uses RTL row-reverse');
});

test('Visual Audit Artifacts — All 40 Screenshots Captured', async () => {
  const { existsSync } = await import('node:fs');
  const devices = [
    'small-phone-720x1600',
    'medium-phone-1080x2400',
    'large-phone-1440x3200',
    'tablet-1600x2560',
  ];
  const screens = [
    '01_auth_login',
    '01b_auth_register',
    '02_dashboard',
    '03_expenses',
    '04_accounts',
    '05_usd_deals',
    '06_contacts',
    '07_debts_procedures',
    '08_unified_contact_profile_modal',
    '09_cloud_export_modal',
  ];

  for (const dev of devices) {
    for (const scr of screens) {
      const beforeFile = path.resolve(root, `reports/screenshots/before/${dev}_${scr}.png`);
      const afterFile = path.resolve(root, `reports/screenshots/after/${dev}_${scr}.png`);
      assert.ok(existsSync(beforeFile), `Before screenshot must exist: ${dev}_${scr}.png`);
      assert.ok(existsSync(afterFile), `After screenshot must exist: ${dev}_${scr}.png`);
    }
  }
});
