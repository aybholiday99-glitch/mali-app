import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AuthUser } from '../types/mali';
import type { StringStorage } from './nativeAuthStorageCore';

export const NATIVE_OAUTH_REDIRECT = 'mali://auth/callback';
export type NativeOAuthFailure = 'cancelled' | 'dismissed' | 'stale' | 'busy' | 'unsupported' | 'provider' | 'callback' | 'verification' | 'cleanup' | 'unavailable';
export interface NativeOAuthResult { success: boolean; ok: boolean; message: string; user?: AuthUser; failureKind?: NativeOAuthFailure }
export interface NativeOAuthBrowser {
  prepareRedirect(): string;
  open(url: string, redirect: string): Promise<{ type: string; url?: string }>;
  dismiss(): void;
}
interface Dependencies {
  client: SupabaseClient;
  provider: 'google' | 'facebook';
  supabaseUrl: string;
  storageKey: string;
  storage: StringStorage;
  browser: NativeOAuthBrowser;
  signal: AbortSignal;
  isCurrent(): boolean;
  serialize<T>(action: () => Promise<T>): Promise<T>;
  acceptVerified(user: User): Promise<AuthUser>;
}
class NativeOAuthError extends Error {
  readonly kind: NativeOAuthFailure;
  constructor(kind: NativeOAuthFailure) { super(kind); this.kind = kind; }
}
const validFlow = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value);
const messages: Record<NativeOAuthFailure, string> = {
  cancelled: 'تم إلغاء تسجيل الدخول.', dismissed: 'تم إغلاق نافذة تسجيل الدخول.',
  stale: 'تغيرت جلسة الدخول. افتح طلب دخول جديداً.', busy: 'يوجد طلب دخول قيد التنفيذ.',
  unsupported: 'يتطلب الدخول الاجتماعي نسخة تطوير أو نسخة مثبتة تدعم رابط التطبيق.',
  provider: 'تعذر إكمال مصادقة مزود الدخول. جرّب البريد الإلكتروني أو أعد المحاولة.',
  callback: 'رابط العودة إلى التطبيق غير صالح.', verification: 'لم يتم توثيق جلسة الدخول عبر الخادم.',
  cleanup: 'تعذر تأكيد إزالة بيانات طلب الدخول. أعد محاولة تسجيل الخروج.',
  unavailable: 'تعذر بدء تسجيل الدخول الآمن. أعد المحاولة.',
};
export const nativeOAuthFailure = (kind: NativeOAuthFailure): NativeOAuthResult => ({ success: false, ok: false, failureKind: kind, message: messages[kind] });
function sameRedirect(url: URL) {
  return url.protocol === 'mali:' && url.hostname === 'auth' && url.pathname === '/callback'
    && !url.port && !url.username && !url.password && !url.hash;
}

