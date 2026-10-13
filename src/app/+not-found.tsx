import React from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { useMali } from '../context/MaliContext';
export default function NotFoundRoute() {
  const {theme}=useMali();
  return <View style={{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:theme.bg,padding:24}}>
    <Text accessibilityRole="header" style={{color:theme.text,textAlign:'right',fontSize:20}}>الصفحة غير موجودة</Text>
    <Link href="/" style={{color:theme.primary,padding:16,marginTop:12}}>العودة إلى مالي</Link>
  </View>;
}
