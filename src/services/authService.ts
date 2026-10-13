import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { SerialQueue } from './serialQueue';
import { clearAuthTokenStorage, getAuthTokenStorage } from './authTokenStorage';
import { isAuthStorageKey, mayRemoveLegacyAuthValue } from './nativeAuthStorageCore';
import { NATIVE_OAUTH_REDIRECT, nativeOAuthFailure, performNativeOAuth, type NativeOAuthFailure } from './nativeOAuthCore';
import { INITIAL_MALI_STATE } from '../data/initialData';
import { AuthProviderType, AuthUser, SupabaseConfig } from '../types/mali';

const DEFAULT_SUPABASE_URL = INITIAL_MALI_STATE.supabaseConfig.url;
const DEFAULT_SUPABASE_ANON_KEY = INITIAL_MALI_STATE.supabaseConfig.anonKey;

const MALI_AUTH_SESSION_KEY = 'mali_auth_session_v2';
const LEGACY_STORAGE_KEYS = [
  'mali_local_users_registry_v1',
  'mali_auth_session_v1',
  '@mali_users_db_v1',
  '@mali_current_user_v1',
];

const COMMON_WEAK_PASSWORDS = new Set([
  '123456',
  '12345678',
  '123456789',
  'password',
  'password123',
  'qwerty123',
  '11111111',
  '00000000',
  'admin123',
  'iloveyou',
]);

export interface AuthResponse {
  success: boolean;
  ok?: boolean;
  message: string;
  user?: AuthUser;
  failureKind?: NativeOAuthFailure;
}

let sharedClient: SupabaseClient | null = null;
let sharedClientKey = '';
const authOperations = new SerialQueue();
let oauthCallbackInFlight: Promise<AuthUser | null> | null = null;
let nativeAuthGeneration = 0;
let nativeOAuthAttempt: { controller: AbortController; key: string; promise: Promise<AuthResponse>; accepted: boolean } | null = null;
function cancelNativeOAuth() { nativeAuthGeneration++; nativeOAuthAttempt?.controller.abort(); }

function authStorageKey(url: string) {
  return 'mali_supabase_auth_' + new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
}

function sanitizeConfig(config?: Partial<SupabaseConfig>): { url: string; anonKey: string } {
  const url = (config?.url || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, '');
  const anonKey = (config?.anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();
  return { url, anonKey };
}

/**
 * عميل Supabase الموحد مع تفعيل تدفق PKCE الآمن وإدارة الجلسات الموثقة
 */
export function getSharedSupabaseClient(config?: Partial<SupabaseConfig>): SupabaseClient {
  const { url, anonKey } = sanitizeConfig(config);
  const key = `${url}::${anonKey}`;
  if (!sharedClient || sharedClientKey !== key) {
    if (nativeOAuthAttempt && sharedClientKey !== key) cancelNativeOAuth();
    sharedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storage: getAuthTokenStorage(authStorageKey(url)),
        storageKey: authStorageKey(url),
      },
    });
    sharedClientKey = key;
  }
  return sharedClient;
}

function mapSupabaseUserToAuthUser(user: User, fallbackProvider?: AuthProviderType): AuthUser {
  const meta = user.user_metadata || {};
  const appMeta = user.app_metadata || {};
  const rawProvider = String(appMeta.provider || fallbackProvider || 'email').toLowerCase();
  const provider: AuthProviderType =
    rawProvider === 'google' ? 'google' : rawProvider === 'facebook' ? 'facebook' : 'email';

  const email = (user.email || meta.email || '').trim().toLowerCase();
  const displayName =
    meta.full_name ||
    meta.name ||
    (email ? email.split('@')[0] : 'مستخدم مالي');

  return {
    id: user.id,
    name: String(displayName),
    email,
    phone: user.phone || meta.phone || undefined,
    avatarUrl: meta.avatar_url || meta.picture || undefined,
    googleSub: provider === 'google' ? String(meta.sub || meta.provider_id || '') || undefined : undefined,
    googleSyncedAt: new Date().toISOString(),
    provider,
    isLocalOnly: false,
    createdAt: user.created_at || new Date().toISOString(),
  };
}

