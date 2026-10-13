import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { NATIVE_OAUTH_REDIRECT, type NativeOAuthBrowser } from './nativeOAuthCore';

/** Supply only missing PKCE primitives; preserve an existing WebCrypto runtime. */
export function ensureNativePkceCrypto() {
  if (typeof TextEncoder !== 'function' || typeof btoa !== 'function') throw new Error('Native PKCE encoding is unavailable.');
  const crypto = globalThis.crypto || {} as globalThis.Crypto;
  if (typeof crypto.getRandomValues !== 'function') Object.defineProperty(crypto, 'getRandomValues', { value: Crypto.getRandomValues, configurable: true });
  const subtle = crypto.subtle || {} as SubtleCrypto;
  if (typeof subtle.digest !== 'function') Object.defineProperty(subtle, 'digest', { configurable: true, value: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
    const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
    if (name.toUpperCase() !== 'SHA-256') return Promise.reject(new Error('Unsupported native PKCE digest.'));
    return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
  } });
  if (!crypto.subtle) Object.defineProperty(crypto, 'subtle', { value: subtle, configurable: true });
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true });
}

export const nativeOAuthBrowser: NativeOAuthBrowser = {
  prepareRedirect: () => {
    const redirect = AuthSession.makeRedirectUri({ scheme: 'mali', path: 'auth/callback', native: NATIVE_OAUTH_REDIRECT });
    if (redirect === NATIVE_OAUTH_REDIRECT) ensureNativePkceCrypto();
    return redirect;
  },
  open: (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect),
  dismiss: () => AuthSession.dismiss(),
};
