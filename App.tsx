import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MaliProvider, useMali } from './src/context/MaliContext';
import { AuthScreen } from './src/screens/AuthScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { AccountsScreen } from './src/screens/AccountsScreen';
import { UsdDealsScreen } from './src/screens/UsdDealsScreen';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { ExpensesScreen } from './src/screens/ExpensesScreen';
import { ProceduresDebtsScreen } from './src/screens/ProceduresDebtsScreen';
import { CloudAndExportModal } from './src/screens/CloudAndExportModal';
import { launchSocialOAuthWindow } from './src/services/authService';

type TabKey =
  | 'dashboard'
  | 'accounts'
  | 'deals'
  | 'contacts'
  | 'expenses'
  | 'procedures';

const MainAppShell: React.FC = () => {
  const {
    state,
    theme,
    isDarkMode,
    toggleTheme,
    currentUser,
    isLoading,
    isSyncing,
    lastSyncMessage,
    loginUser,
    logoutUser,
  } = useMali();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [cloudModalVisible, setCloudModalVisible] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);

  const isCloudConfigured = !currentUser?.isLocalOnly && Boolean(
    state.supabaseConfig.url.trim() && state.supabaseConfig.anonKey.trim()
  );

  if (isLoading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.headerBg }}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={{ color: theme.text, marginTop: 12 }}>جارٍ تحميل خزنتك…</Text>
    </View>;
  }

  if (!currentUser) {
    return (
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: theme.headerBg }]}
      >
        <StatusBar
          barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          backgroundColor={theme.headerBg}
        />
        <AuthScreen
          supabaseConfig={state.supabaseConfig}
          onAuthenticated={(user) => loginUser(user)}
          onOpenCloudConfig={() => setCloudModalVisible(true)}
        />
        <CloudAndExportModal
          visible={cloudModalVisible}
          onClose={() => setCloudModalVisible(false)}
        />
      </SafeAreaView>
    );
  }

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
    if (currentUser.provider === 'google') return 'حساب Google';
    if (currentUser.provider === 'facebook') return 'حساب Facebook';
    return 'بريد إلكتروني';
  };

  return (
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

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[
                styles.iconActionBtn,
                {
                  backgroundColor: theme.cardAlt,
                  borderColor: theme.border,
                },
              ]}
              onPress={toggleTheme}
            >
              <Ionicons
                name={isDarkMode ? 'sunny-outline' : 'moon-outline'}
                size={16}
                color={isDarkMode ? '#FBBF24' : theme.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.cloudPill,
                {
                  backgroundColor: isCloudConfigured
                    ? theme.primarySoft
                    : theme.cardAlt,
                  borderColor: isCloudConfigured ? theme.primary : theme.border,
                },
              ]}
              onPress={() => setCloudModalVisible(true)}
            >
              <Ionicons
                name="cloud-outline"
                size={15}
                color={isCloudConfigured ? theme.primary : theme.blue}
              />
              <Text
                style={[
                  styles.cloudPillText,
                  {
                    color: isCloudConfigured
                      ? theme.primary
                      : theme.textSecondary,
                  },
                ]}
              >
                {currentUser?.isLocalOnly ? 'محلي / تصدير' : isSyncing ? 'المزامنة…' : isCloudConfigured ? 'السحابة / تصدير' : 'إعدادات السحابة'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.userPill,
                {
                  backgroundColor: theme.cardAlt,
                  borderColor: theme.border,
                },
              ]}
              onPress={() => setProfileModalVisible(true)}
            >
              <Ionicons
                name={getProviderIcon() as any}
                size={14}
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
              onPress={() => setActiveTab('expenses')}
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
              onPress={() => setActiveTab('accounts')}
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
              onPress={() => setActiveTab('contacts')}
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
              onPress={() => setActiveTab('procedures')}
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
          {activeTab === 'dashboard' && (
            <DashboardScreen
              onNavigate={(tab) => setActiveTab(tab as TabKey)}
              onOpenExportModal={() => setCloudModalVisible(true)}
            />
          )}
          {activeTab === 'accounts' && <AccountsScreen />}
          {activeTab === 'deals' && <UsdDealsScreen />}
          {activeTab === 'contacts' && <ContactsScreen />}
          {activeTab === 'expenses' && <ExpensesScreen />}
          {activeTab === 'procedures' && <ProceduresDebtsScreen />}
        </View>
      </View>

      {/* Bottom Navigation Bar (4 Spacious Tabs) */}
      <View
        style={[
          styles.bottomNav,
          {
            backgroundColor: theme.headerBg,
            borderTopColor: theme.border,
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
              <TouchableOpacity
                key={item.id}
                style={styles.navItem}
                onPress={() => setActiveTab(item.defaultTab)}
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
                معرف الخزنة السحابية المرتبط بحسابك:
              </Text>
              <Text style={[styles.profileInfoVal, { color: theme.primary }]}>
                {state.supabaseConfig.workspaceKey}
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
                const res = await launchSocialOAuthWindow(
                  'google',
                  state.supabaseConfig
                );
                if (!('fallbackModal' in res) && res.success && res.user) {
                  loginUser(res.user);
                  setProfileModalVisible(false);
                }
              }}
            >
              <Ionicons name="logo-google" size={18} color="#EA4335" />
              <Text
                style={{
                  color: theme.primary,
                  fontWeight: 'bold',
                  fontSize: 13,
                }}
              >
                {currentUser.provider === 'google'
                  ? 'مزامنة فورية مع حساب Google و Supabase'
                  : 'ربط ومزامنة مع حساب Google الفعلي'}
              </Text>
            </TouchableOpacity>

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
                  logoutUser();
                }}
              >
                <Ionicons name="log-out-outline" size={18} color="#FFFFFF" />
                <Text style={styles.logoutBtnText}>تسجيل الخروج</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <MaliProvider>
      <MainAppShell />
    </MaliProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
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
  iconActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  userPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 110,
  },
  userPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cloudPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
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
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
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
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 18 : 10,
    alignItems: 'center',
  },
  bottomNavInner: {
    width: '100%',
    maxWidth: 780,
    flexDirection: 'row-reverse',
    justifyContent: 'space-around',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: 4,
  },
  navIconWrap: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
  },
  navLabel: {
    fontSize: 11,
    marginTop: 3,
    fontWeight: '500',
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
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
  },
  closeProfileBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  logoutBtn: {
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