export function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return {
      valid: false,
      message: 'يرجى اختيار كلمة مرور قوية لا تقل عن 8 أحرف لحماية بياناتك المالية.',
    };
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return {
      valid: false,
      message: 'كلمة المرور المختارة شائعة جداً وسهلة التخمين. يرجى اختيار كلمة مرور أقوى.',
    };
  }
  return { valid: true };
}

/**
 * تنظيف أي بيانات حساسة قديمة كانت مخزنة محلياً في الإصدارات السابقة
 */
export async function purgeLegacyInsecureStorage(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(LEGACY_STORAGE_KEYS);
  } catch {
    // ignore cleanup errors
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    for (const k of LEGACY_STORAGE_KEYS) {
      try {
        window.localStorage.removeItem(k);
      } catch {
        // ignore
      }
    }
  }
}

async function saveLocalSessionSummary(user: AuthUser): Promise<void> {
  const safeSummary: AuthUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    provider: user.provider,
    isLocalOnly: Boolean(user.isLocalOnly),
    createdAt: user.createdAt,
  };
  await AsyncStorage.setItem(MALI_AUTH_SESSION_KEY, JSON.stringify(safeSummary));
}

/**
 * استرجاع الجلسة الموثقة حصرياً عبر التحقق من جلسة Supabase Auth النشطة
 * لا يتم منح أي صلاحيات سحابية من بيانات محلية قابلة للتعديل
 */
export async function getStoredAuthSession(config?: Partial<SupabaseConfig>): Promise<AuthUser | null> {
  await purgeLegacyInsecureStorage();

  try {
    const supabase = getSharedSupabaseClient(config);
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (!sessionError && sessionData?.session?.user) {
      const expiresAt = sessionData.session.expires_at;
      if (expiresAt && expiresAt * 1000 < Date.now() - 60_000) {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr || !refreshed?.session?.user) {
          await clearAuthSession(config);
          return null;
        }
        const verifiedRefreshed = mapSupabaseUserToAuthUser(refreshed.session.user);
        await saveLocalSessionSummary(verifiedRefreshed);
        return verifiedRefreshed;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!userError && userData?.user) {
        const verifiedUser = mapSupabaseUserToAuthUser(userData.user);
        await saveLocalSessionSummary(verifiedUser);
        return verifiedUser;
      }
      return null;
    }

    const rawLocal = await AsyncStorage.getItem(MALI_AUTH_SESSION_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal) as AuthUser;
      if (parsed && parsed.isLocalOnly === true && parsed.id === 'local-offline-guest') {
        return parsed;
      }
      await AsyncStorage.removeItem(MALI_AUTH_SESSION_KEY);
    }
  } catch {
    // ignore
  }
  return null;
}

export async function getPersistedSessionUser(config?: Partial<SupabaseConfig>): Promise<AuthUser | null> {
  return getStoredAuthSession(config);
}

async function clearAuthSessionImpl(config?: Partial<SupabaseConfig>): Promise<void> {
  await purgeLegacyInsecureStorage();
  try {
    const supabase = getSharedSupabaseClient(config);
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // ignore network errors on signOut
  }
  // Cleanup failures must reach the caller; successful local sign-out must not
  // be reported while credentials remain usable in secure/legacy storage.
  const { url } = sanitizeConfig(config);
  let cleanupFailed = false;
  try { await clearAuthTokenStorage(authStorageKey(url)); } catch { cleanupFailed = true; }
  try {
    const legacyKeys = [MALI_AUTH_SESSION_KEY, 'mali_supabase_auth_token'];
    for (const key of await AsyncStorage.getAllKeys()) {
      if (isAuthStorageKey('mali_supabase_auth_token', key)
        && mayRemoveLegacyAuthValue('mali_supabase_auth_token', key, await AsyncStorage.getItem(key))) legacyKeys.push(key);
    }
    await AsyncStorage.multiRemove(legacyKeys);
  } catch { cleanupFailed = true; }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(MALI_AUTH_SESSION_KEY);
    } catch {
      // ignore
    }
  }
  if (cleanupFailed) throw new Error('تعذر تأكيد إزالة بيانات الدخول من الجهاز. يرجى إعادة محاولة تسجيل الخروج.');
}

