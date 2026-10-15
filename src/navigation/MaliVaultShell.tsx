import React, { useState, useEffect } from 'react';
import { View,Text,StyleSheet,TouchableOpacity,StatusBar,Modal } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link,router,usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import { useResponsiveLayout, MIN_TOUCH_TARGET } from '../theme/responsive';
import { CloudAndExportModal } from '../screens/CloudAndExportModal';
import { LegacyVaultMigrationModal } from '../components/LegacyVaultMigrationModal';
import { OfflineBanner } from '../components/OfflineBanner';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';
import { verifyAdminRoleOnServer } from '../services/adminService';
import { launchSocialOAuthWindow } from '../services/authService';
import { sectionFromPath,pathForSection,type VaultSection as TabKey } from './routes';
import { VaultActionsProvider } from './VaultActions';

export const MaliVaultShell: React.FC<{children:React.ReactNode}> = ({children}) => {
  const {
    state,
    theme,
    isDarkMode,
    toggleTheme,
    currentUser,
    lastSyncMessage,
    loginUser,
    logoutUser,
    legacyVaultPendingMigration,
    isMigratingLegacy,
    migrationStepStatus,
    migrationError,
    performLegacyVaultMigration,
    cancelLegacyVaultMigration,
  } = useMali();
  const insets = useSafeAreaInsets();
  const { isSmallPhone } = useResponsiveLayout();
  const activeTab=sectionFromPath(usePathname());
  const [cloudModalVisible, setCloudModalVisible] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [adminAuthorizedKey, setAdminAuthorizedKey] = useState<string | null>(null);
  const [profileMessage,setProfileMessage]=useState<string | null>(null);
  const [profileBusy,setProfileBusy]=useState(false);

  const adminScope = currentUser ? [currentUser.id, state.supabaseConfig.url, state.supabaseConfig.anonKey].join('|') : null;
  const adminAuthorized = adminAuthorizedKey !== null && adminAuthorizedKey === adminScope;

  // The client-side user profile is not an authorization source. Only a
  // server-checked administrative role can reveal the privileged entry point.
  useEffect(() => {
    let current = true;
    // Defer invalidation; the scoped render guard hides prior privileges immediately.
    void Promise.resolve().then(() => {
      if (current) { setAdminAuthorizedKey(null); setAdminModalVisible(false); }
    });
    if (currentUser && !currentUser.isLocalOnly) {
      void verifyAdminRoleOnServer(state.supabaseConfig, currentUser)
        .then(allowed => { if (current) setAdminAuthorizedKey(allowed ? adminScope : null); })
        .catch(() => { if (current) setAdminAuthorizedKey(null); });
    }
    return () => { current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminScope]);

  if (!currentUser) return null;

  // 4 Clean, Spacious Bottom Navigation Tabs instead of 6 crowded ones
  const bottomNavItems: {
    id: 'home' | 'wallet' | 'deals' | 'relations';
    defaultTab: TabKey;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    matches: TabKey[];
  }[] = [
    {
      id: 'home',
      defaultTab: 'dashboard',
      label: 'الرئيسية',
      icon: 'grid',
      matches: ['dashboard'],
    },
    {
      id: 'wallet',
      defaultTab: 'expenses',
      label: 'المصاريف والحسابات',
      icon: 'wallet',
      matches: ['expenses', 'accounts'],
    },
    {
      id: 'deals',
      defaultTab: 'deals',
      label: 'تداول الدولار',
      icon: 'trending-up',
      matches: ['deals'],
    },
    {
      id: 'relations',
      defaultTab: 'contacts',
      label: 'المتعاملون والديون',
      icon: 'people',
      matches: ['contacts', 'procedures'],
    },
  ];

  const getProviderIcon = () => {
    if (currentUser.provider === 'google') return 'logo-google';
    if (currentUser.provider === 'facebook') return 'logo-facebook';
    return 'person';
  };

  const getProviderLabel = () => {
    if (currentUser.isLocalOnly) return 'وضع محلي';
    if (currentUser.provider === 'google') return 'حساب Google';
    if (currentUser.provider === 'facebook') return 'حساب Facebook';
    return 'بريد إلكتروني';
  };

  return (
    <VaultActionsProvider value={{openExport:()=>setCloudModalVisible(true)}}>
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.headerBg }]}
    >
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* Minimal, Calm Top App Bar */}
      <View
        style={[
          styles.topHeader,
          {
            backgroundColor: theme.headerBg,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <View style={styles.headerInner}>
          <View style={styles.brandRow}>
            <View
              style={[styles.logoBadge, { backgroundColor: theme.primary }]}
            >
              <Ionicons name="wallet" size={17} color="#FFFFFF" />
            </View>
            <Text style={[styles.appTitle, { color: theme.text }]}>مالي</Text>
          </View>

          <View style={[styles.headerActions, isSmallPhone && styles.headerActionsSmall]}>
            <TouchableOpacity
              style={[
                styles.iconActionBtn,
                {
                  backgroundColor: theme.cardAlt,
                  borderColor: theme.border,
                },
              ]}
              onPress={toggleTheme}
              accessibilityRole="button"
              accessibilityLabel={isDarkMode ? 'تفعيل المظهر الفاتح' : 'تفعيل المظهر الداكن'}
            >
              <Ionicons
                name={isDarkMode ? 'sunny-outline' : 'moon-outline'}
                size={18}
                color={isDarkMode ? '#FBBF24' : theme.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.cloudPill,
                isSmallPhone && styles.cloudPillCompact,
                {
                  backgroundColor: theme.cardAlt,
                  borderColor: theme.border,
                },
              ]}
              onPress={() => setCloudModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="تصدير التقارير والنسخ الاحتياطي"
            >
              <Ionicons
                name="document-text-outline"
                size={16}
                color={theme.primary}
              />
              {!isSmallPhone && (
                <Text
                  style={[
                    styles.cloudPillText,
                    {
                      color: theme.primary,
                    },
                  ]}
                  numberOfLines={1}
                >
                  تصدير التقارير
                </Text>
              )}
            </TouchableOpacity>

            {adminAuthorized && (
              <TouchableOpacity
                style={[
                  styles.iconActionBtn,
                  {
                    backgroundColor: '#FEF3C7',
                    borderColor: '#FDE68A',
                  },
                ]}
                onPress={() => setAdminModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="لوحة تحكم مالك النظام"
              >
                <Ionicons name="shield-checkmark" size={18} color="#D97706" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.userPill,
                isSmallPhone && styles.userPillCompact,
                {
                  backgroundColor: theme.cardAlt,
                  borderColor: theme.border,
                },
              ]}
              onPress={() => setProfileModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="عرض الحساب وتسجيل الخروج"
            >
              <Ionicons
                name={getProviderIcon() as any}
                size={15}
                color={theme.primary}
              />
              <Text
                style={[styles.userPillText, { color: theme.text }]}
                numberOfLines={1}
              >
                {currentUser.name.split(' ')[0]}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <OfflineBanner
        isOffline={Boolean(
          lastSyncMessage &&
            (lastSyncMessage.includes('تعذر الاتصال بالخادم') ||
              lastSyncMessage.includes('لا يوجد اتصال'))
        )}
      />

      {lastSyncMessage && <Text accessibilityRole="alert" style={{ color: theme.text, backgroundColor: theme.surfaceSoft, padding: 10, textAlign: 'right' }}>{lastSyncMessage}</Text>}

      {/* Contextual Sub-Bar ONLY when inside unified tabs (Wallet or Relations) */}
      {(activeTab === 'expenses' || activeTab === 'accounts') && (
        <View
          style={[
            styles.subNavWrapper,
            {
              backgroundColor: theme.headerBg,
              borderBottomColor: theme.border,
            },
          ]}
        >
          <View
            style={[
              styles.subNavSegment,
              { backgroundColor: theme.cardAlt, borderColor: theme.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.subNavBtn,
                activeTab === 'expenses' && {
                  backgroundColor: theme.card,
                  borderColor: theme.primary,
                },
              ]}
              onPress={() => router.navigate(pathForSection('expenses'))}
            >
              <Ionicons
                name="receipt-outline"
                size={15}
                color={
                  activeTab === 'expenses' ? theme.primary : theme.textSecondary
                }
              />
              <Text
                style={[
                  styles.subNavBtnText,
                  {
                    color:
                      activeTab === 'expenses'
                        ? theme.primary
                        : theme.textSecondary,
                  },
                  activeTab === 'expenses' && { fontWeight: 'bold' },
                ]}
              >
                سحب مصروف والسجل
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.subNavBtn,
                activeTab === 'accounts' && {
                  backgroundColor: theme.card,
                  borderColor: theme.primary,
                },
              ]}
              onPress={() => router.navigate(pathForSection('accounts'))}
            >
              <Ionicons
                name="card-outline"
                size={15}
                color={
                  activeTab === 'accounts' ? theme.primary : theme.textSecondary
                }
              />
              <Text
                style={[
                  styles.subNavBtnText,
                  {
                    color:
                      activeTab === 'accounts'
                        ? theme.primary
                        : theme.textSecondary,
                  },
                  activeTab === 'accounts' && { fontWeight: 'bold' },
                ]}
              >
                حساباتي وخزائني ({state.accounts.length})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {(activeTab === 'contacts' || activeTab === 'procedures') && (
        <View
          style={[
            styles.subNavWrapper,
            {
              backgroundColor: theme.headerBg,
              borderBottomColor: theme.border,
            },
          ]}
        >
          <View
            style={[
              styles.subNavSegment,
              { backgroundColor: theme.cardAlt, borderColor: theme.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.subNavBtn,
                activeTab === 'contacts' && {
                  backgroundColor: theme.card,
                  borderColor: theme.primary,
                },
              ]}
              onPress={() => router.navigate(pathForSection('contacts'))}
            >
              <Ionicons
                name="people-outline"
                size={15}
                color={
                  activeTab === 'contacts' ? theme.primary : theme.textSecondary
                }
              />
              <Text
                style={[
                  styles.subNavBtnText,
                  {
                    color:
                      activeTab === 'contacts'
                        ? theme.primary
                        : theme.textSecondary,
                  },
                  activeTab === 'contacts' && { fontWeight: 'bold' },
                ]}
              >
                الأشخاص والمتعاملون ({state.contacts.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.subNavBtn,
                activeTab === 'procedures' && {
                  backgroundColor: theme.card,
                  borderColor: theme.primary,
                },
              ]}
              onPress={() => router.navigate(pathForSection('procedures'))}
            >
              <Ionicons
                name="briefcase-outline"
                size={15}
                color={
                  activeTab === 'procedures'
                    ? theme.primary
                    : theme.textSecondary
                }
              />
              <Text
                style={[
                  styles.subNavBtnText,
                  {
                    color:
                      activeTab === 'procedures'
                        ? theme.primary
                        : theme.textSecondary,
                  },
                  activeTab === 'procedures' && { fontWeight: 'bold' },
                ]}
              >
                الديون والإجراءات
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Main Content Screen Centered & Properly Sized */}
      <View style={[styles.screenWrapper, { backgroundColor: theme.bg }]}>
        <View style={styles.responsiveContentBox}>
          {children}
        </View>
      </View>

      {/* Bottom Navigation Bar (4 Spacious Tabs) */}
      <View
        style={[
          styles.bottomNav,
          {
            backgroundColor: theme.headerBg,
            borderTopColor: theme.border,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
      >
        <View style={styles.bottomNavInner}>
          {bottomNavItems.map((item) => {
            const isActive = item.matches.includes(activeTab);
            const iconName: keyof typeof Ionicons.glyphMap = isActive
              ? item.icon
              : (`${item.icon}-outline` as any);

            return (
              <Link key={item.id} href={pathForSection(item.defaultTab)} asChild>
              <TouchableOpacity
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{selected:isActive}}
                style={styles.navItem}
              >
                <View
                  style={[
                    styles.navIconWrap,
                    isActive && { backgroundColor: theme.primarySoft },
                  ]}
                >
                  <Ionicons
                    name={iconName}
                    size={20}
                    color={isActive ? theme.primary : theme.textSecondary}
                  />
                </View>
                <Text
                  style={[
                    styles.navLabel,
                    { color: isActive ? theme.primary : theme.textSecondary },
                    isActive && { fontWeight: 'bold' },
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
              </Link>
            );
          })}
        </View>
      </View>

      {/* Cloud Sync & Export Modal */}
      <CloudAndExportModal
        visible={cloudModalVisible}
        onClose={() => setCloudModalVisible(false)}
      />

      {/* User Profile & Logout Modal */}
      <Modal
        visible={profileModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileModalVisible(false)}
      >
        <View
          style={[styles.modalBackdrop, { backgroundColor: theme.overlay }]}
        >
          <View
            style={[
              styles.profileCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <View style={styles.profileTopRow}>
              <View
                style={[
                  styles.profileAvatar,
                  {
                    backgroundColor: theme.primarySoft,
                    borderColor: theme.primary,
                  },
                ]}
              >
                <Ionicons
                  name={getProviderIcon() as any}
                  size={24}
                  color={theme.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.profileName, { color: theme.text }]}>
                  {currentUser.name}
                </Text>
                <Text
                  style={[styles.profileEmail, { color: theme.textSecondary }]}
                >
                  {currentUser.email}
                </Text>
                <View
                  style={[
                    styles.providerBadge,
                    { backgroundColor: theme.blueSoft },
                  ]}
                >
                  <Text
                    style={[styles.providerBadgeText, { color: theme.blue }]}
                  >
                    مسجل عبر: {getProviderLabel()}
                  </Text>
                </View>
              </View>
            </View>

            <View
              style={[
                styles.profileInfoBox,
                {
                  backgroundColor: theme.cardAlt,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.profileInfoLabel,
                  { color: theme.textSecondary },
                ]}
              >
                حالة الحساب:
              </Text>
              <Text style={[styles.profileInfoVal, { color: theme.primary }]}>
                موثق
              </Text>
            </View>

            <TouchableOpacity
              style={{
                flexDirection: 'row-reverse',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: theme.primarySoft,
                borderWidth: 1,
                borderColor: theme.primary,
                marginBottom: 12,
              }}
              onPress={async () => {
                setProfileBusy(true);setProfileMessage(null);
                try { const res = await launchSocialOAuthWindow(
                  'google',
                  state.supabaseConfig
                );
                if (!('fallbackModal' in res) && res.success && res.user) {
                  loginUser(res.user);
                  setProfileModalVisible(false);
                } else if ('message' in res) setProfileMessage(res.message);
                } catch { setProfileMessage('تعذر بدء تسجيل الدخول. أعد المحاولة.'); }
                finally { setProfileBusy(false); }
              }}
              disabled={profileBusy}
              accessibilityRole="button"
              accessibilityState={{disabled:profileBusy,busy:profileBusy}}
            >
              <Ionicons name="logo-google" size={18} color="#EA4335" />
              <Text
                style={{
                  color: theme.primary,
                  fontWeight: 'bold',
                  fontSize: 13,
                }}
              >
                {profileBusy ? 'جارٍ فتح تسجيل الدخول…' : currentUser.provider === 'google'
                  ? 'تسجيل الدخول عبر Google'
                  : 'ربط حساب Google'}
              </Text>
            </TouchableOpacity>

            {profileMessage && <Text accessibilityRole="alert" style={{color:theme.text,textAlign:'right',marginBottom:12}}>{profileMessage}</Text>}

            <View style={styles.profileActions}>
              <TouchableOpacity
                style={[
                  styles.closeProfileBtn,
                  {
                    backgroundColor: theme.cardAlt,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setProfileModalVisible(false)}
              >
                <Text
                  style={[
                    styles.closeProfileBtnText,
                    { color: theme.textSecondary },
                  ]}
                >
                  إغلاق
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.logoutBtn, { backgroundColor: theme.danger }]}
                onPress={() => {
                  setProfileModalVisible(false);
                  void logoutUser();
                }}
                accessibilityRole="button"
                accessibilityLabel="تسجيل الخروج"
              >
                <Ionicons name="log-out-outline" size={18} color="#FFFFFF" />
                <Text style={styles.logoutBtnText}>تسجيل الخروج</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Legacy Vault Migration Modal */}
      <LegacyVaultMigrationModal
        visible={Boolean(legacyVaultPendingMigration)}
        summary={legacyVaultPendingMigration}
        isMigrating={isMigratingLegacy}
        stepStatus={migrationStepStatus}
        errorMessage={migrationError}
        onStartMigration={performLegacyVaultMigration}
        onCancelOrLogout={cancelLegacyVaultMigration}
      />

      {/* System Owner Admin Dashboard Modal */}
      <Modal
        visible={adminModalVisible && adminAuthorized}
        animationType="slide"
        onRequestClose={() => setAdminModalVisible(false)}
      >
        <AdminDashboardScreen onClose={() => setAdminModalVisible(false)} />
      </Modal>
    </SafeAreaView>
    </VaultActionsProvider>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  topHeader: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  headerInner: {
    width: '100%',
    maxWidth: 780,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  logoBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  headerActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  headerActionsSmall: {
    gap: 4,
  },
  iconActionBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  userPill: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 110,
  },
  userPillCompact: {
    maxWidth: 80,
    paddingHorizontal: 6,
  },
  userPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cloudPill: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 24,
    borderWidth: 1,
  },
  cloudPillCompact: {
    paddingHorizontal: 12,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  cloudPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  subNavWrapper: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  subNavSegment: {
    width: '100%',
    maxWidth: 780,
    flexDirection: 'row-reverse',
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  subNavBtn: {
    minHeight: MIN_TOUCH_TARGET,
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  subNavBtnText: {
    fontSize: 12,
  },
  screenWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  responsiveContentBox: {
    flex: 1,
    width: '100%',
    maxWidth: 780,
  },
  bottomNav: {
    borderTopWidth: 1,
    paddingVertical: 6,
    alignItems: 'center',
  },
  bottomNavInner: {
    width: '100%',
    maxWidth: 780,
    flexDirection: 'row-reverse',
    justifyContent: 'space-around',
  },
  navItem: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  navIconWrap: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 14,
  },
  navLabel: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
    lineHeight: 14,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  profileCard: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  profileTopRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  profileAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  profileEmail: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 2,
  },
  providerBadge: {
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
  },
  providerBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  profileInfoBox: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  profileInfoLabel: {
    fontSize: 11,
    textAlign: 'right',
  },
  profileInfoVal: {
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
    marginTop: 4,
  },
  profileActions: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  closeProfileBtn: {
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeProfileBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  logoutBtn: {
    minHeight: MIN_TOUCH_TARGET,
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  logoutBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
