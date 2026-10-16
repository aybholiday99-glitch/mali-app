import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { useMali } from '../../context/MaliContext';
import { MaliVaultShell } from '../../navigation/MaliVaultShell';
export default function VaultLayout() {
  const {currentUser,mutationSessionGeneration}=useMali();
  return <MaliVaultShell key={currentUser?.id+'::'+mutationSessionGeneration}><Tabs backBehavior="history" tabBar={()=>null} screenOptions={{headerShown:false,lazy:true,freezeOnBlur:true}}>
    <Tabs.Screen name="dashboard" /><Tabs.Screen name="accounts" /><Tabs.Screen name="deals" />
    <Tabs.Screen name="contacts" /><Tabs.Screen name="expenses" /><Tabs.Screen name="procedures" />
  </Tabs></MaliVaultShell>;
}
export const unstable_settings = { initialRouteName: 'dashboard' };