export async function savePersistedSessionUser(
  user: AuthUser | null,
  config?: Partial<SupabaseConfig>
): Promise<void> {
  if (!user) {
    await clearAuthSession(config);
    return;
  }
  if (user.isLocalOnly) {
    await saveLocalSessionSummary({
      ...user,
      id: 'local-offline-guest',
      isLocalOnly: true,
    });
    return;
  }
  // لا يتم حفظ مستخدم سحابي إلا إذا كانت جلسة Supabase Auth مطابقة له فعلياً
  const supabase = getSharedSupabaseClient(config);
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user && data.session.user.id === user.id) {
    await saveLocalSessionSummary({ ...user, isLocalOnly: false });
  }
}

/**
 * الدخول في وضع الضيف المحلي فقط (Offline Guest Mode)
 * معزول تماماً ولا يمنح أي صلاحيات وصول إلى قاعدة البيانات السحابية
 */
async function startOfflineGuestSessionImpl(): Promise<AuthUser> {
  await purgeLegacyInsecureStorage();
  const guestUser: AuthUser = {
    id: 'local-offline-guest',
    name: 'وضع محلي (بدون مزامنة سحابية)',
    email: 'offline@local.device',
    provider: 'email',
    isLocalOnly: true,
    createdAt: new Date().toISOString(),
  };
  await saveLocalSessionSummary(guestUser);
  return guestUser;
}

/**
 * إنشاء حساب جديد حصرياً عبر Supabase Auth الرسمي
 */
async function registerWithEmailImpl(
  name: string,
  email: string,
  password: string,
  phone: string | undefined,
  config?: Partial<SupabaseConfig>
): Promise<AuthResponse> {
  await purgeLegacyInsecureStorage();

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();

  if (!cleanName) {
    return { success: false, ok: false, message: 'يرجى إدخال الاسم الكامل.' };
  }
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, ok: false, message: 'يرجى إدخال بريد إلكتروني صحيح.' };
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    return {
      success: false,
      ok: false,
      message: strength.message || 'كلمة المرور غير صالحة.',
    };
  }

  try {
    const supabase = getSharedSupabaseClient(config);
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: cleanName,
          phone: phone?.trim() || '',
        },
      },
    });

    if (error) {
      if (error.message.toLowerCase().includes('already registered')) {
        return {
          success: false,
          ok: false,
          message: 'هذا البريد الإلكتروني مسجل مسبقاً. يرجى تسجيل الدخول أو استعادة كلمة المرور.',
        };
      }
      return {
        success: false,
        ok: false,
        message: `تعذر إنشاء الحساب: ${error.message}`,
      };
    }

    if (!data?.user) {
      return {
        success: false,
        ok: false,
        message: 'لم يتم إرجاع بيانات المستخدم من الخادم. يرجى المحاولة مرة أخرى.',
      };
    }

    if (!data.session) {
      const signInRes = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (signInRes.error || !signInRes.data?.user) {
        return {
          success: false,
          ok: false,
          message: 'تم إنشاء الحساب. يرجى تأكيد البريد الإلكتروني ثم تسجيل الدخول.',
        };
      }
      const verifiedUser = mapSupabaseUserToAuthUser(signInRes.data.user, 'email');
      await saveLocalSessionSummary(verifiedUser);
      return {
        success: true,
        ok: true,
        user: verifiedUser,
        message: 'تم إنشاء حسابك السحابي بنجاح.',
      };
    }

    const verifiedUser = mapSupabaseUserToAuthUser(data.user, 'email');
    await saveLocalSessionSummary(verifiedUser);
    return {
      success: true,
      ok: true,
      user: verifiedUser,
      message: 'تم إنشاء حسابك السحابي بنجاح.',
    };
  } catch (e: any) {
    return {
      success: false,
      ok: false,
      message: `تعذر الاتصال بخادم المصادقة السحابي: ${e?.message || 'تحقق من اتصالك بالإنترنت'}`,
    };
  }
}

export async function signUpWithEmail(
  params: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  },
  supabaseConfig?: Partial<SupabaseConfig>
): Promise<AuthResponse> {
  return registerWithEmail(params.name, params.email, params.password, params.phone, supabaseConfig);
}

/**
 * تسجيل الدخول بالبريد الإلكتروني وكلمة المرور حصرياً عبر Supabase Auth الرسمي
 */
