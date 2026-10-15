import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSystemOwner,
  getEmergencyMaintenanceState,
  setEmergencyMaintenanceMode,
  syncEmergencyMaintenanceState,
  fetchAdminSystemMetrics,
  fetchAdminUserList,
  fetchAdminSecurityEvents,
  verifyAdminRoleOnServer,
  checkAdminMfaAssuranceLevel,
} from '../src/services/adminService.ts';

const mockOwner = {
  id: 'usr-owner-001',
  email: 'owner@mali.app',
  name: 'مالك النظام',
  app_metadata: { role: 'owner' },
  isLocalOnly: false,
};

const mockAdminUser = {
  id: 'usr-admin-002',
  email: 'admin@mali.app',
  name: 'مدير العمليات',
  app_metadata: { role: 'admin' },
  isLocalOnly: false,
};

const mockRoleAdmin = {
  id: 'usr-role-admin-003',
  email: 'staff@business.ly',
  name: 'مشرف بنظام الدور المباشر',
  role: 'admin',
  isLocalOnly: false,
};

const mockEmailSpoofer = {
  id: 'usr-spoofer-004',
  email: 'admin@mali.app', // Has admin email but NO server admin claim
  name: 'مهاجم يحاول استخدام البريد',
  app_metadata: {},
  isLocalOnly: false,
};

const mockUserMetadataSpoofer = {
  id: 'usr-meta-spoofer-005',
  email: 'user@example.ly',
  name: 'مهاجم يحاول تعديل metadata العميل',
  user_metadata: { role: 'admin' }, // Client-editable metadata
  app_metadata: {},
  isLocalOnly: false,
};

const mockCustomer = {
  id: 'usr-customer-006',
  email: 'customer@tripoli.ly',
  name: 'عميل عادي',
  app_metadata: { role: 'authenticated' },
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

function createMockSyncClient(options = {}) {
  const {
    isAdmin = true,
    rpcFails = false,
    maintenanceActive = false,
    maintenanceReason = 'صيانة ترقية',
  } = options;

  return {
    rpc: async (name, args = {}) => {
      if (rpcFails) {
        return { data: null, error: { message: 'Connection to central server lost', code: '57P01' } };
      }
      if (!isAdmin && name.startsWith('mali_admin_')) {
        return { data: null, error: { message: 'غير مصرح لك بالوصول إلى لوحة الإدارة.', code: '42501' } };
      }

      switch (name) {
        case 'mali_check_admin_role':
          return { data: { is_admin: isAdmin, role: isAdmin ? 'admin' : null, user_id: 'usr-owner-001' }, error: null };

        case 'mali_admin_get_system_metrics':
          return {
            data: {
              registeredUsersCount: 15,
              activeVaultsCount: 14,
              totalTransactionsCount: 128,
              totalAuditEventsCount: 250,
              failedOperationsCount: null,
              systemHealth: maintenanceActive ? 'maintenance' : 'healthy',
              serverUptimeHours: null,
              lastSecurityAuditDate: null,
              isEmergencyMaintenanceActive: maintenanceActive,
              maintenanceReason: maintenanceActive ? maintenanceReason : null,
            },
            error: null,
          };

        case 'mali_admin_get_users':
          return {
            data: [
              {
                id: 'usr-owner-001',
                email: 'owner@mali.app',
                name: 'مالك النظام',
                createdAt: '2026-09-01T10:00:00Z',
                lastActiveAt: '2026-10-14T12:00:00Z',
                status: 'active',
                vaultStatus: 'synced',
                accountsCount: 3,
                transactionsCount: 45,
              },
            ],
            error: null,
          };

        case 'mali_admin_get_security_events':
          return {
            data: [
              {
                id: 'evt_1',
                timestamp: '2026-10-14T12:05:00Z',
                eventType: 'maintenance_toggle',
                severity: 'info',
                details: 'تغيير وضع الصيانة المركزي: تحديث خوادم',
                userEmail: 'usr-owner-001',
              },
            ],
            error: null,
          };

        case 'mali_admin_toggle_maintenance':
          return {
            data: {
              active: args.p_active,
              reason: args.p_reason,
              updated_at: '2026-10-14T12:10:00Z',
            },
            error: null,
          };

        default:
          return { data: null, error: { message: `Unknown RPC ${name}`, code: '42883' } };
      }
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'mali_system_settings') {
              return {
                data: {
                  value: {
                    active: maintenanceActive,
                    reason: maintenanceReason,
                  },
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: 'aal2', nextLevel: 'aal2' },
          error: null,
        }),
      },
    },
  };
}

test('1. isSystemOwner strictly rejects email spoofing and client user_metadata', () => {
  // Verified claims in app_metadata or server role: ALLOWED
  assert.equal(isSystemOwner(mockOwner), true);
  assert.equal(isSystemOwner(mockAdminUser), true);
  assert.equal(isSystemOwner(mockRoleAdmin), false, 'A client-supplied role must never unlock admin');

  // Email alone with no server role: STRICTLY REJECTED
  assert.equal(isSystemOwner(mockEmailSpoofer), false, 'Email address alone must NEVER grant admin access');

  // Client-editable user_metadata: STRICTLY REJECTED
  assert.equal(isSystemOwner(mockUserMetadataSpoofer), false, 'Client user_metadata must NEVER grant admin access');

  // Normal customers and guests: STRICTLY REJECTED
  assert.equal(isSystemOwner(mockCustomer), false);
  assert.equal(isSystemOwner(mockGuest), false);
  assert.equal(isSystemOwner(null), false);
});

