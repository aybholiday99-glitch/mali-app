import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createNativeAuthStorage } from './nativeAuthStorageCore';

const adapters = new Map<string, ReturnType<typeof createNativeAuthStorage>>();
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

/** Web intentionally retains the existing AsyncStorage/localStorage behavior. */
export function getAuthTokenStorage(storageKey: string) {
  return Platform.OS === 'web' ? AsyncStorage : nativeAdapter(storageKey);
}

export async function clearAuthTokenStorage(storageKey: string) {
  if (Platform.OS === 'web') {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key === storageKey || key.startsWith(storageKey + '-'));
    await AsyncStorage.multiRemove(keys);
  } else {
    await nativeAdapter(storageKey).clearAll();
  }
}