async function loginWithEmailImpl(
  email: string,
  password: string,
  config?: Partial<SupabaseConfig>
): Promise<AuthResponse> {
  await purgeLegacyInsecureStorage();

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, ok: false, message: 'يرجى إدخال بريد إلكتروني صحيح.' };
  }
  if (!password) {
    return { success: false, ok: false, message: 'يرجى إدخال كلمة المرور.' };
  }

  try {
    const supabase = getSharedSupabaseClient(config);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error || !data?.user || !data?.session) {
      return {
        success: false,
        ok: false,
        message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      };
    }

    const verifiedUser = mapSupabaseUserToAuthUser(data.user, 'email');
    await saveLocalSessionSummary(verifiedUser);
    return {
      success: true,
      ok: true,
      user: verifiedUser,
      message: 'تم تسجيل الدخول السحابي بنجاح.',
    };
  } catch (e: any) {
    return {
      success: false,
      ok: false,
      message: `تعذر الاتصال بخادم المصادقة: ${e?.message || 'تحقق من اتصالك بالإنترنت'}`,
    };
  }
}

export async function signInWithEmail(
  params: {
    email: string;
    password: string;
  },
  supabaseConfig?: Partial<SupabaseConfig>
): Promise<AuthResponse> {
  return loginWithEmail(params.email, params.password, supabaseConfig);
}

/**
 * إرسال طلب رسمي لإعادة تعيين كلمة المرور عبر البريد الإلكتروني (Supabase Auth Reset Flow)
 */
export async function resetPasswordByEmail(
  email: string,
  config?: Partial<SupabaseConfig>
): Promise<AuthResponse> {
  await purgeLegacyInsecureStorage();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, ok: false, message: 'يرجى إدخال بريد إلكتروني صحيح.' };
  }

  try {
    const supabase = getSharedSupabaseClient(config);
    const redirectTo =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo,
    });

    if (error) {
      return {
        success: false,
        ok: false,
        message: `تعذر إرسال رابط استعادة كلمة المرور: ${error.message}`,
      };
    }

    return {
      success: true,
      ok: true,
      message:
        'تم إرسال رابط آمن لإعادة تعيين كلمة المرور إلى بريدك الإلكتروني عبر Supabase Auth.',
    };
  } catch (e: any) {
    return {
      success: false,
      ok: false,
      message: `تعذر الاتصال بخادم المصادقة: ${e?.message || 'خطأ في الشبكة'}`,
    };
  }
}

/**
 * تحديث كلمة المرور للمستخدم الموثّق حالياً عبر جلسة Supabase رسمية، أو إرسال رابط استعادة للبريد
 * يمنع تماماً تعديل كلمات المرور محلياً بدون مصادقة خادمية
 */
export async function resetUserPasswordLocal(
  email: string,
  newPassword?: string,
  supabaseConfig?: Partial<SupabaseConfig>
): Promise<AuthResponse> {
  await purgeLegacyInsecureStorage();
  const supabase = getSharedSupabaseClient(supabaseConfig);
  const { data: sessionData } = await supabase.auth.getSession();

  if (
    sessionData?.session?.user &&
    newPassword &&
    sessionData.session.user.email?.toLowerCase() === email.trim().toLowerCase()
  ) {
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return {
        success: false,
        ok: false,
        message: strength.message || 'كلمة المرور غير صالحة.',
      };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return {
        success: false,
        ok: false,
        message: `تعذر تحديث كلمة المرور: ${error.message}`,
      };
    }
    return {
      success: true,
      ok: true,
      message: 'تم تحديث كلمة المرور في حسابك السحابي بنجاح.',
    };
  }

  return resetPasswordByEmail(email, supabaseConfig);
}

/**
 * معالجة عودة نافذة OAuth (PKCE Code أو Session) والتحقق الصارم من المصدر (Origin)
 */
