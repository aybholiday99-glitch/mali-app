import type { AuthUser, SupabaseConfig } from '../types/mali';

export interface SystemMetricsSummary {
  registeredUsersCount: number;
  activeVaultsCount: number;
  totalTransactionsCount: number;
  totalAuditEventsCount: number;
  failedOperationsCount: number | null;
  systemHealth: 'healthy' | 'warning' | 'maintenance';
  serverUptimeHours: number | null;
  lastSecurityAuditDate: string | null;
  isEmergencyMaintenanceActive: boolean;
  maintenanceReason?: string;
}

export interface AdminUserRecord {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastActiveAt: string;
  status: 'active' | 'locked' | 'pending_migration';
  vaultStatus: 'synced' | 'empty' | 'conflict';
  accountsCount: number;
  transactionsCount: number;
}

export interface AdminSecurityEvent {
  id: string;
  timestamp: string;
  eventType:
    | 'login_success'
    | 'auth_failure'
    | 'concurrency_conflict'
    | 'overdraft_blocked'
    | 'unauthorized_attempt'
    | 'maintenance_toggle'
    | string;
  severity: 'info' | 'warning' | 'critical';
  details: string;
  userEmail?: string;
}

let isEmergencyMaintenanceMode = false;
let emergencyMaintenanceReason: string | undefined = undefined;

async function getClient(config: SupabaseConfig, clientOverride?: any) {
  if (clientOverride) return clientOverride;
  const { getSharedSupabaseClient } = await import('./authService.ts');
  return getSharedSupabaseClient(config);
}

/**
 * Validates whether the given user has system owner / administrative privileges.
 * Relies strictly on server-assigned app_metadata or role property.
 * Email strings and client-editable user_metadata are strictly excluded.
 */
export function isSystemOwner(user: AuthUser | null): boolean {
  if (!user || !user.id || user.isLocalOnly) return false;
  // A free-form top-level role on a locally constructed object is never proof
  // of server authorization. The RPC remains the only access decision.
  const appRole = (user as any).app_metadata?.role;
  return appRole === 'admin' || appRole === 'owner';
}

/**
 * Validates admin status directly against the server database via RPC.
 */
export async function verifyAdminRoleOnServer(
  config: SupabaseConfig,
  user: AuthUser,
  clientOverride?: any
): Promise<boolean> {
  if (!user || user.isLocalOnly) return false;
  try {
    const client = await getClient(config, clientOverride);
    const { data, error } = await client.rpc('mali_check_admin_role', {});
    // A verified admin role for a different Supabase session must never grant
    // this profile access (A -> B -> A races and stale native credentials).
    if (error || !data || data.user_id !== user.id) return false;
    return data.is_admin === true;
  } catch {
    return false;
  }
}

/** Never authorize admin APIs from a cached client user profile. */
async function authorizedAdminClient(
  config: SupabaseConfig,
  user: AuthUser,
  clientOverride?: any
): Promise<any> {
  if (!user?.id || user.isLocalOnly) throw new Error('غير مصرح باستخدام لوحة الإدارة.');
  const client = await getClient(config, clientOverride);
  if (!(await verifyAdminRoleOnServer(config, user, client))) {
    throw new Error('غير مصرح باستخدام لوحة الإدارة.');
  }
  return client;
}
/**
 * Gets the current system maintenance mode status from memory cache.
 */
export function getEmergencyMaintenanceState(): {
  active: boolean;
  reason?: string;
} {
  return {
    active: isEmergencyMaintenanceMode,
    reason: emergencyMaintenanceReason,
  };
}

/**
 * Synchronizes the central maintenance mode state from the server database.
 */
export async function syncEmergencyMaintenanceState(
  config: SupabaseConfig,
  clientOverride?: any
): Promise<{ active: boolean; reason?: string }> {
  try {
    const client = await getClient(config, clientOverride);
    const { data, error } = await client
      .from('mali_system_settings')
      .select('value')
      .eq('key', 'maintenance_mode')
      .maybeSingle();

    if (!error && data?.value) {
      isEmergencyMaintenanceMode = Boolean(data.value.active);
      emergencyMaintenanceReason = data.value.reason || undefined;
    }
  } catch {
    // Retain previous state on network failure
  }
  return {
    active: isEmergencyMaintenanceMode,
    reason: emergencyMaintenanceReason,
  };
}

/**
 * Toggles emergency maintenance mode centrally via server RPC.
 * Supports both full signature (config, user, enabled, reason, clientOverride)
 * and standalone toggle for tests.
 */
export async function setEmergencyMaintenanceMode(
  config: SupabaseConfig,
  user: AuthUser,
  enabled: boolean,
  reason?: string,
  clientOverride?: any
): Promise<{ success: boolean; message: string }> {
  // There is intentionally no local-only toggle: maintenance is a server action.
  const targetEnabled = enabled;
  const targetReason = reason || undefined;
  if (!user || user.isLocalOnly) {
    throw new Error('غير مصرح لك بتغيير وضع الصيانة المركزي.');
  }

  const client = await authorizedAdminClient(config, user, clientOverride);
  const { error } = await client.rpc('mali_admin_toggle_maintenance', {
    p_active: targetEnabled,
    p_reason: targetReason || null,
  });

  if (error) {
    if (error.code === '42501' || error.message?.includes('غير مصرح')) {
      throw new Error('غير مصرح لك بتغيير وضع الصيانة المركزي.');
    }
    throw new Error('تعذر تفعيل وضع الصيانة على الخادم: ' + (error.message || 'خطأ غير معروف'));
  }

  isEmergencyMaintenanceMode = targetEnabled;
  emergencyMaintenanceReason = targetEnabled
    ? (targetReason || 'صيانة طارئة مجدولة من قِبل مالك النظام.')
    : undefined;

  return {
    success: true,
    message: targetEnabled
      ? 'تم تفعيل وضع الصيانة الطارئة للنظام بنجاح على الخادم المركزي.'
      : 'تم إيقاف وضع الصيانة واستئناف العمليات الطبيعية على الخادم المركزي.',
  };
}

