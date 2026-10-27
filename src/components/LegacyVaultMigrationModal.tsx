import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import type { LegacyVaultSummary, MigrationStepStatus } from '../services/legacyVaultMigrationService';

interface LegacyVaultMigrationModalProps {
  visible: boolean;
  summary: LegacyVaultSummary | null;
  isMigrating: boolean;
  stepStatus: MigrationStepStatus | null;
  errorMessage: string | null;
  onStartMigration: () => void;
  onCancelOrLogout: () => void;
}

export const LegacyVaultMigrationModal: React.FC<LegacyVaultMigrationModalProps> = ({
  visible,
  summary,
  isMigrating,
  stepStatus,
  errorMessage,
  onStartMigration,
  onCancelOrLogout,
}) => {
  const { theme } = useMali();

  if (!visible || !summary) return null;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContent,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* Header Icon & Title */}
            <View style={styles.headerRow}>
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: theme.primarySoft },
                ]}
              >
                <Ionicons name="cloud-upload" size={28} color={theme.primary} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>
                ترحيل الخزنة إلى الخادم المركزي
              </Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                تم رصد بيانات مالية سابقة محفوظة على هذا الجهاز. تطبيق مالي يعتمد
                الآن نظام التخزين المركزي المعتمد لضمان سلامة أموالك وسهولة وصولك من
                أي جهاز.
              </Text>
            </View>

            {/* Statistics Card */}
            <View
              style={[
                styles.summaryCard,
                { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                ملخص السجلات المراد ترحيلها:
              </Text>

              <View style={styles.metricsGrid}>
                <View style={styles.metricItem}>
                  <Text style={[styles.metricValue, { color: theme.primary }]}>
                    {summary.accountsCount}
                  </Text>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>
                    خزائن وحسابات
                  </Text>
                </View>

                <View style={styles.metricItem}>
                  <Text style={[styles.metricValue, { color: theme.primary }]}>
                    {summary.transactionsCount}
                  </Text>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>
                    حركات مالية
                  </Text>
                </View>

                <View style={styles.metricItem}>
                  <Text style={[styles.metricValue, { color: theme.primary }]}>
                    {summary.debtsCount}
                  </Text>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>
                    سجلات ديون
                  </Text>
                </View>

                <View style={styles.metricItem}>
                  <Text style={[styles.metricValue, { color: theme.primary }]}>
                    {summary.dealsCount}
                  </Text>
                  <Text style={[styles.metricLabel, { color: theme.textMuted }]}>
                    صفقات دولار
                  </Text>
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <View style={styles.checksumRow}>
                <Ionicons name="shield-checkmark" size={16} color={theme.primary} />
                <Text style={[styles.checksumText, { color: theme.textSecondary }]}>
                  بصمة التحقق والهاش: {summary.sha256Checksum}
                </Text>
              </View>
            </View>

            {/* Progress or Error Display */}
            {isMigrating && (
              <View
                style={[
                  styles.progressContainer,
                  { backgroundColor: theme.surfaceSoft, borderColor: theme.primary },
                ]}
              >
                <ActivityIndicator size="small" color={theme.primary} />
                <Text style={[styles.progressText, { color: theme.primary }]}>
                  {stepStatus?.message || 'جاري معالجة ونقل البيانات بأمان…'}
                </Text>
                <View style={[styles.progressBarBg, { backgroundColor: theme.border }]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        backgroundColor: theme.primary,
                        width: `${stepStatus?.progressPercent || 25}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            )}

            {errorMessage && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color="#DC2626" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            <Text style={[styles.guaranteeText, { color: theme.textMuted }]}>
              🔒 ضمان الأمان: لن يتم حذف النسخة المحلية إلا بعد اكتمال الرفع
              والتأكد من مطابقة جميع السجلات على الخادم المركزي وحفظ نسخة أرشيفية
              آمنة.
            </Text>

            {/* Action Buttons */}
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: isMigrating ? theme.border : theme.primary,
                  },
                ]}
                onPress={onStartMigration}
                disabled={isMigrating}
                accessibilityRole="button"
                accessibilityLabel="بدء ترحيل البيانات الآن"
              >
                {isMigrating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.primaryBtnText}>
                  {isMigrating ? 'جاري الترحيل…' : 'ترحيل واعتماد البيانات الآن'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.secondaryBtn,
                  { borderColor: theme.border, backgroundColor: theme.surfaceSoft },
                ]}
                onPress={onCancelOrLogout}
                disabled={isMigrating}
                accessibilityRole="button"
                accessibilityLabel="تسجيل الخروج والاحتفاظ بالبيانات محلياً"
              >
                <Ionicons name="log-out-outline" size={18} color={theme.textSecondary} />
                <Text style={[styles.secondaryBtnText, { color: theme.textSecondary }]}>
                  تسجيل الخروج والاحتفاظ بالبيانات محلياً
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  scrollContent: {
    padding: 24,
  },
  headerRow: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  metricItem: {
    width: '48%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  metricLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  checksumRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  checksumText: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  progressContainer: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  errorBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    color: '#991B1B',
    fontSize: 13,
    textAlign: 'right',
    lineHeight: 18,
  },
  guaranteeText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  buttonGroup: {
    gap: 12,
  },
  primaryBtn: {
    flexDirection: 'row-reverse',
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    flexDirection: 'row-reverse',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
