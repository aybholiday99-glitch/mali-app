import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSystemOwner,
  getEmergencyMaintenanceState,
  setEmergencyMaintenanceMode,
  fetchAdminSystemMetrics,
  fetchAdminUserList,
  fetchAdminSecurityEvents,
} from '../src/services/adminService.ts';

const mockOwner = {
  id: 'usr-owner-001',
  email: 'owner@mali.app',
  name: 'مالك النظام',
  isLocalOnly: false,
};

const mockAdminUser = {
  id: 'usr-admin-002',
  email: 'admin@mali.app',
  name: 'مدير العمليات',
  isLocalOnly: false,
};

const mockRoleAdmin = {
  id: 'usr-role-admin-003',
  email: 'staff@business.ly',
  name: 'مشرف بنظام الدور',
  role: 'admin',
  isLocalOnly: false,
};

const mockCustomer = {
  id: 'usr-customer-004',
  email: 'customer@tripoli.ly',
  name: 'عميل عادي',
  isLocalOnly: false,
};

const mockGuest = {
  id: 'local-offline-guest',
  email: 'guest@device.local',
  name: 'ضيف محلي',
  isLocalOnly: true,
};

const mockConfig = {
  url: 'https://evcwoaerlykghgdevrhb.supabase.co',
  anonKey: 'sb_publishable_test',
  workspaceKey: 'mali-admin-test',
  autoSync: true,
};

test('isSystemOwner authorizes configured owner emails and admin roles only', () => {
  assert.equal(isSystemOwner(mockOwner), true);
  assert.equal(isSystemOwner(mockAdminUser), true);
  assert.equal(isSystemOwner(mockRoleAdmin), true);

  // Normal customers and guests are strictly denied
  assert.equal(isSystemOwner(mockCustomer), false);
  assert.equal(isSystemOwner(mockGuest), false);
  assert.equal(isSystemOwner(null), false);
});

test('fetchAdminSystemMetrics succeeds for authorized owner and rejects customers', async () => {
  const metrics = await fetchAdminSystemMetrics(mockConfig, mockOwner);
  assert.ok(metrics);
  assert.ok(metrics.registeredUsersCount > 0);
  assert.ok(metrics.activeVaultsCount > 0);
  assert.ok(metrics.totalTransactionsCount > 0);
  assert.ok(metrics.totalAuditEventsCount > 0);
  assert.equal(typeof metrics.systemHealth, 'string');

  await assert.rejects(
    fetchAdminSystemMetrics(mockConfig, mockCustomer),
    /غير مصرح لك بالوصول/
  );
});

test('setEmergencyMaintenanceMode updates system maintenance state and reason', () => {
  const stateBefore = getEmergencyMaintenanceState();
  assert.equal(stateBefore.active, false);

  const enableRes = setEmergencyMaintenanceMode(true, 'ترقية قاعدة البيانات المركزية.');
  assert.equal(enableRes.success, true);
  assert.ok(enableRes.message.includes('تم تفعيل'));

  const stateActive = getEmergencyMaintenanceState();
  assert.equal(stateActive.active, true);
  assert.equal(stateActive.reason, 'ترقية قاعدة البيانات المركزية.');

  const disableRes = setEmergencyMaintenanceMode(false);
  assert.equal(disableRes.success, true);
  const stateDisabled = getEmergencyMaintenanceState();
  assert.equal(stateDisabled.active, false);
  assert.equal(stateDisabled.reason, undefined);
});

test('fetchAdminUserList and fetchAdminSecurityEvents return audited records for owner', async () => {
  const users = await fetchAdminUserList(mockConfig, mockOwner);
  assert.ok(Array.isArray(users));
  assert.ok(users.length > 0);
  assert.equal(users[0].id, mockOwner.id);
  assert.equal(users[0].status, 'active');

  const events = await fetchAdminSecurityEvents(mockConfig, mockOwner);
  assert.ok(Array.isArray(events));
  assert.ok(events.length > 0);
  assert.ok(events.some(e => e.eventType === 'login_success'));
  assert.ok(events.some(e => e.eventType === 'concurrency_conflict'));
  assert.ok(events.some(e => e.eventType === 'overdraft_blocked'));

  await assert.rejects(
    fetchAdminUserList(mockConfig, mockCustomer),
    /غير مصرح لك بالوصول/
  );
  await assert.rejects(
    fetchAdminSecurityEvents(mockConfig, mockCustomer),
    /غير مصرح لك بالوصول/
  );
});
