import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const readSource = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

test('admin navigation requires a server-checked, current identity/config scope', async () => {
  const src = await readSource('src/navigation/MaliVaultShell.tsx');
  assert.match(src, /verifyAdminRoleOnServer\(state\.supabaseConfig, currentUser\)/);
  assert.match(src, /adminAuthorizedKey === adminScope/);
  assert.match(src, /visible=\{adminModalVisible && adminAuthorized\}/);
  assert.doesNotMatch(src, /isSystemOwner\(currentUser\)/);
});

test('admin screen cannot render privileged account listings from a previous scope', async () => {
  const src = await readSource('src/screens/AdminDashboardScreen.tsx');
  assert.match(src, /authorizedScope !== adminScope/);
  assert.match(src, /setMetrics\(null\)/);
  assert.match(src, /setUsers\(\[\]\)/);
  assert.match(src, /setEvents\(\[\]\)/);
  assert.match(src, /verifyAdminRoleOnServer\(state\.supabaseConfig, currentUser\)/);
});

test('admin RPC verification binds role to the exact authenticated owner', async () => {
  const src = await readSource('src/services/adminService.ts');
  assert.match(src, /data\.user_id !== user\.id/);
  assert.doesNotMatch(src, /directRole === 'admin'/);
  assert.match(src, /authorizedAdminClient\(config, user, clientOverride\)/);
  assert.match(src, /data\.serverUptimeHours === 'number'/);
});