async function consumeOAuthRedirectImpl(
  supabaseConfig?: Partial<SupabaseConfig>
): Promise<AuthUser | null> {
  await purgeLegacyInsecureStorage();
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;

  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error_description') || url.searchParams.get('error');
  const hash = window.location.hash || '';
  const hasAuthParams =
    Boolean(code) ||
    Boolean(errorParam) ||
    hash.includes('access_token=') ||
    hash.includes('error=');

  if (!hasAuthParams) return null;

  const targetOrigin = window.location.origin;
  const supabase = getSharedSupabaseClient(supabaseConfig);

  try {
    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw new Error('تعذر إكمال التحقق من رابط الدخول.');
    }

    if (window.history?.replaceState) {
      window.history.replaceState(null, document.title, window.location.pathname);
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const verifiedUser =
      !userErr && userData?.user ? mapSupabaseUserToAuthUser(userData.user) : null;

    if (verifiedUser) {
      await saveLocalSessionSummary(verifiedUser);
    }

    if (window.opener && window.opener !== window) {
      window.opener.postMessage(
        {
          type: 'MALI_OAUTH_CALLBACK_COMPLETE',
          hasError: Boolean(errorParam) || !verifiedUser,
          errorMessage: errorParam || undefined,
        },
        targetOrigin
      );
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // ignore
        }
      }, 120);
    }

    return verifiedUser;
  } catch (err: any) {
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(
        {
          type: 'MALI_OAUTH_CALLBACK_COMPLETE',
          hasError: true,
          errorMessage: err?.message || 'فشل التحقق من جلسة OAuth',
        },
        targetOrigin
      );
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // ignore
        }
      }, 120);
    }
    return null;
  }
}

export function handleOAuthCallbackInWindow(config?: Partial<SupabaseConfig>): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const url = new URL(window.location.href);
  const hasAuthParams =
    url.searchParams.has('code') ||
    url.searchParams.has('error') ||
    (window.location.hash || '').includes('access_token=');
  if (!hasAuthParams) return false;
  void consumeOAuthRedirectIfPresent(config);
  return Boolean(window.opener && window.opener !== window);
}

/**
 * فتح نافذة مصادقة OAuth رسمية عبر Supabase Auth (PKCE Flow)
 * مع التحقق الصارم من event.origin و event.source ومنع أي مفاتيح سرية مضمنة
 */
