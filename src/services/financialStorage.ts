import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createChunkedFinancialStorage, type FinancialStorageBackend } from './chunkedFinancialStorage';
import { createWebFinancialStorageBackend } from './webFinancialStorageBackend';

const webBackend = createWebFinancialStorageBackend({ legacyStorage: AsyncStorage });

export const financialStorageBackend: FinancialStorageBackend = {
  getItem: key => (Platform?.OS === 'web' ? webBackend.getItem(key) : AsyncStorage.getItem(key)),
  setItem: (key, value) => (Platform?.OS === 'web' ? webBackend.setItem(key, value) : AsyncStorage.setItem(key, value)),
  get removeItem() {
    if (Platform?.OS === 'web') return webBackend.removeItem;
    return typeof AsyncStorage?.removeItem === 'function' ? (key: string) => AsyncStorage.removeItem(key) : undefined;
  },
  get getAllKeys() {
    if (Platform?.OS === 'web') return webBackend.getAllKeys;
    return typeof AsyncStorage?.getAllKeys === 'function' ? () => AsyncStorage.getAllKeys() : undefined;
  },
};

export const financialRecoveryStorage = {
  getItem: (key: string) => financialStorageBackend.getItem(key),
  getAllKeys: async () => (financialStorageBackend.getAllKeys ? financialStorageBackend.getAllKeys() : []),
};

export const financialStorage = createChunkedFinancialStorage(financialStorageBackend, async (key, action) => {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (Platform?.OS === 'web' && !locks) throw new Error('تعذر تأمين حفظ الخزنة في هذا المتصفح. استخدم نسخة حديثة أو التطبيق.');
  return locks ? locks.request('mali-financial-cache:' + key, { mode: 'exclusive' }, action) : action();
});

