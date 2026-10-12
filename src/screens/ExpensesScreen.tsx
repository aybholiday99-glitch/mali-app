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
  INCOME_CATEGORIES,
  QUICK_EXPENSE_PURPOSES,
} from '../data/initialData';
import { Currency, PaymentMethodType } from '../types/mali';
import { CalmDropdown, DropdownOption } from '../components/CalmDropdown';
import {
  exportFileOrShare,
  formatMoney,
  generateTransactionsCsv,
  getPaymentMethodLabel,
} from '../utils/exportHelper';

export const ExpensesScreen: React.FC = () => {
  const {
    state,
    theme,
    addTransaction,
    deleteTransaction,
    updateCategoryBudget,
  } = useMali();

  const [subTab, setSubTab] = useState<'ledger' | 'budgets'>('ledger');
  const [typeFilter, setTypeFilter] = useState<
    'all' | 'expense' | 'income' | 'deals'
  >('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'cash' | 'bank'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // --- Fast & Concise Inline Expense State (القيمة المسحوبة + قائمة منسدلة للغرض + قائمة منسدلة للحساب) ---
  const [quickAmount, setQuickAmount] = useState('');
  const [quickPurposeKey, setQuickPurposeKey] = useState(
    QUICK_EXPENSE_PURPOSES[0].key
  );
  const [quickCustomDetail, setQuickCustomDetail] = useState('');
  const [quickAccountId, setQuickAccountId] = useState(
    state.accounts[0]?.id || ''
  );
  const [quickSavedMessage, setQuickSavedMessage] = useState<string | null>(
    null
  );

  // Secondary Modal for Income or Internal Transfer
  const [otherTxModal, setOtherTxModal] = useState(false);
  const [txType, setTxType] = useState<'income' | 'transfer'>('income');
  const [txTitle, setTxTitle] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState(INCOME_CATEGORIES[0]);
  const [txAccountId, setTxAccountId] = useState(state.accounts[0]?.id || '');
  const [txTargetAccountId, setTxTargetAccountId] = useState(
    state.accounts[1]?.id || ''
  );

  // Edit Budget Modal
  const [editingBudgetCat, setEditingBudgetCat] = useState<string | null>(null);
  const [budgetLimitInput, setBudgetLimitInput] = useState('');

  const accountMap = new Map(state.accounts.map((a) => [a.id, a]));
  const selectedQuickAccount =
    accountMap.get(quickAccountId) || state.accounts[0];

  // Dropdown Options
  const purposeDropdownOptions: DropdownOption[] = QUICK_EXPENSE_PURPOSES.map(
    (p) => ({
      value: p.key,
      label: p.label,
      icon: p.icon,
      badgeColor: p.color,
    })
  );

  const accountDropdownOptions: DropdownOption[] = state.accounts.map(
    (acc) => ({
      value: acc.id,
      label: acc.name,
      subLabel: `المتاح: ${formatMoney(acc.balance, acc.currency)} (${
        acc.isCash ? 'نقدي كاش' : acc.bankName
      })`,
      icon: acc.isCash ? 'cash-outline' : 'card-outline',
      badgeColor: acc.color,
    })
  );

  const incomeCategoryOptions: DropdownOption[] = INCOME_CATEGORIES.map(
    (c) => ({
      value: c,
      label: c,
      icon: 'trending-up-outline',
    })
  );

  // Totals (Expenses + Cheque Liquidation Fees, excluding USD deal commissions already netted in deal profit)
  const totalExpensesLyd = state.transactions
    .filter(
      (t) =>
        (t.type === 'expense' || t.type === 'cheque_liquidation') &&
        t.currency === 'LYD'
    )
    .reduce(
      (s, t) =>
        s +
        (t.type === 'cheque_liquidation'
          ? t.feeAmount || 0
          : t.amount + (t.feeAmount || 0)),
      0
    );

  const totalIncomeLyd = state.transactions
    .filter(
      (t) =>
        (t.type === 'income' || t.type === 'deal_sell') && t.currency === 'LYD'
    )
    .reduce((s, t) => s + t.amount, 0);

  const filteredTransactions = state.transactions.filter((tx) => {
    if (
      typeFilter === 'expense' &&
      tx.type !== 'expense' &&
      tx.type !== 'cheque_liquidation'
    ) {
      return false;
    }
    if (typeFilter === 'income' && tx.type !== 'income') return false;
    if (
      typeFilter === 'deals' &&
      tx.type !== 'deal_buy' &&
      tx.type !== 'deal_sell' &&
      tx.type !== 'deal_personal_take'
    ) {
      return false;
    }
    if (methodFilter === 'cash' && tx.paymentMethod !== 'cash') return false;
    if (methodFilter === 'bank' && tx.paymentMethod === 'cash') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return (
        tx.title.toLowerCase().includes(q) ||
        tx.category.toLowerCase().includes(q) ||
        (tx.notes && tx.notes.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // 1-Tap Save Quick Expense
  const handleQuickExpenseSubmit = () => {
    const amt = parseFloat(quickAmount) || 0;
    const acc = selectedQuickAccount;
    if (amt <= 0 || !acc) return;

    const purposeObj =
      QUICK_EXPENSE_PURPOSES.find((p) => p.key === quickPurposeKey) ||
      QUICK_EXPENSE_PURPOSES[0];

    const detail = quickCustomDetail.trim();
    const finalTitle = detail
      ? `${purposeObj.shortLabel}: ${detail}`
      : `سحب مصروف (${purposeObj.shortLabel})`;

    const method: PaymentMethodType = acc.isCash ? 'cash' : 'card';

    addTransaction({
      title: finalTitle,
      type: 'expense',
      amount: amt,
      currency: acc.currency,
      category: purposeObj.key,
      accountId: acc.id,
      paymentMethod: method,
      notes: detail ? `الغرض: ${detail} — سحب من ${acc.name}` : undefined,
    });

    setQuickAmount('');
    setQuickCustomDetail('');
    setQuickSavedMessage(
      `✓ تم خصم ${formatMoney(amt, acc.currency)} لغرض (${
        detail || purposeObj.shortLabel
      }) من حساب «${acc.name}»`
    );
    setTimeout(() => {
      setQuickSavedMessage(null);
    }, 4500);
  };

  const handleSaveOtherTransaction = () => {
    const amt = parseFloat(txAmount) || 0;
    if (amt <= 0 || !txAccountId) return;
    const selectedAcc = accountMap.get(txAccountId);
    const currency: Currency = selectedAcc?.currency || 'LYD';

    if (txType === 'transfer') {
      const targetAcc = accountMap.get(txTargetAccountId);
      if (
        !targetAcc ||
        targetAcc.id === txAccountId ||
        targetAcc.currency !== currency
      ) {
        return;
      }
    }

    addTransaction({
      title:
        txTitle.trim() ||
        (txType === 'income'
          ? `إيداع / إيراد: ${txCategory}`
          : 'تحويل بين الحسابات'),
      type: txType,
      amount: amt,
      currency,
      category: txType === 'transfer' ? 'تحويل داخلي' : txCategory,
      accountId: txAccountId,
      targetAccountId: txType === 'transfer' ? txTargetAccountId : undefined,
      paymentMethod: selectedAcc?.isCash ? 'cash' : 'transfer',
    });

    setTxTitle('');
    setTxAmount('');
    setOtherTxModal(false);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      {/* ================================================================
          1. FAST & CONCISE EXPENSE CARD (إضافة مصروف سريعة بقوائم منسدلة غير مزدحمة)
         ================================================================ */}
      <View
        style={[
          styles.quickExpenseCard,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={styles.quickCardHeader}>
          <View style={styles.quickHeaderRight}>
            <View
              style={[
                styles.quickHeaderIcon,
                { backgroundColor: theme.primarySoft },
              ]}
            >
              <Ionicons
                name="wallet-outline"
                size={18}
                color={theme.primary}
              />
            </View>
            <View>
              <Text style={[styles.quickCardTitle, { color: theme.text }]}>
                سحب مصروف سريع
              </Text>
              <Text
                style={[styles.quickCardSub, { color: theme.textSecondary }]}
              >
                القيمة المسحوبة ← اختر الغرض والحساب من القائمة المنسدلة
              </Text>
            </View>
          </View>
        </View>

        {/* 1. القيمة المسحوبة */}
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
          1. القيمة المسحوبة ({selectedQuickAccount?.currency || 'LYD'})
        </Text>
        <TextInput
          style={[
            styles.amountInput,
            {
              backgroundColor: theme.inputBg,
              borderColor: quickAmount ? theme.primary : theme.border,
              color: theme.text,
            },
          ]}
          keyboardType="numeric"
          value={quickAmount}
          onChangeText={setQuickAmount}
          placeholder="أدخل المبلغ المسحوب (مثلاً 50)..."
          placeholderTextColor={theme.textMuted}
        />

        {/* 2. الغرض + 3. الحساب في قوائم منسدلة متناسقة */}
        <View style={styles.twoColRow}>
          <View style={{ flex: 1 }}>
            <CalmDropdown
              label="2. لأي غرض؟"
              value={quickPurposeKey}
              options={purposeDropdownOptions}
              onSelect={setQuickPurposeKey}
            />
          </View>

          <View style={{ flex: 1 }}>
            <CalmDropdown
              label="3. سُحبت من أي حساب؟"
              value={selectedQuickAccount?.id || ''}
              options={accountDropdownOptions}
              onSelect={setQuickAccountId}
            />
          </View>
        </View>

        {/* تفصيل اختياري */}
        <TextInput
          style={[
            styles.noteInput,
            {
              backgroundColor: theme.inputBg,
              borderColor: theme.border,
              color: theme.text,
              marginTop: 6,
            },
          ]}
          value={quickCustomDetail}
          onChangeText={setQuickCustomDetail}
          placeholder="ملاحظة اختيارية (مثلاً: غداء، بنزين، قميص)..."
          placeholderTextColor={theme.textMuted}
        />

        {/* Confirmation Banner if just saved */}
        {quickSavedMessage ? (
          <View
            style={[
              styles.savedFeedbackBox,
              {
                backgroundColor: theme.successSoft,
                borderColor: theme.success,
              },
            ]}
          >
            <Text style={[styles.savedFeedbackText, { color: theme.success }]}>
              {quickSavedMessage}
            </Text>
          </View>
        ) : null}

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitQuickBtn,
            {
              backgroundColor:
                parseFloat(quickAmount) > 0 ? theme.primary : theme.textMuted,
            },
          ]}
          onPress={handleQuickExpenseSubmit}
        >
          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
          <Text style={styles.submitQuickBtnText} numberOfLines={1}>
            {parseFloat(quickAmount) > 0
              ? `سحب ${formatMoney(
                  parseFloat(quickAmount),
                  selectedQuickAccount?.currency || 'LYD'
                )} (${quickCustomDetail.trim() || quickPurposeKey}) من ${
                  selectedQuickAccount?.name || ''
                }`
              : 'سحب وحفظ المصروف الآن'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Secondary Action Bar: Record Income / Transfer / Export */}
      <View style={styles.secondaryActionRow}>
        <TouchableOpacity
          style={[
            styles.secondaryActionBtn,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
          onPress={() => {
            const firstAcc = state.accounts[0];
            setTxAccountId(firstAcc?.id || '');
            const sameCurrTarget = state.accounts.find(
              (a) => a.id !== firstAcc?.id && a.currency === firstAcc?.currency
            );
            setTxTargetAccountId(sameCurrTarget?.id || '');
            setOtherTxModal(true);
          }}
        >
          <Ionicons
            name="add-circle-outline"
            size={17}
            color={theme.primary}
          />
          <Text style={[styles.secondaryActionBtnText, { color: theme.text }]}>
            إيراد وارد أو تحويل داخلي
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.exportBtn,
            { backgroundColor: theme.blueSoft, borderColor: theme.blue },
          ]}
          onPress={() => {
            const csv = generateTransactionsCsv(state);
            exportFileOrShare('كشف_الحركات_والمصاريف_مالي.csv', csv);
          }}
        >
          <Ionicons name="download-outline" size={17} color={theme.blue} />
          <Text style={[styles.exportBtnText, { color: theme.blue }]}>
            Excel
          </Text>
        </TouchableOpacity>
      </View>

      {/* Clean 2-Item Summary Row */}
      <View style={styles.summaryRow}>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            إجمالي المسحوبات والمصاريف
          </Text>
          <Text style={[styles.summaryVal, { color: theme.danger }]}>
            {formatMoney(totalExpensesLyd, 'LYD')}
          </Text>
        </View>
        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            إجمالي الإيرادات الواردة
          </Text>
          <Text style={[styles.summaryVal, { color: theme.success }]}>
            {formatMoney(totalIncomeLyd, 'LYD')}
          </Text>
        </View>
      </View>

      {/* Sub-navigation: Ledger vs Monthly Budgets */}
      <View
        style={[
          styles.subTabs,
          { backgroundColor: theme.cardAlt, borderColor: theme.border },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.subTab,
            subTab === 'ledger' && {
              backgroundColor: theme.card,
              shadowColor: '#000',
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 1,
            },
          ]}
          onPress={() => setSubTab('ledger')}
        >
          <Ionicons
            name="list-outline"
            size={16}
            color={subTab === 'ledger' ? theme.primary : theme.textSecondary}
          />
          <Text
            style={[
              styles.subTabText,
              {
                color:
                  subTab === 'ledger' ? theme.primary : theme.textSecondary,
              },
              subTab === 'ledger' && { fontWeight: 'bold' },
            ]}
          >
            سجل المسحوبات والحركات ({filteredTransactions.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.subTab,
            subTab === 'budgets' && {
              backgroundColor: theme.card,
              shadowColor: '#000',
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 1,
            },
          ]}
          onPress={() => setSubTab('budgets')}
        >
          <Ionicons
            name="pie-chart-outline"
            size={16}
            color={subTab === 'budgets' ? theme.primary : theme.textSecondary}
          />
          <Text
            style={[
              styles.subTabText,
              {
                color:
                  subTab === 'budgets' ? theme.primary : theme.textSecondary,
              },
              subTab === 'budgets' && { fontWeight: 'bold' },
            ]}
          >
            مراقبة المصاريف حسب الغرض
          </Text>
        </TouchableOpacity>
      </View>

      {subTab === 'ledger' ? (
        <>
          {/* Compact Search + Dropdown Filters Row */}
          <View style={styles.filtersToolbar}>
            <View
              style={[
                styles.searchBox,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Ionicons
                name="search-outline"
                size={16}
                color={theme.textMuted}
              />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="بحث بالغرض أو الحساب..."
                placeholderTextColor={theme.textMuted}
              />
            </View>

            <View style={styles.twoColRow}>
              <CalmDropdown
                compact
                value={typeFilter}
                options={[
                  {
                    value: 'all',
                    label: 'النوع: كل الحركات',
                    icon: 'layers-outline',
                  },
                  {
                    value: 'expense',
                    label: 'المصاريف والمسحوبات فقط',
                    icon: 'arrow-up-circle-outline',
                  },
                  {
                    value: 'income',
                    label: 'الإيرادات الواردة فقط',
                    icon: 'arrow-down-circle-outline',
                  },
                  {
                    value: 'deals',
                    label: 'حركات تداول الدولار',
                    icon: 'trending-up-outline',
                  },
                ]}
                onSelect={(v) => setTypeFilter(v as any)}
              />

              <CalmDropdown
                compact
                value={methodFilter}
                options={[
                  {
                    value: 'all',
                    label: 'الدفع: كاش + مصارف',
                    icon: 'wallet-outline',
                  },
                  {
                    value: 'cash',
                    label: 'كاش نقدي فقط',
                    icon: 'cash-outline',
                  },
                  {
                    value: 'bank',
                    label: 'مصارف وبطاقات فقط',
                    icon: 'card-outline',
                  },
                ]}
                onSelect={(v) => setMethodFilter(v as any)}
              />
            </View>
          </View>

          {/* Transactions Cards */}
          {filteredTransactions.map((tx) => {
            const acc = accountMap.get(tx.accountId);
            const isPositive =
              tx.type === 'income' ||
              tx.type === 'deal_sell' ||
              (tx.type === 'debt_settlement' &&
                (tx.title.startsWith('تحصيل') || tx.title.startsWith('استلام')));
            const isInternalTransfer =
              tx.type === 'cheque_liquidation' || tx.type === 'transfer';
            return (
              <View
                key={tx.id}
                style={[
                  styles.txCard,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <View style={styles.txCardTop}>
                  <View style={styles.txCardRight}>
                    <View
                      style={[
                        styles.txIcon,
                        {
                          backgroundColor: isPositive
                            ? theme.successSoft
                            : isInternalTransfer
                            ? theme.blueSoft
                            : theme.dangerSoft,
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          isPositive
                            ? 'arrow-down'
                            : isInternalTransfer
                            ? 'swap-horizontal'
                            : 'arrow-up'
                        }
                        size={18}
                        color={
                          isPositive
                            ? theme.success
                            : isInternalTransfer
                            ? theme.blue
                            : theme.danger
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.txTitle, { color: theme.text }]}>
                        {tx.title}
                      </Text>
                      <Text
                        style={[styles.txSub, { color: theme.textSecondary }]}
                      >
                        الغرض:{' '}
                        <Text
                          style={{ color: theme.primary, fontWeight: 'bold' }}
                        >
                          {tx.category}
                        </Text>{' '}
                        • الحساب:{' '}
                        <Text style={{ color: theme.text, fontWeight: 'bold' }}>
                          {acc?.name || 'حساب'}
                        </Text>{' '}
                        • {tx.date}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.txCardLeft}>
                    <Text
                      style={[
                        styles.txAmount,
                        {
                          color: isPositive
                            ? theme.success
                            : isInternalTransfer
                            ? theme.blue
                            : theme.danger,
                        },
                      ]}
                    >
                      {isPositive ? '+' : isInternalTransfer ? '⇄ ' : '-'}
                      {formatMoney(tx.amount, tx.currency)}
                    </Text>
                    <View
                      style={[
                        styles.methodBadge,
                        { backgroundColor: theme.cardAlt },
                      ]}
                    >
                      <Text
                        style={[
                          styles.methodBadgeText,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {getPaymentMethodLabel(tx.paymentMethod)}
                      </Text>
                    </View>
                  </View>
                </View>

                <View
                  style={[styles.txFooter, { borderTopColor: theme.border }]}
                >
                  <Text
                    style={[styles.txNotes, { color: theme.textSecondary }]}
                  >
                    {tx.notes || `حركة مسجلة على ${acc?.name || 'الحساب'}`}
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.deleteSmallBtn,
                      { backgroundColor: theme.dangerSoft },
                    ]}
                    onPress={() => deleteTransaction(tx.id)}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={13}
                      color={theme.danger}
                    />
                    <Text
                      style={{
                        color: theme.danger,
                        fontSize: 10,
                        fontWeight: '600',
                      }}
                    >
                      حذف واسترجاع الرصيد
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </>
      ) : (
        /* Budgets & Categories Analytics View */
        <View>
          <Text style={[styles.budgetIntro, { color: theme.textSecondary }]}>
            تتبع مصاريفك الشهرية حسب كل غرض (أكل، ملابس، سيارة، منزل...) مقارنة بالسقف الشهري:
          </Text>
          {state.budgets.map((b) => {
            const spentLyd = state.transactions
              .filter(
                (t) =>
                  (t.type === 'expense' || t.type === 'cheque_liquidation') &&
                  t.category === b.category &&
                  t.currency === 'LYD'
              )
              .reduce(
                (s, t) =>
                  s +
                  (t.type === 'cheque_liquidation'
                    ? t.feeAmount || 0
                    : t.amount),
                0
              );

            const pct =
              b.monthlyLimitLyd > 0
                ? Math.min(
                    100,
                    Math.round((spentLyd / b.monthlyLimitLyd) * 100)
                  )
                : 0;

            const barColor =
              pct >= 100
                ? theme.danger
                : pct >= 75
                ? theme.warning
                : theme.primary;

            return (
              <View
                key={b.id}
                style={[
                  styles.budgetCard,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <View style={styles.budgetHeader}>
                  <View style={styles.budgetTitleRow}>
                    <View
                      style={[styles.budgetDot, { backgroundColor: b.color }]}
                    />
                    <Text style={[styles.budgetCatName, { color: theme.text }]}>
                      {b.category}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.editBudgetBtn,
                      {
                        backgroundColor: theme.blueSoft,
                        borderColor: theme.blue,
                      },
                    ]}
                    onPress={() => {
                      setEditingBudgetCat(b.category);
                      setBudgetLimitInput(String(b.monthlyLimitLyd));
                    }}
                  >
                    <Ionicons
                      name="create-outline"
                      size={15}
                      color={theme.blue}
                    />
                    <Text
                      style={[styles.editBudgetText, { color: theme.blue }]}
                    >
                      تعديل السقف
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.budgetAmountsRow}>
                  <Text
                    style={[
                      styles.budgetSpentText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    المصروف الفعلي:{' '}
                    <Text style={{ color: theme.text, fontWeight: 'bold' }}>
                      {formatMoney(spentLyd, 'LYD')}
                    </Text>
                  </Text>
                  <Text
                    style={[styles.budgetLimitText, { color: theme.textMuted }]}
                  >
                    من أصل {formatMoney(b.monthlyLimitLyd, 'LYD')} ({pct}%)
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
                      { width: `${pct}%`, backgroundColor: barColor },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Modal: Record Income or Internal Transfer (Using Clean Dropdowns) */}
      <Modal
        visible={otherTxModal}
        transparent
        animationType="fade"
        onRequestClose={() => setOtherTxModal(false)}
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
              تسجيل إيراد وارد أو تحويل بين حساباتك
            </Text>

            <CalmDropdown
              label="نوع العملية:"
              value={txType}
              options={[
                {
                  value: 'income',
                  label: 'إيراد وارد / تغذية حساب',
                  icon: 'arrow-down-circle-outline',
                },
                {
                  value: 'transfer',
                  label: 'تحويل داخلي بين حسابين',
                  icon: 'swap-horizontal-outline',
                },
              ]}
              onSelect={(v) => {
                const nextType = v as 'income' | 'transfer';
                setTxType(nextType);
                if (nextType === 'transfer') {
                  const fromAcc = accountMap.get(txAccountId);
                  const validTarget = state.accounts.find(
                    (a) =>
                      a.id !== txAccountId && a.currency === fromAcc?.currency
                  );
                  setTxTargetAccountId(validTarget?.id || '');
                }
              }}
            />

            <CalmDropdown
              label={
                txType === 'transfer' ? 'من الحساب المصدر:' : 'إيداع في حساب:'
              }
              value={txAccountId}
              options={accountDropdownOptions}
              onSelect={(nextAccId) => {
                setTxAccountId(nextAccId);
                const fromAcc = accountMap.get(nextAccId);
                const currentTarget = accountMap.get(txTargetAccountId);
                if (
                  !currentTarget ||
                  currentTarget.id === nextAccId ||
                  currentTarget.currency !== fromAcc?.currency
                ) {
                  const validTarget = state.accounts.find(
                    (a) =>
                      a.id !== nextAccId && a.currency === fromAcc?.currency
                  );
                  setTxTargetAccountId(validTarget?.id || '');
                }
              }}
            />

            {txType === 'transfer' ? (
              <CalmDropdown
                label="إلى الحساب المستلم (نفس العملة):"
                value={txTargetAccountId}
                options={accountDropdownOptions.filter((a) => {
                  const fromAcc = accountMap.get(txAccountId);
                  const targetAcc = accountMap.get(a.value);
                  return (
                    a.value !== txAccountId &&
                    targetAcc?.currency === fromAcc?.currency
                  );
                })}
                onSelect={setTxTargetAccountId}
              />
            ) : (
              <CalmDropdown
                label="نوع الإيراد:"
                value={txCategory}
                options={incomeCategoryOptions}
                onSelect={setTxCategory}
              />
            )}

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              المبلغ
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
              value={txAmount}
              onChangeText={setTxAmount}
              placeholder="0.00"
              placeholderTextColor={theme.textMuted}
            />

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              ملاحظة مختصرة (اختياري)
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
              value={txTitle}
              onChangeText={setTxTitle}
              placeholder="مثال: راتب، إيداع نقدي، تغذية..."
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
                onPress={() => setOtherTxModal(false)}
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
                onPress={handleSaveOtherTransaction}
              >
                <Text style={styles.saveBtnText}>حفظ العملية</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 2: Edit Monthly Budget Limit */}
      <Modal
        visible={Boolean(editingBudgetCat)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingBudgetCat(null)}
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
              تحديد السقف الشهري لغرض: {editingBudgetCat}
            </Text>
            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              الميزانية الشهرية بالدينار الليبي
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
              value={budgetLimitInput}
              onChangeText={setBudgetLimitInput}
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
                onPress={() => setEditingBudgetCat(null)}
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
                  if (editingBudgetCat) {
                    const val = parseFloat(budgetLimitInput);
                    if (Number.isFinite(val) && val >= 0) {
                      updateCategoryBudget(editingBudgetCat, val);
                    }
                    setEditingBudgetCat(null);
                  }
                }}
              >
                <Text style={styles.saveBtnText}>حفظ الميزانية</Text>
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
  quickExpenseCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  quickCardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  quickHeaderRight: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  quickHeaderIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  quickCardSub: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: 5,
    marginTop: 4,
  },
  amountInput: {
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  noteInput: {
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13,
    textAlign: 'right',
  },
  savedFeedbackBox: {
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    borderWidth: 1,
  },
  savedFeedbackText: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  submitQuickBtn: {
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  submitQuickBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  secondaryActionRow: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginBottom: 14,
  },
  secondaryActionBtn: {
    flex: 2,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  secondaryActionBtnText: {
    fontWeight: '600',
    fontSize: 12,
  },
  exportBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  exportBtnText: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  summaryRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    flex: 1,
    minWidth: 140,
    borderRadius: 14,
    padding: 12,
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
  subTabs: {
    flexDirection: 'row-reverse',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
    borderWidth: 1,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  subTabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filtersToolbar: {
    marginBottom: 12,
    gap: 8,
  },
  searchBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    borderRadius: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    textAlign: 'right',
    fontSize: 13,
  },
  txCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  txCardTop: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txCardRight: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  txIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  txSub: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 2,
  },
  txCardLeft: {
    alignItems: 'flex-start',
    marginRight: 8,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  methodBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    marginTop: 4,
  },
  methodBadgeText: {
    fontSize: 10,
  },
  txFooter: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  txNotes: {
    fontSize: 11,
    textAlign: 'right',
    flex: 1,
  },
  deleteSmallBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  budgetIntro: {
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 12,
  },
  budgetCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
  },
  budgetHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  budgetTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  budgetDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  budgetCatName: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  editBudgetBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
  },
  editBudgetText: {
    fontSize: 11,
    fontWeight: '600',
  },
  budgetAmountsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  budgetSpentText: {
    fontSize: 12,
  },
  budgetLimitText: {
    fontSize: 12,
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
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
    maxWidth: 500,
    width: '100%',
    alignSelf: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 5,
    marginTop: 6,
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
    gap: 10,
    alignItems: 'flex-start',
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
