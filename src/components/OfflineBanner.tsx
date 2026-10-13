import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface OfflineBannerProps {
  isOffline?: boolean;
  message?: string;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  isOffline = false,
  message,
}) => {
  if (!isOffline) return null;

  return (
    <View
      style={[
        styles.bannerContainer,
        { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
      ]}
      accessibilityRole="alert"
    >
      <Ionicons name="cloud-offline" size={18} color="#DC2626" />
      <Text style={[styles.bannerText, { color: '#991B1B' }]}>
        {message ||
          'لا يوجد اتصال بالإنترنت. العمليات المالية تتطلب اتصالاً مباشراً بالخادم المركزي لضمان الأمان والمطابقة.'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  bannerContainer: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    gap: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    textAlign: 'right',
    fontWeight: '500',
    lineHeight: 18,
  },
});
