import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createChunkedFinancialStorage } from './chunkedFinancialStorage';

export const financialStorage = createChunkedFinancialStorage(AsyncStorage,async(key,action)=>{
  const locks=typeof navigator!=='undefined'?navigator.locks:undefined;
  if(Platform?.OS==='web' && !locks) throw new Error('تعذر تأمين حفظ الخزنة في هذا المتصفح. استخدم نسخة حديثة أو التطبيق.');
  return locks?locks.request('mali-financial-cache:'+key,{mode:'exclusive'},action):action();
});