/** Only this browser result owns the native code exchange; no global Linking listener. */
export async function performNativeOAuth(deps: Dependencies): Promise<NativeOAuthResult> {
  let flowId: string | null = null, verifier: string | null = null, initialUserId: string | null = null;
  let exchangedToken: string | null = null, result: NativeOAuthResult = nativeOAuthFailure('unavailable');
  let browserOpen = false;
  const check = () => { if (deps.signal.aborted || !deps.isCurrent()) throw new NativeOAuthError('stale'); };
  const cancelBrowser = () => { if (browserOpen) { try { deps.browser.dismiss(); } catch { /* No credential/error payload is exposed. */ } } };
  deps.signal.addEventListener('abort', cancelBrowser, { once: true });
  try {
    const url = await deps.serialize(async () => {
      check();
      if (deps.browser.prepareRedirect() !== NATIVE_OAUTH_REDIRECT) throw new NativeOAuthError('unsupported');
      const initial = await deps.client.auth.getSession(); check();
      if (initial.error) throw new NativeOAuthError('unavailable');
      initialUserId = initial.data.session?.user.id || null;
      const prepared = await deps.client.auth.signInWithOAuth({ provider: deps.provider, options: { redirectTo: NATIVE_OAUTH_REDIRECT, skipBrowserRedirect: true } });
      if (validFlow(prepared.data?.flowId)) flowId = prepared.data.flowId;
      if (flowId) verifier = await deps.storage.getItem(`${deps.storageKey}-flow-${flowId}-code-verifier`);
      check();
      if (prepared.error || !prepared.data?.url || !flowId || verifier === null) throw new NativeOAuthError('provider');
      const authorization = new URL(prepared.data.url), endpoint = new URL(deps.supabaseUrl + '/auth/v1/authorize');
      const redirect = new URL(authorization.searchParams.get('redirect_to') || '');
      if (authorization.protocol !== 'https:' || authorization.origin !== endpoint.origin || authorization.pathname !== endpoint.pathname
        || authorization.username || authorization.password || authorization.hash || authorization.searchParams.get('provider') !== deps.provider
        || authorization.searchParams.get('code_challenge_method') !== 's256' || !/^[A-Za-z0-9_-]{43}$/.test(authorization.searchParams.get('code_challenge') || '')
        || !sameRedirect(redirect) || (redirect.searchParams.has('sb_flow_id') && redirect.searchParams.get('sb_flow_id') !== flowId)) throw new NativeOAuthError('callback');
      return prepared.data.url;
    });
    check();
    let onAbort: () => void = () => {};
    let response: { type: string; url?: string };
    try {
      browserOpen = true;
      response = await Promise.race([deps.browser.open(url, NATIVE_OAUTH_REDIRECT), new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new NativeOAuthError('stale'));
        deps.signal.addEventListener('abort', onAbort, { once: true });
        if (deps.signal.aborted) onAbort();
      })]);
    } finally { browserOpen = false; deps.signal.removeEventListener('abort', onAbort); }
    check();
    if (response.type === 'cancel') throw new NativeOAuthError('cancelled');
    if (response.type === 'dismiss') throw new NativeOAuthError('dismissed');
    if (response.type === 'locked' || response.type === 'opened') throw new NativeOAuthError('busy');
    if (response.type !== 'success' || !response.url) throw new NativeOAuthError('provider');
    const callback = new URL(response.url);
    if (!sameRedirect(callback) || ['access_token', 'refresh_token', 'token'].some(key => callback.searchParams.has(key))) throw new NativeOAuthError('callback');
    if (['error', 'error_description', 'error_code'].some(key => callback.searchParams.has(key))) throw new NativeOAuthError('provider');
    const codes = callback.searchParams.getAll('code'), ids = callback.searchParams.getAll('sb_flow_id');
    if (codes.length !== 1 || !codes[0] || codes[0].length > 4096 || ids.length > 1 || (ids.length === 1 && ids[0] !== flowId)) throw new NativeOAuthError('callback');
    result = await deps.serialize(async () => {
      check();
      const before = await deps.client.auth.getSession(); check();
      if (before.error || (before.data.session?.user.id || null) !== initialUserId) throw new NativeOAuthError('stale');
      const exchanged = await deps.client.auth.exchangeCodeForSession(codes[0], { flowId: flowId! });
      exchangedToken = exchanged.data.session?.access_token || null;
      check();
      const expectedId = exchanged.data.user?.id;
      if (exchanged.error || !expectedId || !exchangedToken || exchanged.data.session?.user.id !== expectedId) throw new NativeOAuthError('verification');
      const verified = await deps.client.auth.getUser(exchangedToken); check();
      const current = await deps.client.auth.getSession(); check();
      if (verified.error || verified.data.user?.id !== expectedId || current.error || current.data.session?.user.id !== expectedId
        || current.data.session.access_token !== exchangedToken) throw new NativeOAuthError('verification');
      const user = await deps.acceptVerified(verified.data.user); check();
      return { success: true, ok: true, user, message: 'تم تسجيل الدخول الاجتماعي وتوثيق الجلسة بنجاح.' };
    });
  } catch (error) { result = nativeOAuthFailure(error instanceof NativeOAuthError ? error.kind : 'unavailable'); }
  finally {
    deps.signal.removeEventListener('abort', cancelBrowser);
    try {
      await deps.serialize(async () => {
        // A failed exchange may have persisted tokens. Only its exact current
        // session can be removed; a newer user's token must remain untouched.
        if (!result.success && exchangedToken) {
          const current = await deps.client.auth.getSession();
          if (!current.error && current.data.session?.access_token === exchangedToken) {
            const signedOut = await deps.client.auth.signOut({ scope: 'local' });
            if (signedOut.error) throw new NativeOAuthError('cleanup');
          }
        }
        if (flowId && verifier !== null) {
          const slot = `${deps.storageKey}-flow-${flowId}-code-verifier`;
          if (await deps.storage.getItem(slot) === verifier) await deps.storage.removeItem(slot);
          const fixed = deps.storageKey + '-code-verifier';
          if (await deps.storage.getItem(fixed) === verifier) await deps.storage.removeItem(fixed);
          const index = deps.storageKey + '-flows-code-verifier', raw = await deps.storage.getItem(index);
          if (raw !== null) {
            const ids = JSON.parse(raw);
            if (!Array.isArray(ids) || ids.some(id => !validFlow(id))) throw new NativeOAuthError('cleanup');
            if (ids.includes(flowId)) {
              const remaining = ids.filter(id => id !== flowId);
              if (remaining.length) await deps.storage.setItem(index, JSON.stringify(remaining)); else await deps.storage.removeItem(index);
            }
          }
        }
      });
    } catch { result = nativeOAuthFailure('cleanup'); }
  }
  return result.success && (deps.signal.aborted || !deps.isCurrent()) ? nativeOAuthFailure('stale') : result;
}
