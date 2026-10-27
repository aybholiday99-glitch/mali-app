import React from 'react';
import { View,Text,ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { MaliProvider,useMali } from './src/context/MaliContext';
import { canEnterVault } from './src/navigation/routes';

export function MaliSessionNavigator() {
  const {currentUser,isLoading,authCleanupPending,theme}=useMali();
  // Preserve the initial deep link during bootstrap. No navigation or financial
  // screen mounts until the provider has finished loading the owner's vault.
  if (isLoading) return <View style={{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:theme.headerBg}}>
    <ActivityIndicator size="large" color={theme.primary} />
    <Text accessibilityRole="alert" style={{color:theme.text,marginTop:12}}>جارٍ تحميل خزنتك…</Text>
  </View>;
  const ownerReady=canEnterVault(currentUser,isLoading,authCleanupPending);
  return <Stack screenOptions={{headerShown:false,animation:'none'}}>
    <Stack.Screen name="index" />
    <Stack.Protected guard={!ownerReady}><Stack.Screen name="(auth)" /></Stack.Protected>
    <Stack.Protected guard={ownerReady}><Stack.Screen name="(vault)" /></Stack.Protected>
    <Stack.Screen name="+not-found" />
  </Stack>;
}

export default function App() {
  return <MaliProvider><MaliSessionNavigator /></MaliProvider>;
}
