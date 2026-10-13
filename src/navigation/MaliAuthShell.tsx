import React, { useState } from 'react';
import { View, Text, StatusBar, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMali } from '../context/MaliContext';
import { AuthScreen } from '../screens/AuthScreen';
import { CloudAndExportModal } from '../screens/CloudAndExportModal';

/** The auth form stays mounted while a native browser callback changes its URL. */
export function MaliAuthShell({children}:{children:React.ReactNode}) {
  const {state,theme,isDarkMode,authCleanupPending,lastSyncMessage,loginUser,logoutUser}=useMali();
  const [cloudVisible,setCloudVisible]=useState(false);
  return <SafeAreaView style={{flex:1,backgroundColor:theme.headerBg}}>
    <StatusBar barStyle={isDarkMode?'light-content':'dark-content'} />
    {authCleanupPending && <View style={{padding:12,backgroundColor:theme.surfaceSoft}}>
      <Text accessibilityRole="alert" style={{color:theme.text,textAlign:'right'}}>{lastSyncMessage || 'جارٍ إزالة بيانات الدخول من الجهاز…'}</Text>
      {!!lastSyncMessage && <TouchableOpacity accessibilityRole="button" accessibilityLabel="إعادة محاولة تسجيل الخروج" onPress={()=>{void logoutUser();}} style={{minHeight:44,padding:12}}>
        <Text style={{color:theme.primary,textAlign:'right'}}>إعادة محاولة تسجيل الخروج</Text>
      </TouchableOpacity>}
    </View>}
    {children}
    <AuthScreen supabaseConfig={state.supabaseConfig} onAuthenticated={loginUser} onOpenCloudConfig={()=>setCloudVisible(true)} />
    <CloudAndExportModal visible={cloudVisible} onClose={()=>setCloudVisible(false)} />
  </SafeAreaView>;
}