/**
 * Fetches real centralized system metrics from server RPC.
 * Never returns mock or dummy data. Throws explicit error when unavailable.
 */
export async function fetchAdminSystemMetrics(
  config: SupabaseConfig,
  user: AuthUser,
  clientOverride?: any
): Promise<SystemMetricsSummary> {
  if (!user || user.isLocalOnly) {
    throw new Error('غير مصرح لك بالوصول إلى لوحة تحكم مالك النظام.');
  }

  const client = await authorizedAdminClient(config, user, clientOverride);
  const { data, error } = await client.rpc('mali_admin_get_system_metrics', {});

  if (error) {
    if (error.code === '42501' || error.message?.includes('غير مصرح')) {
      throw new Error('غير مصرح لك بالوصول إلى لوحة تحكم مالك النظام.');
    }
    throw new Error('خدمة الإحصائيات المركزية غير متوفرة على الخادم حالياً: ' + (error.message || 'فشل الاتصال'));
  }

  if (!data) {
    throw new Error('خدمة الإحصائيات المركزية لم تعد بأي بيانات من الخادم.');
  }

  isEmergencyMaintenanceMode = Boolean(data.isEmergencyMaintenanceActive);
  emergencyMaintenanceReason = data.maintenanceReason || undefined;

  return {
    registeredUsersCount: Number(data.registeredUsersCount) || 0,
    activeVaultsCount: Number(data.activeVaultsCount) || 0,
    totalTransactionsCount: Number(data.totalTransactionsCount) || 0,
    totalAuditEventsCount: Number(data.totalAuditEventsCount) || 0,
    failedOperationsCount: typeof data.failedOperationsCount === 'number' && Number.isFinite(data.failedOperationsCount) ? data.failedOperationsCount : null,
    systemHealth: data.systemHealth || (isEmergencyMaintenanceMode ? 'maintenance' : 'healthy'),
    serverUptimeHours: typeof data.serverUptimeHours === 'number' && Number.isFinite(data.serverUptimeHours) ? data.serverUptimeHours : null,
    lastSecurityAuditDate: typeof data.lastSecurityAuditDate === 'string' ? data.lastSecurityAuditDate : null,
    isEmergencyMaintenanceActive: isEmergencyMaintenanceMode,
    maintenanceReason: emergencyMaintenanceReason,
  };
}

/**
 * Fetches real user directory list from server RPC.
 * Never returns mock or dummy users.
 */
export async function fetchAdminUserList(
  config: SupabaseConfig,
  user: AuthUser,
  clientOverride?: any
): Promise<AdminUserRecord[]> {
  if (!user || user.isLocalOnly) {
    throw new Error('غير مصرح لك بالوصول إلى قائمة مستخدمي النظام.');
  }

  const client = await authorizedAdminClient(config, user, clientOverride);
  const { data, error } = await client.rpc('mali_admin_get_users', {});

  if (error) {
    if (error.code === '42501' || error.message?.includes('غير مصرح')) {
      throw new Error('غير مصرح لك بالوصول إلى قائمة مستخدمي النظام.');
    }
    throw new Error('خدمة قائمة المستخدمين غير متوفرة على الخادم حالياً: ' + (error.message || 'فشل الاتصال'));
  }

  if (!Array.isArray(data)) {
    throw new Error('تعذر قراءة قائمة المستخدمين من الخادم المركزي.');
  }

  return data;
}

/**
 * Fetches real security audit events log from server RPC.
 * Never returns mock or dummy events.
 */
export async function fetchAdminSecurityEvents(
  config: SupabaseConfig,
  user: AuthUser,
  clientOverride?: any
): Promise<AdminSecurityEvent[]> {
  if (!user || user.isLocalOnly) {
    throw new Error('غير مصرح لك بالوصول إلى سجل أحداث الأمان.');
  }

  const client = await authorizedAdminClient(config, user, clientOverride);
  const { data, error } = await client.rpc('mali_admin_get_security_events', {});

  if (error) {
    if (error.code === '42501' || error.message?.includes('غير مصرح')) {
      throw new Error('غير مصرح لك بالوصول إلى سجل أحداث الأمان.');
    }
    throw new Error('خدمة أحداث الأمان المركزية غير متوفرة على الخادم حالياً: ' + (error.message || 'فشل الاتصال'));
  }

  if (!Array.isArray(data)) {
    throw new Error('تعذر قراءة سجل أحداث الأمان من الخادم المركزي.');
  }

  return data;
}

/**
 * Inspects MFA authentication assurance level for admin account security.
 */
export async function checkAdminMfaAssuranceLevel(clientOverride?: any): Promise<{
  supported: boolean;
  currentLevel: 'aal1' | 'aal2' | 'unknown';
  nextLevel: 'aal1' | 'aal2' | 'unknown';
}> {
  try {
    const client = await getClient({ url: '', anonKey: '', workspaceKey: '', autoSync: false }, clientOverride);
    if (client?.auth?.mfa?.getAuthenticatorAssuranceLevel) {
      const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!error && data) {
        return {
          supported: true,
          currentLevel: (data.currentLevel as any) || 'aal1',
          nextLevel: (data.nextLevel as any) || 'aal1',
        };
      }
    }
    return { supported: false, currentLevel: 'aal1', nextLevel: 'aal1' };
  } catch {
    return { supported: false, currentLevel: 'unknown', nextLevel: 'unknown' };
  }
}
