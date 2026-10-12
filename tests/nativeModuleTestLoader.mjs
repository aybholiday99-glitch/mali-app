// Run the real TS/TSX services and provider with only native/external I/O mocked.
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export function installNativeTestLoader({ provider = false, ui = false } = {}) {
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      let source;
      if (specifier === '@react-native-async-storage/async-storage') source = 'export default globalThis.maliTestStorage;';
      if (specifier === 'react-native') source = 'export const Platform = globalThis.maliTestPlatform;';
      if (ui && specifier === 'react-native') source += "export const View='View',Text='Text',ScrollView='ScrollView',TouchableOpacity='TouchableOpacity',TextInput='TextInput',Modal='Modal'; export const StyleSheet={create:s=>s}; export const Share={share:async()=>({})};";
      if (ui && specifier === '@expo/vector-icons') source = "export const Ionicons='Ionicons';";
      if (specifier === '@supabase/supabase-js') source = 'export const createClient = (...args) => globalThis.maliTestCreateClient(...args);';
      if (provider && specifier.endsWith('/services/authService')) {
        source = "export const clearAuthSession=(...a)=>globalThis.maliProviderAuth.clearAuthSession(...a); export const consumeOAuthRedirectIfPresent=(...a)=>globalThis.maliProviderAuth.consumeOAuthRedirectIfPresent(...a); export const getPersistedSessionUser=(...a)=>globalThis.maliProviderAuth.getPersistedSessionUser(...a); export const savePersistedSessionUser=(...a)=>globalThis.maliProviderAuth.savePersistedSessionUser(...a); export const subscribeToAuthIdentity=(...a)=>globalThis.maliProviderAuth.subscribeToAuthIdentity(...a);";
      }
      if (provider && specifier.endsWith('/services/supabaseSync')) {
        source = 'export const pullStateFromSupabase=(...a)=>globalThis.maliProviderSync.pull(...a); export const pushStateToSupabase=(...a)=>globalThis.maliProviderSync.push(...a);';
      }
      if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const extension of ['.ts','.tsx']) {
          if (existsSync(base + extension)) return { url: pathToFileURL(base + extension).href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
        const file = fileURLToPath(url);
        return { format: 'module', source: ts.transpileModule(readFileSync(file,'utf8'), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
          fileName: file,
        }).outputText, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}
