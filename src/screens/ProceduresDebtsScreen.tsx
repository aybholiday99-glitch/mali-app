import { PagedRows } from '../components/PagedRows';
import { useFinancialSubmission, FinancialSaveNotice } from '../hooks/useFinancialSubmission';
import { nextSubmissionKey } from '../services/submissionKey';
import { parseFinancialInput } from '../utils/financialInput';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import {
  ContactPerson,
  ContactRole,
  Currency,
  DebtRecord,
  DebtSettlementType,
  FinancialProcedure,
  PaymentMethodType,
} from '../types/mali';
import { canDisburseFromAccount } from '../services/financialEngine';
import { formatMoney, getPaymentMethodLabel } from '../utils/exportHelper';
import { CalmDropdown } from '../components/CalmDropdown';
import { UnifiedContactProfileModal } from '../components/UnifiedContactProfileModal';

const PROCEDURE_TYPES: FinancialProcedure['procedureType'][] = [
  'صك مصدق / مقاصة',
  'بطاقة دولية / أغراض شخصية',
  'تسييل / سحب مصرفي',
  'اعتماد / حوالة خارجية',
  'حجز مالي / التزام',
  'إجراء مصرفي عام',
];

export const ProceduresDebtsScreen: React.FC = () => {
  const [submissionKey, setSubmissionKey] = useState(nextSubmissionKey);
  const {
    state,
    theme,
    addContact,
    addDebt,
    addDebtInstallment,
    deleteDebtInstallment,
    deleteDebt,
    addProcedure,
    toggleProcedureStage,
    addProcedureStage,
    deleteProcedure,
  } = useMali();


  const [activeTab, setActiveTab] = useState<'debts' | 'procedures'>('debts');

  // New Debt Modal State
  const [newDebtModal, setNewDebtModal] = useState(false);
  const [personName, setPersonName] = useState('');
  const [phone, setPhone] = useState('');
  const [direction, setDirection] = useState<'receivable' | 'payable'>(
    'receivable'
  );
  const [debtCurrency, setDebtCurrency] = useState<Currency>('LYD');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtDueDate, setDebtDueDate] = useState('');
  const [affectWallet, setAffectWallet] = useState(true);
  const [selectedWalletId, setSelectedWalletId] = useState(
    state.accounts.find((a) => a.currency === 'LYD')?.id || state.accounts[0]?.id || ''
  );
  const [debtNotes, setDebtNotes] = useState('');
  const [debtError, setDebtError] = useState<string | null>(null);
  const [contactSelectionMode, setContactSelectionMode] = useState<'existing' | 'new'>(
    state.contacts.length > 0 ? 'existing' : 'new'
  );
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [contactSearchQuery, setContactSearchQuery] = useState('');
  const [newContactRole, setNewContactRole] = useState<ContactRole>('شخصي / عميل');
  const [profileModalContact, setProfileModalContact] = useState<ContactPerson | null>(null);

  // Debt Installment Modal State
  const [activeDebtForPay, setActiveDebtForPay] = useState<DebtRecord | null>(
    null
  );
  const [installmentAmt, setInstallmentAmt] = useState('');
  const [installmentAccId, setInstallmentAccId] = useState('');
  const [installmentMethod, setInstallmentMethod] =
    useState<PaymentMethodType>('cash');
  const [installmentNotes, setInstallmentNotes] = useState('');
  const [installmentSettlementType, setInstallmentSettlementType] =
    useState<DebtSettlementType>('cash');
  const [nonCashReason, setNonCashReason] = useState('');

  // New Procedure Modal State
  const [newProcModal, setNewProcModal] = useState(false);
  const [procTitle, setProcTitle] = useState('');
  const [procType, setProcType] = useState<FinancialProcedure['procedureType']>(
    PROCEDURE_TYPES[0]
  );
  const [procBank, setProcBank] = useState('');
  const [procRef, setProcRef] = useState('');
  const [procAmt, setProcAmt] = useState('');
  const [procCurrency] = useState<Currency>('LYD');
  const [procDueDate, setProcDueDate] = useState('');
  const [procStagesText, setProcStagesText] = useState(
    'تجهيز المستندات وتقديم الطلب\nمراجعة المصرف والمطابقة\nإتمام الإجراء ونزول القيمة بالحساب'
  );
  const [procNotes, setProcNotes] = useState('');

  // Add Stage inline state
  const [addingStageProcId, setAddingStageProcId] = useState<string | null>(
    null
  );
  const [newStageTitle, setNewStageTitle] = useState('');

  const { submit, saving, error: submissionError, reject, fieldRef } = useFinancialSubmission(() => {
    setSubmissionKey(nextSubmissionKey()); setNewDebtModal(false); setActiveDebtForPay(null); setNewProcModal(false); setAddingStageProcId(null);
    setPersonName(''); setPhone(''); setDebtAmount(''); setDebtNotes(''); setDebtDueDate(''); setDebtError(null);
    setSelectedWalletId(state.accounts.find((a) => a.currency === 'LYD')?.id || state.accounts[0]?.id || '');
    setInstallmentAmt(''); setInstallmentNotes(''); setInstallmentAccId('');
    setInstallmentSettlementType('cash'); setNonCashReason('');
    setProcTitle(''); setProcBank(''); setProcRef(''); setProcAmt(''); setProcNotes(''); setProcDueDate(''); setNewStageTitle('');
    setAffectWallet(true); setProcStagesText('');
  });

  // Totals for Debts
  const receivableLyd = state.debts
    .filter(
      (d) =>
        d.status === 'active' &&
        d.direction === 'receivable' &&
        d.currency === 'LYD'
    )
    .reduce((s, d) => s + d.remainingAmount, 0);

  const receivableUsd = state.debts
    .filter(
      (d) =>
        d.status === 'active' &&
        d.direction === 'receivable' &&
        d.currency === 'USD'
    )
    .reduce((s, d) => s + d.remainingAmount, 0);

  const payableLyd = state.debts
    .filter(
      (d) =>
        d.status === 'active' &&
        d.direction === 'payable' &&
        d.currency === 'LYD'
    )
    .reduce((s, d) => s + d.remainingAmount, 0);

  const payableUsd = state.debts
    .filter(
      (d) =>
        d.status === 'active' &&
        d.direction === 'payable' &&
        d.currency === 'USD'
    )
    .reduce((s, d) => s + d.remainingAmount, 0);

  const handleSaveDebt = async () => {
    let resolvedContactId: string | undefined = undefined;
    let finalPersonName = personName.trim();
    let finalPhone = phone.trim() || undefined;

    if (contactSelectionMode === 'existing') {
      const existing = state.contacts.find((c) => c.id === selectedContactId);
      if (!existing) {
        setDebtError('يرجى اختيار شخص من قائمة المتعاملين المسجلين، أو التبديل لإنشاء شخص جديد.');
        return reject('اختر شخصاً مسجلاً أو أنشئ شخصاً جديداً.', 'personName');
      }
      resolvedContactId = existing.id;
      finalPersonName = existing.name;
      finalPhone = existing.phone || finalPhone;
    } else {
      if (!finalPersonName) {
        setDebtError('أدخل اسم الشخص الجديد ثم أعد الحفظ.');
        return reject('أدخل اسم صاحب الدين ثم أعد الحفظ.', 'personName');
      }
      const existingContact = state.contacts.find(
        (c) => c.name.trim().toLowerCase() === finalPersonName.toLowerCase()
      );
      if (existingContact) {
        resolvedContactId = existingContact.id;
      } else {
        await addContact({
          name: finalPersonName,
          phone: finalPhone || '',
          role: newContactRole,
          notes: debtNotes.trim() || undefined,
        });
      }
    }

    const amt = parseFinancialInput(debtAmount);
    if (amt === null || amt <= 0) return reject('أدخل مبلغ دين صحيحاً أكبر من صفر.', 'debtAmount');
    setDebtError(null);

    let chosenWallet = undefined;
    if (affectWallet) {
      const validWallet = state.accounts.find(
        (a) => a.id === selectedWalletId && a.currency === debtCurrency
      );
      if (!validWallet) {
        setDebtError('اختر الخزينة المالية لإتمام الحركة، أو ألغِ تحديث الرصيد لتسجيل رصيد دين سابق.');
        return reject('اختر الخزينة المالية أو ألغِ تحديث الرصيد لتسجيل دين سابق.', 'selectedWalletId');
      }
      if (direction === 'receivable') {
        const disburse = canDisburseFromAccount(validWallet, amt);
        if (!disburse.allowed) {
          const err = `رصيد الخزينة (${formatMoney(disburse.available, debtCurrency)}) غير كافٍ لصرف القرض (${formatMoney(amt, debtCurrency)})! العجز: ${formatMoney(disburse.deficit, debtCurrency)}. (السحب على المكشوف غير مصرح به)`;
          setDebtError(err);
          return reject(err, 'debtAmount');
        }
      }
      chosenWallet = validWallet;
    }

    if (!await submit(() => addDebt({
      idempotencyKey: submissionKey + ":addDebt",
      contactId: resolvedContactId,
      personName: finalPersonName,
      phone: finalPhone,
      direction,
      currency: debtCurrency,
      totalAmount: amt,
      dueDate: debtDueDate.trim() || undefined,
      notes: debtNotes.trim() || undefined,
      affectAccountId:
        affectWallet && chosenWallet ? chosenWallet.id : undefined,
      paymentMethod: chosenWallet?.isCash === false ? 'transfer' : 'cash',
    }))) return;
    setSubmissionKey(nextSubmissionKey());
    setPersonName('');
    setPhone('');
    setSelectedContactId(null);
    setContactSearchQuery('');
    setDebtAmount('');
    setDebtDueDate('');
    setDebtNotes('');
    setAffectWallet(true);
    setNewDebtModal(false);
  };


  const handleSaveInstallment = async () => {
    if (!activeDebtForPay) return reject('اختر الدين الذي تريد تسجيل الدفعة له.');
    const amt = parseFinancialInput(installmentAmt);
    if (amt === null || amt <= 0) return reject('أدخل مبلغ دفعة صحيحاً أكبر من صفر.', 'installmentAmt');
    if (amt > activeDebtForPay.remainingAmount) {
      return reject(`قيمة الدفعة (${formatMoney(amt, activeDebtForPay.currency)}) تتجاوز المبلغ المتبقي (${formatMoney(activeDebtForPay.remainingAmount, activeDebtForPay.currency)}).`, 'installmentAmt');
    }

    if (installmentSettlementType === 'non_cash') {
      const reason = nonCashReason.trim() || installmentNotes.trim();
      if (!reason) {
        return reject('يرجى تحديد أو كتابة سبب وتفاصيل التسوية غير النقدية.', 'nonCashReason');
      }
      if (!await submit(() => addDebtInstallment({
        idempotencyKey: submissionKey + ":addDebtInstallment",
        debtId: activeDebtForPay.id,
        amount: amt,
        settlementType: 'non_cash',
        isNonCash: true,
        nonCashReason: reason,
        notes: installmentNotes.trim() || undefined,
        paymentMethod: 'cash',
      }))) return;
    } else {
      // Cash installment: Treasury is strictly mandatory
      const matchingAccs = state.accounts.filter(
        (a) => a.currency === activeDebtForPay.currency
      );
      if (matchingAccs.length === 0) {
        return reject(
          `لا توجد خزينة مسجلة بعملة الدين (${activeDebtForPay.currency}). يرجى إنشاء خزينة بهذه العملة أولاً لتسجيل دفعة نقدية، أو اختيار 'تسوية غير نقدية / مقاصة'.`,
          'installmentAccId'
        );
      }
      if (!installmentAccId) {
        return reject('اختر الخزينة التي تمت من خلالها حركة الدفعة.', 'installmentAccId');
      }
      const chosenAcc = matchingAccs.find((a) => a.id === installmentAccId);
      if (!chosenAcc) {
        return reject('اختر خزينة صالحة بنفس عملة الدين.', 'installmentAccId');
      }

      if (activeDebtForPay.direction === 'payable') {
        const disburse = canDisburseFromAccount(chosenAcc, amt);
        if (!disburse.allowed) {
          return reject(
            `رصيد الخزينة (${formatMoney(disburse.available, activeDebtForPay.currency)}) غير كافٍ لسداد هذا القسط (${formatMoney(amt, activeDebtForPay.currency)})! العجز: ${formatMoney(disburse.deficit, activeDebtForPay.currency)}. (السحب على المكشوف غير مصرح به لهذه الخزينة)`,
            'installmentAmt'
          );
        }
      }

      if (!await submit(() => addDebtInstallment({
        idempotencyKey: submissionKey + ":addDebtInstallment",
        debtId: activeDebtForPay.id,
        amount: amt,
        accountId: chosenAcc.id,
        settlementType: 'cash',
        isNonCash: false,
        paymentMethod: installmentMethod,
        notes: installmentNotes.trim() || undefined,
      }))) return;
    }

    setSubmissionKey(nextSubmissionKey());
    setActiveDebtForPay(null);
    setInstallmentAmt('');
    setInstallmentNotes('');
    setInstallmentAccId('');
    setInstallmentSettlementType('cash');
    setNonCashReason('');
  };

  const handleSaveProcedure = async () => {
    if (!procTitle.trim()) return reject('أدخل عنوان الإجراء المالي ثم أعد الحفظ.', 'procTitle');
    const amt = procAmt.trim() ? parseFinancialInput(procAmt) : undefined;
    if (amt === null || (amt !== undefined && amt < 0)) return reject('أدخل مبلغ إجراء صحيحاً لا يقل عن صفر أو اتركه فارغاً.', 'procAmt');
    const stages = procStagesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!await submit(() => addProcedure({
      title: procTitle.trim(),
      procedureType: procType,
      bankOrEntity: procBank.trim() || 'مصرف / جهة مالية',
      referenceNumber: procRef.trim() || undefined,
      amount: amt,
      currency: procCurrency,
      dueDate: procDueDate.trim() || undefined,
      stages,
      notes: procNotes.trim() || undefined,
    }))) return;

    setProcTitle('');
    setProcBank('');
    setProcRef('');
    setProcAmt('');
    setProcNotes('');
    setNewProcModal(false);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <FinancialSaveNotice error={submissionError} />
      {/* Sub-navigation Tabs */}
      <View accessibilityRole="tablist" accessibilityLabel="الديون والإجراءات المالية"
        style={[
          styles.subTabs,
          { backgroundColor: theme.cardAlt, borderColor: theme.border },
        ]}
      >
        <TouchableOpacity aria-selected={activeTab === 'debts'} accessibilityRole="tab" accessibilityState={{ disabled: saving, selected: activeTab === 'debts' }} disabled={saving}
          style={[
            styles.subTab,
            activeTab === 'debts' && {
              backgroundColor: theme.card,
              shadowColor: '#000',
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 1,
            },
            styles.touchTarget,
          ]}
          onPress={() => setActiveTab('debts')}
        >
          <Ionicons
            name="people-outline"
            size={16}
            color={
              activeTab === 'debts' ? theme.primary : theme.textSecondary
            }
          />
          <Text
            style={[
              styles.subTabText,
              {
                color:
                  activeTab === 'debts' ? theme.primary : theme.textSecondary,
              },
              activeTab === 'debts' && { fontWeight: 'bold' },
            ]}
          >
            الديون والأمانات (لي / عليّ)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity aria-selected={activeTab === 'procedures'} accessibilityRole="tab" accessibilityState={{ disabled: saving, selected: activeTab === 'procedures' }} disabled={saving}
          style={[
            styles.subTab,
            activeTab === 'procedures' && {
              backgroundColor: theme.card,
              shadowColor: '#000',
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 1,
            },
            styles.touchTarget,
          ]}
          onPress={() => setActiveTab('procedures')}
        >
          <Ionicons
            name="checkbox-outline"
            size={16}
            color={
              activeTab === 'procedures' ? theme.primary : theme.textSecondary
            }
          />
          <Text
            style={[
              styles.subTabText,
              {
                color:
                  activeTab === 'procedures'
                    ? theme.primary
                    : theme.textSecondary,
              },
              activeTab === 'procedures' && { fontWeight: 'bold' },
            ]}
          >
            الإجراءات المالية والصكوك ({state.procedures.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'debts' ? (
        <>
          {/* Debts KPI Cards */}
          <View style={styles.kpiRow}>
            <View
              style={[
                styles.kpiCard,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  borderTopWidth: 3,
                  borderTopColor: theme.success,
                },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: theme.textSecondary }]}>
                إجمالي ديون لي عند الغير (مستحقاتي)
              </Text>
              <Text style={[styles.kpiVal, { color: theme.success }]}>
                {formatMoney(receivableLyd, 'LYD')}
              </Text>
              <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
                + مستحقات بالدولار: {formatMoney(receivableUsd, 'USD')}
              </Text>
            </View>

            <View
              style={[
                styles.kpiCard,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  borderTopWidth: 3,
                  borderTopColor: theme.danger,
                },
              ]}
            >
              <Text style={[styles.kpiLabel, { color: theme.textSecondary }]}>
                إجمالي ديون وأمانات عليّ للغير
              </Text>
              <Text style={[styles.kpiVal, { color: theme.danger }]}>
                {formatMoney(payableLyd, 'LYD')}
              </Text>
              <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
                + التزامات بالدولار: {formatMoney(payableUsd, 'USD')}
              </Text>
            </View>
          </View>

          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
            style={[
              styles.primaryActionBtn,
              { backgroundColor: theme.primary },
              styles.touchTarget,
            ]}
            onPress={() => {
              const defaultAcc = state.accounts.find((a) => a.currency === debtCurrency);
              if (defaultAcc) {
                setSelectedWalletId(defaultAcc.id);
              }
              setContactSelectionMode(state.contacts.length > 0 ? 'existing' : 'new');
              setNewDebtModal(true);
            }}
          >
            <Ionicons name="add-circle" size={20} color="#FFFFFF" />
            <Text style={styles.primaryActionBtnText}>
              إضافة دين جديد أو أمانة مالية (لي / عليّ)
            </Text>
          </TouchableOpacity>

          {/* Debts List */}
          {<PagedRows items={state.debts} label="الديون" disabled={saving}>{(debt) => {
            const pct =
              debt.totalAmount > 0
                ? Math.min(
                    100,
                    Math.round((debt.paidAmount / debt.totalAmount) * 100)
                  )
                : 0;
            const isReceivable = debt.direction === 'receivable';
            const originAccount = debt.accountId
              ? state.accounts.find((a) => a.id === debt.accountId)
              : undefined;

            return (
              <View
                key={debt.id}
                style={[
                  styles.card,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgeRow}>
                      <View
                        style={[
                          styles.dirBadge,
                          {
                            backgroundColor: isReceivable
                              ? theme.successSoft
                              : theme.dangerSoft,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: isReceivable ? theme.success : theme.danger,
                            fontSize: 11,
                            fontWeight: 'bold',
                          }}
                        >
                          {isReceivable
                            ? 'دين لي عند الغير (مستحق لي)'
                            : 'دين / أمانة عليّ للغير'}
                        </Text>
                      </View>
                      {originAccount ? (
                        <View
                          style={[
                            styles.treasuryBadge,
                            {
                              backgroundColor: theme.cardAlt,
                              borderColor: theme.border,
                            },
                          ]}
                        >
                          <Ionicons
                            name={originAccount.isCash ? 'cash-outline' : 'card-outline'}
                            size={12}
                            color={theme.primary}
                          />
                          <Text
                            style={{
                              fontSize: 11,
                              color: theme.textSecondary,
                            }}
                          >
                            {isReceivable
                              ? `صُرف من: ${originAccount.name}`
                              : `أُودع في: ${originAccount.name}`}
                          </Text>
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.treasuryBadge,
                            {
                              backgroundColor: theme.cardAlt,
                              borderColor: theme.border,
                            },
                          ]}
                        >
                          <Ionicons
                            name="document-text-outline"
                            size={12}
                            color={theme.textMuted}
                          />
                          <Text
                            style={{
                              fontSize: 11,
                              color: theme.textMuted,
                            }}
                          >
                            رصيد سابق (بدون خزينة)
                          </Text>
                        </View>
                      )}
                      {debt.dueDate && (
                        <Text
                          style={[
                            styles.dateTag,
                            { color: theme.textSecondary },
                          ]}
                        >
                          الاستحقاق: {debt.dueDate}
                        </Text>
                      )}
                    </View>

                    <View style={styles.debtPersonRow}>
                      <Text style={[styles.cardTitle, { color: theme.text }]}>
                        {debt.personName}
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.profilePillBtn,
                          {
                            backgroundColor: theme.primary + '18',
                            borderColor: theme.primary + '40',
                          },
                        ]}
                        onPress={() => {
                          const matching = state.contacts.find(
                            (c) =>
                              c.id === debt.contactId ||
                              (c.name &&
                                c.name.trim().toLowerCase() ===
                                  debt.personName.trim().toLowerCase())
                          ) || {
                            id: debt.contactId || debt.personName,
                            name: debt.personName,
                            phone: debt.phone || '',
                            role: 'شخصي / عميل' as const,
                            createdAt: debt.createdAt,
                          };
                          setProfileModalContact(matching);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`عرض الملف المالي لـ ${debt.personName}`}
                      >
                        <Ionicons name="folder-open-outline" size={13} color={theme.primary} />
                        <Text style={[styles.profilePillText, { color: theme.primary }]}>الملف المالي</Text>
                      </TouchableOpacity>
                    </View>
                    {debt.notes ? (
                      <Text
                        style={[styles.cardSub, { color: theme.textSecondary }]}
                      >
                        {debt.notes}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.remBox}>
                    <Text
                      style={[styles.remLabel, { color: theme.textSecondary }]}
                    >
                      المتبقي
                    </Text>
                    <Text
                      style={[
                        styles.remVal,
                        { color: isReceivable ? theme.success : theme.danger },
                      ]}
                    >
                      {formatMoney(debt.remainingAmount, debt.currency)}
                    </Text>
                    <Text
                      style={[styles.totalSmall, { color: theme.textMuted }]}
                    >
                      من أصل {formatMoney(debt.totalAmount, debt.currency)}
                    </Text>
                  </View>
                </View>

                {/* Progress Bar */}
                <View style={styles.progressSection}>
                  <View style={styles.progressHeader}>
                    <Text
                      style={[
                        styles.progressLabel,
                        { color: theme.textSecondary },
                      ]}
                    >
                      المسدد: {formatMoney(debt.paidAmount, debt.currency)}
                    </Text>
                    <Text
                      style={[styles.progressPct, { color: theme.primary }]}
                    >
                      {pct}%
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.progressBarBg,
                      { backgroundColor: theme.cardAlt },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${pct}%`,
                          backgroundColor: isReceivable
                            ? theme.primary
                            : theme.blue,
                        },
                      ]}
                    />
                  </View>
                </View>

                {/* Installments History */}
                {debt.installments.length > 0 && (
                  <View
                    style={[
                      styles.installmentsBox,
                      {
                        backgroundColor: theme.cardAlt,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.installmentsTitle,
                        { color: theme.blue },
                      ]}
                    >
                      دفعات التسديد المسجلة ({debt.installments.length}):
                    </Text>
                    {<PagedRows items={debt.installments} label="دفعات الدين" disabled={saving} resetKey={debt.id} pageSize={10}>{(inst) => {
                      const instAcc = inst.accountId
                        ? state.accounts.find((a) => a.id === inst.accountId)
                        : undefined;
                      const isNonCash = inst.isNonCash || inst.settlementType === 'non_cash';
                      return (
                        <View key={inst.id} style={[styles.instRow, { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }]}>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.instText,
                                { color: theme.textSecondary },
                              ]}
                            >
                              • {inst.date}: دفعة بقيمة{' '}
                              <Text style={{ fontWeight: 'bold', color: theme.text }}>
                                {formatMoney(inst.amount, debt.currency)}
                              </Text>
                              {isNonCash ? (
                                <Text style={{ color: '#8B5CF6', fontWeight: 'bold' }}>
                                  {' '}• [تسوية غير نقدية: {inst.nonCashReason || 'مقاصة'}]
                                </Text>
                              ) : (
                                <>
                                  {' '}({getPaymentMethodLabel(inst.paymentMethod)})
                                  {instAcc ? (
                                    <Text style={{ color: theme.primary, fontWeight: '600' }}>
                                      {' '}• {isReceivable ? `أُودعت في: ${instAcc.name}` : `دُفعت من: ${instAcc.name}`}
                                    </Text>
                                  ) : null}
                                </>
                              )}
                              {inst.notes ? ` - ${inst.notes}` : ''}
                            </Text>
                          </View>
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`حذف دفعة ${formatMoney(inst.amount, debt.currency)}`}
                            disabled={saving}
                            style={[styles.touchTarget, { padding: 6, marginLeft: 8 }]}
                            onPress={async () => {
                              await submit(() => deleteDebtInstallment(debt.id, inst.id));
                            }}
                          >
                            <Ionicons name="trash-outline" size={16} color={theme.danger} />
                          </TouchableOpacity>
                        </View>
                      );
                    }}</PagedRows>}
                  </View>
                )}

                <View style={styles.cardActions}>
                  {debt.remainingAmount > 0 && (
                    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                      style={[
                        styles.payInstallmentBtn,
                        { backgroundColor: theme.primary },
                        styles.touchTarget,
                      ]}
                      onPress={() => {
                        const matchingAccs = state.accounts.filter(
                          (a) => a.currency === debt.currency
                        );
                        setActiveDebtForPay(debt);
                        setInstallmentAmt(String(debt.remainingAmount));
                        setInstallmentAccId(matchingAccs[0]?.id || '');
                        setInstallmentSettlementType('cash');
                        setNonCashReason('');
                      }}
                    >
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={16}
                        color="#FFFFFF"
                      />
                      <Text style={styles.payInstallmentBtnText}>
                        {isReceivable
                          ? 'تسجيل تحصيل دفعة'
                          : 'تسجيل سداد دفعة'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} accessibilityLabel={`حذف دين ${debt.personName}`} disabled={saving}
                    style={[
                      styles.deleteBtn,
                      {
                        backgroundColor: theme.dangerSoft,
                        borderColor: theme.danger,
                      },
                      styles.touchTarget,
                    ]}
                    onPress={async () => await submit(() => deleteDebt(debt.id))}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={16}
                      color={theme.danger}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}</PagedRows>}
        </>
      ) : (
        /* Financial Procedures Tab */
        <>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
            style={[
              styles.primaryActionBtn,
              { backgroundColor: theme.primary },
              styles.touchTarget,
            ]}
            onPress={() => setNewProcModal(true)}
          >
            <Ionicons name="add-circle" size={20} color="#FFFFFF" />
            <Text style={styles.primaryActionBtnText}>
              إضافة إجراء مالي / معاملة مصرفية / صك قيد المقاصة
            </Text>
          </TouchableOpacity>

          {<PagedRows items={state.procedures} label="الإجراءات" disabled={saving}>{(proc) => {
            const doneCount = proc.stages.filter((s) => s.completed).length;
            const totalCount = proc.stages.length || 1;
            const pct = Math.round((doneCount / totalCount) * 100);

            return (
              <View
                key={proc.id}
                style={[
                  styles.card,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgeRow}>
                      <View
                        style={[
                          styles.procTypeBadge,
                          {
                            backgroundColor: theme.blueSoft,
                            borderColor: theme.blue,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.procTypeText, { color: theme.blue }]}
                        >
                          {proc.procedureType}
                        </Text>
                      </View>
                      {proc.referenceNumber && (
                        <Text
                          style={[
                            styles.refBadge,
                            { color: theme.warning },
                          ]}
                        >
                          رقم الإشارة/الصك: {proc.referenceNumber}
                        </Text>
                      )}
                    </View>

                    <Text style={[styles.cardTitle, { color: theme.text }]}>
                      {proc.title}
                    </Text>
                    <Text
                      style={[styles.cardSub, { color: theme.textSecondary }]}
                    >
                      {proc.bankOrEntity}{' '}
                      {proc.dueDate
                        ? `• تاريخ المتابعة: ${proc.dueDate}`
                        : ''}
                    </Text>
                  </View>

                  {proc.amount ? (
                    <View style={styles.remBox}>
                      <Text
                        style={[
                          styles.remLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        القيمة المرتبطة
                      </Text>
                      <Text style={[styles.remVal, { color: theme.blue }]}>
                        {formatMoney(proc.amount, proc.currency || 'LYD')}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {proc.notes ? (
                  <Text
                    style={[
                      styles.procNotes,
                      {
                        backgroundColor: theme.cardAlt,
                        color: theme.textSecondary,
                      },
                    ]}
                  >
                    {proc.notes}
                  </Text>
                ) : null}

                {/* Stages Checklist */}
                <View
                  style={[
                    styles.stagesBox,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <View style={styles.progressHeader}>
                    <Text
                      style={[styles.stagesHeaderTitle, { color: theme.text }]}
                    >
                      مراحل تنفيذ الإجراء (اضغط لتغيير حالة المرحلة):
                    </Text>
                    <Text
                      style={[styles.progressPct, { color: theme.primary }]}
                    >
                      {doneCount}/{proc.stages.length} مكتمل ({pct}%)
                    </Text>
                  </View>

                  {<PagedRows items={proc.stages} label="مراحل الإجراء" disabled={saving} resetKey={proc.id} pageSize={10}>{(st) => (
                    <TouchableOpacity aria-checked={st.completed} accessibilityRole="checkbox" accessibilityState={{ disabled: saving, checked: st.completed }} accessibilityLabel={`${proc.title}: ${st.title}`} disabled={saving}
                      key={st.id}
                      style={[
                        styles.stageRow,
                        { borderBottomColor: theme.border },
                        styles.touchTarget,
                      ]}
                      onPress={async () => await submit(() => toggleProcedureStage(proc.id, st.id))}
                    >
                      <Ionicons
                        name={st.completed ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={st.completed ? theme.primary : theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.stageTitle,
                          {
                            color: st.completed ? theme.primary : theme.text,
                          },
                          st.completed && styles.stageTitleCompleted,
                        ]}
                      >
                        {st.title}
                      </Text>
                      {st.completedAt && (
                        <Text
                          style={[
                            styles.stageDate,
                            { color: theme.textMuted },
                          ]}
                        >
                          {st.completedAt}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}</PagedRows>}

                  {addingStageProcId === proc.id ? (
                    <View style={styles.addStageInline}>
                      <TextInput accessibilityLabel="اسم المرحلة الجديدة" ref={fieldRef('newStageTitle')} editable={!saving}
                        style={[
                          styles.input,
                          {
                            flex: 1,
                            paddingVertical: 6,
                            backgroundColor: theme.inputBg,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                          styles.touchTarget,
                        ]}
                        value={newStageTitle}
                        onChangeText={setNewStageTitle}
                        placeholder="اكتب اسم المرحلة الجديدة..."
                        placeholderTextColor={theme.textMuted}
                      />
                      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                        style={[
                          styles.inlineSaveBtn,
                          { backgroundColor: theme.primary },
                          styles.touchTarget,
                        ]}
                        onPress={async () => {
                          if (!newStageTitle.trim()) return reject('أدخل اسم المرحلة الجديدة.', 'newStageTitle');
                          if (!await submit(() => addProcedureStage(proc.id, newStageTitle))) return;
                          setNewStageTitle('');
                          setAddingStageProcId(null);
                        }}
                      >
                        <Text style={styles.inlineSaveText}>إضافة</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.procFooterRow}>
                      <TouchableOpacity style={styles.touchTarget} accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                        onPress={() => setAddingStageProcId(proc.id)}
                      >
                        <Text
                          style={[styles.addStageLink, { color: theme.blue }]}
                        >
                          + إضافة خطوة أو مرحلة جديدة
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.touchTarget} accessibilityRole="button" accessibilityState={{ disabled: saving }} accessibilityLabel={`حذف إجراء ${proc.title}`} disabled={saving}
                        onPress={async () => await submit(() => deleteProcedure(proc.id))}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={theme.danger}
                        />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          }}</PagedRows>}
        </>
      )}

      {/* Modal 1: Add New Debt / Trust */}
      <Modal
        visible={newDebtModal}
        transparent
        animationType="fade"
        onRequestClose={() => setNewDebtModal(false)}
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
                تسجيل دين جديد أو أمانة مالية
              </Text>

              <CalmDropdown disabled={saving}
                label="نوع الدين / الأمانة:"
                value={direction}
                options={[
                  {
                    value: 'receivable',
                    label: 'دين لي عند الغير (مستحق لي)',
                    subLabel: 'أموال لي عند أشخاص أو جهات',
                    icon: 'arrow-down-circle-outline',
                    badgeColor: theme.success,
                  },
                  {
                    value: 'payable',
                    label: 'دين / أمانة عليّ للغير',
                    subLabel: 'التزام أو أمانة مستحقة للغير',
                    icon: 'arrow-up-circle-outline',
                    badgeColor: theme.danger,
                  },
                ]}
                onSelect={(val) => setDirection(val as 'receivable' | 'payable')}
              />

              {/* Person Selection Mode Segmented Selector */}
              <View style={[styles.contactModeSelector, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
                <TouchableOpacity
                  style={[
                    styles.contactModeTab,
                    contactSelectionMode === 'existing' && [styles.contactModeTabActive, { backgroundColor: theme.card }],
                  ]}
                  onPress={() => {
                    setContactSelectionMode('existing');
                    setDebtError(null);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: contactSelectionMode === 'existing' }}
                >
                  <Ionicons
                    name="people-outline"
                    size={16}
                    color={contactSelectionMode === 'existing' ? theme.primary : theme.textSecondary}
                  />
                  <Text
                    style={[
                      styles.contactModeTabText,
                      { color: contactSelectionMode === 'existing' ? theme.primary : theme.textSecondary },
                    ]}
                  >
                    شخص مسجل ({state.contacts.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.contactModeTab,
                    contactSelectionMode === 'new' && [styles.contactModeTabActive, { backgroundColor: theme.card }],
                  ]}
                  onPress={() => {
                    setContactSelectionMode('new');
                    setSelectedContactId(null);
                    setDebtError(null);
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: contactSelectionMode === 'new' }}
                >
                  <Ionicons
                    name="person-add-outline"
                    size={16}
                    color={contactSelectionMode === 'new' ? theme.primary : theme.textSecondary}
                  />
                  <Text
                    style={[
                      styles.contactModeTabText,
                      { color: contactSelectionMode === 'new' ? theme.primary : theme.textSecondary },
                    ]}
                  >
                    إنشاء شخص جديد
                  </Text>
                </TouchableOpacity>
              </View>

              {contactSelectionMode === 'existing' ? (
                <View style={styles.existingContactContainer}>
                  <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                    اختر المتعامل من القائمة أو ابحث باسمه/هاتفه
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text },
                      styles.touchTarget,
                    ]}
                    value={contactSearchQuery}
                    onChangeText={setContactSearchQuery}
                    placeholder="ابحث بالاسم أو رقم الهاتف..."
                    placeholderTextColor={theme.textMuted}
                    accessibilityLabel="بحث في المتعاملين"
                  />

                  {/* Filtered contacts list */}
                  <ScrollView
                    nestedScrollEnabled
                    style={[styles.contactPickerList, { maxHeight: 150, borderColor: theme.border }]}
                  >
                    {state.contacts
                      .filter((c) => {
                        if (!contactSearchQuery.trim()) return true;
                        const q = contactSearchQuery.trim().toLowerCase();
                        return (
                          c.name.toLowerCase().includes(q) ||
                          c.phone.toLowerCase().includes(q)
                        );
                      })
                      .map((c) => {
                        const isSelected = selectedContactId === c.id;
                        return (
                          <TouchableOpacity
                            key={c.id}
                            style={[
                              styles.contactPickerItem,
                              {
                                backgroundColor: isSelected ? theme.primary + '18' : theme.cardAlt,
                                borderColor: isSelected ? theme.primary : theme.border,
                              },
                            ]}
                            onPress={() => {
                              setSelectedContactId(c.id);
                              setPersonName(c.name);
                              setPhone(c.phone || '');
                              setDebtError(null);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`اختيار المتعامل ${c.name}`}
                          >
                            <Ionicons
                              name={isSelected ? 'checkmark-circle' : 'person-outline'}
                              size={18}
                              color={isSelected ? theme.primary : theme.textSecondary}
                            />
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text style={[styles.contactPickerName, { color: theme.text, fontWeight: isSelected ? 'bold' : 'normal' }]}>
                                {c.name}
                              </Text>
                              <Text style={[styles.contactPickerSub, { color: theme.textSecondary }]}>
                                {c.phone ? `${c.phone} • ` : ''}{c.role}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                  </ScrollView>

                  {selectedContactId ? (
                    <View style={[styles.selectedContactBadge, { backgroundColor: theme.primary + '15', borderColor: theme.primary }]}>
                      <Ionicons name="checkmark-done-circle" size={18} color={theme.primary} />
                      <Text style={[styles.selectedContactText, { color: theme.primary }]}>
                        تم الربط بملف: {state.contacts.find((c) => c.id === selectedContactId)?.name}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.unselectedWarningText, { color: theme.warning }]}>
                      ⚠️ يرجى النقر على شخص من القائمة أعلاه لربط الدين بملفه المالي.
                    </Text>
                  )}
                </View>
              ) : (
                <View style={styles.newContactContainer}>
                  <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                    اسم الشخص أو الجهة *
                  </Text>
                  <TextInput
                    accessibilityLabel="اسم صاحب الدين"
                    ref={fieldRef('personName')}
                    editable={!saving}
                    style={[
                      styles.input,
                      { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text },
                      styles.touchTarget,
                    ]}
                    value={personName}
                    onChangeText={setPersonName}
                    placeholder="مثال: محمد السنوسي / شركة الأمل..."
                    placeholderTextColor={theme.textMuted}
                  />

                  <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                    رقم الهاتف (اختياري)
                  </Text>
                  <TextInput
                    accessibilityLabel="رقم هاتف صاحب الدين"
                    ref={fieldRef('phone')}
                    editable={!saving}
                    keyboardType="phone-pad"
                    style={[
                      styles.input,
                      { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text },
                      styles.touchTarget,
                    ]}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="091xxxxxxx"
                    placeholderTextColor={theme.textMuted}
                  />

                  <CalmDropdown
                    disabled={saving}
                    label="نوع العلاقة مع الشخص:"
                    value={newContactRole}
                    options={[
                      { value: 'شخصي / عميل', label: 'شخصي / عميل', icon: 'person-outline', badgeColor: theme.primary },
                      { value: 'شركة / مورد', label: 'شركة / مورد', icon: 'business-outline', badgeColor: theme.warning },
                      { value: 'تاجر عملة', label: 'تاجر عملة', icon: 'cash-outline', badgeColor: theme.blue },
                      { value: 'مكتب صرافة', label: 'مكتب صرافة', icon: 'storefront-outline', badgeColor: '#8B5CF6' },
                      { value: 'شريك تجاري', label: 'شريك تجاري', icon: 'hand-left-outline', badgeColor: theme.success },
                    ]}
                    onSelect={(val) => setNewContactRole(val as ContactRole)}
                  />
                </View>
              )}
              {debtError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: theme.danger, textAlign: 'right' }}>{debtError}</Text>}


              <View style={styles.twoColRow}>
                <View style={{ flex: 2 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    المبلغ الكلي
                  </Text>
                  <TextInput accessibilityLabel="قيمة الدين" ref={fieldRef('debtAmount')} editable={!saving}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                      styles.touchTarget,
                    ]}
                    keyboardType="numeric"
                    value={debtAmount}
                    onChangeText={setDebtAmount}
                    placeholder="0.00"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <CalmDropdown disabled={saving}
                    label="العملة"
                    value={debtCurrency}
                    options={[
                      {
                        value: 'LYD',
                        label: 'دينار (LYD)',
                        icon: 'wallet-outline',
                        badgeColor: theme.primary,
                      },
                      {
                        value: 'USD',
                        label: 'دولار ($)',
                        icon: 'logo-usd',
                        badgeColor: theme.warning,
                      },
                    ]}
                    onSelect={(val) => {
                      const nextCurr = val as Currency;
                      setDebtCurrency(nextCurr);
                      const matchingAcc = state.accounts.find(
                        (a) => a.currency === nextCurr
                      );
                      if (matchingAcc) {
                        setSelectedWalletId(matchingAcc.id);
                      }
                    }}
                  />
                </View>
              </View>

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                تاريخ الاستحقاق / التذكير
              </Text>
              <TextInput accessibilityLabel="تاريخ استحقاق الدين" ref={fieldRef('debtDueDate')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                value={debtDueDate}
                onChangeText={setDebtDueDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textMuted}
              />

              {affectWallet ? (
                <>
                  <CalmDropdown
                    disabled={saving}
                    label={
                      direction === 'receivable'
                        ? 'الخزينة التي تم إعطاء المبلغ منها (سيتم الخصم منها):'
                        : 'الخزينة التي استلمت المبلغ فيها (سيتم الإيداع فيها):'
                    }
                    value={selectedWalletId}
                    options={state.accounts
                      .filter((a) => a.currency === debtCurrency)
                      .map((acc) => ({
                        value: acc.id,
                        label: acc.name,
                        subLabel: `الرصيد: ${formatMoney(acc.balance, acc.currency)} • ${
                          acc.isCash ? 'نقدي كاش' : acc.bankName
                        }`,
                        icon: acc.isCash ? 'cash-outline' : 'card-outline',
                        badgeColor: acc.color,
                      }))}
                    onSelect={setSelectedWalletId}
                  />

                  {state.accounts.filter((a) => a.currency === debtCurrency).length === 0 && (
                    <View style={[styles.balanceWarningBox, { borderColor: theme.warning }]}>
                      <Text style={[styles.balanceWarningText, { color: theme.warning }]}>
                        ⚠️ لا توجد خزينة مسجلة بعملة {debtCurrency}. يرجى إنشاء خزينة أولاً لإتمام حركة النقدية، أو تعطيل خيار تحديث الرصيد لتسجيل رصيد افتتاحي سابق.
                      </Text>
                    </View>
                  )}

                  {(() => {
                    const amtVal = parseFinancialInput(debtAmount);
                    const chosenAcc = state.accounts.find((a) => a.id === selectedWalletId);
                    if (
                      direction === 'receivable' &&
                      chosenAcc &&
                      amtVal !== null &&
                      amtVal > 0
                    ) {
                      const check = canDisburseFromAccount(chosenAcc, amtVal);
                      if (!check.allowed) {
                        return (
                          <View style={[styles.balanceWarningBox, { borderColor: theme.danger, backgroundColor: theme.danger + '15' }]}>
                            <Text style={[styles.balanceWarningText, { color: theme.danger, fontWeight: 'bold' }]}>
                              ⛔ عجز في رصيد الخزينة — السحب على المكشوف غير مصرح به!
                            </Text>
                            <Text style={{ color: theme.text, fontSize: 13, marginTop: 4 }}>
                              • الرصيد المتاح: {formatMoney(check.available, debtCurrency)}
                            </Text>
                            <Text style={{ color: theme.text, fontSize: 13 }}>
                              • المبلغ المطلوب صرفه: {formatMoney(amtVal, debtCurrency)}
                            </Text>
                            <Text style={{ color: theme.danger, fontSize: 13, fontWeight: 'bold' }}>
                              • العجز المالي: {formatMoney(check.deficit, debtCurrency)}
                            </Text>
                          </View>
                        );
                      }
                    }
                    return null;
                  })()}
                </>
              ) : (
                <View
                  style={[
                    styles.infoBanner,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color={theme.blue}
                  />
                  <Text
                    style={[
                      styles.infoBannerText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    وضع الرصيد السابق: لن تتأثر أي خزينة أو حساب مصرفي، وسيتم قيد الدين كإثبات محاسبي فقط.
                  </Text>
                </View>
              )}

              <TouchableOpacity
                aria-checked={affectWallet}
                accessibilityRole="checkbox"
                accessibilityState={{ disabled: saving, checked: affectWallet }}
                accessibilityLabel="تحديث رصيد الحساب عند تسجيل الدين"
                disabled={saving}
                style={[styles.checkboxOption, styles.touchTarget]}
                onPress={() => setAffectWallet(!affectWallet)}
              >
                <Ionicons
                  name={affectWallet ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={theme.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.checkboxLabel,
                      { color: theme.text, fontWeight: '600' },
                    ]}
                  >
                    {affectWallet
                      ? (direction === 'receivable'
                          ? 'تحديث رصيد الخزينة فوراً (خصم المبلغ من الخزينة)'
                          : 'تحديث رصيد الخزينة فوراً (إيداع المبلغ في الخزينة)')
                      : 'تسجيل رصيد دين سابق (بدون حركة نقدية في الخزينة)'}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                    {affectWallet
                      ? 'ألغِ التحديد لتسجيل رصيد دين سابق/مرحل دون سحب أو إيداع كاش في الخزائن.'
                      : 'تم تفعيل وضع الرصيد السابق: لن تتأثر أي خزينة أو حساب مصرفي.'}
                  </Text>
                </View>
              </TouchableOpacity>

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                ملاحظات وتفاصيل الاتفاق
              </Text>
              <TextInput accessibilityLabel="ملاحظات الدين" ref={fieldRef('debtNotes')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                value={debtNotes}
                onChangeText={setDebtNotes}
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
                  onPress={() => setNewDebtModal(false)}
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
                <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                  style={[styles.saveBtn, { backgroundColor: theme.primary }, styles.touchTarget]}
                  onPress={handleSaveDebt}
                >
                  <Text style={styles.saveBtnText}>حفظ السجل</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Modal 2: Record Debt Installment */}
      <Modal
        visible={Boolean(activeDebtForPay)}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveDebtForPay(null)}
      >
        <View
          style={[styles.modalBackdrop, { backgroundColor: theme.overlay }]}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <FinancialSaveNotice error={submissionError} />
            <Text accessibilityRole="header" style={[styles.modalTitle, { color: theme.text }]}>
              {activeDebtForPay?.direction === 'receivable'
                ? `تحصيل دفعة من: ${activeDebtForPay?.personName}`
                : `سداد دفعة إلى: ${activeDebtForPay?.personName}`}
            </Text>
            <Text style={[styles.modalSub, { color: theme.textSecondary }]}>
              المبلغ المتبقي حالياً:{' '}
              {formatMoney(
                activeDebtForPay?.remainingAmount || 0,
                activeDebtForPay?.currency || 'LYD'
              )}
            </Text>

            {/* اختيار نوع العملية: حركة نقدية أو تسوية غير نقدية / مقاصة */}
            <View style={{ flexDirection: 'row-reverse', gap: 8, marginVertical: 10 }}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ selected: installmentSettlementType === 'cash' }}
                disabled={saving}
                style={[
                  styles.segmentBtn,
                  styles.touchTarget,
                  {
                    flex: 1,
                    backgroundColor:
                      installmentSettlementType === 'cash'
                        ? theme.primary
                        : theme.cardAlt,
                    borderColor:
                      installmentSettlementType === 'cash'
                        ? theme.primary
                        : theme.border,
                  },
                ]}
                onPress={() => setInstallmentSettlementType('cash')}
              >
                <Ionicons
                  name="cash-outline"
                  size={16}
                  color={
                    installmentSettlementType === 'cash'
                      ? '#FFFFFF'
                      : theme.textSecondary
                  }
                  style={{ marginLeft: 4 }}
                />
                <Text
                  style={{
                    color:
                      installmentSettlementType === 'cash'
                        ? '#FFFFFF'
                        : theme.text,
                    fontWeight:
                      installmentSettlementType === 'cash' ? 'bold' : 'normal',
                    fontSize: 12,
                  }}
                >
                  حركة نقدية (خزينة)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ selected: installmentSettlementType === 'non_cash' }}
                disabled={saving}
                style={[
                  styles.segmentBtn,
                  styles.touchTarget,
                  {
                    flex: 1,
                    backgroundColor:
                      installmentSettlementType === 'non_cash'
                        ? '#8B5CF6'
                        : theme.cardAlt,
                    borderColor:
                      installmentSettlementType === 'non_cash'
                        ? '#8B5CF6'
                        : theme.border,
                  },
                ]}
                onPress={() => setInstallmentSettlementType('non_cash')}
              >
                <Ionicons
                  name="git-compare-outline"
                  size={16}
                  color={
                    installmentSettlementType === 'non_cash'
                      ? '#FFFFFF'
                      : theme.textSecondary
                  }
                  style={{ marginLeft: 4 }}
                />
                <Text
                  style={{
                    color:
                      installmentSettlementType === 'non_cash'
                        ? '#FFFFFF'
                        : theme.text,
                    fontWeight:
                      installmentSettlementType === 'non_cash' ? 'bold' : 'normal',
                    fontSize: 12,
                  }}
                >
                  تسوية غير نقدية (مقاصة)
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              قيمة الدفعة المسددة الآن
            </Text>
            <TextInput accessibilityLabel="قيمة الدفعة" ref={fieldRef('installmentAmt')} editable={!saving}
              style={[
                styles.input,
                {
                  backgroundColor: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.text,
                },
                styles.touchTarget,
              ]}
              keyboardType="numeric"
              value={installmentAmt}
              onChangeText={setInstallmentAmt}
            />

            {(() => {
              const instAmtVal = parseFinancialInput(installmentAmt);
              if (activeDebtForPay && instAmtVal !== null && instAmtVal > activeDebtForPay.remainingAmount) {
                return (
                  <View style={[styles.balanceWarningBox, { borderColor: theme.danger, backgroundColor: theme.danger + '15' }]}>
                    <Text style={[styles.balanceWarningText, { color: theme.danger }]}>
                      ⚠️ تنبيه: قيمة الدفعة تتجاوز المبلغ المتبقي ({formatMoney(activeDebtForPay.remainingAmount, activeDebtForPay.currency)})!
                    </Text>
                  </View>
                );
              }
              return null;
            })()}

            {installmentSettlementType === 'cash' ? (
              <>
                {state.accounts.filter((a) => a.currency === activeDebtForPay?.currency).length === 0 ? (
                  <View style={[styles.balanceWarningBox, { borderColor: theme.warning }]}>
                    <Text style={[styles.balanceWarningText, { color: theme.warning }]}>
                      ⚠️ لا توجد أي خزينة مسجلة بعملة الدين ({activeDebtForPay?.currency}). يرجى إنشاء خزينة أولاً لإيداع أو صرف الدفعة، أو اختيار وضع &apos;تسوية غير نقدية (مقاصة)&apos;.
                    </Text>
                  </View>
                ) : (
                  <>
                    <CalmDropdown disabled={saving}
                      label={
                        activeDebtForPay?.direction === 'receivable'
                          ? 'في أي خزينة تم استلام الدفعة؟ (سيتم الإيداع فيها):'
                          : 'من أي خزينة تم دفع القسط؟ (سيتم الخصم منها):'
                      }
                      value={installmentAccId}
                      options={state.accounts
                        .filter((a) => a.currency === activeDebtForPay?.currency)
                        .map((acc) => ({
                          value: acc.id,
                          label: acc.name,
                          subLabel: `الرصيد: ${formatMoney(acc.balance, acc.currency)} • ${
                            acc.isCash ? 'نقدي كاش' : acc.bankName
                          }`,
                          icon: acc.isCash ? 'cash-outline' : 'card-outline',
                          badgeColor: acc.color,
                        }))}
                      onSelect={setInstallmentAccId}
                    />

                    {(() => {
                      if (activeDebtForPay?.direction === 'payable') {
                        const instAmtVal = parseFinancialInput(installmentAmt);
                        const chosenAcc = state.accounts.find((a) => a.id === installmentAccId);
                        if (chosenAcc && instAmtVal !== null && instAmtVal > 0) {
                          const check = canDisburseFromAccount(chosenAcc, instAmtVal);
                          if (!check.allowed) {
                            return (
                              <View style={[styles.balanceWarningBox, { borderColor: theme.danger, backgroundColor: theme.danger + '15' }]}>
                                <Text style={[styles.balanceWarningText, { color: theme.danger, fontWeight: 'bold' }]}>
                                  ⛔ عجز في رصيد الخزينة — السحب على المكشوف غير مصرح به!
                                </Text>
                                <Text style={{ color: theme.text, fontSize: 13, marginTop: 4 }}>
                                  • الرصيد المتاح: {formatMoney(check.available, activeDebtForPay.currency)}
                                </Text>
                                <Text style={{ color: theme.text, fontSize: 13 }}>
                                  • المبلغ المطلوب سداده: {formatMoney(instAmtVal, activeDebtForPay.currency)}
                                </Text>
                                <Text style={{ color: theme.danger, fontSize: 13, fontWeight: 'bold' }}>
                                  • العجز المالي: {formatMoney(check.deficit, activeDebtForPay.currency)}
                                </Text>
                              </View>
                            );
                          }
                        }
                      }
                      return null;
                    })()}

                    <CalmDropdown disabled={saving}
                      label="طريقة السداد"
                      value={installmentMethod}
                      options={[
                        { value: 'cash', label: 'نقدي (كاش)', icon: 'cash-outline' },
                        { value: 'transfer', label: 'حوالة مصرفية', icon: 'swap-horizontal-outline' },
                        { value: 'cheque', label: 'صك مصرفي', icon: 'document-outline' },
                        { value: 'card', label: 'بطاقة', icon: 'card-outline' },
                      ]}
                      onSelect={(value) => setInstallmentMethod(value as PaymentMethodType)}
                    />
                  </>
                )}
              </>
            ) : (
              <View style={{ marginVertical: 4 }}>
                <CalmDropdown disabled={saving}
                  label="نوع وسبب التسوية غير النقدية"
                  value={nonCashReason || 'مقاصة ديون'}
                  options={[
                    { value: 'مقاصة ديون (دين مقابل دين آخر)', label: 'مقاصة ديون (دين مقابل دين آخر)', icon: 'git-compare-outline' },
                    { value: 'تنازل / إبراء ذمة / خصم مسموح به', label: 'تنازل / إبراء ذمة / خصم مسموح به', icon: 'shield-checkmark-outline' },
                    { value: 'تسوية عينية (بضاعة / أصول / خدمات)', label: 'تسوية عينية (بضاعة / أصول / خدمات)', icon: 'cube-outline' },
                    { value: 'أخرى (بيان مخصص)', label: 'أخرى (بيان مخصص)', icon: 'document-text-outline' },
                  ]}
                  onSelect={(val) => setNonCashReason(val)}
                />

                <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                  تفاصيل وسبب التسوية غير النقدية (إلزامي)
                </Text>
                <TextInput accessibilityLabel="سبب وتفاصيل التسوية غير النقدية" ref={fieldRef('nonCashReason')} editable={!saving}
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.inputBg,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                    styles.touchTarget,
                  ]}
                  value={nonCashReason}
                  onChangeText={setNonCashReason}
                  placeholder="مثال: مقاصة مقابل فاتورة أو دين آخر..."
                  placeholderTextColor={theme.textMuted}
                />

                <View style={[styles.infoBanner, { backgroundColor: '#8B5CF6' + '15', borderColor: '#8B5CF6' }]}>
                  <Ionicons name="information-circle-outline" size={18} color="#8B5CF6" />
                  <Text style={[styles.infoBannerText, { color: theme.text, flex: 1, marginRight: 6 }]}>
                    ℹ️ التسوية غير النقدية تُخفض الرصيد المتبقي للدين مباشرة دون إيداع أو سحب أي أموال من الخزائن.
                  </Text>
                </View>
              </View>
            )}

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              ملاحظات الدفعة
            </Text>
            <TextInput accessibilityLabel="ملاحظات الدفعة" ref={fieldRef('installmentNotes')} editable={!saving}
              style={[
                styles.input,
                {
                  backgroundColor: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.text,
                },
                styles.touchTarget,
              ]}
              value={installmentNotes}
              onChangeText={setInstallmentNotes}
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
                onPress={() => setActiveDebtForPay(null)}
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
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                style={[styles.saveBtn, { backgroundColor: installmentSettlementType === 'non_cash' ? '#8B5CF6' : theme.primary }, styles.touchTarget]}
                onPress={handleSaveInstallment}
              >
                <Text style={styles.saveBtnText}>
                  {installmentSettlementType === 'non_cash' ? 'تأكيد التسوية غير النقدية' : 'تأكيد الدفعة وتحديث الرصيد'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 3: Add Financial Procedure */}
      <Modal
        visible={newProcModal}
        transparent
        animationType="fade"
        onRequestClose={() => setNewProcModal(false)}
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
                إضافة إجراء مالي أو معاملة مصرفية بمراحل
              </Text>

              <CalmDropdown disabled={saving}
                label="نوع الإجراء المالي:"
                value={procType}
                options={PROCEDURE_TYPES.map((pt) => ({
                  value: pt,
                  label: pt,
                  icon: 'document-text-outline',
                  badgeColor: theme.blue,
                }))}
                onSelect={(val) =>
                  setProcType(val as FinancialProcedure['procedureType'])
                }
              />

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                عنوان الإجراء / المعاملة
              </Text>
              <TextInput accessibilityLabel="عنوان الإجراء المالي" ref={fieldRef('procTitle')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                value={procTitle}
                onChangeText={setProcTitle}
                placeholder="مثال: إصدار صك مصدق أو شحن بطاقة 10,000$..."
                placeholderTextColor={theme.textMuted}
              />

              <View style={styles.twoColRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    المصرف / الجهة
                  </Text>
                  <TextInput accessibilityLabel="مصرف أو جهة الإجراء" ref={fieldRef('procBank')} editable={!saving}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                      styles.touchTarget,
                    ]}
                    value={procBank}
                    onChangeText={setProcBank}
                    placeholder="مصرف الجمهورية / النوران..."
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    رقم الصك / الإشارة
                  </Text>
                  <TextInput accessibilityLabel="الرقم المرجعي للإجراء" ref={fieldRef('procRef')} editable={!saving}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                      styles.touchTarget,
                    ]}
                    value={procRef}
                    onChangeText={setProcRef}
                    placeholder="CHK-..."
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
              </View>

              <View style={styles.twoColRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    المبلغ المرتبط (اختياري)
                  </Text>
                  <TextInput accessibilityLabel="مبلغ الإجراء المالي" ref={fieldRef('procAmt')} editable={!saving}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                      styles.touchTarget,
                    ]}
                    keyboardType="numeric"
                    value={procAmt}
                    onChangeText={setProcAmt}
                    placeholder="0"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    تاريخ المتابعة
                  </Text>
                  <TextInput accessibilityLabel="تاريخ استحقاق الإجراء" ref={fieldRef('procDueDate')} editable={!saving}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                      styles.touchTarget,
                    ]}
                    value={procDueDate}
                    onChangeText={setProcDueDate}
                  />
                </View>
              </View>

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                خطوات ومراحل الإجراء (كل مرحلة في سطر جديد):
              </Text>
              <TextInput accessibilityLabel="مراحل الإجراء، مرحلة في كل سطر" ref={fieldRef('procStagesText')} editable={!saving}
                style={[
                  styles.input,
                  {
                    minHeight: 80,
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                multiline
                value={procStagesText}
                onChangeText={setProcStagesText}
              />

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                ملاحظات إضافية
              </Text>
              <TextInput accessibilityLabel="ملاحظات الإجراء" ref={fieldRef('procNotes')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                value={procNotes}
                onChangeText={setProcNotes}
                placeholder="تفاصيل إضافية..."
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
                  onPress={() => setNewProcModal(false)}
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
                <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving}
                  style={[styles.saveBtn, { backgroundColor: theme.primary }, styles.touchTarget]}
                  onPress={handleSaveProcedure}
                >
                  <Text style={styles.saveBtnText}>حفظ الإجراء</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Unified Financial Profile Modal */}
      <UnifiedContactProfileModal
        visible={Boolean(profileModalContact)}
        contact={profileModalContact}
        onClose={() => setProfileModalContact(null)}
        onAddDebt={(c) => {
          setProfileModalContact(null);
          setContactSelectionMode('existing');
          setSelectedContactId(c.id);
          setPersonName(c.name);
          setPhone(c.phone || '');
          setNewDebtModal(true);
        }}
        onSettleDebt={(c, d) => {
          setProfileModalContact(null);
          if (d) setActiveDebtForPay(d);
        }}
      />
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
  subTabs: {
    flexDirection: 'row-reverse',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  subTabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  kpiRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  kpiCard: {
    flex: 1,
    minWidth: 200,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    alignItems: 'flex-end',
  },
  kpiLabel: {
    fontSize: 12,
    marginBottom: 4,
    fontWeight: '600',
  },
  kpiVal: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  kpiSub: {
    fontSize: 11,
    marginTop: 4,
  },
  primaryActionBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 14,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  dirBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  procTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  procTypeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  refBadge: {
    fontSize: 11,
    fontWeight: '600',
  },
  dateTag: {
    fontSize: 11,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  cardSub: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 3,
  },
  remBox: {
    alignItems: 'flex-start',
    marginRight: 8,
  },
  remLabel: {
    fontSize: 10,
  },
  remVal: {
    fontSize: 17,
    fontWeight: 'bold',
  },
  totalSmall: {
    fontSize: 10,
  },
  progressSection: {
    marginBottom: 10,
  },
  progressHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 11,
  },
  progressPct: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  progressBarBg: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
  },
  installmentsBox: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  installmentsTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 4,
  },
  instRow: {
    paddingVertical: 2,
  },
  instText: {
    fontSize: 11,
    textAlign: 'right',
  },
  cardActions: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  payInstallmentBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 9,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  payInstallmentBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  deleteBtn: {
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  procNotes: {
    fontSize: 12,
    textAlign: 'right',
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
  },
  stagesBox: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  stagesHeaderTitle: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  stageRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  stageTitle: {
    flex: 1,
    fontSize: 13,
    textAlign: 'right',
  },
  stageTitleCompleted: {
    textDecorationLine: 'line-through',
  },
  stageDate: {
    fontSize: 10,
  },
  procFooterRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  addStageLink: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  addStageInline: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  inlineSaveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  inlineSaveText: {
    color: '#FFFFFF',
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
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 8,
  },
  modalSub: {
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 10,
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
  twoColRow: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  choiceBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  choiceBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  checkboxOption: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 6,
  },
  checkboxLabel: {
    fontSize: 12,
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
  treasuryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  balanceWarningBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#F87171',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    marginBottom: 6,
  },
  balanceWarningText: {
    fontSize: 11,
    color: '#DC2626',
    textAlign: 'right',
    fontWeight: '600',
  },
  infoBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 8,
  },
  infoBannerText: {
    fontSize: 11,
    flex: 1,
    textAlign: 'right',
  },
  segmentBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  contactModeSelector: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    marginBottom: 12,
  },
  contactModeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 7,
    minHeight: 48,
    minWidth: 48,
  },
  contactModeTabActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  contactModeTabText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  existingContactContainer: {
    marginBottom: 8,
  },
  contactPickerList: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 4,
    marginBottom: 8,
  },
  contactPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 4,
    minHeight: 48,
    minWidth: 48,
  },
  contactPickerName: {
    fontSize: 13,
  },
  contactPickerSub: {
    fontSize: 11,
  },
  selectedContactBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 8,
  },
  selectedContactText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  unselectedWarningText: {
    fontSize: 11,
    marginBottom: 8,
    textAlign: 'right',
  },
  newContactContainer: {
    marginBottom: 8,
  },
  debtPersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  profilePillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 48,
    minWidth: 48,
  },
  profilePillText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
});

