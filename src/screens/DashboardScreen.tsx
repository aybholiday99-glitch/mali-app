import { nextSubmissionKey } from '../services/submissionKey';
import { financialPreview, parseFinancialInput } from '../utils/financialInput';
import { proportionalMoney, addMoney, multiplyMoney, subtractRates } from '../services/financialEngine';
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
import { QUICK_EXPENSE_PURPOSES } from '../data/initialData';
import { CalmDropdown } from '../components/CalmDropdown';
import {
  formatMoney,
  formatRate,
  getPaymentMethodLabel,
  getTransactionTypeLabel,
} from '../utils/exportHelper';
import {
  reconcileDashboardSummary,
  roundMoney,
} from '../services/financialEngine';

interface DashboardProps {
  onNavigate: (tab: string) => void;
  onOpenExportModal: () => void;
}

export const DashboardScreen: React.FC<DashboardProps> = ({
  onNavigate,
  onOpenExportModal,
}) => {
  const [submissionKey, setSubmissionKey] = useState(nextSubmissionKey);
  const { state, theme, updateMarketRates, addTransaction } = useMali();
  const [valuationCurrency, setValuationCurrency] = useState<'LYD' | 'USD'>('LYD');

  // Edit Rates Modal
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [cashRateInput, setCashRateInput] = useState(
    String(state.marketRates.cashUsdToLyd)
  );
  const [chequeRateInput, setChequeRateInput] = useState(
    String(state.marketRates.chequeUsdToLyd)
  );
  const [discountInput, setDiscountInput] = useState(
    String(state.marketRates.defaultChequeDiscountPercent)
  );

  // Quick Calculator Modal
  const [calcModalOpen, setCalcModalOpen] = useState(false);
  const [calcUsdInput, setCalcUsdInput] = useState('1000');
  const [calcChequeLydInput, setCalcChequeLydInput] = useState('10000');

  // Quick Expense Modal right on Home Screen
  const [quickExpModalOpen, setQuickExpModalOpen] = useState(false);
  const [qExpAmount, setQExpAmount] = useState('');
  const [qExpPurposeKey, setQExpPurposeKey] = useState(
    QUICK_EXPENSE_PURPOSES[0].key
  );
  const [qExpCustomDetail, setQExpCustomDetail] = useState('');
  const [qExpAccountId, setQExpAccountId] = useState(
    state.accounts[0]?.id || ''
  );

  const cashRate = state.marketRates.cashUsdToLyd || 6.22;
  const chequeRate = state.marketRates.chequeUsdToLyd || 6.38;
  const discPct = state.marketRates.defaultChequeDiscountPercent || 2.5;

  const summary = reconcileDashboardSummary(state);

  // Balances
  const cashLydTotal = summary.totalCashLyd;
  const bankLydTotal = summary.totalBankLyd;
  const usdTotal = summary.totalUsd;

  // Debts
  const receivableLyd = summary.totalReceivableLyd;
  const payableLyd = summary.totalPayableLyd;
  const receivableUsd = summary.totalReceivableUsd;
  const payableUsd = summary.totalPayableUsd;

  const totalAssetsLyd = summary.netWorthEstimatedLyd;
  const netDebtLyd = roundMoney(
    receivableLyd - payableLyd + roundMoney((receivableUsd - payableUsd) * cashRate)
  );
  const netWorthLyd = roundMoney(totalAssetsLyd + netDebtLyd);
  const netWorthUsd = cashRate > 0 ? roundMoney(netWorthLyd / cashRate) : 0;

  // Deals summary
  const totalRealizedProfitLyd = summary.totalRealizedProfitLyd;
  const openDealsRemainingUsd = summary.totalOpenDealsUsd;

  const unrealizedProfitLyd = state.deals
    .filter((d) => d.status !== 'closed')
    .reduce(
      (s, d) =>
        roundMoney(s + roundMoney(d.remainingUsd * (cashRate - d.effectiveBuyRate))),
      0
    );

  const totalExpensesLyd = state.transactions
    .filter(
      (t) =>
        (t.type === 'expense' && t.category !== 'ديون وأمانات' && t.currency === 'LYD') ||
        (t.type === 'cheque_liquidation' && t.currency === 'LYD')
    )
    .reduce(
      (s, t) =>
        roundMoney(
          s + (t.type === 'cheque_liquidation' ? t.feeAmount || 0 : t.amount)
        ),
      0
    );

  const activeProcedures = state.procedures.filter(
    (p) => p.status !== 'completed' && p.status !== 'cancelled'
  );

  const accountMap = new Map(state.accounts.map((a) => [a.id, a.name]));

  // Calculator values
  const parsedCalcUsd = financialPreview(parseFinancialInput(calcUsdInput));
  const parsedCalcChequeLyd = financialPreview(parseFinancialInput(calcChequeLydInput));
  const calcFeeLyd = financialPreview(proportionalMoney(parsedCalcChequeLyd, discPct, 100));
  const calcNetCashLyd = financialPreview(addMoney(parsedCalcChequeLyd, -calcFeeLyd));

  const handleSaveRates = () => {
    const cRate = parseFinancialInput(cashRateInput);
    const chRate = parseFinancialInput(chequeRateInput);
    const disc = parseFinancialInput(discountInput);
    if (cRate === null || chRate === null || disc === null) return;
    if (!updateMarketRates({
      cashUsdToLyd: cRate,
      chequeUsdToLyd: chRate,
      defaultChequeDiscountPercent: disc,
    })) return;
    setRateModalOpen(false);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      {/* Compact Live Market Exchange Rates Strip */}
      <View
        style={[
          styles.rateStrip,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.rateItemsRow}>
          <View style={styles.rateBadge}>
            <Text style={[styles.rateLabel, { color: theme.textMuted }]}>
              كاش:
            </Text>
            <Text style={[styles.rateValue, { color: theme.success }]}>
              {cashRate.toFixed(2)}
            </Text>
          </View>
          <View
            style={[styles.rateDivider, { backgroundColor: theme.border }]}
          />
          <View style={styles.rateBadge}>
            <Text style={[styles.rateLabel, { color: theme.textMuted }]}>
              تحويل:
            </Text>
            <Text style={[styles.rateValue, { color: theme.blue }]}>
              {chequeRate.toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={styles.rateButtonsGroup}>
          <TouchableOpacity
            style={[styles.editRateBtn, { backgroundColor: theme.blueSoft }]}
            onPress={() => setCalcModalOpen(true)}
          >
            <Ionicons name="calculator-outline" size={14} color={theme.blue} />
            <Text style={[styles.editRateBtnText, { color: theme.blue }]}>
              حاسبة
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.editRateBtn, { backgroundColor: theme.primarySoft }]}
            onPress={() => {
              setCashRateInput(String(state.marketRates.cashUsdToLyd));
              setChequeRateInput(String(state.marketRates.chequeUsdToLyd));
              setDiscountInput(
                String(state.marketRates.defaultChequeDiscountPercent)
              );
              setRateModalOpen(true);
            }}
          >
            <Ionicons name="create-outline" size={14} color={theme.primary} />
            <Text style={[styles.editRateBtnText, { color: theme.primary }]}>
              السعر
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Clean, Low-Density Net Worth Hero Card */}
      <View
        style={[
          styles.heroCard,
          { backgroundColor: theme.primary, borderColor: theme.primary },
        ]}
      >
        <View style={styles.heroHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroSubtitle}>صافي الرصيد الكلي</Text>
            <Text style={styles.heroAmount}>
              {valuationCurrency === 'LYD'
                ? formatMoney(netWorthLyd, 'LYD')
                : formatMoney(netWorthUsd, 'USD')}
            </Text>
            <Text style={styles.heroSecondaryAmount}>
              {valuationCurrency === 'LYD'
                ? `يعادل ${formatMoney(netWorthUsd, 'USD')}`
                : `يعادل ${formatMoney(netWorthLyd, 'LYD')}`}
            </Text>
          </View>

          <View style={styles.currencyToggle}>
            <TouchableOpacity
              style={[
                styles.currBtn,
                valuationCurrency === 'LYD' && styles.currBtnActive,
              ]}
              onPress={() => setValuationCurrency('LYD')}
            >
              <Text
                style={[
                  styles.currBtnText,
                  valuationCurrency === 'LYD' && styles.currBtnTextActive,
                ]}
              >
                دينار
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.currBtn,
                valuationCurrency === 'USD' && styles.currBtnActive,
              ]}
              onPress={() => setValuationCurrency('USD')}
            >
              <Text
                style={[
                  styles.currBtnText,
                  valuationCurrency === 'USD' && styles.currBtnTextActive,
                ]}
              >
                دولار $
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.heroBreakdownGrid}>
          <TouchableOpacity
            style={styles.breakdownItem}
            onPress={() => onNavigate('accounts')}
          >
            <Text style={styles.breakdownLabel}>الكاش النقدي</Text>
            <Text style={styles.breakdownValue}>
              {formatMoney(cashLydTotal, 'LYD')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.breakdownItem}
            onPress={() => onNavigate('accounts')}
          >
            <Text style={styles.breakdownLabel}>المصارف</Text>
            <Text style={styles.breakdownValue}>
              {formatMoney(bankLydTotal, 'LYD')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.breakdownItem}
            onPress={() => onNavigate('deals')}
          >
            <Text style={styles.breakdownLabel}>الدولار ($)</Text>
            <Text style={[styles.breakdownValue, { color: '#FEF08A' }]}>
              {formatMoney(usdTotal, 'USD')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 4 Clean Quick Action Buttons */}
      <View style={styles.quickActionsRow}>
        <TouchableOpacity
          style={[
            styles.quickActionBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          onPress={() => {
            setQExpAccountId(state.accounts[0]?.id || '');
            setQuickExpModalOpen(true);
          }}
        >
          <View
            style={[
              styles.quickIconCircle,
              { backgroundColor: theme.amberSoft },
            ]}
          >
            <Ionicons name="receipt-outline" size={19} color={theme.amber} />
          </View>
          <Text style={[styles.quickActionText, { color: theme.text }]}>
            سحب مصروف
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.quickActionBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          onPress={() => onNavigate('deals')}
        >
          <View
            style={[
              styles.quickIconCircle,
              { backgroundColor: theme.successSoft },
            ]}
          >
            <Ionicons name="trending-up" size={19} color={theme.success} />
          </View>
          <Text style={[styles.quickActionText, { color: theme.text }]}>
            تداول دولار
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.quickActionBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          onPress={() => onNavigate('accounts')}
        >
          <View
            style={[
              styles.quickIconCircle,
              { backgroundColor: theme.blueSoft },
            ]}
          >
            <Ionicons name="swap-horizontal" size={19} color={theme.blue} />
          </View>
          <Text style={[styles.quickActionText, { color: theme.text }]}>
            تسييل صك
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.quickActionBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          onPress={() => onNavigate('contacts')}
        >
          <View
            style={[
              styles.quickIconCircle,
              { backgroundColor: theme.primarySoft },
            ]}
          >
            <Ionicons name="people" size={19} color={theme.primary} />
          </View>
          <Text style={[styles.quickActionText, { color: theme.text }]}>
            المتعاملون
          </Text>
        </TouchableOpacity>
      </View>

      {/* Two Compact Summary Cards */}
      <View style={styles.kpiRow}>
        <TouchableOpacity
          style={[
            styles.kpiCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          onPress={() => onNavigate('deals')}
        >
          <Text style={[styles.kpiTitle, { color: theme.textSecondary }]}>
            أرباح تداول الدولار
          </Text>
          <Text style={[styles.kpiMainVal, { color: theme.success }]}>
            +{formatMoney(totalRealizedProfitLyd, 'LYD')}
          </Text>
          <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
            المتبقي بالصفقات: ${openDealsRemainingUsd.toLocaleString()}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.kpiCard,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          onPress={() => onNavigate('expenses')}
        >
          <Text style={[styles.kpiTitle, { color: theme.textSecondary }]}>
            إجمالي المصاريف
          </Text>
          <Text style={[styles.kpiMainVal, { color: theme.danger }]}>
            {formatMoney(totalExpensesLyd, 'LYD')}
          </Text>
          <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
            {activeProcedures.length} إجراءات نشطة | صافي الديون:{' '}
            {formatMoney(netDebtLyd, 'LYD')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Accounts & Wallets Quick Strip */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          حساباتي وخزائني
        </Text>
        <TouchableOpacity onPress={() => onNavigate('accounts')}>
          <Text style={[styles.sectionLink, { color: theme.primary }]}>
            إدارة الحسابات ←
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.accountsCarousel}
      >
        {state.accounts.map((acc) => (
          <TouchableOpacity
            key={acc.id}
            style={[
              styles.miniAccCard,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                borderRightColor: acc.color,
              },
            ]}
            onPress={() => onNavigate('accounts')}
          >
            <Text
              style={[styles.miniAccName, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {acc.name}
            </Text>
            <Text style={[styles.miniAccBalance, { color: theme.text }]}>
              {formatMoney(acc.balance, acc.currency)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Recent Transactions (4 items for low visual clutter) */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>
          آخر الحركات
        </Text>
        <TouchableOpacity onPress={() => onNavigate('expenses')}>
          <Text style={[styles.sectionLink, { color: theme.primary }]}>
            عرض الكل ←
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.txListCard,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        {state.transactions.slice(0, 4).map((tx, idx) => {
          const isPositive =
            tx.type === 'income' ||
            tx.type === 'deal_sell' ||
            (tx.type === 'debt_settlement' &&
              (tx.title.startsWith('تحصيل') || tx.title.startsWith('استلام')));
          const isTransfer =
            tx.type === 'cheque_liquidation' || tx.type === 'transfer';

          return (
            <View
              key={tx.id}
              style={[
                styles.txRow,
                { borderBottomColor: theme.border },
                idx === Math.min(3, state.transactions.length - 1) && {
                  borderBottomWidth: 0,
                },
              ]}
            >
              <View style={styles.txRight}>
                <View
                  style={[
                    styles.txIconBox,
                    {
                      backgroundColor: isPositive
                        ? theme.successSoft
                        : isTransfer
                        ? theme.blueSoft
                        : theme.dangerSoft,
                    },
                  ]}
                >
                  <Ionicons
                    name={
                      isPositive
                        ? 'arrow-down-outline'
                        : isTransfer
                        ? 'swap-horizontal-outline'
                        : 'arrow-up-outline'
                    }
                    size={16}
                    color={
                      isPositive
                        ? theme.success
                        : isTransfer
                        ? theme.blue
                        : theme.danger
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.txTitle, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {tx.title}
                  </Text>
                  <Text style={[styles.txMeta, { color: theme.textMuted }]}>
                    {accountMap.get(tx.accountId) || 'حساب'} • {tx.date}
                  </Text>
                </View>
              </View>
              <View style={styles.txLeft}>
                <Text
                  style={[
                    styles.txAmount,
                    {
                      color: isPositive
                        ? theme.success
                        : isTransfer
                        ? theme.blue
                        : theme.danger,
                    },
                  ]}
                >
                  {isPositive ? '+' : isTransfer ? '⇄ ' : '-'}
                  {formatMoney(tx.amount, tx.currency)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Modal 1: Edit Market Rates */}
      <Modal visible={rateModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              تحديث أسعار صرف الدولار ونسبة خصم الصكوك
            </Text>
            <Text style={[styles.modalSub, { color: theme.textMuted }]}>
              تُستخدم هذه الأسعار كمرجع افتراضي عند فتح الصفقات ولحساب صافي ثروتك اللحظي
            </Text>

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              سعر الدولار نقدي (كاش) مقابل الدينار
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.surfaceSoft,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              keyboardType="numeric"
              value={cashRateInput}
              onChangeText={setCashRateInput}
            />

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              سعر الدولار تحويل مصرفي / صكوك مقابل الدينار
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.surfaceSoft,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              keyboardType="numeric"
              value={chequeRateInput}
              onChangeText={setChequeRateInput}
            />

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              نسبة خصم تسييل الصكوك الافتراضية (%)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.surfaceSoft,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              keyboardType="numeric"
              value={discountInput}
              onChangeText={setDiscountInput}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  { backgroundColor: theme.surfaceSoft },
                ]}
                onPress={() => setRateModalOpen(false)}
              >
                <Text
                  style={[styles.cancelBtnText, { color: theme.textSecondary }]}
                >
                  إلغاء
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: theme.primary }]}
                onPress={handleSaveRates}
              >
                <Text style={styles.saveBtnText}>حفظ الأسعار</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 2: Quick Currency & Cheque Liquidation Calculator */}
      <Modal visible={calcModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              الحاسبة السريعة (دولار كاش / تحويل مصرفي / تسييل صكوك)
            </Text>
            <Text style={[styles.modalSub, { color: theme.textMuted }]}>
              احسب فوراً قيمة أي مبلغ دولار بالكاش أو التحويل، وصافي تسييل أي صك مصرفي
            </Text>

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              1. أدخل مبلغ الدولار ($ USD) لمعرفة قيمته بالدينار:
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.surfaceSoft,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              keyboardType="numeric"
              value={calcUsdInput}
              onChangeText={setCalcUsdInput}
            />

            <View
              style={[
                styles.calcResultBox,
                { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
              ]}
            >
              <View style={styles.calcRow}>
                <Text style={[styles.calcLabel, { color: theme.textSecondary }]}>
                  القيمة نقداً (كاش بسعر {cashRate}):
                </Text>
                <Text style={[styles.calcVal, { color: theme.success }]}>
                  {formatMoney(financialPreview(multiplyMoney(parsedCalcUsd, cashRate)), 'LYD')}
                </Text>
              </View>
              <View style={styles.calcRow}>
                <Text style={[styles.calcLabel, { color: theme.textSecondary }]}>
                  القيمة بتحويل مصرفي/صك (بسعر {chequeRate}):
                </Text>
                <Text style={[styles.calcVal, { color: theme.blue }]}>
                  {formatMoney(financialPreview(multiplyMoney(parsedCalcUsd, chequeRate)), 'LYD')}
                </Text>
              </View>
              <View style={styles.calcRow}>
                <Text style={[styles.calcLabel, { color: theme.textSecondary }]}>
                  فرق القيمة بين التحويل والكاش:
                </Text>
                <Text style={[styles.calcVal, { color: theme.amber }]}>
                  +{formatMoney(financialPreview(multiplyMoney(parsedCalcUsd, subtractRates(chequeRate, cashRate))), 'LYD')}
                </Text>
              </View>
            </View>

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              2. أدخل قيمة صك مصرفي (د.ل) لمعرفة صافي الكاش بعد خصم ({discPct}%):
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.surfaceSoft,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              keyboardType="numeric"
              value={calcChequeLydInput}
              onChangeText={setCalcChequeLydInput}
            />

            <View
              style={[
                styles.calcResultBox,
                { backgroundColor: theme.surfaceSoft, borderColor: theme.border },
              ]}
            >
              <View style={styles.calcRow}>
                <Text style={[styles.calcLabel, { color: theme.textSecondary }]}>
                  عمولة التسييل المخصومة ({discPct}%):
                </Text>
                <Text style={[styles.calcVal, { color: theme.danger }]}>
                  -{formatMoney(calcFeeLyd, 'LYD')}
                </Text>
              </View>
              <View style={styles.calcRow}>
                <Text style={[styles.calcLabel, { color: theme.textSecondary }]}>
                  الصافي المستلم كاش باليد:
                </Text>
                <Text style={[styles.calcVal, { color: theme.success }]}>
                  {formatMoney(calcNetCashLyd, 'LYD')}
                </Text>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: theme.primary }]}
                onPress={() => setCalcModalOpen(false)}
              >
                <Text style={styles.saveBtnText}>تم</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 3: Fast & Concise 3-Step Expense Modal on Home Screen */}
      <Modal
        visible={quickExpModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQuickExpModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.text }]}>
              سحب مصروف سريع ومختصر
            </Text>
            <Text style={[styles.modalSub, { color: theme.textMuted }]}>
              أدخل القيمة المسحوبة ← اختر الغرض ← اختر الحساب الذي سُحبت منه
            </Text>

            <Text style={[styles.inputLabel, { color: theme.text }]}>
              1. القيمة المسحوبة:
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.surfaceSoft,
                  borderColor: theme.primary,
                  color: theme.text,
                  fontSize: 16,
                  fontWeight: 'bold',
                },
              ]}
              keyboardType="numeric"
              value={qExpAmount}
              onChangeText={setQExpAmount}
              placeholder="اكتب المبلغ المسحوب هنا (مثلاً 50)..."
              placeholderTextColor={theme.textMuted}
            />

            <View
              style={{
                flexDirection: 'row-reverse',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: 6,
              }}
            >
              {['10', '20', '50', '100', '200', '500'].map((val) => {
                const active = qExpAmount === val;
                return (
                  <TouchableOpacity
                    key={val}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 8,
                      borderWidth: 1,
                      backgroundColor: active
                        ? theme.primary
                        : theme.surfaceSoft,
                      borderColor: active ? theme.primary : theme.border,
                    }}
                    onPress={() => setQExpAmount(val)}
                  >
                    <Text
                      style={{
                        color: active ? '#FFFFFF' : theme.textSecondary,
                        fontSize: 12,
                        fontWeight: 'bold',
                      }}
                    >
                      {val}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <CalmDropdown
              label="2. لأي غرض؟ (أكل، ملابس، سيارة، مقاضي، أو غيره):"
              value={qExpPurposeKey}
              options={QUICK_EXPENSE_PURPOSES.map((p) => ({
                value: p.key,
                label: p.label,
                icon: p.icon,
                badgeColor: p.color,
              }))}
              onSelect={setQExpPurposeKey}
            />

            <CalmDropdown
              label="3. سُحبت من أي حساب؟"
              value={qExpAccountId}
              options={state.accounts.map((acc) => ({
                value: acc.id,
                label: acc.name,
                subLabel: `${formatMoney(acc.balance, acc.currency)} • ${
                  acc.isCash ? 'نقدي كاش' : acc.bankName
                }`,
                icon: acc.isCash ? 'cash-outline' : 'card-outline',
                badgeColor: acc.color,
              }))}
              onSelect={setQExpAccountId}
            />

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>
              تفصيل إضافي اختياري:
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.surfaceSoft,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={qExpCustomDetail}
              onChangeText={setQExpCustomDetail}
              placeholder="مثال: عشاء، بنزين، قميص (اختياري)..."
              placeholderTextColor={theme.textMuted}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  { backgroundColor: theme.surfaceSoft },
                ]}
                onPress={() => setQuickExpModalOpen(false)}
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
                  const amt = parseFinancialInput(qExpAmount);
                  const acc = state.accounts.find(
                    (a) => a.id === qExpAccountId
                  );
                  if (amt === null || amt <= 0 || !acc) return;
                  const purposeObj =
                    QUICK_EXPENSE_PURPOSES.find(
                      (p) => p.key === qExpPurposeKey
                    ) || QUICK_EXPENSE_PURPOSES[0];
                  const detail = qExpCustomDetail.trim();
                  if (!addTransaction({
                    idempotencyKey: submissionKey + ":addTransaction",
                    title: detail
                      ? `${purposeObj.shortLabel}: ${detail}`
                      : `سحب مصروف (${purposeObj.shortLabel})`,
                    type: 'expense',
                    amount: amt,
                    currency: acc.currency,
                    category: purposeObj.key,
                    accountId: acc.id,
                    paymentMethod: acc.isCash ? 'cash' : 'card',
                    notes: detail
                      ? `الغرض: ${detail} — سحب من ${acc.name}`
                      : undefined,
                  })) return;
                  setSubmissionKey(nextSubmissionKey());
                  setQExpAmount('');
                  setQExpCustomDetail('');
                  setQuickExpModalOpen(false);
                }}
              >
                <Text style={styles.saveBtnText}>سحب وحفظ المصروف الآن</Text>
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
  rateStrip: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    flexWrap: 'wrap',
    gap: 8,
  },
  rateItemsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  rateBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  rateLabel: {
    fontSize: 12,
  },
  rateValue: {
    fontWeight: 'bold',
    fontSize: 13,
  },
  rateDivider: {
    width: 1,
    height: 14,
  },
  rateButtonsGroup: {
    flexDirection: 'row-reverse',
    gap: 6,
  },
  editRateBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  editRateBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  heroCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  heroHeaderRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 4,
  },
  heroAmount: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  heroSecondaryAmount: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    textAlign: 'right',
    marginTop: 2,
  },
  currencyToggle: {
    flexDirection: 'row-reverse',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 10,
    padding: 3,
  },
  currBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  currBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  currBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  currBtnTextActive: {
    color: '#0F766E',
    fontWeight: 'bold',
  },
  heroBreakdownGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    paddingTop: 14,
  },
  breakdownItem: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
    borderRadius: 12,
    padding: 10,
    alignItems: 'flex-end',
  },
  breakdownLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    textAlign: 'right',
  },
  breakdownValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 2,
  },
  quickActionsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
  },
  quickActionBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
  },
  quickIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickActionText: {
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  kpiRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 18,
  },
  kpiCard: {
    flex: 1,
    minWidth: 240,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  kpiTop: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  kpiTitle: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  miniBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  kpiMainVal: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 4,
  },
  kpiSub: {
    fontSize: 11,
    textAlign: 'right',
  },
  sectionHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  sectionLink: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  accountsCarousel: {
    marginBottom: 18,
  },
  miniAccCard: {
    borderRadius: 14,
    padding: 14,
    marginLeft: 10,
    width: 210,
    borderWidth: 1,
    borderRightWidth: 4,
  },
  miniAccTop: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  miniAccBadgeBox: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  miniAccBank: {
    fontSize: 10,
  },
  miniAccName: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: 6,
  },
  miniAccBalance: {
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  txListCard: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
  },
  txRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  txRight: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  txIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txTitle: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  txMeta: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 2,
  },
  txLeft: {
    alignItems: 'flex-start',
    marginRight: 8,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  txTypeTag: {
    fontSize: 10,
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    maxWidth: 460,
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
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlign: 'right',
    fontSize: 14,
  },
  calcResultBox: {
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    gap: 6,
  },
  calcRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calcLabel: {
    fontSize: 12,
  },
  calcVal: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalActions: {
    flexDirection: 'row-reverse',
    justifyContent: 'flex-start',
    gap: 10,
    marginTop: 18,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
