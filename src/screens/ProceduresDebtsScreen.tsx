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
  Currency,
  DebtRecord,
  FinancialProcedure,
  PaymentMethodType,
} from '../types/mali';
import { formatMoney, getPaymentMethodLabel } from '../utils/exportHelper';
import { CalmDropdown } from '../components/CalmDropdown';

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
    addDebt,
    addDebtInstallment,
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
  const [affectWallet, setAffectWallet] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState(
    state.accounts[0]?.id || ''
  );
  const [debtNotes, setDebtNotes] = useState('');
  const [debtError, setDebtError] = useState<string | null>(null);

  // Debt Installment Modal State
  const [activeDebtForPay, setActiveDebtForPay] = useState<DebtRecord | null>(
    null
  );
  const [installmentAmt, setInstallmentAmt] = useState('');
  const [installmentAccId, setInstallmentAccId] = useState('');
  const [installmentMethod, setInstallmentMethod] =
    useState<PaymentMethodType>('cash');
  const [installmentNotes, setInstallmentNotes] = useState('');

  // New Procedure Modal State
  const [newProcModal, setNewProcModal] = useState(false);
  const [procTitle, setProcTitle] = useState('');
  const [procType, setProcType] = useState<FinancialProcedure['procedureType']>(
    PROCEDURE_TYPES[0]
  );
  const [procBank, setProcBank] = useState('');
  const [procRef, setProcRef] = useState('');
  const [procAmt, setProcAmt] = useState('');
  const [procCurrency, setProcCurrency] = useState<Currency>('LYD');
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
    setPersonName(''); setPhone(''); setDebtAmount(''); setDebtNotes(''); setDebtDueDate(''); setDebtError(null); setSelectedWalletId('');
    setInstallmentAmt(''); setInstallmentNotes(''); setInstallmentAccId('');
    setProcTitle(''); setProcBank(''); setProcRef(''); setProcAmt(''); setProcNotes(''); setProcDueDate(''); setNewStageTitle('');
    setAffectWallet(false); setProcStagesText('');
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
    const amt = parseFinancialInput(debtAmount);
    if (!personName.trim()) return reject('أدخل اسم صاحب الدين ثم أعد الحفظ.', 'personName');
    if (amt === null || amt <= 0) return reject('أدخل مبلغ دين صحيحاً أكبر من صفر.', 'debtAmount');
    const validWallet = state.accounts.find(
      (a) => a.id === selectedWalletId && a.currency === debtCurrency
    );
    setDebtError(null);
    if (affectWallet && !validWallet) {
      setDebtError('اختر حساباً موجوداً بالعملة نفسها، أو ألغِ تحديث الرصيد لتسجيل دين دون حركة نقدية.');
      return;
    }
    const chosenWallet = validWallet;

    if (!await submit(() => addDebt({
      idempotencyKey: submissionKey + ":addDebt",
      personName: personName.trim(),
      phone: phone.trim() || undefined,
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
    setDebtAmount('');
    setDebtNotes('');
    setNewDebtModal(false);
  };

  const handleSaveInstallment = async () => {
    if (!activeDebtForPay) return reject('اختر الدين الذي تريد تسجيل الدفعة له.');
    const amt = parseFinancialInput(installmentAmt);
    if (amt === null || amt <= 0) return reject('أدخل مبلغ دفعة صحيحاً أكبر من صفر.', 'installmentAmt');

    if (!await submit(() => addDebtInstallment({
      idempotencyKey: submissionKey + ":addDebtInstallment",
      debtId: activeDebtForPay.id,
      amount: amt,
      accountId: installmentAccId || undefined,
      paymentMethod: installmentMethod,
      notes: installmentNotes.trim() || undefined,
    }))) return;
    setSubmissionKey(nextSubmissionKey());
    setActiveDebtForPay(null);
    setInstallmentAmt('');
    setInstallmentNotes('');
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
            onPress={() => setNewDebtModal(true)}
          >
            <Ionicons name="add-circle" size={20} color="#FFFFFF" />
            <Text style={styles.primaryActionBtnText}>
              إضافة دين جديد أو أمانة مالية (لي / عليّ)
            </Text>
          </TouchableOpacity>

          {/* Debts List */}
          {state.debts.map((debt) => {
            const pct =
              debt.totalAmount > 0
                ? Math.min(
                    100,
                    Math.round((debt.paidAmount / debt.totalAmount) * 100)
                  )
                : 0;
            const isReceivable = debt.direction === 'receivable';

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

                    <Text style={[styles.cardTitle, { color: theme.text }]}>
                      {debt.personName}
                    </Text>
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
                    {debt.installments.map((inst) => (
                      <View key={inst.id} style={styles.instRow}>
                        <Text
                          style={[
                            styles.instText,
                            { color: theme.textSecondary },
                          ]}
                        >
                          • {inst.date}: دفعة بقيمة{' '}
                          {formatMoney(inst.amount, debt.currency)} (
                          {getPaymentMethodLabel(inst.paymentMethod)})
                          {inst.notes ? ` - ${inst.notes}` : ''}
                        </Text>
                      </View>
                    ))}
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
          })}
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

          {state.procedures.map((proc) => {
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

                  {proc.stages.map((st) => (
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
                  ))}

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
          })}
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

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                اسم الشخص أو الجهة
              </Text>
              <TextInput accessibilityLabel="اسم صاحب الدين" ref={fieldRef('personName')} editable={!saving}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                  styles.touchTarget,
                ]}
                value={personName}
                onChangeText={setPersonName}
                placeholder="مثال: محمد السنوسي / شركة..."
                placeholderTextColor={theme.textMuted}
              />
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

              <TouchableOpacity aria-checked={affectWallet} accessibilityRole="checkbox" accessibilityState={{ disabled: saving, checked: affectWallet }} accessibilityLabel="تحديث رصيد الحساب عند تسجيل الدين" disabled={saving}
                style={[styles.checkboxOption, styles.touchTarget]}
                onPress={() => setAffectWallet(!affectWallet)}
              >
                <Ionicons
                  name={affectWallet ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={theme.primary}
                />
                <Text
                  style={[
                    styles.checkboxLabel,
                    { color: theme.textSecondary },
                  ]}
                >
                  تحديث رصيد الخزينة/الحساب فوراً بهذا المبلغ
                </Text>
              </TouchableOpacity>

              {affectWallet && (
                <CalmDropdown disabled={saving}
                  label="اختر الحساب لتحديث رصيده:"
                  value={selectedWalletId}
                  options={state.accounts
                    .filter((a) => a.currency === debtCurrency)
                    .map((acc) => ({
                      value: acc.id,
                      label: acc.name,
                      subLabel: `${formatMoney(acc.balance, acc.currency)} • ${
                        acc.isCash ? 'نقدي كاش' : acc.bankName
                      }`,
                      icon: acc.isCash ? 'cash-outline' : 'card-outline',
                      badgeColor: acc.color,
                    }))}
                  onSelect={setSelectedWalletId}
                />
              )}

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

            <CalmDropdown disabled={saving}
              label={
                activeDebtForPay?.direction === 'receivable'
                  ? 'إيداع المبلغ المحصل في حساب:'
                  : 'خصم المبلغ المسدد من حساب:'
              }
              value={installmentAccId}
              options={state.accounts
                .filter((a) => a.currency === activeDebtForPay?.currency)
                .map((acc) => ({
                  value: acc.id,
                  label: acc.name,
                  subLabel: `${formatMoney(acc.balance, acc.currency)} • ${
                    acc.isCash ? 'نقدي كاش' : acc.bankName
                  }`,
                  icon: acc.isCash ? 'cash-outline' : 'card-outline',
                  badgeColor: acc.color,
                }))}
              onSelect={setInstallmentAccId}
            />
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
              placeholder="مثال: دفعة نقدية باليد أو حوالة مصرفية..."
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
                style={[styles.saveBtn, { backgroundColor: theme.primary }, styles.touchTarget]}
                onPress={handleSaveInstallment}
              >
                <Text style={styles.saveBtnText}>
                  تأكيد الدفعة وتحديث الرصيد
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
});
