import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Linking,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import { useResponsiveLayout, MIN_TOUCH_TARGET } from '../theme/responsive';
import { ContactPerson, DebtRecord, DealSale, UsdDeal } from '../types/mali';
import {
  computeUnifiedContactProfile,
  ContactTimelineEntry,
} from '../services/unifiedContactProfileService';
import {
  exportFileOrShare,
  formatMoney,
  formatRate,
  generateContactStatementCsv,
  printContactStatement,
} from '../utils/exportHelper';
import { PagedRows } from './PagedRows';

interface UnifiedContactProfileModalProps {
  visible: boolean;
  contact: ContactPerson | null;
  onClose: () => void;
  onAddDebt?: (contact: ContactPerson) => void;
  onSettleDebt?: (contact: ContactPerson, debt?: DebtRecord) => void;
  onAddDeal?: (contact: ContactPerson) => void;
  onAddSale?: (contact: ContactPerson) => void;
  onAddTransfer?: (contact: ContactPerson) => void;
}

type TabType = 'all' | 'timeline' | 'debts' | 'deals' | 'transactions';

export const UnifiedContactProfileModal: React.FC<UnifiedContactProfileModalProps> = ({
  visible,
  contact,
  onClose,
  onAddDebt,
  onSettleDebt,
  onAddDeal,
  onAddSale,
  onAddTransfer,
}) => {
  const { isSmallPhone } = useResponsiveLayout();
  const { state, theme, updateContact } = useMali();
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [exporting, setExporting] = useState(false);
  const [noteEditVisible, setNoteEditVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const profile = useMemo(() => {
    if (!contact) return null;
    return computeUnifiedContactProfile(state, contact);
  }, [state, contact]);

  if (!visible || !contact || !profile) {
    return null;
  }

  const { currencies, usdDealsSummary, debts, directTransactions, timelineEntries } = profile;

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      const csv = generateContactStatementCsv(state, contact);
      const safeName = contact.name.replace(/[/\\?%*:|"<>]/g, '_');
      await exportFileOrShare(`كشف_حساب_${safeName}.csv`, csv);
      setStatusMessage('تم تصدير كشف الحساب بصيغة Excel/CSV بنجاح.');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch {
      setStatusMessage('تعذر تصدير الملف.');
      setTimeout(() => setStatusMessage(null), 3000);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      setExporting(true);
      await printContactStatement(state, contact);
      setStatusMessage('تم إنشاء وطباعة كشف الحساب الموحد PDF بنجاح.');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch {
      setStatusMessage('تعذر توليد كشف الحساب PDF.');
      setTimeout(() => setStatusMessage(null), 3000);
    } finally {
      setExporting(false);
    }
  };

  const handleSaveNotes = async () => {
    try {
      await updateContact(contact.id, { notes: noteText.trim() || undefined });
      setNoteEditVisible(false);
      setStatusMessage('تم تحديث الملاحظات بنجاح.');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch {
      setStatusMessage('خطأ: تعذر حفظ الملاحظات.');
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  const openNoteEditor = () => {
    setNoteText(contact.notes || '');
    setNoteEditVisible(true);
  };

  const callPhone = (phoneNum: string) => {
    const cleaned = phoneNum.replace(/\s+/g, '');
    if (cleaned) {
      Linking.openURL(`tel:${cleaned}`).catch(() => {});
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.bg }]}>
        {/* Header Bar */}
        <View style={[styles.header, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: theme.cardAlt }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="إغلاق الملف المالي"
          >
            <Ionicons name="close" size={22} color={theme.text} />
          </TouchableOpacity>

          <View style={styles.headerInfo}>
            <View style={styles.headerTitleRow}>
              <Text accessibilityRole="header" style={[styles.contactName, { color: theme.text }]}>
                {contact.name}
              </Text>
              <View style={[styles.roleBadge, { backgroundColor: theme.primary + '20' }]}>
                <Text style={[styles.roleBadgeText, { color: theme.primary }]}>{contact.role}</Text>
              </View>
            </View>

            {Boolean(contact.phone) && (
              <TouchableOpacity
                style={styles.phoneRow}
                onPress={() => callPhone(contact.phone)}
                accessibilityRole="button"
                accessibilityLabel={`اتصال بالرقم ${contact.phone}`}
              >
                <Ionicons name="call-outline" size={14} color={theme.primary} />
                <Text style={[styles.phoneText, { color: theme.primary }]}>{contact.phone}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {statusMessage && (
          <View style={[styles.statusBanner, { backgroundColor: theme.primary + '20', borderColor: theme.primary }]}>
            <Ionicons name="information-circle-outline" size={18} color={theme.primary} />
            <Text style={[styles.statusText, { color: theme.text }]}>{statusMessage}</Text>
          </View>
        )}

        <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
          {/* Quick Info & Notes Card */}
          <View style={[styles.infoCard, isSmallPhone && { padding: 12 }, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>تاريخ الإضافة:</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>{contact.createdAt || 'غير محدد'}</Text>
            </View>

            {Boolean(contact.bankDetails) && (
              <View style={styles.infoRow}>
                <Ionicons name="card-outline" size={16} color={theme.textSecondary} />
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>البيانات المصرفية:</Text>
                <Text style={[styles.infoValue, { color: theme.text }]}>{contact.bankDetails}</Text>
              </View>
            )}

            <View style={styles.infoRow}>
              <Ionicons name="document-text-outline" size={16} color={theme.textSecondary} />
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>الملاحظات:</Text>
              <Text style={[styles.infoValue, { color: theme.text }]}>
                {contact.notes ? contact.notes : 'لا توجد ملاحظات مسجلة.'}
              </Text>
            </View>
          </View>

          {/* Quick Actions Bar */}
          <View style={styles.quickActionsContainer}>
            <Text style={[styles.sectionHeading, { color: theme.textSecondary }]}>إجراءات سريعة:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionButtonsRow}>
              {onAddDebt && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: theme.primary }]}
                  onPress={() => onAddDebt(contact)}
                  accessibilityRole="button"
                  accessibilityLabel="إضافة دين جديد للمتعامل"
                >
                  <Ionicons name="add-circle-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>إضافة دين</Text>
                </TouchableOpacity>
              )}

              {onSettleDebt && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#10B981' }]}
                  onPress={() => onSettleDebt(contact)}
                  accessibilityRole="button"
                  accessibilityLabel="تسجيل دفعة أو تسوية"
                >
                  <Ionicons name="checkmark-done-circle-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>تسجيل دفعة</Text>
                </TouchableOpacity>
              )}

              {onAddDeal && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#F59E0B' }]}
                  onPress={() => onAddDeal(contact)}
                  accessibilityRole="button"
                  accessibilityLabel="شراء دولار من المتعامل"
                >
                  <Ionicons name="cart-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>شراء</Text>
                </TouchableOpacity>
              )}

              {onAddSale && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#3B82F6' }]}
                  onPress={() => onAddSale(contact)}
                  accessibilityRole="button"
                  accessibilityLabel="بيع دولار للمتعامل"
                >
                  <Ionicons name="cash-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>بيع</Text>
                </TouchableOpacity>
              )}

              {onAddTransfer && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#6366F1' }]}
                  onPress={() => onAddTransfer(contact)}
                  accessibilityRole="button"
                  accessibilityLabel="تحويل مالي للمتعامل"
                >
                  <Ionicons name="swap-horizontal-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>تحويل مالي</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: theme.cardAlt, borderWidth: 1, borderColor: theme.border }]}
                onPress={openNoteEditor}
                accessibilityRole="button"
                accessibilityLabel="تعديل ملاحظات المتعامل"
              >
                <Ionicons name="create-outline" size={16} color={theme.text} />
                <Text style={[styles.actionBtnText, { color: theme.text }]}>الملاحظات</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#DC2626' }]}
                onPress={handleExportPdf}
                disabled={exporting}
                accessibilityRole="button"
                accessibilityLabel="تصدير كشف حساب PDF"
              >
                <Ionicons name="document-outline" size={16} color="#FFFFFF" />
                <Text style={styles.actionBtnText}>كشف حساب PDF</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#059669' }]}
                onPress={handleExportCsv}
                disabled={exporting}
                accessibilityRole="button"
                accessibilityLabel="تصدير كشف حساب Excel"
              >
                <Ionicons name="download-outline" size={16} color="#FFFFFF" />
                <Text style={styles.actionBtnText}>تصدير Excel/CSV</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* KPI Summary Cards */}
          {/* LYD Position Card */}
          <View style={[styles.kpiCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.kpiHeader}>
              <View style={styles.kpiCurrencyBadge}>
                <Ionicons name="cash-outline" size={16} color={theme.primary} />
                <Text style={[styles.kpiCurrencyTitle, { color: theme.text }]}>المركز المالي بالدينار الليبي (LYD)</Text>
              </View>
              <View
                style={[
                  styles.netBadge,
                  {
                    backgroundColor:
                      currencies.LYD.netPosition > 0
                        ? '#D1FAE5'
                        : currencies.LYD.netPosition < 0
                        ? '#FEE2E2'
                        : theme.cardAlt,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.netBadgeText,
                    {
                      color:
                        currencies.LYD.netPosition > 0
                          ? '#059669'
                          : currencies.LYD.netPosition < 0
                          ? '#DC2626'
                          : theme.textSecondary,
                    },
                  ]}
                >
                  {currencies.LYD.netPosition > 0
                    ? `صافي مستحق لي: ${formatMoney(currencies.LYD.netPosition, 'LYD')}`
                    : currencies.LYD.netPosition < 0
                    ? `صافي مستحق عليّ: ${formatMoney(Math.abs(currencies.LYD.netPosition), 'LYD')}`
                    : 'الرصيد متوازن'}
                </Text>
              </View>
            </View>

            <View style={styles.kpiGrid}>
              <View style={[styles.kpiBox, { backgroundColor: theme.cardAlt }]}>
                <Text style={[styles.kpiLabel, { color: theme.textSecondary }]}>ديون مستحقة لي</Text>
                <Text style={[styles.kpiValue, { color: '#059669' }]}>
                  {formatMoney(currencies.LYD.receivables, 'LYD')}
                </Text>
                <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
                  {currencies.LYD.activeReceivablesCount} ديون نشطة
                </Text>
              </View>

              <View style={[styles.kpiBox, { backgroundColor: theme.cardAlt }]}>
                <Text style={[styles.kpiLabel, { color: theme.textSecondary }]}>ديون مستحقة عليّ</Text>
                <Text style={[styles.kpiValue, { color: '#DC2626' }]}>
                  {formatMoney(currencies.LYD.payables, 'LYD')}
                </Text>
                <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
                  {currencies.LYD.activePayablesCount} التزامات نشطة
                </Text>
              </View>
            </View>
          </View>

          {/* USD Position Card */}
          <View style={[styles.kpiCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.kpiHeader}>
              <View style={styles.kpiCurrencyBadge}>
                <Ionicons name="logo-usd" size={16} color="#D97706" />
                <Text style={[styles.kpiCurrencyTitle, { color: theme.text }]}>المركز المالي بالدولار الأمريكي (USD)</Text>
              </View>
              <View
                style={[
                  styles.netBadge,
                  {
                    backgroundColor:
                      currencies.USD.netPosition > 0
                        ? '#D1FAE5'
                        : currencies.USD.netPosition < 0
                        ? '#FEE2E2'
                        : theme.cardAlt,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.netBadgeText,
                    {
                      color:
                        currencies.USD.netPosition > 0
                          ? '#059669'
                          : currencies.USD.netPosition < 0
                          ? '#DC2626'
                          : theme.textSecondary,
                    },
                  ]}
                >
                  {currencies.USD.netPosition > 0
                    ? `صافي مستحق لي: ${formatMoney(currencies.USD.netPosition, 'USD')}`
                    : currencies.USD.netPosition < 0
                    ? `صافي مستحق عليّ: ${formatMoney(Math.abs(currencies.USD.netPosition), 'USD')}`
                    : 'الرصيد متوازن'}
                </Text>
              </View>
            </View>

            <View style={styles.kpiGrid}>
              <View style={[styles.kpiBox, { backgroundColor: theme.cardAlt }]}>
                <Text style={[styles.kpiLabel, { color: theme.textSecondary }]}>ديون مستحقة لي</Text>
                <Text style={[styles.kpiValue, { color: '#059669' }]}>
                  {formatMoney(currencies.USD.receivables, 'USD')}
                </Text>
                <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
                  {currencies.USD.activeReceivablesCount} ديون نشطة
                </Text>
              </View>

              <View style={[styles.kpiBox, { backgroundColor: theme.cardAlt }]}>
                <Text style={[styles.kpiLabel, { color: theme.textSecondary }]}>ديون مستحقة عليّ</Text>
                <Text style={[styles.kpiValue, { color: '#DC2626' }]}>
                  {formatMoney(currencies.USD.payables, 'USD')}
                </Text>
                <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
                  {currencies.USD.activePayablesCount} التزامات نشطة
                </Text>
              </View>
            </View>

            {/* USD Deals Mini Stats */}
            {(usdDealsSummary.dealsCount > 0 || usdDealsSummary.salesCount > 0) && (
              <View style={[styles.dealsMiniSummary, { borderTopColor: theme.border }]}>
                <View style={styles.dealsStatRow}>
                  <Text style={[styles.dealsStatLabel, { color: theme.textSecondary }]}>مشتريات الدولار منه:</Text>
                  <Text style={[styles.dealsStatVal, { color: theme.text, fontWeight: 'bold' }]}>
                    ${usdDealsSummary.boughtUsdAmount} (بتكلفة {formatMoney(usdDealsSummary.boughtLydCost, 'LYD')})
                  </Text>
                </View>
                <View style={styles.dealsStatRow}>
                  <Text style={[styles.dealsStatLabel, { color: theme.textSecondary }]}>مبيعات الدولار له:</Text>
                  <Text style={[styles.dealsStatVal, { color: theme.text, fontWeight: 'bold' }]}>
                    ${usdDealsSummary.soldUsdAmount} (بإيراد {formatMoney(usdDealsSummary.soldLydRevenue, 'LYD')})
                  </Text>
                </View>
                {usdDealsSummary.realizedProfitLyd !== 0 && (
                  <View style={styles.dealsStatRow}>
                    <Text style={[styles.dealsStatLabel, { color: theme.textSecondary }]}>صافي الربح المحقق:</Text>
                    <Text
                      style={[
                        styles.dealsStatVal,
                        {
                          color: usdDealsSummary.realizedProfitLyd > 0 ? '#059669' : '#DC2626',
                          fontWeight: 'bold',
                        },
                      ]}
                    >
                      {formatMoney(usdDealsSummary.realizedProfitLyd, 'LYD')}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Segmented Navigation Tabs */}
          <View style={[styles.tabsRow, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'all' && [styles.activeTab, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('all')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'all' }}
            >
              <Text style={[styles.tabText, { color: activeTab === 'all' ? theme.primary : theme.textSecondary }]}>
                الملف الشامل
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'timeline' && [styles.activeTab, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('timeline')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'timeline' }}
            >
              <Text style={[styles.tabText, { color: activeTab === 'timeline' ? theme.primary : theme.textSecondary }]}>
                الحركات ({timelineEntries.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'debts' && [styles.activeTab, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('debts')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'debts' }}
            >
              <Text style={[styles.tabText, { color: activeTab === 'debts' ? theme.primary : theme.textSecondary }]}>
                الديون ({debts.all.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'deals' && [styles.activeTab, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('deals')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'deals' }}
            >
              <Text style={[styles.tabText, { color: activeTab === 'deals' ? theme.primary : theme.textSecondary }]}>
                الدولار ({usdDealsSummary.dealsCount + usdDealsSummary.salesCount})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'transactions' && [styles.activeTab, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('transactions')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'transactions' }}
            >
              <Text style={[styles.tabText, { color: activeTab === 'transactions' ? theme.primary : theme.textSecondary }]}>
                مباشرة ({directTransactions.items.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Section 1: Timeline */}
          {(activeTab === 'all' || activeTab === 'timeline') && (
            <View style={styles.tabContent}>
              <Text style={[styles.sectionHeading, { color: theme.text }]}>
                سجل الحركات المالية الموحد ({timelineEntries.length})
              </Text>
              {timelineEntries.length === 0 ? (
                <View style={[styles.emptyBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Ionicons name="calendar-outline" size={32} color={theme.textMuted} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>لا توجد حركات مالية مسجلة مع هذا الشخص حتى الآن.</Text>
                </View>
              ) : (
                <PagedRows
                  items={timelineEntries}
                  pageSize={activeTab === 'all' ? 5 : 15}
                  label="سجل الحركات المالية الموحد"
                  resetKey={contact.id}
                >
                  {(entry: ContactTimelineEntry) => {
                    const isCredit = entry.type === 'debt_receivable' || entry.type === 'deal_sell';
                    const isDebit = entry.type === 'debt_payable' || entry.type === 'deal_buy';

                    return (
                      <View
                        key={entry.id}
                        style={[
                          styles.timelineCard,
                          {
                            backgroundColor: theme.card,
                            borderColor: theme.border,
                            borderRightColor:
                              entry.isNonCash
                                ? '#8B5CF6'
                                : isCredit
                                ? '#059669'
                                : isDebit
                                ? '#DC2626'
                                : theme.primary,
                          },
                        ]}
                      >
                        <View style={styles.timelineTopRow}>
                          <View style={styles.timelineTypeBadge}>
                            <Text style={styles.timelineTypeLabel}>{entry.typeLabel}</Text>
                            {entry.isNonCash && (
                              <View style={styles.nonCashBadge}>
                                <Text style={styles.nonCashBadgeText}>تسوية غير نقدية</Text>
                              </View>
                            )}
                          </View>
                          <Text style={[styles.timelineDate, { color: theme.textMuted }]}>{entry.date}</Text>
                        </View>

                        <Text style={[styles.timelineDesc, { color: theme.text }]}>{entry.description}</Text>

                        <View style={styles.timelineDetailsRow}>
                          <Text style={[styles.timelineAmount, { color: theme.text }]}>
                            المبلغ: {formatMoney(entry.amount, entry.currency)}
                            {entry.secondaryAmount !== undefined && entry.secondaryCurrency && (
                              <Text style={{ color: theme.textSecondary }}>
                                {' '}(المقابل: {formatMoney(entry.secondaryAmount, entry.secondaryCurrency)})
                              </Text>
                            )}
                          </Text>

                          <Text style={[styles.timelineAccount, { color: theme.textSecondary }]}>
                            {entry.accountName} {entry.paymentMethodLabel ? `• ${entry.paymentMethodLabel}` : ''}
                          </Text>
                        </View>

                        {Boolean(entry.nonCashReason) && (
                          <Text style={styles.nonCashReasonText}>سبب التسوية: {entry.nonCashReason}</Text>
                        )}

                        <View style={styles.timelineBalanceRow}>
                          <Text style={[styles.runningBalanceLabel, { color: theme.textSecondary }]}>
                            الرصيد بعد الحركة ({entry.currency}):
                          </Text>
                          <Text
                            style={[
                              styles.runningBalanceVal,
                              {
                                color:
                                  entry.runningBalance > 0
                                    ? '#059669'
                                    : entry.runningBalance < 0
                                    ? '#DC2626'
                                    : theme.textSecondary,
                              },
                            ]}
                          >
                            {formatMoney(entry.runningBalance, entry.currency)}
                          </Text>
                        </View>
                      </View>
                    );
                  }}
                </PagedRows>
              )}
            </View>
          )}

          {/* Section 2: Deals Purchases */}
          {(activeTab === 'all' || activeTab === 'deals') && (
            <View style={styles.tabContent}>
              <Text style={[styles.sectionHeading, { color: theme.text, marginTop: 12 }]}>
                مشتريات المتعامل بالدولار ({usdDealsSummary.dealsCount})
              </Text>
              {usdDealsSummary.matchedDeals.length === 0 ? (
                <View style={[styles.emptyBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Ionicons name="cash-outline" size={32} color={theme.textMuted} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>لا توجد صفقات شراء دولار مسجلة منه.</Text>
                </View>
              ) : (
                <PagedRows
                  items={usdDealsSummary.matchedDeals}
                  pageSize={activeTab === 'all' ? 5 : 10}
                  label="مشتريات المتعامل"
                  resetKey={contact.id}
                >
                  {(deal: UsdDeal) => (
                    <View key={deal.id} style={[styles.dealItemCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                      <View style={styles.dealTopRow}>
                        <Text style={[styles.dealTitle, { color: theme.text }]}>صفقة: {deal.dealNumber} - {deal.title}</Text>
                        <Text style={[styles.dealDate, { color: theme.textMuted }]}>{deal.buyDate}</Text>
                      </View>
                      <View style={styles.dealMetricsRow}>
                        <Text style={[styles.dealMetric, { color: theme.textSecondary }]}>
                          الكمية: <Text style={{ color: theme.text, fontWeight: 'bold' }}>${deal.totalUsdBought}</Text>
                        </Text>
                        <Text style={[styles.dealMetric, { color: theme.textSecondary }]}>
                          سعر الشراء: <Text style={{ color: theme.text }}>{formatRate(deal.buyRate)}</Text>
                        </Text>
                        <Text style={[styles.dealMetric, { color: theme.textSecondary }]}>
                          التكلفة: <Text style={{ color: theme.text }}>{formatMoney(deal.totalLydCost, 'LYD')}</Text>
                        </Text>
                      </View>
                    </View>
                  )}
                </PagedRows>
              )}

              {/* Section 3: Deals Sales */}
              <Text style={[styles.sectionHeading, { color: theme.text, marginTop: 12 }]}>
                مبيعات المتعامل بالدولار ({usdDealsSummary.salesCount})
              </Text>
              {usdDealsSummary.matchedSales.length === 0 ? (
                <View style={[styles.emptyBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Ionicons name="cart-outline" size={32} color={theme.textMuted} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>لا توجد صفقات بيع دولار مسجلة له.</Text>
                </View>
              ) : (
                <PagedRows
                  items={usdDealsSummary.matchedSales}
                  pageSize={activeTab === 'all' ? 5 : 10}
                  label="مبيعات المتعامل"
                  resetKey={contact.id}
                >
                  {({ deal, sale }: { deal: UsdDeal; sale: DealSale }) => (
                    <View key={sale.id} style={[styles.dealItemCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                      <View style={styles.dealTopRow}>
                        <Text style={[styles.dealTitle, { color: theme.text }]}>بيع من صفقة: {deal.dealNumber}</Text>
                        <Text style={[styles.dealDate, { color: theme.textMuted }]}>{sale.date}</Text>
                      </View>
                      <View style={styles.dealMetricsRow}>
                        <Text style={[styles.dealMetric, { color: theme.textSecondary }]}>
                          المباع: <Text style={{ color: theme.text, fontWeight: 'bold' }}>${sale.usdAmount}</Text>
                        </Text>
                        <Text style={[styles.dealMetric, { color: theme.textSecondary }]}>
                          سعر البيع: <Text style={{ color: theme.text }}>{formatRate(sale.sellRate)}</Text>
                        </Text>
                        <Text style={[styles.dealMetric, { color: theme.textSecondary }]}>
                          المستلم: <Text style={{ color: '#059669' }}>{formatMoney(sale.netLydReceived, 'LYD')}</Text>
                        </Text>
                        <Text style={[styles.dealMetric, { color: theme.textSecondary }]}>
                          الربح: <Text style={{ color: '#059669', fontWeight: 'bold' }}>{formatMoney(sale.profitLyd, 'LYD')}</Text>
                        </Text>
                      </View>
                    </View>
                  )}
                </PagedRows>
              )}
            </View>
          )}

          {/* Section 4: Debts & Installments */}
          {(activeTab === 'all' || activeTab === 'debts') && (
            <View style={styles.tabContent}>
              <Text style={[styles.sectionHeading, { color: theme.text, marginTop: 12 }]}>
                ديون وأمانات المتعامل ({debts.all.length})
              </Text>
              {debts.all.length === 0 ? (
                <View style={[styles.emptyBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Ionicons name="document-outline" size={32} color={theme.textMuted} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>لا توجد ديون أو أمانات مسجلة مع هذا الشخص.</Text>
                </View>
              ) : (
                <PagedRows
                  items={debts.all}
                  pageSize={activeTab === 'all' ? 5 : 10}
                  label="ديون المتعامل"
                  resetKey={contact.id}
                >
                  {(debt: DebtRecord) => {
                    const isReceivable = debt.direction === 'receivable';
                    const isSettled = debt.status === 'completed' || debt.remainingAmount <= 0.005;

                    return (
                      <View
                        key={debt.id}
                        style={[
                          styles.debtCard,
                          {
                            backgroundColor: theme.card,
                            borderColor: theme.border,
                            borderRightColor: isReceivable ? '#059669' : '#DC2626',
                          },
                        ]}
                      >
                        <View style={styles.debtHeaderRow}>
                          <View style={styles.debtBadgeGroup}>
                            <View
                              style={[
                                styles.dirBadge,
                                { backgroundColor: isReceivable ? '#D1FAE5' : '#FEE2E2' },
                              ]}
                            >
                              <Text style={{ color: isReceivable ? '#059669' : '#DC2626', fontWeight: 'bold', fontSize: 11 }}>
                                {isReceivable ? 'دين لي عنده' : 'دين عليّ له'}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.statusBadge,
                                { backgroundColor: isSettled ? '#E0E7FF' : '#FEF3C7' },
                              ]}
                            >
                              <Text style={{ color: isSettled ? '#4F46E5' : '#D97706', fontSize: 11 }}>
                                {isSettled ? 'مسدد بالكامل' : 'نشط / قائم'}
                              </Text>
                            </View>
                          </View>
                          <Text style={[styles.debtDate, { color: theme.textMuted }]}>{debt.createdAt}</Text>
                        </View>

                        <View style={styles.debtAmountsRow}>
                          <View>
                            <Text style={[styles.debtAmountLabel, { color: theme.textSecondary }]}>المبلغ الإجمالي</Text>
                            <Text style={[styles.debtAmountVal, { color: theme.text }]}>
                              {formatMoney(debt.totalAmount, debt.currency)}
                            </Text>
                          </View>
                          <View>
                            <Text style={[styles.debtAmountLabel, { color: theme.textSecondary }]}>المسدد</Text>
                            <Text style={[styles.debtAmountVal, { color: '#059669' }]}>
                              {formatMoney(debt.paidAmount, debt.currency)}
                            </Text>
                          </View>
                          <View>
                            <Text style={[styles.debtAmountLabel, { color: theme.textSecondary }]}>المتبقي</Text>
                            <Text style={[styles.debtAmountVal, { color: isSettled ? theme.textMuted : '#DC2626', fontWeight: 'bold' }]}>
                              {formatMoney(debt.remainingAmount, debt.currency)}
                            </Text>
                          </View>
                        </View>

                        {Boolean(debt.notes) && (
                          <Text style={[styles.debtNotes, { color: theme.textSecondary }]}>
                            {debt.notes}
                          </Text>
                        )}

                        {/* Installments Breakdown */}
                        {debt.installments && debt.installments.length > 0 && (
                          <View style={[styles.installmentsBox, { backgroundColor: theme.cardAlt }]}>
                            <Text style={[styles.installmentsHeader, { color: theme.textSecondary }]}>
                              الدفعات والأقساط المسجلة ({debt.installments.length}):
                            </Text>
                            {debt.installments.map((inst) => (
                              <View key={inst.id} style={styles.installmentRow}>
                                <Text style={[styles.instDate, { color: theme.textMuted }]}>{inst.date}</Text>
                                <Text style={[styles.instAmount, { color: '#059669' }]}>
                                  {formatMoney(inst.amount, debt.currency)}
                                </Text>
                                {inst.isNonCash ? (
                                  <Text style={styles.instNonCashTag}>غير نقدي: {inst.nonCashReason || 'تسوية'}</Text>
                                ) : (
                                  <Text style={[styles.instMethod, { color: theme.textSecondary }]}>
                                    نقدي
                                  </Text>
                                )}
                              </View>
                            ))}
                          </View>
                        )}

                        {/* Action on active debt */}
                        {!isSettled && onSettleDebt && (
                          <TouchableOpacity
                            style={[styles.settleBtn, { backgroundColor: theme.primary }]}
                            onPress={() => onSettleDebt(contact, debt)}
                            accessibilityRole="button"
                            accessibilityLabel={`تسجيل دفعة للدين ${debt.id}`}
                          >
                            <Ionicons name="add-circle-outline" size={14} color="#FFFFFF" />
                            <Text style={styles.settleBtnText}>تسجيل دفعة لهذا الدين</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  }}
                </PagedRows>
              )}
            </View>
          )}

          {/* Section 5: Direct Transactions */}
          {(activeTab === 'all' || activeTab === 'transactions') && (
            <View style={styles.tabContent}>
              <Text style={[styles.sectionHeading, { color: theme.text, marginTop: 12 }]}>
                معاملات المتعامل المباشرة ({directTransactions.items.length})
              </Text>
              {directTransactions.items.length === 0 ? (
                <View style={[styles.emptyBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Ionicons name="swap-horizontal-outline" size={32} color={theme.textMuted} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                    لا توجد حركات مالية مباشرة مسجلة لهذا الشخص.
                  </Text>
                </View>
              ) : (
                <PagedRows
                  items={directTransactions.items}
                  pageSize={activeTab === 'all' ? 5 : 10}
                  label="معاملات المتعامل المباشرة"
                  resetKey={contact.id}
                >
                  {(tx) => (
                    <View key={tx.id} style={[styles.directTxCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                      <View style={styles.directTxHeader}>
                        <Text style={[styles.directTxTitle, { color: theme.text }]}>{tx.title}</Text>
                        <Text style={[styles.directTxDate, { color: theme.textMuted }]}>{tx.date}</Text>
                      </View>
                      <View style={styles.directTxDetails}>
                        <Text style={[styles.directTxCategory, { color: theme.textSecondary }]}>التصنيف: {tx.category}</Text>
                        <Text style={[styles.directTxAmount, { color: tx.type === 'income' ? '#059669' : '#DC2626' }]}>
                          {formatMoney(tx.amount, tx.currency)}
                        </Text>
                      </View>
                      {Boolean(tx.notes) && (
                        <Text style={[styles.directTxNotes, { color: theme.textMuted }]}>{tx.notes}</Text>
                      )}
                    </View>
                  )}
                </PagedRows>
              )}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Note Editor Modal */}
        <Modal visible={noteEditVisible} transparent animationType="fade" onRequestClose={() => setNoteEditVisible(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.noteModalBackdrop, { backgroundColor: theme.overlay }]}
          >
            <View style={[styles.noteModalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text accessibilityRole="header" style={[styles.noteModalTitle, { color: theme.text }]}>
                تعديل ملاحظات المتعامل: {contact.name}
              </Text>
              <TextInput
                style={[styles.noteInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                multiline
                numberOfLines={4}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="أدخل ملاحظات حول التعامل أو الحساب..."
                placeholderTextColor={theme.textMuted}
                accessibilityLabel="ملاحظات المتعامل"
              />
              <View style={styles.noteModalActions}>
                <TouchableOpacity
                  style={[styles.noteCancelBtn, { backgroundColor: theme.cardAlt }]}
                  onPress={() => setNoteEditVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="إلغاء تعديل الملاحظات"
                >
                  <Text style={[styles.noteCancelText, { color: theme.textSecondary }]}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.noteSaveBtn, { backgroundColor: theme.primary }]}
                  onPress={handleSaveNotes}
                  accessibilityRole="button"
                  accessibilityLabel="حفظ الملاحظة"
                >
                  <Text style={styles.noteSaveText}>حفظ الملاحظة</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  headerTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  contactName: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  phoneRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    minHeight: MIN_TOUCH_TARGET,
  },
  phoneText: {
    fontSize: 13,
    fontWeight: '500',
  },
  statusBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  infoCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  infoValue: {
    fontSize: 13,
    flex: 1,
    textAlign: 'right',
  },
  quickActionsContainer: {
    marginBottom: 16,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: 8,
  },
  actionButtonsRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingVertical: 4,
  },
  actionBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  kpiCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  kpiHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 8,
  },
  kpiCurrencyBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  kpiCurrencyTitle: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  netBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  netBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  kpiGrid: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  kpiBox: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  kpiLabel: {
    fontSize: 11,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  kpiSub: {
    fontSize: 10,
  },
  dealsMiniSummary: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 4,
  },
  dealsStatRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  dealsStatLabel: {
    fontSize: 12,
  },
  dealsStatVal: {
    fontSize: 12,
  },
  tabsRow: {
    flexDirection: 'row-reverse',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    minHeight: 48,
    minWidth: 48,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  tabText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  tabContent: {
    gap: 10,
    marginBottom: 14,
  },
  emptyBox: {
    padding: 28,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  timelineCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderRightWidth: 4,
    gap: 6,
    marginBottom: 8,
  },
  timelineTopRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineTypeBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  timelineTypeLabel: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  nonCashBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  nonCashBadgeText: {
    color: '#8B5CF6',
    fontSize: 10,
    fontWeight: 'bold',
  },
  timelineDate: {
    fontSize: 11,
  },
  timelineDesc: {
    fontSize: 13,
  },
  timelineDetailsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  timelineAmount: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  timelineAccount: {
    fontSize: 11,
  },
  nonCashReasonText: {
    fontSize: 11,
    color: '#8B5CF6',
    fontStyle: 'italic',
  },
  timelineBalanceRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#00000010',
  },
  runningBalanceLabel: {
    fontSize: 11,
  },
  runningBalanceVal: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  debtCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderRightWidth: 4,
    gap: 6,
    marginBottom: 8,
  },
  debtHeaderRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debtBadgeGroup: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  dirBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  debtDate: {
    fontSize: 11,
  },
  debtAmountsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  debtAmountLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  debtAmountVal: {
    fontSize: 13,
  },
  debtNotes: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  installmentsBox: {
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
    marginBottom: 8,
    gap: 4,
  },
  installmentsHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  installmentRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  instDate: {
    fontSize: 10,
  },
  instAmount: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  instNonCashTag: {
    fontSize: 10,
    color: '#8B5CF6',
  },
  instMethod: {
    fontSize: 10,
  },
  settleBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    minHeight: 48,
    minWidth: 48,
  },
  settleBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  dealItemCard: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  dealTopRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dealTitle: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  dealDate: {
    fontSize: 11,
  },
  dealMetricsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  dealMetric: {
    fontSize: 11,
  },
  directTxCard: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    gap: 4,
  },
  directTxHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  directTxTitle: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  directTxDate: {
    fontSize: 11,
  },
  directTxDetails: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  directTxCategory: {
    fontSize: 11,
  },
  directTxAmount: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  directTxNotes: {
    fontSize: 10,
    marginTop: 4,
  },
  noteModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noteModalCard: {
    width: '100%',
    maxWidth: 420,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  noteModalTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'right',
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    minHeight: 90,
    textAlignVertical: 'top',
    textAlign: 'right',
    fontSize: 13,
    marginBottom: 14,
  },
  noteModalActions: {
    flexDirection: 'row-reverse',
    justifyContent: 'flex-start',
    gap: 10,
  },
  noteCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteCancelText: {
    fontSize: 13,
  },
  noteSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteSaveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
