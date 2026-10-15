import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import {
  verifyAdminRoleOnServer,
  fetchAdminSystemMetrics,
  fetchAdminUserList,
  fetchAdminSecurityEvents,
  setEmergencyMaintenanceMode,
  checkAdminMfaAssuranceLevel,
  type SystemMetricsSummary,
  type AdminUserRecord,
  type AdminSecurityEvent,
} from '../services/adminService';
import { MIN_TOUCH_TARGET } from '../theme/responsive';

interface AdminDashboardScreenProps {
  onClose: () => void;
}

export const AdminDashboardScreen: React.FC<AdminDashboardScreenProps> = ({
  onClose,
}) => {
  const { theme, currentUser, state } = useMali();
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'security' | 'emergency'>('overview');
  const [loading, setLoading] = useState(true);
  const adminScope = currentUser ? [currentUser.id, state.supabaseConfig.url, state.supabaseConfig.anonKey].join('|') : null;
  const [authorizedScope, setAuthorizedScope] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SystemMetricsSummary | null>(null);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [events, setEvents] = useState<AdminSecurityEvent[]>([]);
  const [mfaStatus, setMfaStatus] = useState<{ supported: boolean; currentLevel: string; nextLevel: string } | null>(null);
  const [maintenanceSwitch, setMaintenanceSwitch] = useState(false);
  const [maintenanceReasonText, setMaintenanceReasonText] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // The server, not user metadata or a local role claim, decides admin access.
  // Invalidate authorization and privileged data on every identity/config change.
  useEffect(() => {
    let current = true;
    // The scoped render check fails closed before async invalidation completes.
    void Promise.resolve().then(() => {
      if (!current) return;
      setAuthorizedScope(null);
      setMetrics(null);
      setUsers([]);
      setEvents([]);
    });
    if (currentUser && !currentUser.isLocalOnly) {
      void verifyAdminRoleOnServer(state.supabaseConfig, currentUser)
        .then(allowed => {
          if (current) setAuthorizedScope(allowed ? adminScope : null);
        })
        .catch(() => { if (current) setAuthorizedScope(null); });
    }
    return () => { current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminScope]);
  const handleRefresh = async () => {
    if (!currentUser || authorizedScope !== adminScope) return;
    setLoading(true);
    setStatusMessage(null);
    try {
      const [m, u, e, mfa] = await Promise.all([
        fetchAdminSystemMetrics(state.supabaseConfig, currentUser).catch((err: any) => {
          setStatusMessage(err.message || 'خدمة الإحصائيات المركزية غير متوفرة.');
          return null;
        }),
        fetchAdminUserList(state.supabaseConfig, currentUser).catch(() => []),
        fetchAdminSecurityEvents(state.supabaseConfig, currentUser).catch(() => []),
        checkAdminMfaAssuranceLevel().catch(() => ({ supported: false, currentLevel: 'aal1', nextLevel: 'aal1' })),
      ]);
      setMetrics(m);
      setUsers(u);
      setEvents(e);
      setMfaStatus(mfa);
      if (m) {
        setMaintenanceSwitch(m.isEmergencyMaintenanceActive);
        setMaintenanceReasonText(m.maintenanceReason || '');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!currentUser || authorizedScope !== adminScope) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const [m, u, e, mfa] = await Promise.all([
          fetchAdminSystemMetrics(state.supabaseConfig, currentUser).catch((err: any) => {
            if (mounted) setStatusMessage(err.message || 'خدمة الإحصائيات المركزية غير متوفرة.');
            return null;
          }),
          fetchAdminUserList(state.supabaseConfig, currentUser).catch(() => []),
          fetchAdminSecurityEvents(state.supabaseConfig, currentUser).catch(() => []),
          checkAdminMfaAssuranceLevel().catch(() => ({ supported: false, currentLevel: 'aal1', nextLevel: 'aal1' })),
        ]);
        if (!mounted) return;
        setMetrics(m);
        setUsers(u);
        setEvents(e);
        setMfaStatus(mfa);
        if (m) {
          setMaintenanceSwitch(m.isEmergencyMaintenanceActive);
          setMaintenanceReasonText(m.maintenanceReason || '');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizedScope, adminScope]);

  const handleToggleMaintenance = async () => {
    if (!currentUser || authorizedScope !== adminScope) return;
    const nextVal = !maintenanceSwitch;
    try {
      const res = await setEmergencyMaintenanceMode(
        state.supabaseConfig,
        currentUser,
        nextVal,
        maintenanceReasonText
      );
      setMaintenanceSwitch(nextVal);
      setStatusMessage(res.message);
      if (metrics) {
        setMetrics({
          ...metrics,
          isEmergencyMaintenanceActive: nextVal,
          systemHealth: nextVal ? 'maintenance' : 'healthy',
          maintenanceReason: nextVal ? maintenanceReasonText : undefined,
        });
      }
    } catch (err: any) {
      setStatusMessage(err.message || 'تعذر تحديث وضع الصيانة على الخادم المركزي.');
    }
  };

  if (!currentUser || authorizedScope !== adminScope) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: theme.bg }]}>
        <Ionicons name="lock-closed" size={48} color="#DC2626" />
        <Text style={[styles.deniedText, { color: theme.text }]}>
          غير مصرح لك بالوصول إلى هذه اللوحة. مخصصة لمالك النظام فقط.
        </Text>
        <TouchableOpacity style={[styles.closeBtn, { backgroundColor: theme.primary }]} onPress={onClose}>
          <Text style={styles.closeBtnText}>العودة للتطبيق</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <View style={styles.headerTitleRow}>
          <View style={[styles.shieldBadge, { backgroundColor: '#FEF3C7' }]}>
            <Ionicons name="shield-checkmark" size={20} color="#D97706" />
          </View>
          <View>
            <Text style={[styles.headerTitle, { color: theme.text }]}>
              لوحة تحكم مالك النظام
            </Text>
            <Text style={[styles.headerSubtitle, { color: theme.textMuted }]}>
              الرقابة المركزية، سلامة البيانات، وتدقيق التزامن
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.closeIconBtn, { backgroundColor: theme.surfaceSoft }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="إغلاق لوحة الإدارة"
        >
          <Ionicons name="close" size={20} color={theme.text} />
        </TouchableOpacity>
      </View>

      {/* Navigation Tabs */}
      <View style={[styles.tabBar, { backgroundColor: theme.surfaceSoft, borderBottomColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'overview' && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('overview')}
        >
          <Ionicons
            name="grid-outline"
            size={16}
            color={activeTab === 'overview' ? theme.primary : theme.textSecondary}
          />
          <Text style={[styles.tabText, { color: activeTab === 'overview' ? theme.primary : theme.textSecondary }]}>
            نظرة عامة
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'users' && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('users')}
        >
          <Ionicons
            name="people-outline"
            size={16}
            color={activeTab === 'users' ? theme.primary : theme.textSecondary}
          />
          <Text style={[styles.tabText, { color: activeTab === 'users' ? theme.primary : theme.textSecondary }]}>
            المستخدمون
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'security' && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('security')}
        >
          <Ionicons
            name="shield-outline"
            size={16}
            color={activeTab === 'security' ? theme.primary : theme.textSecondary}
          />
          <Text style={[styles.tabText, { color: activeTab === 'security' ? theme.primary : theme.textSecondary }]}>
            أحداث الأمان
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'emergency' && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('emergency')}
        >
          <Ionicons
            name="warning-outline"
            size={16}
            color={activeTab === 'emergency' ? '#DC2626' : theme.textSecondary}
          />
          <Text style={[styles.tabText, { color: activeTab === 'emergency' ? '#DC2626' : theme.textSecondary }]}>
            طوارئ النظام
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status banner */}
      {statusMessage && (
        <View style={styles.statusBanner}>
          <Text style={styles.statusBannerText}>{statusMessage}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
            جاري فحص حالة النظام والبيانات المركزية…
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {activeTab === 'overview' && metrics && (
            <View style={styles.tabContent}>
              {/* Health status banner */}
              <View
                style={[
                  styles.healthCard,
                  {
                    backgroundColor:
                      metrics.systemHealth === 'healthy' ? '#ECFDF5' : '#FEF2F2',
                    borderColor:
                      metrics.systemHealth === 'healthy' ? '#A7F3D0' : '#FECACA',
                  },
                ]}
              >
                <Ionicons
                  name={
                    metrics.systemHealth === 'healthy'
                      ? 'checkmark-circle'
                      : 'alert-circle'
                  }
                  size={24}
                  color={metrics.systemHealth === 'healthy' ? '#059669' : '#DC2626'}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.healthTitle,
                      {
                        color:
                          metrics.systemHealth === 'healthy'
                            ? '#065F46'
                            : '#991B1B',
                      },
                    ]}
                  >
                    {metrics.systemHealth === 'healthy'
                      ? 'النظام يعمل بصورة طبيعية ومستقرة'
                      : 'وضع الصيانة الطارئة مفعل حالياً'}
                  </Text>
                  <Text
                    style={[
                      styles.healthSub,
                      {
                        color:
                          metrics.systemHealth === 'healthy'
                            ? '#047857'
                            : '#B91C1C',
                      },
                    ]}
                  >
                    قاعدة بيانات Supabase مؤمّنة بسياسات RLS، ولا توجد تسريبات أو اختراقات.
                  </Text>
                </View>
              </View>

              {/* Metrics Grid */}
              <View style={styles.metricsGrid}>
                <View
                  style={[
                    styles.metricCard,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="people" size={24} color={theme.primary} />
                  <Text style={[styles.metricNumber, { color: theme.text }]}>
                    {metrics.registeredUsersCount}
                  </Text>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>
                    المستخدمون المسجلون
                  </Text>
                </View>

                <View
                  style={[
                    styles.metricCard,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="cube" size={24} color="#2563EB" />
                  <Text style={[styles.metricNumber, { color: theme.text }]}>
                    {metrics.activeVaultsCount}
                  </Text>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>
                    الخزائن المركزية النشطة
                  </Text>
                </View>

                <View
                  style={[
                    styles.metricCard,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="receipt" size={24} color="#059669" />
                  <Text style={[styles.metricNumber, { color: theme.text }]}>
                    {metrics.totalTransactionsCount.toLocaleString('ar-LY')}
                  </Text>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>
                    إجمالي الحركات المالية
                  </Text>
                </View>

                <View
                  style={[
                    styles.metricCard,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="shield-checkmark" size={24} color="#7C3AED" />
                  <Text style={[styles.metricNumber, { color: theme.text }]}>
                    {metrics.totalAuditEventsCount.toLocaleString('ar-LY')}
                  </Text>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>
                    سجلات التدقيق المحصنة
                  </Text>
                </View>
              </View>

              {/* Architecture Architecture Guarantees */}
              <View
                style={[
                  styles.architectureCard,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                  المعايير الهندسية المركزية المفعلة:
                </Text>

                <View style={styles.ruleItem}>
                  <Ionicons name="checkmark-done" size={18} color="#059669" />
                  <Text style={[styles.ruleText, { color: theme.textSecondary }]}>
                    عزل المستأجرين الكامل (Multi-Tenant RLS): لا يمكن لأي عميل قراءة أو تعديل خزنة عميل آخر.
                  </Text>
                </View>

                <View style={styles.ruleItem}>
                  <Ionicons name="checkmark-done" size={18} color="#059669" />
                  <Text style={[styles.ruleText, { color: theme.textSecondary }]}>
                    منع التخزين المحلي (Central Server Only): هاتف العميل لا يحتفظ بأي سجلات مالية بعد إغلاق الجلسة.
                  </Text>
                </View>

                <View style={styles.ruleItem}>
                  <Ionicons name="checkmark-done" size={18} color="#059669" />
                  <Text style={[styles.ruleText, { color: theme.textSecondary }]}>
                    منع السحب المكشوف النقدي: الحسابات النقدية محظور تجاوز رصيدها الصفر تحت أي ظرف.
                  </Text>
                </View>

                <View style={styles.ruleItem}>
                  <Ionicons name="checkmark-done" size={18} color="#059669" />
                  <Text style={[styles.ruleText, { color: theme.textSecondary }]}>
                    التزامن المتفائل الصارم (CAS Validation): رفض أي كتابات متزامنة متضاربة دون تأكيد الخادم.
                  </Text>
                </View>
              </View>
            </View>
          )}

          {activeTab === 'overview' && !metrics && (
            <View style={styles.unavailableContainer}>
              <Ionicons name="cloud-offline-outline" size={48} color="#DC2626" />
              <Text style={[styles.unavailableTitle, { color: theme.text }]}>
                خدمة الإحصائيات المركزية غير متوفرة
              </Text>
              <Text style={[styles.unavailableDesc, { color: theme.textSecondary }]}>
                {statusMessage || 'تعذر جلب البيانات الحقيقية من الخادم المركزي. لن يتم عرض أي بيانات تجريبية وهمية.'}
              </Text>
              <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: theme.primary }]}
                onPress={handleRefresh}
                accessibilityRole="button"
                accessibilityLabel="إعادة محاولة الاتصال بالخادم"
              >
                <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
                <Text style={styles.retryBtnText}>إعادة المحاولة</Text>
              </TouchableOpacity>
            </View>
          )}

          {activeTab === 'users' && (
            <View style={styles.tabContent}>
              <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 12 }]}>
                سجل حسابات العملاء المسجلين:
              </Text>
              {users.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Ionicons name="people-outline" size={36} color="#9CA3AF" />
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                    لا توجد حسابات مستخدمين مسترجعة من الخادم المركزي حالياً.
                  </Text>
                  <TouchableOpacity
                    style={[styles.retryBtn, { backgroundColor: theme.surfaceSoft, marginTop: 12 }]}
                    onPress={handleRefresh}
                    accessibilityRole="button"
                    accessibilityLabel="إعادة محاولة تحميل المستخدمين"
                  >
                    <Ionicons name="refresh-outline" size={16} color={theme.text} />
                    <Text style={[styles.retryBtnText, { color: theme.text }]}>تحديث القائمة</Text>
                  </TouchableOpacity>
                </View>
              )}
              {users.map((u) => (
                <View
                  key={u.id}
                  style={[
                    styles.userCard,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.userCardHeader}>
                    <View style={styles.userNameCol}>
                      <Text style={[styles.userName, { color: theme.text }]}>
                        {u.name}
                      </Text>
                      <Text style={[styles.userEmail, { color: theme.textMuted }]}>
                        {u.email}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        {
                          backgroundColor:
                            u.status === 'active' ? '#ECFDF5' : '#FEF2F2',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          {
                            color:
                              u.status === 'active' ? '#059669' : '#DC2626',
                          },
                        ]}
                      >
                        {u.status === 'active' ? 'نشط' : 'مقفل'}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.divider, { backgroundColor: theme.border }]} />

                  <View style={styles.userCardMeta}>
                    <Text style={[styles.metaText, { color: theme.textMuted }]}>
                      الخزائن: {u.accountsCount} | الحركات: {u.transactionsCount}
                    </Text>
                    <Text style={[styles.metaText, { color: theme.textMuted }]}>
                      حالة الخزنة: {u.vaultStatus === 'synced' ? 'متزامنة مع السيرفر' : 'فارغة'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {activeTab === 'security' && (
            <View style={styles.tabContent}>
              {mfaStatus && (
                <View
                  style={[
                    styles.mfaCard,
                    {
                      backgroundColor: mfaStatus.currentLevel === 'aal2' ? '#ECFDF5' : '#F9FAFB',
                      borderColor: mfaStatus.currentLevel === 'aal2' ? '#A7F3D0' : '#E5E7EB',
                    },
                  ]}
                >
                  <Ionicons
                    name={mfaStatus.currentLevel === 'aal2' ? 'shield-checkmark' : 'shield-outline'}
                    size={22}
                    color={mfaStatus.currentLevel === 'aal2' ? '#059669' : '#4B5563'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.mfaTitle, { color: theme.text }]}>
                      مستوى المصادقة المتعددة (MFA): {mfaStatus.currentLevel.toUpperCase()}
                    </Text>
                    <Text style={[styles.mfaSubtitle, { color: theme.textSecondary }]}>
                      {mfaStatus.currentLevel === 'aal2'
                        ? 'المصادقة الثنائية (MFA AAL2) مفعلة ومعتمدة على هذا الحساب.'
                        : 'خادم Supabase جاهز لترقية المصادقة الثنائية (MFA) لحماية الحساب الإداري.'}
                    </Text>
                  </View>
                </View>
              )}

              <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 12 }]}>
                سجل أحداث الأمان والتدقيق الحي:
              </Text>
              {events.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Ionicons name="shield-outline" size={36} color="#9CA3AF" />
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                    لا توجد أحداث أمان مسجلة حديثاً في سجل التدقيق المركزي.
                  </Text>
                  <TouchableOpacity
                    style={[styles.retryBtn, { backgroundColor: theme.surfaceSoft, marginTop: 12 }]}
                    onPress={handleRefresh}
                    accessibilityRole="button"
                    accessibilityLabel="إعادة محاولة تحميل سجل الأمان"
                  >
                    <Ionicons name="refresh-outline" size={16} color={theme.text} />
                    <Text style={[styles.retryBtnText, { color: theme.text }]}>تحديث السجل</Text>
                  </TouchableOpacity>
                </View>
              )}
              {events.map((evt) => (
                <View
                  key={evt.id}
                  style={[
                    styles.eventCard,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.eventCardHeader}>
                    <View
                      style={[
                        styles.severityDot,
                        {
                          backgroundColor:
                            evt.severity === 'critical'
                              ? '#DC2626'
                              : evt.severity === 'warning'
                              ? '#D97706'
                              : '#059669',
                        },
                      ]}
                    />
                    <Text style={[styles.eventTime, { color: theme.textMuted }]}>
                      {new Date(evt.timestamp).toLocaleTimeString('ar-LY')}
                    </Text>
                  </View>
                  <Text style={[styles.eventDetails, { color: theme.text }]}>
                    {evt.details}
                  </Text>
                  {evt.userEmail && (
                    <Text style={[styles.eventUser, { color: theme.primary }]}>
                      المعرف: {evt.userEmail}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {activeTab === 'emergency' && (
            <View style={styles.tabContent}>
              <View
                style={[
                  styles.emergencyCard,
                  { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
                ]}
              >
                <Ionicons name="warning" size={32} color="#D97706" />
                <Text style={styles.emergencyTitle}>
                  إيقاف المزامنة والعمليات مؤقتاً لحالات الطوارئ
                </Text>
                <Text style={styles.emergencySub}>
                  في حال تفعيل هذا الخيار، سيتم رفض أي عمليات رفع أو تعديل جديدة من
                  تطبيقات العملاء مع إظهار رسالة الصيانة، لحين الانتهاء من التحديثات.
                </Text>

                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>
                    وضع الصيانة الطارئة: {maintenanceSwitch ? 'مُفعّل' : 'مُعطّل'}
                  </Text>
                  <Switch
                    value={maintenanceSwitch}
                    onValueChange={handleToggleMaintenance}
                    trackColor={{ false: '#D1D5DB', true: '#DC2626' }}
                  />
                </View>

                <Text style={styles.inputLabel}>سبب الصيانة (يظهر للعملاء):</Text>
                <TextInput
                  style={styles.reasonInput}
                  value={maintenanceReasonText}
                  onChangeText={setMaintenanceReasonText}
                  placeholder="صيانة دورية مجدولة لتحديث الخوادم..."
                  placeholderTextColor="#9CA3AF"
                />

                <TouchableOpacity
                  style={styles.saveReasonBtn}
                  onPress={async () => {
                    if (!currentUser || authorizedScope !== adminScope) return;
                    try {
                      const res = await setEmergencyMaintenanceMode(
                        state.supabaseConfig,
                        currentUser,
                        maintenanceSwitch,
                        maintenanceReasonText
                      );
                      setStatusMessage(res.message);
                      Alert.alert('تم الحفظ', res.message);
                    } catch (err: any) {
                      Alert.alert('خطأ', err.message || 'تعذر حفظ إعدادات الطوارئ على الخادم.');
                    }
                  }}
                >
                  <Text style={styles.saveReasonBtnText}>حفظ إعدادات الطوارئ على الخادم</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  deniedText: {
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 24,
  },
  closeBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  header: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  shieldBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  headerSubtitle: {
    fontSize: 12,
    textAlign: 'right',
  },
  closeIconBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBar: {
    flexDirection: 'row-reverse',
    borderBottomWidth: 1,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row-reverse',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: MIN_TOUCH_TARGET,
    gap: 6,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statusBanner: {
    backgroundColor: '#ECFDF5',
    padding: 10,
    alignItems: 'center',
  },
  statusBannerText: {
    color: '#065F46',
    fontSize: 13,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  content: {
    padding: 16,
  },
  tabContent: {
    gap: 16,
  },
  healthCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  healthTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  healthSub: {
    fontSize: 12,
    marginTop: 2,
    textAlign: 'right',
  },
  metricsGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    width: '48%',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  metricNumber: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  metricLabel: {
    fontSize: 12,
  },
  architectureCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  ruleItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  ruleText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'right',
  },
  userCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  userCardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userNameCol: {
    alignItems: 'flex-end',
  },
  userName: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  userEmail: {
    fontSize: 12,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  divider: {
    height: 1,
  },
  userCardMeta: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  metaText: {
    fontSize: 12,
  },
  eventCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  eventCardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  severityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  eventTime: {
    fontSize: 11,
  },
  eventDetails: {
    fontSize: 13,
    textAlign: 'right',
    lineHeight: 18,
  },
  eventUser: {
    fontSize: 11,
    textAlign: 'right',
  },
  emergencyCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: 12,
  },
  emergencyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#92400E',
    textAlign: 'center',
  },
  emergencySub: {
    fontSize: 13,
    color: '#B45309',
    textAlign: 'center',
    lineHeight: 19,
  },
  switchRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 12,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#78350F',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#78350F',
    alignSelf: 'flex-end',
  },
  reasonInput: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 12,
    textAlign: 'right',
    color: '#111827',
  },
  saveReasonBtn: {
    backgroundColor: '#D97706',
    paddingVertical: 12,
    paddingHorizontal: 24,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    marginTop: 8,
  },
  saveReasonBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  unavailableContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  unavailableTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  unavailableDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 8,
    minHeight: 48,
    minWidth: 48,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  mfaCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    gap: 10,
  },
  mfaTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  mfaSubtitle: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 2,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
});
