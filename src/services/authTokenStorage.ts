import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createNativeAuthStorage, isAuthStorageKey, mayRemoveLegacyAuthValue } from './nativeAuthStorageCore';

const adapters = new Map<string, ReturnType<typeof createNativeAuthStorage>>();
const webAdapters = new Map<string, {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}>();
const options = {
  keychainService: 'mali.supabase.auth.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

function nativeAdapter(key: string) {
  let adapter = adapters.get(key);
  if (!adapter) {
    adapter = createNativeAuthStorage(key, {
      secure: {
        getItem: (name) => SecureStore.getItemAsync(name, options),
        setItem: (name, value) => SecureStore.setItemAsync(name, value, options),
        removeItem: (name) => SecureStore.deleteItemAsync(name, options),
      },
      legacy: AsyncStorage,
      isAvailable: () => SecureStore.isAvailableAsync(),
    });
    adapters.set(key, adapter);
  }
  return adapter;
}

function webAdapter(namespace: string) {
  let adapter = webAdapters.get(namespace);
  if (!adapter) {
    const requireOwned = (key: string) => { if (!isAuthStorageKey(namespace, key)) throw new Error('Invalid authentication storage key.'); };
    adapter = {
      getItem: async key => {
        requireOwned(key);
        const value = await AsyncStorage.getItem(key);
        return mayRemoveLegacyAuthValue(namespace, key, value) ? value : null;
      },
      setItem: async (key, value) => {
        requireOwned(key);
        if (!mayRemoveLegacyAuthValue(namespace, key, await AsyncStorage.getItem(key))) throw new Error('Ambiguous authentication storage ownership.');
        await AsyncStorage.setItem(key, value);
      },
      removeItem: async key => {
        requireOwned(key);
        if (mayRemoveLegacyAuthValue(namespace, key, await AsyncStorage.getItem(key))) await AsyncStorage.removeItem(key);
      },
    };
    webAdapters.set(namespace, adapter);
  }
  return adapter;
}

/** Web intentionally retains the existing AsyncStorage/localStorage behavior. */
export function getAuthTokenStorage(storageKey: string) {
  return Platform.OS === 'web' ? webAdapter(storageKey) : nativeAdapter(storageKey);
}

export async function clearAuthTokenStorage(storageKey: string) {
  if (Platform.OS === 'web') {
    const keys: string[] = [];
    for (const key of await AsyncStorage.getAllKeys()) {
      if (mayRemoveLegacyAuthValue(storageKey, key, await AsyncStorage.getItem(key))) keys.push(key);
    }
    await AsyncStorage.multiRemove(keys);
  } else {
    await nativeAdapter(storageKey).clearAll();
  }
}