export async function launchSocialOAuthWindow(
  provider: 'google' | 'facebook',
  supabaseConfig?: Partial<SupabaseConfig>
): Promise<AuthResponse> {
  if (Platform.OS !== 'web') return launchNativeSocialOAuth(provider, supabaseConfig);
  await purgeLegacyInsecureStorage();
  const providerLabel = provider === 'google' ? 'Google' : 'Facebook';

  try {
    const supabase = getSharedSupabaseClient(supabaseConfig);
    const redirectTo =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : NATIVE_OAUTH_REDIRECT;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      return {
        success: false,
        ok: false,
        message: `مزود الدخول عبر ${providerLabel} غير مفعّل حالياً في إعدادات Supabase Auth للمشروع. يرجى تفعيله من لوحة تحكم Supabase أو تسجيل الدخول بالبريد الإلكتروني وكلمة المرور.`,
      };
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.open === 'function') {
      // التحقق أولاً من إعدادات مزود الهوية على خادم Supabase قبل فتح النافذة
      const { url: baseUrl, anonKey } = sanitizeConfig(supabaseConfig);
      try {
        const settingsRes = await fetch(`${baseUrl}/auth/v1/settings`, {
          headers: { apikey: anonKey },
        });
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          const isEnabled = Boolean(settings?.external?.[provider]);
          if (!isEnabled) {
            return {
              success: false,
              ok: false,
              message: `مزود الدخول عبر ${providerLabel} متوقف حالياً في إعدادات مشروع Supabase لحماية الحسابات بعد تدوير المفاتيح. يرجى ضبط Client ID و Secret جديدين في لوحة تحكم Supabase Auth أو الدخول بالبريد الإلكتروني.`,
            };
          }
        }
      } catch {
        // المتابعة إلى تدفق PKCE الرسمي
      }

      const width = 500;
      const height = 650;
      const left = Math.max(0, Math.round((window.screen.width - width) / 2));
      const top = Math.max(0, Math.round((window.screen.height - height) / 2));
      const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no`;

      const popup = window.open(data.url, `mali_${provider}_pkce_oauth`, features);
      if (!popup) {
        window.location.assign(data.url);
        return {
          success: false,
          ok: false,
          message: `جاري التوجيه إلى بوابة ${providerLabel} الرسمية عبر Supabase Auth...`,
        };
      }

      return await new Promise<AuthResponse>((resolve) => {
        let settled = false;
        const expectedOrigin = window.location.origin;

        const finish = (res: AuthResponse) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMessage);
          clearInterval(pollTimer);
          try {
            if (!popup.closed) popup.close();
          } catch {
            // ignore
          }
          resolve(res);
        };

        const verifyFromSupabaseServer = async (errText?: string) => {
          if (errText) {
            finish({
              success: false,
              ok: false,
              message: `تعذر إكمال مصادقة ${providerLabel}: ${errText}`,
            });
            return;
          }
          const { data: userData, error: userErr } = await supabase.auth.getUser();
          if (userErr || !userData?.user) {
            finish({
              success: false,
              ok: false,
              message: `لم يتم التحقق من جلسة ${providerLabel} عبر خادم Supabase Auth.`,
            });
            return;
          }
          const verifiedUser = mapSupabaseUserToAuthUser(userData.user, provider);
          await saveLocalSessionSummary(verifiedUser);
          finish({
            success: true,
            ok: true,
            user: verifiedUser,
            message: `تم تسجيل الدخول وتوثيق جلسة ${providerLabel} عبر Supabase Auth بنجاح.`,
          });
        };

        const onMessage = (event: MessageEvent) => {
          // تحقق أمني صارم من origin و source لمنع استغلال postMessage
          if (event.origin !== expectedOrigin) return;
          if (event.source !== popup) return;
          if (!event.data || event.data.type !== 'MALI_OAUTH_CALLBACK_COMPLETE') return;

          void verifyFromSupabaseServer(
            event.data.hasError ? String(event.data.errorMessage || 'خطأ في المصادقة') : undefined
          );
        };

        window.addEventListener('message', onMessage);

        const pollTimer = setInterval(async () => {
          if (settled) return;
          if (popup.closed) {
            const { data: sessionCheck } = await supabase.auth.getSession();
            if (sessionCheck?.session?.user) {
              await verifyFromSupabaseServer();
            } else {
              finish({
                success: false,
                ok: false,
                message: `تم إغلاق نافذة تسجيل الدخول عبر ${providerLabel} قبل اكتمال المصادقة.`,
              });
            }
          }
        }, 600);
      });
    }

    return {
      success: false,
      ok: false,
      message: `يرجى استخدام متصفح يدعم نوافذ المصادقة الآمنة (PKCE) لتسجيل الدخول عبر ${providerLabel}.`,
    };
  } catch (e: any) {
    return {
      success: false,
      ok: false,
      message: `تعذر بدء مصادقة ${providerLabel}: ${e?.message || 'خطأ غير متوقع'}`,
    };
  }
}

function launchNativeSocialOAuth(provider: 'google' | 'facebook', config?: Partial<SupabaseConfig>): Promise<AuthResponse> {
  if (provider !== 'google' && provider !== 'facebook') return Promise.resolve(nativeOAuthFailure('provider'));
  const resolved = sanitizeConfig(config), key = `${provider}::${resolved.url}::${resolved.anonKey}`;
  if (nativeOAuthAttempt) return nativeOAuthAttempt.key === key ? nativeOAuthAttempt.promise : Promise.resolve(nativeOAuthFailure('busy'));
  let client: SupabaseClient;
  try { client = getSharedSupabaseClient(config); } catch { return Promise.resolve(nativeOAuthFailure('unavailable')); }
  const generation = ++nativeAuthGeneration, controller = new AbortController();
  const promise = (async () => {
    try {
      await purgeLegacyInsecureStorage();
      const { nativeOAuthBrowser } = await import('./nativeOAuthPlatform');
      return await performNativeOAuth({ client, provider, supabaseUrl: resolved.url, storageKey: authStorageKey(resolved.url),
        storage: getAuthTokenStorage(authStorageKey(resolved.url)), browser: nativeOAuthBrowser, signal: controller.signal,
        isCurrent: () => nativeAuthGeneration === generation && sharedClient === client,
        serialize: action => authOperations.run(action),
        acceptVerified: async user => { const verified = mapSupabaseUserToAuthUser(user, provider); await saveLocalSessionSummary(verified); return verified; },
      });
    } catch { return nativeOAuthFailure('unavailable'); }
  })().then(result => {
    if (result.success && (controller.signal.aborted || generation !== nativeAuthGeneration || sharedClient !== client)) return nativeOAuthFailure('stale');
    if (result.success && nativeOAuthAttempt?.controller === controller && !controller.signal.aborted && generation === nativeAuthGeneration) nativeOAuthAttempt.accepted = true;
    return result;
  }).finally(() => { if (nativeOAuthAttempt?.controller === controller) nativeOAuthAttempt = null; })
    .then(result => result.success && (controller.signal.aborted || generation !== nativeAuthGeneration || sharedClient !== client) ? nativeOAuthFailure('stale') : result);
  nativeOAuthAttempt = { controller, key, promise, accepted: false };
  return promise;
}

export async function signInWithSocialProvider(
  provider: 'google' | 'facebook',
  _profileInput?: { name?: string; email?: string } | SupabaseConfig,
  supabaseConfig?: Partial<SupabaseConfig>
): Promise<AuthResponse> {
  const resolvedConfig =
    _profileInput && 'url' in _profileInput ? (_profileInput as SupabaseConfig) : supabaseConfig;
  return launchSocialOAuthWindow(provider, resolvedConfig);
}

export function getSupabaseOAuthRedirectUrl(
  provider: AuthProviderType,
  supabaseConfig?: Partial<SupabaseConfig>
): string | null {
  const { url: baseUrl } = sanitizeConfig(supabaseConfig);
  if (!baseUrl || provider === 'email') return null;
  const redirectTo =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin + window.location.pathname
      : NATIVE_OAUTH_REDIRECT;
  return `${baseUrl}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(
    redirectTo
  )}`;
}

export function clearAuthSession(config?: Partial<SupabaseConfig>): Promise<void> {
  cancelNativeOAuth();
  return authOperations.run(() => clearAuthSessionImpl(config));
}

export function loginWithEmail(email: string, password: string, config?: Partial<SupabaseConfig>): Promise<AuthResponse> {
  cancelNativeOAuth();
  return authOperations.run(() => loginWithEmailImpl(email, password, config));
}

export function registerWithEmail(name: string, email: string, password: string, phone: string | undefined, config?: Partial<SupabaseConfig>): Promise<AuthResponse> {
  cancelNativeOAuth();
  return authOperations.run(() => registerWithEmailImpl(name, email, password, phone, config));
}

export function startOfflineGuestSession(): Promise<AuthUser> {
  cancelNativeOAuth();
  return authOperations.run(() => startOfflineGuestSessionImpl());
}

export function consumeOAuthRedirectIfPresent(config?: Partial<SupabaseConfig>): Promise<AuthUser | null> {
  if (!oauthCallbackInFlight) {
    oauthCallbackInFlight = authOperations.run(() => consumeOAuthRedirectImpl(config))
      .finally(() => { oauthCallbackInFlight = null; });
  }
  return oauthCallbackInFlight;
}

/** Auth events never await Supabase calls inside the library callback. */
export function subscribeToAuthIdentity(
  callback: (user: AuthUser | null) => void,
  config?: Partial<SupabaseConfig>
): () => void {
  const client = getSharedSupabaseClient(config);
  let active = true;
  let generation = 0;
  const { data } = client.auth.onAuthStateChange((event, session) => {
    const token = ++generation;
    if (event === 'SIGNED_OUT') { if (nativeOAuthAttempt) cancelNativeOAuth(); callback(null); return; }
    if (event !== 'SIGNED_IN' || !session?.user) return;
    const expectedId = session.user.id;
    const intentGeneration = nativeAuthGeneration;
    const nativeOwner = nativeOAuthAttempt;
    setTimeout(() => {
      if (!active || token !== generation) return;
      void client.auth.getUser().then(({ data: verified, error }) => {
        if (active && token === generation && intentGeneration === nativeAuthGeneration && (!nativeOwner || nativeOwner.accepted)
          && !error && verified.user?.id === expectedId) {
          callback(mapSupabaseUserToAuthUser(verified.user));
        }
      });
    }, 0);
  });
  return () => { active = false; generation++; data.subscription.unsubscribe(); };
}
