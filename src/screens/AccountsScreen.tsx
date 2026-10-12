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
import { LIBYAN_BANKS } from '../data/initialData';
import { Account, Currency } from '../types/mali';
import { CalmDropdown } from '../components/CalmDropdown';
import {
  exportFileOrShare,
  formatMoney,
  generateTransactionsCsv,
} from '../utils/exportHelper';

export const AccountsScreen: React.FC = () => {
  const {
    state,
    theme,
    addAccount,
    updateAccountBalance,
    deleteAccount,
    liquidateChequeToCash,
    addTransaction,
  } = useMali();

  const [filterType, setFilterType] = useState<'all' | 'cash' | 'bank'>('all');

  // Add Account Modal
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [accName, setAccName] = useState('');
  const [selectedBank, setSelectedBank] = useState(LIBYAN_BANKS[1]);
  const [accCurrency, setAccCurrency] = useState<Currency>('LYD');
  const [isCashAcc, setIsCashAcc] = useState(false);
  const [initialBalance, setInitialBalance] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accNotes, setAccNotes] = useState('');

  // Cheque Liquidation Modal
  const [liqModalVisible, setLiqModalVisible] = useState(false);
  const bankLydAccounts = state.accounts.filter(
    (a) => a.currency === 'LYD' && !a.isCash
  );
  const cashLydAccounts = state.accounts.filter(
    (a) => a.currency === 'LYD' && a.isCash
  );

  const [sourceBankId, setSourceBankId] = useState(
    bankLydAccounts[0]?.id || ''
  );
  const [targetCashId, setTargetCashId] = useState(
    cashLydAccounts[0]?.id || ''
  );
  const [chequeAmount, setChequeAmount] = useState('10000');
  const [discountPct, setDiscountPct] = useState(
    String(state.marketRates.defaultChequeDiscountPercent || 2.5)
  );
  const [liqNotes, setLiqNotes] = useState('');

  // Direct Transfer Modal (تحويل مباشر بين حساباتي)
  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [trFromId, setTrFromId] = useState(state.accounts[0]?.id || '');
  const [trToId, setTrToId] = useState(state.accounts[1]?.id || '');
  const [trAmountStr, setTrAmountStr] = useState('1000');
  const [trNotes, setTrNotes] = useState('');

  // Edit Balance Modal
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [newBalanceStr, setNewBalanceStr] = useState('');

  const filteredAccounts = state.accounts.filter((a) => {
    if (filterType === 'cash') return a.isCash;
    if (filterType === 'bank') return !a.isCash;
    return true;
  });

  const totalCashLyd = state.accounts
    .filter((a) => a.currency === 'LYD' && a.isCash)
    .reduce((s, a) => s + a.balance, 0);
  const totalBankLyd = state.accounts
    .filter((a) => a.currency === 'LYD' && !a.isCash)
    .reduce((s, a) => s + a.balance, 0);
  const totalUsd = state.accounts
    .filter((a) => a.currency === 'USD')
    .reduce((s, a) => s + a.balance, 0);

  const parsedChequeAmt = parseFloat(chequeAmount) || 0;
  const parsedDiscount = parseFloat(discountPct) || 0;
  const calculatedFee = Number(
    ((parsedChequeAmt * parsedDiscount) / 100).toFixed(2)
  );
  const calculatedNetCash = Number(
    (parsedChequeAmt - calculatedFee).toFixed(2)
  );

  const handleCreateAccount = () => {
    if (!accName.trim()) return;
    const bal = parseFloat(initialBalance) || 0;
    const colors = [
      '#0D9488',
      '#0284C7',
      '#6366F1',
      '#10B981',
      '#D97706',
      '#EC4899',
    ];
    const randomColor = colors[state.accounts.length % colors.length];

    addAccount({
      name: accName.trim(),
      bankName: isCashAcc ? 'خزينة نقدية (كاش)' : selectedBank,
      category: isCashAcc
        ? accCurrency === 'USD'
          ? 'cash_usd'
          : 'cash_lyd'
        : accCurrency === 'USD'
        ? 'bank_usd'
        : 'bank_lyd',
      currency: accCurrency,
      balance: bal,
      isCash: isCashAcc,
      accountNumber: accountNumber.trim() || undefined,
      color: randomColor,
      notes: accNotes.trim() || undefined,
    });

    setAccName('');
    setInitialBalance('');
    setAccountNumber('');
    setAccNotes('');
    setAddModalVisible(false);
  };

  const handleLiquidateCheque = () => {
    if (!sourceBankId || !targetCashId || parsedChequeAmt <= 0) return;
    liquidateChequeToCash({
      sourceBankAccountId: sourceBankId,
      targetCashAccountId: targetCashId,
      chequeAmountLyd: parsedChequeAmt,
      discountPercent: parsedDiscount,
      notes: liqNotes.trim() || undefined,
    });
    setLiqModalVisible(false);
    setLiqNotes('');
  };

  const handleDirectTransfer = () => {
    const amt = parseFloat(trAmountStr) || 0;
    if (!trFromId || !trToId || trFromId === trToId || amt <= 0) return;
    const fromAcc = state.accounts.find((a) => a.id === trFromId);
    const toAcc = state.accounts.find((a) => a.id === trToId);
    if (!fromAcc || !toAcc) return;

    addTransaction({
      title: `تحويل من ${fromAcc.name} إلى ${toAcc.name}`,
      category: 'transfer',
      type: 'transfer',
      amount: amt,
      currency: fromAcc.currency,
      paymentMethod: fromAcc.isCash ? 'cash' : 'transfer',
      accountId: trFromId,
      targetAccountId: trToId,
      notes: trNotes.trim() || undefined,
    });
    setTransferModalVisible(false);
    setTrNotes('');
  };

  const handleExportAccountCsv = (acc: Account) => {
    const csv = generateTransactionsCsv(state, acc.id);
    exportFileOrShare(`كشف_حساب_${acc.name}.csv`, csv);
  };

  const fromAccObj = state.accounts.find((a) => a.id === trFromId);
  const matchingToAccounts = state.accounts.filter(
    (a) => a.id !== trFromId && a.currency === (fromAccObj?.currency || 'LYD')
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      {/* Compact Summary Header Strip */}
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
            الكاش النقدي
          </Text>
          <Text style={[styles.summaryVal, { color: theme.primary }]}>
            {formatMoney(totalCashLyd, 'LYD')}
          </Text>
        </View>
        <View
          style={{ width: 1, height: 26, backgroundColor: theme.border }}
        />
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            المصارف والصكوك
          </Text>
          <Text style={[styles.summaryVal, { color: theme.blue }]}>
            {formatMoney(totalBankLyd, 'LYD')}
          </Text>
        </View>
        <View
          style={{ width: 1, height: 26, backgroundColor: theme.border }}
        />
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            خزائن الدولار ($)
          </Text>
          <Text style={[styles.summaryVal, { color: theme.warning }]}>
            {formatMoney(totalUsd, 'USD')}
          </Text>
        </View>
      </View>

      {/* Top Action & Filter Bar */}
      <View style={styles.topActionRow}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
          onPress={() => setAddModalVisible(true)}
        >
          <Ionicons name="add-circle-outline" size={16} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>+ حساب</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.secondaryBtn,
            {
              backgroundColor: theme.blueSoft,
              borderColor: theme.blue,
            },
          ]}
          onPress={() => {
            const first = state.accounts[0];
            const second = state.accounts.find(
              (a) => a.id !== first?.id && a.currency === first?.currency
            );
            setTrFromId(first?.id || '');
            setTrToId(second?.id || '');
            setTransferModalVisible(true);
          }}
        >
          <Ionicons
            name="swap-vertical-outline"
            size={16}
            color={theme.blue}
          />
          <Text style={[styles.secondaryBtnText, { color: theme.blue }]}>
            تحويل
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.secondaryBtn,
            {
              backgroundColor: theme.warningSoft,
              borderColor: theme.warning,
            },
          ]}
          onPress={() => {
            setSourceBankId(bankLydAccounts[0]?.id || '');
            setTargetCashId(cashLydAccounts[0]?.id || '');
            setLiqModalVisible(true);
          }}
        >
          <Ionicons
            name="swap-horizontal-outline"
            size={16}
            color={theme.warning}
          />
          <Text style={[styles.secondaryBtnText, { color: theme.warning }]}>
            تسييل صك
          </Text>
        </TouchableOpacity>

        <View style={{ width: 155 }}>
          <CalmDropdown
            compact
            value={filterType}
            options={[
              {
                value: 'all',
                label: `الكل (${state.accounts.length})`,
                icon: 'wallet-outline',
                badgeColor: theme.primary,
              },
              {
                value: 'cash',
                label: 'خزائن الكاش النقدي',
                icon: 'cash-outline',
                badgeColor: theme.primary,
              },
              {
                value: 'bank',
                label: 'المصارف والصكوك',
                icon: 'business-outline',
                badgeColor: theme.blue,
              },
            ]}
            onSelect={(val) => setFilterType(val as any)}
          />
        </View>
      </View>

      {/* Accounts List */}
      {filteredAccounts.map((acc) => {
        const txCount = state.transactions.filter(
          (t) => t.accountId === acc.id || t.targetAccountId === acc.id
        ).length;

        return (
          <View
            key={acc.id}
            style={[
              styles.accountCard,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                borderRightColor: acc.color,
              },
            ]}
          >
            <View style={styles.accHeader}>
              <View style={{ flex: 1 }}>
                <View style={styles.accBadgesRow}>
                  <View
                    style={[
                      styles.typeBadge,
                      {
                        backgroundColor: acc.isCash
                          ? theme.primarySoft
                          : theme.blueSoft,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: acc.isCash ? theme.primary : theme.blue,
                        fontSize: 10,
                        fontWeight: 'bold',
                      }}
                    >
                      {acc.isCash ? 'كاش نقدي' : 'مصرف / صكوك'}
                    </Text>
                  </View>
                  <Text
                    style={[styles.bankTag, { color: theme.textSecondary }]}
                  >
                    {acc.bankName}
                  </Text>
                </View>
                <Text style={[styles.accTitle, { color: theme.text }]}>
                  {acc.name}
                </Text>
                {acc.accountNumber ? (
                  <Text style={[styles.accNumber, { color: theme.textMuted }]}>
                    {acc.accountNumber}
                  </Text>
                ) : null}
              </View>

              <View style={styles.accBalanceBox}>
                <Text
                  style={[
                    styles.accBalanceLabel,
                    { color: theme.textSecondary },
                  ]}
                >
                  الرصيد المتاح
                </Text>
                <Text
                  style={[
                    styles.accBalanceValue,
                    {
                      color:
                        acc.currency === 'USD' ? theme.warning : theme.text,
                    },
                  ]}
                >
                  {formatMoney(acc.balance, acc.currency)}
                </Text>
              </View>
            </View>

            <View
              style={[styles.accFooter, { borderTopColor: theme.border }]}
            >
              <Text style={[styles.txCountText, { color: theme.textMuted }]}>
                {txCount} حركات
              </Text>
              <View style={styles.accActions}>
                <TouchableOpacity
                  style={[
                    styles.accActionBtn,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => handleExportAccountCsv(acc)}
                >
                  <Ionicons
                    name="download-outline"
                    size={14}
                    color={theme.textSecondary}
                  />
                  <Text
                    style={[
                      styles.accActionText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    Excel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.accActionBtn,
                    {
                      backgroundColor: theme.primarySoft,
                      borderColor: theme.primary,
                    },
                  ]}
                  onPress={() => {
                    setEditingAccount(acc);
                    setNewBalanceStr(String(acc.balance));
                  }}
                >
                  <Ionicons
                    name="create-outline"
                    size={14}
                    color={theme.primary}
                  />
                  <Text
                    style={[styles.accActionText, { color: theme.primary }]}
                  >
                    تعديل الرصيد
                  </Text>
                </TouchableOpacity>

                {state.accounts.length > 2 && (
                  <TouchableOpacity
                    style={[
                      styles.accActionBtn,
                      {
                        backgroundColor: theme.dangerSoft,
                        borderColor: theme.danger,
                      },
                    ]}
                    onPress={() => deleteAccount(acc.id)}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={14}
                      color={theme.danger}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        );
      })}

      {/* Modal 0: Direct Transfer Between Accounts (تحويل مباشر بين حساباتي) */}
      <Modal
        visible={transferModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTransferModalVisible(false)}
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
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              تحويل مباشر بين حساباتي
            </Text>
            <Text style={[styles.modalSub, { color: theme.textSecondary }]}>
              انقل الأموال بسهولة بين حساباتك المصرفية وخزائن الكاش بدون عمولة
            </Text>

            <CalmDropdown
              label="من الحساب (المصدر):"
              value={trFromId}
              options={state.accounts.map((acc) => ({
                value: acc.id,
                label: acc.name,
                subLabel: `${formatMoney(acc.balance, acc.currency)} • ${
                  acc.isCash ? 'نقدي كاش' : acc.bankName
                }`,
                icon: acc.isCash ? 'cash-outline' : 'card-outline',
                badgeColor: acc.color,
              }))}
              onSelect={(id) => {
                setTrFromId(id);
                const selectedAcc = state.accounts.find((a) => a.id === id);
                if (selectedAcc) {
                  const validTargets = state.accounts.filter(
                    (a) =>
                      a.id !== selectedAcc.id &&
                      a.currency === selectedAcc.currency
                  );
                  if (validTargets.length > 0) {
                    setTrToId(validTargets[0].id);
                  }
                }
              }}
            />

            <CalmDropdown
              label={`إلى الحساب المستلم (${fromAccObj?.currency || 'LYD'}):`}
              value={trToId}
              options={matchingToAccounts.map((acc) => ({
                value: acc.id,
                label: acc.name,
                subLabel: `${formatMoney(acc.balance, acc.currency)} • ${
                  acc.isCash ? 'نقدي كاش' : acc.bankName
                }`,
                icon: acc.isCash ? 'cash-outline' : 'card-outline',
                badgeColor: acc.color,
              }))}
              onSelect={setTrToId}
            />

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              المبلغ المراد تحويله ({fromAccObj?.currency || 'LYD'})
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              keyboardType="numeric"
              value={trAmountStr}
              onChangeText={setTrAmountStr}
            />

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              ملاحظة (اختياري)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={trNotes}
              onChangeText={setTrNotes}
              placeholder="مثال: تغذية البطاقة أو سحب كاش..."
              placeholderTextColor={theme.textMuted}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  {
                    backgroundColor: theme.cardAlt,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setTransferModalVisible(false)}
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
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: theme.primary }]}
                onPress={handleDirectTransfer}
              >
                <Text style={styles.saveBtnText}>تنفيذ التحويل الآن</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 1: Cheque Liquidation (تسييل الصكوك إلى كاش) */}
      <Modal
        visible={liqModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLiqModalVisible(false)}
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
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              تسييل صك مصرفي / تحويل رصيد مصرفي إلى كاش
            </Text>
            <Text style={[styles.modalSub, { color: theme.textSecondary }]}>
              يخصم قيمة الصك من حسابك المصرفي ويودع الصافي النقدي في خزينة الكاش بعد احتساب نسبة الخصم تلقائياً
            </Text>

            <CalmDropdown
              label="من الحساب المصرفي (مصدر الصك/الحوالة):"
              value={sourceBankId}
              options={bankLydAccounts.map((b) => ({
                value: b.id,
                label: b.name,
                subLabel: `${formatMoney(b.balance, 'LYD')} • ${b.bankName}`,
                icon: 'business-outline',
                badgeColor: b.color,
              }))}
              onSelect={setSourceBankId}
            />

            <CalmDropdown
              label="إلى خزينة الكاش المستلمة:"
              value={targetCashId}
              options={cashLydAccounts.map((c) => ({
                value: c.id,
                label: c.name,
                subLabel: `${formatMoney(c.balance, 'LYD')} • خزينة نقدية`,
                icon: 'cash-outline',
                badgeColor: c.color,
              }))}
              onSelect={setTargetCashId}
            />

            <View style={styles.twoColRow}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.inputLabel, { color: theme.textSecondary }]}
                >
                  قيمة الصك / الحوالة (د.ل)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.inputBg,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  keyboardType="numeric"
                  value={chequeAmount}
                  onChangeText={setChequeAmount}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.inputLabel, { color: theme.textSecondary }]}
                >
                  نسبة الخصم / العمولة (%)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.inputBg,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  keyboardType="numeric"
                  value={discountPct}
                  onChangeText={setDiscountPct}
                />
              </View>
            </View>

            {/* Live Calculation Preview */}
            <View
              style={[
                styles.previewBox,
                {
                  backgroundColor: theme.cardAlt,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.previewRow}>
                <Text
                  style={[styles.previewLabel, { color: theme.textSecondary }]}
                >
                  المخصوم من المصرف:
                </Text>
                <Text style={[styles.previewVal, { color: theme.text }]}>
                  {formatMoney(parsedChequeAmt, 'LYD')}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text
                  style={[styles.previewLabel, { color: theme.textSecondary }]}
                >
                  عمولة التسييل ({parsedDiscount}%):
                </Text>
                <Text style={[styles.previewVal, { color: theme.danger }]}>
                  -{formatMoney(calculatedFee, 'LYD')}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text
                  style={[styles.previewLabel, { color: theme.textSecondary }]}
                >
                  الصافي المودع في خزينة الكاش:
                </Text>
                <Text
                  style={[
                    styles.previewVal,
                    { color: theme.success, fontSize: 16 },
                  ]}
                >
                  +{formatMoney(calculatedNetCash, 'LYD')}
                </Text>
              </View>
            </View>

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              ملاحظات (رقم الصك / مكتب التسييل)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={liqNotes}
              onChangeText={setLiqNotes}
              placeholder="مثال: تسييل صك رقم 84920 عبر مكتب..."
              placeholderTextColor={theme.textMuted}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  {
                    backgroundColor: theme.cardAlt,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setLiqModalVisible(false)}
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
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: theme.primary }]}
                onPress={handleLiquidateCheque}
              >
                <Text style={styles.saveBtnText}>
                  تنفيذ التسييل وإيداع الكاش
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 2: Add New Account */}
      <Modal
        visible={addModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddModalVisible(false)}
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
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                إضافة حساب مصرفي أو خزينة نقدية
              </Text>

              <View style={styles.twoColRow}>
                <View style={{ flex: 1 }}>
                  <CalmDropdown
                    label="نوع الرصيد:"
                    value={isCashAcc ? 'cash' : 'bank'}
                    options={[
                      {
                        value: 'bank',
                        label: 'حساب مصرفي / صكوك',
                        subLabel: 'مصرف، بطاقة، أو صكوك',
                        icon: 'business-outline',
                        badgeColor: theme.blue,
                      },
                      {
                        value: 'cash',
                        label: 'خزينة كاش (نقدي)',
                        subLabel: 'سيولة نقدية باليد',
                        icon: 'cash-outline',
                        badgeColor: theme.primary,
                      },
                    ]}
                    onSelect={(val) => setIsCashAcc(val === 'cash')}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <CalmDropdown
                    label="العملة:"
                    value={accCurrency}
                    options={[
                      {
                        value: 'LYD',
                        label: 'دينار ليبي (LYD)',
                        subLabel: 'العملة المحلية د.ل',
                        icon: 'wallet-outline',
                        badgeColor: theme.primary,
                      },
                      {
                        value: 'USD',
                        label: 'دولار أمريكي ($ USD)',
                        subLabel: 'العملة الأجنبية $',
                        icon: 'logo-usd',
                        badgeColor: theme.warning,
                      },
                    ]}
                    onSelect={(val) => setAccCurrency(val as Currency)}
                  />
                </View>
              </View>

              {!isCashAcc && (
                <CalmDropdown
                  label="اختر المصرف الليبي:"
                  value={selectedBank}
                  options={LIBYAN_BANKS.slice(1).map((bank) => ({
                    value: bank,
                    label: bank,
                    icon: 'business-outline',
                    badgeColor: theme.blue,
                  }))}
                  onSelect={setSelectedBank}
                />
              )}

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                اسم الحساب المميز
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={accName}
                onChangeText={setAccName}
                placeholder="مثال: حساب مصرف الوحدة (جاري) أو خزينة البيت"
                placeholderTextColor={theme.textMuted}
              />

              <View style={styles.twoColRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    الرصيد الافتتاحي
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    keyboardType="numeric"
                    value={initialBalance}
                    onChangeText={setInitialBalance}
                    placeholder="0"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    رقم الحساب / البطاقة (اختياري)
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    value={accountNumber}
                    onChangeText={setAccountNumber}
                    placeholder="LY..."
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
              </View>

              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
                ملاحظات
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={accNotes}
                onChangeText={setAccNotes}
                placeholder="تفاصيل إضافية حول الحساب..."
                placeholderTextColor={theme.textMuted}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => setAddModalVisible(false)}
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
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: theme.primary }]}
                  onPress={handleCreateAccount}
                >
                  <Text style={styles.saveBtnText}>حفظ الحساب</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Modal 3: Edit Account Balance */}
      <Modal
        visible={Boolean(editingAccount)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingAccount(null)}
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
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              تعديل ومطابقة رصيد: {editingAccount?.name}
            </Text>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              الرصيد الفعلي الحالي ({editingAccount?.currency})
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              keyboardType="numeric"
              value={newBalanceStr}
              onChangeText={setNewBalanceStr}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  {
                    backgroundColor: theme.cardAlt,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setEditingAccount(null)}
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
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: theme.primary }]}
                onPress={() => {
                  if (editingAccount) {
                    const val = parseFloat(newBalanceStr);
                    if (Number.isFinite(val)) {
                      updateAccountBalance(editingAccount.id, val);
                    }
                    setEditingAccount(null);
                  }
                }}
              >
                <Text style={styles.saveBtnText}>تحديث الرصيد</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
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
    fontSize: 17,
    fontWeight: 'bold',
  },
  topActionRow: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    flex: 1,
    minWidth: 150,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  secondaryBtn: {
    flex: 1,
    minWidth: 150,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontWeight: 'bold',
    fontSize: 13,
  },
  filterTabs: {
    flexDirection: 'row-reverse',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  accountCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRightWidth: 5,
  },
  accHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  accBadgesRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  bankTag: {
    fontSize: 12,
  },
  accTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  accNumber: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 2,
  },
  accBalanceBox: {
    alignItems: 'flex-start',
  },
  accBalanceLabel: {
    fontSize: 11,
  },
  accBalanceValue: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 2,
  },
  accNotes: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 10,
    padding: 9,
    borderRadius: 10,
  },
  accFooter: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  txCountText: {
    fontSize: 11,
  },
  accActions: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  accActionBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  accActionText: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 12,
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'right',
    borderWidth: 1,
  },
  twoColRow: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  chipsWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
  },
  choiceBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  choiceBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  previewBox: {
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    gap: 6,
  },
  previewRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  previewLabel: {
    fontSize: 12,
  },
  previewVal: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalActions: {
    flexDirection: 'row-reverse',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
