import React from 'react';
import { Stack } from 'expo-router';
import { useMali } from '../../context/MaliContext';
import { MaliVaultShell } from '../../navigation/MaliVaultShell';
export default function VaultLayout() {
  const {currentUser}=useMali();
  return <MaliVaultShell key={currentUser?.id}><Stack screenOptions={{headerShown:false,animation:'none'}}>
    <Stack.Screen name="dashboard" /><Stack.Screen name="accounts" /><Stack.Screen name="deals" />
    <Stack.Screen name="contacts" /><Stack.Screen name="expenses" /><Stack.Screen name="procedures" />
  </Stack></MaliVaultShell>;
}
export const unstable_settings = { initialRouteName: 'dashboard' };
