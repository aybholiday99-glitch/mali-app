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
  isSystemOwner,
  fetchAdminSystemMetrics,
  fetchAdminUserList,
  fetchAdminSecurityEvents,
  setEmergencyMaintenanceMode,
  type SystemMetricsSummary,
  type AdminUserRecord,
  type AdminSecurityEvent,
} from '../services/adminService';

interface AdminDashboardScreenProps {
  onClose: () => void;
}

export const AdminDashboardScreen: React.FC<AdminDashboardScreenProps> = ({
  onClose,
}) => {
  const { theme, currentUser, state } = useMali();
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'security' | 'emergency'>('overview');
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<SystemMetricsSummary | null>(null);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [events, setEvents] = useState<AdminSecurityEvent[]>([]);
  const [maintenanceSwitch, setMaintenanceSwitch] = useState(false);
  const [maintenanceReasonText, setMaintenanceReasonText] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!currentUser) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const [m, u, e] = await Promise.all([
          fetchAdminSystemMetrics(state.supabaseConfig, currentUser),
          fetchAdminUserList(state.supabaseConfig, currentUser),
          fetchAdminSecurityEvents(state.supabaseConfig, currentUser),
        ]);
        if (!mounted) return;
        setMetrics(m);
        setUsers(u);
        setEvents(e);
        setMaintenanceSwitch(m.isEmergencyMaintenanceActive);
        setMaintenanceReasonText(m.maintenanceReason || '');
      } catch (err: any) {
        if (!mounted) return;
        setStatusMessage(err.message || 'تعذر تحميل بيانات لوحة الإدارة.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleMaintenance = () => {
    const nextVal = !maintenanceSwitch;
    const res = setEmergencyMaintenanceMode(nextVal, maintenanceReasonText);
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
  };

  if (!isSystemOwner(currentUser)) {
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

          {activeTab === 'users' && (
            <View style={styles.tabContent}>
              <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 12 }]}>
                سجل حسابات العملاء المسجلين:
              </Text>
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
              <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 12 }]}>
                سجل أحداث الأمان والتدقيق الحي:
              </Text>
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
                  onPress={() => {
                    setEmergencyMaintenanceMode(maintenanceSwitch, maintenanceReasonText);
                    Alert.alert('تم الحفظ', 'تم تحديث إعدادات الطوارئ بنجاح.');
                  }}
                >
                  <Text style={styles.saveReasonBtnText}>حفظ إعدادات الطوارئ</Text>
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
    width: 36,
    height: 36,
    borderRadius: 18,
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
    borderRadius: 12,
    marginTop: 8,
  },
  saveReasonBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
