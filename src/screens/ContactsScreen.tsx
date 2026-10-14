import { PagedRows } from '../components/PagedRows';
import { useFinancialSubmission, FinancialSaveNotice } from '../hooks/useFinancialSubmission';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import { ContactPerson, ContactRole } from '../types/mali';
import { CalmDropdown } from '../components/CalmDropdown';
import { UnifiedContactProfileModal } from '../components/UnifiedContactProfileModal';
import {
  exportFileOrShare,
  formatMoney,
  generateContactStatementCsv,
  matchesContact,
} from '../utils/exportHelper';

const CONTACT_ROLES: ContactRole[] = [
  'مكتب صرافة',
  'تاجر عملة',
  'شركة / مورد',
  'شريك تجاري',
  'شخصي / عميل',
];

export const ContactsScreen: React.FC = () => {
  const {
    state,
    theme,
    addContact,
    updateContact,
    deleteContact,
  } = useMali();


  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // Add / Edit Contact Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactPerson | null>(
    null
  );
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [roleInput, setRoleInput] = useState<ContactRole>('تاجر عملة');
  const [bankInput, setBankInput] = useState('');
  const [notesInput, setNotesInput] = useState('');

  // Person Detailed Ledger Modal
  const [selectedPerson, setSelectedPerson] = useState<ContactPerson | null>(
    null
  );

  const { submit, saving, error: submissionError, reject, fieldRef } = useFinancialSubmission(() => {
    setModalVisible(false); setEditingContact(null); setSelectedPerson(null);
    setNameInput(''); setPhoneInput(''); setBankInput(''); setNotesInput(''); setSearchQuery('');
  });

  // Helper to get all activity for a given contact
  const getPersonActivity = (person: ContactPerson) => {
    // 1. Deals bought from this person
    const boughtDeals = state.deals.filter(
      (d) => matchesContact(person, d.contactId, d.counterparty)
    );

    // 2. Sales sold to this person (across all deals)
    const soldEntries: {
      deal: typeof state.deals[0];
      sale: typeof state.deals[0]['sales'][0];
    }[] = [];

    state.deals.forEach((deal) => {
      deal.sales.forEach((sale) => {
        if (matchesContact(person, sale.contactId, sale.buyerName)) {
          soldEntries.push({ deal, sale });
        }
      });
    });

    // 3. Debts with this person
    const personDebts = state.debts.filter(
      (db) => matchesContact(person, db.contactId, db.personName)
    );

    const totalBoughtUsd = boughtDeals.reduce(
      (s, d) => s + d.totalUsdBought,
      0
    );
    const totalBoughtLyd = boughtDeals.reduce((s, d) => s + d.totalLydCost, 0);

    const totalSoldUsd = soldEntries.reduce(
      (s, item) => s + item.sale.usdAmount,
      0
    );
    const totalSoldLyd = soldEntries.reduce(
      (s, item) => s + item.sale.netLydReceived,
      0
    );
    const totalProfitFromSales = soldEntries.reduce(
      (s, item) => s + item.sale.profitLyd,
      0
    );

    const activeDebtReceivableLyd = personDebts
      .filter(
        (d) =>
          d.status === 'active' &&
          d.direction === 'receivable' &&
          d.currency === 'LYD'
      )
      .reduce((s, d) => s + d.remainingAmount, 0);

    const activeDebtPayableLyd = personDebts
      .filter(
        (d) =>
          d.status === 'active' &&
          d.direction === 'payable' &&
          d.currency === 'LYD'
      )
      .reduce((s, d) => s + d.remainingAmount, 0);

    const activeDebtReceivableUsd = personDebts
      .filter(
        (d) =>
          d.status === 'active' &&
          d.direction === 'receivable' &&
          d.currency === 'USD'
      )
      .reduce((s, d) => s + d.remainingAmount, 0);

    const activeDebtPayableUsd = personDebts
      .filter(
        (d) =>
          d.status === 'active' &&
          d.direction === 'payable' &&
          d.currency === 'USD'
      )
      .reduce((s, d) => s + d.remainingAmount, 0);

    const totalOperationsCount =
      boughtDeals.length + soldEntries.length + personDebts.length;

    return {
      boughtDeals,
      soldEntries,
      personDebts,
      totalBoughtUsd,
      totalBoughtLyd,
      totalSoldUsd,
      totalSoldLyd,
      totalProfitFromSales,
      activeDebtReceivableLyd,
      activeDebtPayableLyd,
      activeDebtReceivableUsd,
      activeDebtPayableUsd,
      totalOperationsCount,
    };
  };

  const filteredContacts = state.contacts.filter((c) => {
    if (roleFilter !== 'all' && c.role !== roleFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.bankDetails && c.bankDetails.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleOpenAddModal = () => {
    setEditingContact(null);
    setNameInput('');
    setPhoneInput('');
    setRoleInput('تاجر عملة');
    setBankInput('');
    setNotesInput('');
    setModalVisible(true);
  };

  const handleOpenEditModal = (c: ContactPerson) => {
    setEditingContact(c);
    setNameInput(c.name);
    setPhoneInput(c.phone);
    setRoleInput(c.role);
    setBankInput(c.bankDetails || '');
    setNotesInput(c.notes || '');
    setModalVisible(true);
  };

  const handleSaveContact = async () => {
    if (!nameInput.trim()) return reject('أدخل اسم المتعامل ثم أعد الحفظ.', 'nameInput');
    if (editingContact) {
      if (!await submit(() => updateContact(editingContact.id, {
        name: nameInput.trim(),
        phone: phoneInput.trim(),
        role: roleInput,
        bankDetails: bankInput.trim() || undefined,
        notes: notesInput.trim() || undefined,
      }))) return;
    } else {
      if (!await submit(() => addContact({
        name: nameInput.trim(),
        phone: phoneInput.trim(),
        role: roleInput,
        bankDetails: bankInput.trim() || undefined,
        notes: notesInput.trim() || undefined,
      }))) return;
    }
    setModalVisible(false);
  };

  const handleCallPhone = (phone: string) => {
    if (!phone) return;
    const clean = phone.replace(/[^0-9+]/g, '');
    Linking.openURL(`tel:${clean}`).catch(() => {});
  };

  const handleWhatsApp = (phone: string) => {
    if (!phone) return;
    let clean = phone.replace(/[^0-9]/g, '');
    if (clean.startsWith('09')) {
      clean = '218' + clean.slice(1);
    }
    Linking.openURL(`https://wa.me/${clean}`).catch(() => {});
  };

  // Global summary across all contacts
  const totalContactsCount = state.contacts.length;
  const totalUsdBoughtAll = state.deals.reduce(
    (s, d) => s + d.totalUsdBought,
    0
  );
  const totalUsdSoldAll = state.deals.reduce((s, d) => s + d.soldUsd, 0);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <FinancialSaveNotice error={submissionError} />
      {/* Compact Top Summary Strip */}
      <View
        style={[
          styles.summaryRow,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
            borderRadius: 14,
            borderWidth: 1,
            paddingVertical: 10,
            paddingHorizontal: 14,
            alignItems: 'center',
            justifyContent: 'space-between',
          },
        ]}
      >
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            المتعاملون
          </Text>
          <Text style={[styles.summaryVal, { color: theme.primary }]}>
            {totalContactsCount} جهات
          </Text>
        </View>
        <View
          style={{ width: 1, height: 26, backgroundColor: theme.border }}
        />
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            إجمالي الشراء منهم
          </Text>
          <Text style={[styles.summaryVal, { color: theme.blue }]}>
            {formatMoney(totalUsdBoughtAll, 'USD')}
          </Text>
        </View>
        <View
          style={{ width: 1, height: 26, backgroundColor: theme.border }}
        />
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            إجمالي البيع لهم
          </Text>
          <Text style={[styles.summaryVal, { color: theme.warning }]}>
            {formatMoney(totalUsdSoldAll, 'USD')}
          </Text>
        </View>
      </View>

      {/* Search, Filter Dropdown & Add Person Row */}
      <View style={styles.searchAndAddRow}>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
          style={[styles.addPersonBtn, { backgroundColor: theme.primary }, styles.touchTarget]}
          onPress={handleOpenAddModal}
        >
          <Ionicons name="person-add" size={16} color="#FFFFFF" />
          <Text style={styles.addPersonBtnText}>+ إضافة شخص</Text>
        </TouchableOpacity>

        <View style={{ width: 145 }}>
          <CalmDropdown disabled={saving} label="تصفية تصنيف المتعامل"
            compact
            value={roleFilter}
            options={[
              {
                value: 'all',
                label: `الكل (${state.contacts.length})`,
                icon: 'people-outline',
                badgeColor: theme.primary,
              },
              ...CONTACT_ROLES.map((r) => ({
                value: r,
                label: r,
                icon: 'person-outline',
                badgeColor: theme.blue,
              })),
            ]}
            onSelect={setRoleFilter}
          />
        </View>

        <View
          style={[
            styles.searchBox,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Ionicons name="search-outline" size={16} color={theme.textMuted} />
          <TextInput accessibilityLabel="البحث عن متعامل بالاسم أو الهاتف" ref={fieldRef('searchQuery')} role="searchbox" editable={!saving}
            style={[styles.searchInput, { color: theme.text }, styles.touchTarget]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="بحث بالاسم أو الهاتف..."
            placeholderTextColor={theme.textMuted}
          />
        </View>
      </View>

      {/* Contacts Cards List */}
      {<PagedRows items={filteredContacts} label="المتعاملون" disabled={saving} resetKey={JSON.stringify([roleFilter, searchQuery])}>{(person) => {
        const stats = getPersonActivity(person);

        return (
          <View
            key={person.id}
            style={[
              styles.personCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            {/* Header: Name, Role, Phone & Call/WhatsApp Buttons */}
            <View style={styles.personHeader}>
              <View style={styles.personHeaderRight}>
                <View
                  style={[
                    styles.avatarCircle,
                    {
                      backgroundColor: theme.primarySoft,
                      borderColor: theme.primary,
                    },
                  ]}
                >
                  <Ionicons name="person" size={18} color={theme.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameAndRoleRow}>
                    <Text style={[styles.personName, { color: theme.text }]}>
                      {person.name}
                    </Text>
                    <View
                      style={[
                        styles.roleBadge,
                        {
                          backgroundColor: theme.cardAlt,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.roleBadgeText,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {person.role}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.phoneRow}>
                    <Ionicons
                      name="call-outline"
                      size={13}
                      color={theme.blue}
                    />
                    <Text style={[styles.phoneText, { color: theme.blue }]}>
                      {person.phone || 'بدون رقم هاتف'}
                    </Text>
                    {person.bankDetails ? (
                      <Text
                        style={[
                          styles.bankInfoText,
                          { color: theme.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        • {person.bankDetails}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>

              <View style={styles.quickContactActions}>
                {person.phone ? (
                  <>
                    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} accessibilityLabel={`الاتصال بـ ${person.name}`} disabled={saving}
                      style={[
                        styles.iconCircleBtn,
                        {
                          backgroundColor: theme.primarySoft,
                          borderColor: theme.primary,
                        },
                        styles.touchTarget,
                      ]}
                      onPress={() => handleCallPhone(person.phone)}
                    >
                      <Ionicons name="call" size={15} color={theme.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} accessibilityLabel={`مراسلة ${person.name} عبر واتساب`} disabled={saving}
                      style={[
                        styles.iconCircleBtn,
                        {
                          backgroundColor: theme.successSoft,
                          borderColor: theme.success,
                        },
                        styles.touchTarget,
                      ]}
                      onPress={() => handleWhatsApp(person.phone)}
                    >
                      <Ionicons
                        name="logo-whatsapp"
                        size={15}
                        color={theme.success}
                      />
                    </TouchableOpacity>
                  </>
                ) : null}
                <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} accessibilityLabel={`تعديل بيانات ${person.name}`} disabled={saving}
                  style={[
                    styles.iconCircleBtn,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                    styles.touchTarget,
                  ]}
                  onPress={() => handleOpenEditModal(person)}
                >
                  <Ionicons
                    name="create-outline"
                    size={15}
                    color={theme.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Compact Buy & Sell Inline Strip */}
            <View
              style={{
                flexDirection: 'row-reverse',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: theme.cardAlt,
                borderRadius: 10,
                paddingVertical: 8,
                paddingHorizontal: 12,
                marginBottom: 8,
              }}
            >
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{ fontSize: 10, color: theme.textSecondary }}
                >
                  اشتريت منه ({stats.boughtDeals.length})
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: 'bold',
                    color: theme.primary,
                  }}
                >
                  {formatMoney(stats.totalBoughtUsd, 'USD')}
                </Text>
              </View>

              <View
                style={{ width: 1, height: 22, backgroundColor: theme.border }}
              />

              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{ fontSize: 10, color: theme.textSecondary }}
                >
                  بعت له ({stats.soldEntries.length})
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: 'bold',
                    color: theme.blue,
                  }}
                >
                  {formatMoney(stats.totalSoldUsd, 'USD')}
                </Text>
              </View>

              <View
                style={{ width: 1, height: 22, backgroundColor: theme.border }}
              />

              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{ fontSize: 10, color: theme.textSecondary }}
                >
                  الربح معه
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: 'bold',
                    color:
                      stats.totalProfitFromSales >= 0
                        ? theme.success
                        : theme.danger,
                  }}
                >
                  {stats.totalProfitFromSales >= 0 ? '+' : ''}
                  {formatMoney(stats.totalProfitFromSales, 'LYD')}
                </Text>
              </View>
            </View>

            {/* Active Debts Banner if any */}
            {(stats.activeDebtReceivableLyd > 0 ||
              stats.activeDebtPayableLyd > 0 ||
              stats.activeDebtReceivableUsd > 0 ||
              stats.activeDebtPayableUsd > 0) && (
              <View
                style={[
                  styles.debtStrip,
                  {
                    backgroundColor: theme.warningSoft,
                    borderColor: theme.warning,
                  },
                ]}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={15}
                  color={theme.warning}
                />
                <Text style={[styles.debtStripText, { color: theme.warning }]}>
                  ذمم قائمة:{' '}
                  {stats.activeDebtReceivableLyd > 0
                    ? `لي عنده ${formatMoney(stats.activeDebtReceivableLyd, 'LYD')} `
                    : ''}
                  {stats.activeDebtReceivableUsd > 0
                    ? `لي عنده ${formatMoney(stats.activeDebtReceivableUsd, 'USD')} `
                    : ''}
                  {stats.activeDebtPayableLyd > 0
                    ? `له عندي ${formatMoney(stats.activeDebtPayableLyd, 'LYD')} `
                    : ''}
                  {stats.activeDebtPayableUsd > 0
                    ? `له عندي ${formatMoney(stats.activeDebtPayableUsd, 'USD')}`
                    : ''}
                </Text>
              </View>
            )}

            {/* Footer: View Full Ledger & Export */}
            <View style={styles.cardFooter}>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                style={[
                  styles.ledgerBtn,
                  { backgroundColor: theme.primarySoft, borderWidth: 1, borderColor: theme.primary },
                  styles.touchTarget,
                ]}
                onPress={() => setSelectedPerson(person)}
              >
                <Ionicons
                  name="document-text-outline"
                  size={15}
                  color={theme.primary}
                />
                <Text style={[styles.ledgerBtnText, { color: theme.primary }]}>
                  سجل المعاملات ({stats.totalOperationsCount})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                style={[
                  styles.excelBtn,
                  {
                    backgroundColor: theme.cardAlt,
                    borderColor: theme.border,
                  },
                  styles.touchTarget,
                ]}
                onPress={() => {
                  const csv = generateContactStatementCsv(state, person);
                  exportFileOrShare(`كشف_معاملات_${person.name}.csv`, csv);
                }}
              >
                <Ionicons
                  name="download-outline"
                  size={15}
                  color={theme.textSecondary}
                />
                <Text
                  style={[styles.excelBtnText, { color: theme.textSecondary }]}
                >
                  Excel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }}</PagedRows>}

      {/* Modal 1: Unified Financial Profile for Selected Person */}
      <UnifiedContactProfileModal
        visible={Boolean(selectedPerson)}
        contact={selectedPerson}
        onClose={() => setSelectedPerson(null)}
      />

      {/* Modal 2: Add / Edit Person */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View
          style={[styles.modalBackdrop, { backgroundColor: theme.overlay }]}
        >
          <ScrollView
            contentContainerStyle={{ justifyContent: 'center', flexGrow: 1 }}
          >
            <View
              style={[
                styles.modalCard,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <FinancialSaveNotice error={submissionError} />
              <Text accessibilityRole="header" style={[styles.modalTitle, { color: theme.text }]}>
                {editingContact
                  ? `تعديل بيانات: ${editingContact.name}`
                  : 'إضافة شخص أو مكتب صرافة جديد'}
              </Text>

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                الاسم الكامل / اسم المكتب أو الشركة
              </Text>
              <TextInput accessibilityLabel="اسم المتعامل" ref={fieldRef('nameInput')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="مثال: مكتب الأفق للصرافة أو محمد السنوسي"
                placeholderTextColor={theme.textMuted}
              />

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                رقم الهاتف (للاتصال والواتساب)
              </Text>
              <TextInput accessibilityLabel="رقم هاتف المتعامل" ref={fieldRef('phoneInput')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                keyboardType="phone-pad"
                value={phoneInput}
                onChangeText={setPhoneInput}
                placeholder="091-XXXXXXX / 092-XXXXXXX"
                placeholderTextColor={theme.textMuted}
              />

              <CalmDropdown disabled={saving}
                label="تصنيف المتعامل:"
                value={roleInput}
                options={CONTACT_ROLES.map((r) => ({
                  value: r,
                  label: r,
                  icon: 'person-outline',
                  badgeColor: theme.primary,
                }))}
                onSelect={(val) => setRoleInput(val as ContactRole)}
              />

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                المصرف المعتاد / رقم حسابه أو طريقة التعامل
              </Text>
              <TextInput accessibilityLabel="بيانات مصرف المتعامل" ref={fieldRef('bankInput')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                value={bankInput}
                onChangeText={setBankInput}
                placeholder="مثال: مصرف الجمهورية / النوران / تعامل كاش"
                placeholderTextColor={theme.textMuted}
              />

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                ملاحظات إضافية
              </Text>
              <TextInput accessibilityLabel="ملاحظات المتعامل" ref={fieldRef('notesInput')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                value={notesInput}
                onChangeText={setNotesInput}
                placeholder="اختياري..."
                placeholderTextColor={theme.textMuted}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                  style={[
                    styles.cancelBtn,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                    styles.touchTarget,
                  ]}
                  onPress={() => setModalVisible(false)}
                >
                  <Text
                    style={[
                      styles.cancelBtnText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    إلغاء
                  </Text>
                </TouchableOpacity>
                {editingContact && (
                  <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                    style={[
                      styles.cancelBtn,
                      {
                        backgroundColor: theme.dangerSoft,
                        borderColor: theme.danger,
                      },
                      styles.touchTarget,
                    ]}
                    onPress={async () => {
                      if (!await submit(() => deleteContact(editingContact.id))) return;
                      setModalVisible(false);
                    }}
                  >
                    <Text
                      style={[styles.cancelBtnText, { color: theme.danger }]}
                    >
                      حذف
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                  style={[styles.saveBtn, { backgroundColor: theme.primary }, styles.touchTarget]}
                  onPress={handleSaveContact}
                >
                  <Text style={styles.saveBtnText}>حفظ بيانات الشخص</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  touchTarget: { minHeight: 48, minWidth: 48 },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  summaryRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  summaryBox: {
    flex: 1,
    minWidth: 140,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    alignItems: 'flex-end',
  },
  summaryLabel: {
    fontSize: 11,
    marginBottom: 4,
    fontWeight: '600',
  },
  summaryVal: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  searchAndAddRow: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginBottom: 12,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    textAlign: 'right',
    fontSize: 13,
  },
  addPersonBtn: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addPersonBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  rolesScroll: {
    marginBottom: 14,
  },
  rolesRow: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  rolePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  personCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  personHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  personHeaderRight: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  nameAndRoleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  personName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  phoneRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  phoneText: {
    fontSize: 13,
    fontWeight: '600',
  },
  bankInfoText: {
    fontSize: 12,
  },
  quickContactActions: {
    flexDirection: 'row-reverse',
    gap: 6,
  },
  iconCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statsGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
    minWidth: '30%',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    alignItems: 'flex-end',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  statVal: {
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 2,
  },
  statSub: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'right',
  },
  debtStrip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    padding: 9,
    marginBottom: 12,
    borderWidth: 1,
  },
  debtStripText: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'right',
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  ledgerBtn: {
    flex: 2,
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ledgerBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  excelBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  excelBtnText: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  modalHeaderRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  closeIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    textAlign: 'right',
  },
  ledgerSectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
    marginTop: 12,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 8,
  },
  historyItemCard: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
  },
  historyTopRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  historyMainTitle: {
    fontWeight: 'bold',
    fontSize: 13,
  },
  historyDate: {
    fontSize: 11,
  },
  historyDetail: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 2,
  },
  inputLabel: {
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 6,
    marginTop: 8,
    fontWeight: '600',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlign: 'right',
    fontSize: 14,
  },
  chipsWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
  },
  modalActions: {
    flexDirection: 'row-reverse',
    justifyContent: 'flex-start',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
