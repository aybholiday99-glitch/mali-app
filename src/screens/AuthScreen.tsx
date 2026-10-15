import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MIN_TOUCH_TARGET } from '../theme/responsive';
import { AuthUser, SupabaseConfig } from '../types/mali';
import { useMali } from '../context/MaliContext';
import {
  launchSocialOAuthWindow,
  resetUserPasswordLocal,
  signInWithEmail,
  signUpWithEmail,
} from '../services/authService';

interface AuthScreenProps {
  supabaseConfig: SupabaseConfig;
  onAuthenticated: (user: AuthUser) => void;
  onOpenCloudConfig?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  supabaseConfig,
  onAuthenticated,
}) => {
  const { theme, isDarkMode, toggleTheme } = useMali();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleEmailAuth = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setErrorMessage('الرقم السري وتأكيد الرقم السري غير متطابقين.');
        return;
      }
      setLoading(true);
      try {
        const res = await signUpWithEmail(
          { name: fullName, email, password, phone },
          supabaseConfig
        );
        if (!res.success || !res.user) {
          setErrorMessage(res.message);
        } else {
          onAuthenticated(res.user);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'login') {
      setLoading(true);
      try {
        const res = await signInWithEmail({ email, password }, supabaseConfig);
        if (!res.success || !res.user) {
          setErrorMessage(res.message);
        } else {
          onAuthenticated(res.user);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'forgot') {
      setLoading(true);
      try {
        const res = await resetUserPasswordLocal(email, password, supabaseConfig);
        if (!res.success) {
          setErrorMessage(res.message);
        } else {
          setSuccessMessage(res.message);
          setMode('login');
        }
      } finally {
        setLoading(false);
      }
    }
  };

  const handleOpenSocialLogin = async (provider: 'google' | 'facebook') => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoading(true);
    try {
      const popupResult = await launchSocialOAuthWindow(
        provider,
        supabaseConfig
      );
      if (popupResult.success && popupResult.user) {
        onAuthenticated(popupResult.user);
      } else if (popupResult.message) {
        setErrorMessage(popupResult.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: theme.bg }]}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
      <View
        style={[
          styles.authCard,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        {/* Theme Toggle in Top Left */}
        <View style={styles.topUtilityRow}>
          <TouchableOpacity
            style={[
              styles.themeToggleBtn,
              { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
            ]}
            onPress={toggleTheme}
          >
            <Ionicons
              name={isDarkMode ? 'sunny-outline' : 'moon-outline'}
              size={16}
              color={theme.primary}
            />
            <Text style={[styles.themeToggleText, { color: theme.textSecondary }]}>
              {isDarkMode ? 'الوضع النهاري الهادئ' : 'الوضع الليلي'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Brand Logo & Title */}
        <View style={styles.brandSection}>
          <View
            style={[styles.logoCircle, { backgroundColor: theme.primarySoft }]}
          >
            <Ionicons name="wallet-outline" size={32} color={theme.primary} />
          </View>
          <Text style={[styles.brandTitle, { color: theme.text }]}>
            تطبيق مالي | MALI
          </Text>
          <Text style={[styles.brandSub, { color: theme.textMuted }]}>
            إدارة هادئة وبسيطة لمصاريفك، حساباتك المصرفية، وتداولات الدولار
          </Text>
        </View>

        {/* Mode Switch Tabs */}
        <View
          style={[
            styles.modeTabs,
            { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.modeTab,
              mode === 'login' && { backgroundColor: theme.primary },
            ]}
            onPress={() => {
              setMode('login');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
          >
            <Text
              style={[
                styles.modeTabText,
                { color: mode === 'login' ? '#FFFFFF' : theme.textSecondary },
              ]}
            >
              تسجيل الدخول
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeTab,
              mode === 'register' && { backgroundColor: theme.primary },
            ]}
            onPress={() => {
              setMode('register');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
          >
            <Text
              style={[
                styles.modeTabText,
                {
                  color: mode === 'register' ? '#FFFFFF' : theme.textSecondary,
                },
              ]}
            >
              إنشاء حساب جديد
            </Text>
          </TouchableOpacity>
        </View>

        {/* Error / Success Alerts */}
        {errorMessage ? (
          <View
            style={[
              styles.alertBanner,
              {
                backgroundColor: theme.dangerSoft,
                borderColor: theme.danger,
              },
            ]}
          >
            <Ionicons name="alert-circle" size={18} color={theme.danger} />
            <Text style={[styles.alertBannerText, { color: theme.danger }]}>
              {errorMessage}
            </Text>
          </View>
        ) : null}

        {successMessage ? (
          <View
            style={[
              styles.alertBanner,
              {
                backgroundColor: theme.successSoft,
                borderColor: theme.success,
              },
            ]}
          >
            <Ionicons name="checkmark-circle" size={18} color={theme.success} />
            <Text style={[styles.alertBannerText, { color: theme.success }]}>
              {successMessage}
            </Text>
          </View>
        ) : null}

        {/* Email & Password Form */}
        {mode === 'register' && (
          <>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              الاسم الكامل
            </Text>
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
              ]}
            >
              <Ionicons name="person-outline" size={18} color={theme.textMuted} />
              <TextInput
                style={[styles.input, { color: theme.text }]}
                value={fullName}
                onChangeText={setFullName}
                placeholder="مثال: صلاح الليبي"
                placeholderTextColor={theme.textMuted}
              />
            </View>
          </>
        )}

        <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
          البريد الإلكتروني
        </Text>
        <View
          style={[
            styles.inputWrapper,
            { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
          ]}
        >
          <Ionicons name="mail-outline" size={18} color={theme.textMuted} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            placeholderTextColor={theme.textMuted}
          />
        </View>

        {mode === 'register' && (
          <>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              رقم الهاتف (اختياري)
            </Text>
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
              ]}
            >
              <Ionicons name="call-outline" size={18} color={theme.textMuted} />
              <TextInput
                style={[styles.input, { color: theme.text }]}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                placeholder="091-XXXXXXX"
                placeholderTextColor={theme.textMuted}
              />
            </View>
          </>
        )}

        <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
          {mode === 'forgot'
            ? 'الرقم السري الجديد (6 خانات على الأقل)'
            : 'الرقم السري'}
        </Text>
        <View
          style={[
            styles.inputWrapper,
            { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
          ]}
        >
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={theme.textMuted}
            />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { color: theme.text }]}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={theme.textMuted}
          />
          <Ionicons
            name="lock-closed-outline"
            size={18}
            color={theme.textMuted}
          />
        </View>

        {mode === 'register' && (
          <>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              تأكيد الرقم السري
            </Text>
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
              ]}
            >
              <TextInput
                style={[styles.input, { color: theme.text }]}
                secureTextEntry={!showPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="أعد كتابة الرقم السري..."
                placeholderTextColor={theme.textMuted}
              />
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={theme.textMuted}
              />
            </View>
          </>
        )}

        {mode === 'login' && (
          <TouchableOpacity
            style={styles.forgotLinkRow}
            onPress={() => {
              setMode('forgot');
              setErrorMessage(null);
            }}
          >
            <Text style={[styles.forgotLinkText, { color: theme.primary }]}>
              نسيت الرقم السري؟
            </Text>
          </TouchableOpacity>
        )}

        {/* Primary Submit Button */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: theme.primary }]}
          accessibilityRole="button"
          accessibilityLabel={mode === 'register' ? 'إنشاء الحساب والدخول' : mode === 'forgot' ? 'تحديث الرقم السري' : 'تسجيل الدخول بالبريد الإلكتروني'}
          onPress={handleEmailAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons
              name={
                mode === 'register'
                  ? 'person-add-outline'
                  : mode === 'forgot'
                  ? 'key-outline'
                  : 'log-in-outline'
              }
              size={20}
              color="#FFFFFF"
            />
          )}
          <Text style={styles.submitBtnText}>
            {mode === 'register'
              ? 'إنشاء الحساب والدخول'
              : mode === 'forgot'
              ? 'تحديث الرقم السري'
              : 'تسجيل الدخول بالبريد الإلكتروني'}
          </Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View
            style={[styles.dividerLine, { backgroundColor: theme.border }]}
          />
          <Text style={[styles.dividerText, { color: theme.textMuted }]}>
            أو التسجيل السريع عبر
          </Text>
          <View
            style={[styles.dividerLine, { backgroundColor: theme.border }]}
          />
        </View>

        {/* Social Buttons */}
        <View style={styles.socialButtonsCol}>
          <TouchableOpacity
            style={[
              styles.googleBtn,
              {
                backgroundColor: theme.surfaceSoft,
                borderColor: theme.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="المتابعة باستخدام Google"
            onPress={() => handleOpenSocialLogin('google')}
          >
            <Ionicons name="logo-google" size={18} color="#EA4335" />
            <Text style={[styles.googleBtnText, { color: theme.text }]}>
              المتابعة باستخدام Google
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.facebookBtn}
            accessibilityRole="button"
            accessibilityLabel="المتابعة باستخدام Facebook"
            onPress={() => handleOpenSocialLogin('facebook')}
          >
            <Ionicons name="logo-facebook" size={20} color="#FFFFFF" />
            <Text style={styles.facebookBtnText}>
              المتابعة باستخدام Facebook
            </Text>
          </TouchableOpacity>

          {/* Security Notice: Verified Account Required */}
          <View
            style={[
              styles.accountRequiredBox,
              {
                backgroundColor: theme.surfaceSoft,
                borderColor: theme.border,
              },
            ]}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={theme.primary} />
            <Text style={[styles.accountRequiredText, { color: theme.textSecondary }]}>
              لحماية بياناتك المالية، يلزم تسجيل الدخول أو إنشاء حساب للوصول إلى الخزنة.
            </Text>
          </View>
        </View>
      </View>


  </ScrollView>
</KeyboardAvoidingView>
);
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 18,
  },
  authCard: {
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  topUtilityRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 4,
  },
  themeToggleBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
  },
  themeToggleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 18,
  },
  logoCircle: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  brandSub: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  modeTabs: {
    flexDirection: 'row-reverse',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    borderRadius: 9,
    alignItems: 'center',
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  alertBanner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  alertBannerText: {
    fontSize: 12,
    flex: 1,
    textAlign: 'right',
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: 5,
    marginTop: 8,
  },
  inputWrapper: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'right',
  },
  forgotLinkRow: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  forgotLinkText: {
    fontSize: 12,
    fontWeight: '600',
  },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    minHeight: MIN_TOUCH_TARGET,
    marginTop: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  dividerRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 11,
  },
  socialButtonsCol: {
    gap: 10,
  },
  googleBtn: {
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
  },
  googleBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  facebookBtn: {
    backgroundColor: '#1877F2',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  facebookBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  accountRequiredBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  accountRequiredText: {
    fontSize: 12,
    flex: 1,
    textAlign: 'right',
    lineHeight: 18,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    maxWidth: 440,
    maxHeight: '90%',
    width: '100%',
    alignSelf: 'center',
  },
  socialModalHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  socialBadgeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  modalSub: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 2,
  },
  oauthBrowserBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  oauthBrowserBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row-reverse',
    justifyContent: 'flex-start',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  confirmSocialBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmSocialBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