test('2. verifyAdminRoleOnServer checks role against server RPC', async () => {
  const clientAdmin = createMockSyncClient({ isAdmin: true });
  const isAdmin = await verifyAdminRoleOnServer(mockConfig, mockOwner, clientAdmin);
  assert.equal(isAdmin, true);
  assert.equal(await verifyAdminRoleOnServer(mockConfig, mockAdminUser, clientAdmin), false,
    'An admin reply for user A must never authorize user B');

  const clientCustomer = createMockSyncClient({ isAdmin: false });
  const isCustomerAdmin = await verifyAdminRoleOnServer(mockConfig, mockCustomer, clientCustomer);
  assert.equal(isCustomerAdmin, false);

  const isGuestAdmin = await verifyAdminRoleOnServer(mockConfig, mockGuest, clientAdmin);
  assert.equal(isGuestAdmin, false);
});

test('3. fetchAdminSystemMetrics returns real server data and throws on failure without fake mocks', async () => {
  const client = createMockSyncClient({ isAdmin: true });
  const metrics = await fetchAdminSystemMetrics(mockConfig, mockOwner, client);
  assert.ok(metrics);
  assert.equal(metrics.registeredUsersCount, 15);
  assert.equal(metrics.activeVaultsCount, 14);
  assert.equal(metrics.totalTransactionsCount, 128);
  assert.equal(metrics.totalAuditEventsCount, 250);
  assert.equal(metrics.systemHealth, 'healthy');
  assert.equal(metrics.failedOperationsCount, null);
  assert.equal(metrics.serverUptimeHours, null);
  assert.equal(metrics.lastSecurityAuditDate, null);

  // Unauthorized customer must be rejected with 42501 error
  await assert.rejects(
    fetchAdminSystemMetrics(mockConfig, mockCustomer, createMockSyncClient({ isAdmin: false })),
    /غير مصرح/
  );

  // When server RPC fails, it must throw an explicit error rather than returning fake mock data
  const failingClient = createMockSyncClient({ isAdmin: true, rpcFails: true });
  await assert.rejects(
    fetchAdminSystemMetrics(mockConfig, mockOwner, failingClient),
    /\u063a\u064a\u0631 \u0645\u0635\u0631\u062d/
  );
});

test('4. fetchAdminUserList and fetchAdminSecurityEvents return server records and reject customers', async () => {
  const client = createMockSyncClient({ isAdmin: true });

  const users = await fetchAdminUserList(mockConfig, mockOwner, client);
  assert.ok(Array.isArray(users));
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'usr-owner-001');
  assert.equal(users[0].email, 'owner@mali.app');
  assert.equal(users[0].accountsCount, 3);

  const events = await fetchAdminSecurityEvents(mockConfig, mockOwner, client);
  assert.ok(Array.isArray(events));
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'maintenance_toggle');

  // Unauthorized calls must fail
  await assert.rejects(
    fetchAdminUserList(mockConfig, mockCustomer, createMockSyncClient({ isAdmin: false })),
    /غير مصرح/
  );
  await assert.rejects(
    fetchAdminSecurityEvents(mockConfig, mockCustomer, createMockSyncClient({ isAdmin: false })),
    /غير مصرح/
  );
});

test('5. Central emergency maintenance mode is toggled via server RPC and read from settings', async () => {
  const client = createMockSyncClient({ isAdmin: true });

  const resEnable = await setEmergencyMaintenanceMode(
    mockConfig,
    mockOwner,
    true,
    'ترقية وتوسيع خوادم قاعدة البيانات المركزية',
    client
  );
  assert.equal(resEnable.success, true);
  assert.ok(resEnable.message.includes('تم تفعيل'));

  const activeState = getEmergencyMaintenanceState();
  assert.equal(activeState.active, true);
  assert.equal(activeState.reason, 'ترقية وتوسيع خوادم قاعدة البيانات المركزية');

  // Turn off
  const resDisable = await setEmergencyMaintenanceMode(
    mockConfig,
    mockOwner,
    false,
    undefined,
    client
  );
  assert.equal(resDisable.success, true);
  assert.equal(getEmergencyMaintenanceState().active, false);

  // Sync state from server settings table
  const synced = await syncEmergencyMaintenanceState(mockConfig, client);
  assert.equal(typeof synced.active, 'boolean');

  // Customer cannot toggle maintenance mode
  await assert.rejects(
    setEmergencyMaintenanceMode(mockConfig, mockCustomer, true, 'تخريب', createMockSyncClient({ isAdmin: false })),
    /غير مصرح/
  );
});

test('6. checkAdminMfaAssuranceLevel reports MFA capability and level', async () => {
  const client = createMockSyncClient();
  const mfa = await checkAdminMfaAssuranceLevel(client);
  assert.equal(mfa.supported, true);
  assert.equal(mfa.currentLevel, 'aal2');
});
