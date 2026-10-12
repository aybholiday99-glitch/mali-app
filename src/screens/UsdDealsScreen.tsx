import { nextSubmissionKey } from '../services/submissionKey';
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
import { PaymentMethodType, UsdDeal } from '../types/mali';
import { CalmDropdown } from '../components/CalmDropdown';
import { calculateUsdDealCostBasis, roundMoney } from '../services/financialEngine';
import {
  ReceiptAttachmentField,
  ReceiptInlineStrip,
} from '../components/ReceiptImageAttachment';
import {
  exportFileOrShare,
  formatMoney,
  formatRate,
  generateDealsCsv,
  getPaymentMethodLabel,
} from '../utils/exportHelper';

export const UsdDealsScreen: React.FC = () => {
  const [submissionKey, setSubmissionKey] = useState(nextSubmissionKey);
  const {
    state,
    theme,
    createUsdDeal,
    recordDealSale,
    updateDealBuyReceipts,
    updateDealSaleReceipts,
    deleteUsdDeal,
  } = useMali();

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');

  const lydAccounts = state.accounts.filter((a) => a.currency === 'LYD');
  const cashLydAccounts = lydAccounts.filter((a) => a.isCash);
  const bankLydAccounts = lydAccounts.filter((a) => !a.isCash);
  const usdAccounts = state.accounts.filter((a) => a.currency === 'USD');
  const accountMap = new Map(state.accounts.map((a) => [a.id, a]));

  // New Deal Modal State (Buy Side)
  const [newDealModal, setNewDealModal] = useState(false);
  const [dealTitle, setDealTitle] = useState('');
  const [buyMode, setBuyMode] = useState<'cash' | 'bank'>('cash');
  const [buyMethod, setBuyMethod] = useState<PaymentMethodType>('cash');
  const [sourceLydId, setSourceLydId] = useState(
    cashLydAccounts[0]?.id || lydAccounts[0]?.id || ''
  );
  const [targetUsdId, setTargetUsdId] = useState(usdAccounts[0]?.id || '');
  const [usdBoughtStr, setUsdBoughtStr] = useState('5000');
  const [buyRateStr, setBuyRateStr] = useState(
    String(state.marketRates.cashUsdToLyd)
  );
  const [buyCommStr, setBuyCommStr] = useState('0');
  const [sellerContactId, setSellerContactId] = useState<string | undefined>(
    undefined
  );
  const [counterparty, setCounterparty] = useState('');
  const [counterpartyPhone, setCounterpartyPhone] = useState('');
  const [dealNotes, setDealNotes] = useState('');
  const [buyReceiptImages, setBuyReceiptImages] = useState<string[]>([]);

  // Optional Immediate Sell inside New Deal Modal
  const [includeImmediateSell, setIncludeImmediateSell] = useState(false);
  const [immSellUsdStr, setImmSellUsdStr] = useState('5000');
  const [immSellMode, setImmSellMode] = useState<'cash' | 'bank'>('bank');
  const [immSellMethod, setImmSellMethod] =
    useState<PaymentMethodType>('transfer');
  const [immSellRateStr, setImmSellRateStr] = useState(
    String(state.marketRates.chequeUsdToLyd)
  );
  const [immSellCommStr, setImmSellCommStr] = useState('0');
  const [immSellTargetLydId, setImmSellTargetLydId] = useState(
    bankLydAccounts[0]?.id || lydAccounts[0]?.id || ''
  );
  const [immBuyerContactId, setImmBuyerContactId] = useState<
    string | undefined
  >(undefined);
  const [immBuyerName, setImmBuyerName] = useState('');
  const [immBuyerPhone, setImmBuyerPhone] = useState('');
  const [immSellReceiptImages, setImmSellReceiptImages] = useState<string[]>(
    []
  );

  // Record Sale / Personal Take Modal State (for existing open deal)
  const [activeDealForSale, setActiveDealForSale] = useState<UsdDeal | null>(
    null
  );
  const [isPersonalTakeMode, setIsPersonalTakeMode] = useState(false);
  const [saleMode, setSaleMode] = useState<'cash' | 'bank'>('bank');
  const [saleMethod, setSaleMethod] = useState<PaymentMethodType>('transfer');
  const [saleUsdStr, setSaleUsdStr] = useState('');
  const [saleRateStr, setSaleRateStr] = useState('');
  const [saleCommStr, setSaleCommStr] = useState('0');
  const [saleTargetLydId, setSaleTargetLydId] = useState(
    bankLydAccounts[0]?.id || lydAccounts[0]?.id || ''
  );
  const [personalUsdAccountId, setPersonalUsdAccountId] = useState('');
  const [buyerContactId, setBuyerContactId] = useState<string | undefined>(
    undefined
  );
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [saleNotes, setSaleNotes] = useState('');
  const [saleReceiptImages, setSaleReceiptImages] = useState<string[]>([]);

  // Deal Delete Confirmation Modal
  const [dealToDelete, setDealToDelete] = useState<UsdDeal | null>(null);

  // KPIs
  const totalRealizedProfit = state.deals.reduce(
    (s, d) => s + d.realizedProfitLyd,
    0
  );
  const totalRemainingUsd = state.deals
    .filter((d) => d.status !== 'closed')
    .reduce((s, d) => s + d.remainingUsd, 0);

  const potentialProfitCash = state.deals
    .filter((d) => d.status !== 'closed')
    .reduce(
      (s, d) =>
        s +
        d.remainingUsd *
          (state.marketRates.cashUsdToLyd - d.effectiveBuyRate),
      0
    );

  const potentialProfitCheque = state.deals
    .filter((d) => d.status !== 'closed')
    .reduce(
      (s, d) =>
        s +
        d.remainingUsd *
          (state.marketRates.chequeUsdToLyd - d.effectiveBuyRate),
      0
    );

  const filteredDeals = state.deals.filter((d) => {
    if (statusFilter === 'active' && d.status === 'closed') return false;
    if (statusFilter === 'closed' && d.status !== 'closed') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      return (
        d.title.toLowerCase().includes(q) ||
        d.dealNumber.toLowerCase().includes(q) ||
        (d.counterparty && d.counterparty.toLowerCase().includes(q)) ||
        d.sales.some(
          (s) => s.buyerName && s.buyerName.toLowerCase().includes(q)
        )
      );
    }
    return true;
  });

  // Live calculations for New Deal Modal
  const parsedBuyUsd = parseFloat(usdBoughtStr) || 0;
  const parsedBuyRate = parseFloat(buyRateStr) || 0;
  const parsedBuyComm = parseFloat(buyCommStr) || 0;
  const previewBuyGrossLyd = Number((parsedBuyUsd * parsedBuyRate).toFixed(2));
  const previewBuyTotalLyd = Number(
    (previewBuyGrossLyd + parsedBuyComm).toFixed(2)
  );
  const previewEffectiveRate =
    parsedBuyUsd > 0
      ? Number((previewBuyTotalLyd / parsedBuyUsd).toFixed(4))
      : 0;

  // Immediate Sell Preview
  const parsedImmSellUsd = Math.min(
    parseFloat(immSellUsdStr) || 0,
    parsedBuyUsd
  );
  const parsedImmSellRate = parseFloat(immSellRateStr) || 0;
  const parsedImmSellComm = parseFloat(immSellCommStr) || 0;
  const previewImmSellNetLyd = Number(
    (parsedImmSellUsd * parsedImmSellRate - parsedImmSellComm).toFixed(2)
  );
  const previewImmSellCost = Number(
    (parsedImmSellUsd * previewEffectiveRate).toFixed(2)
  );
  const previewImmSellProfit = Number(
    (previewImmSellNetLyd - previewImmSellCost).toFixed(2)
  );

  // Live calculations for Sale Modal (on existing deal)
  const parsedSaleUsd = Math.min(
    parseFloat(saleUsdStr) || 0,
    activeDealForSale?.remainingUsd || 0
  );
  const parsedSaleRate = isPersonalTakeMode
    ? activeDealForSale?.effectiveBuyRate || 0
    : parseFloat(saleRateStr) || 0;
  const parsedSaleComm = isPersonalTakeMode ? 0 : parseFloat(saleCommStr) || 0;
  const previewSaleGrossLyd = Number(
    (parsedSaleUsd * parsedSaleRate).toFixed(2)
  );
  const previewSaleNetLyd = Number(
    (previewSaleGrossLyd - parsedSaleComm).toFixed(2)
  );
  const previewSaleCostBasis = activeDealForSale && parsedSaleUsd > 0 &&
    roundMoney(parsedSaleUsd) <= activeDealForSale.remainingUsd
    ? calculateUsdDealCostBasis(activeDealForSale, roundMoney(parsedSaleUsd)) : 0;
  const previewSaleProfit = isPersonalTakeMode
    ? 0
    : Number((previewSaleNetLyd - previewSaleCostBasis).toFixed(2));
  const previewRateSpread = Number(
    (parsedSaleRate - (activeDealForSale?.buyRate || 0)).toFixed(3)
  );

  // Handlers for switching Cash vs Bank Transfer in Buy Modal
  const handleSelectBuyMode = (mode: 'cash' | 'bank') => {
    setBuyMode(mode);
    if (mode === 'cash') {
      setBuyMethod('cash');
      setBuyRateStr(String(state.marketRates.cashUsdToLyd));
      if (cashLydAccounts.length > 0) {
        setSourceLydId(cashLydAccounts[0].id);
      }
    } else {
      setBuyMethod('transfer');
      setBuyRateStr(String(state.marketRates.chequeUsdToLyd));
      if (bankLydAccounts.length > 0) {
        setSourceLydId(bankLydAccounts[0].id);
      }
    }
  };

  // Handler for switching Cash vs Bank Transfer in Immediate Sell
  const handleSelectImmSellMode = (mode: 'cash' | 'bank') => {
    setImmSellMode(mode);
    if (mode === 'cash') {
      setImmSellMethod('cash');
      setImmSellRateStr(String(state.marketRates.cashUsdToLyd));
      if (cashLydAccounts.length > 0) {
        setImmSellTargetLydId(cashLydAccounts[0].id);
      }
    } else {
      setImmSellMethod('transfer');
      setImmSellRateStr(String(state.marketRates.chequeUsdToLyd));
      if (bankLydAccounts.length > 0) {
        setImmSellTargetLydId(bankLydAccounts[0].id);
      }
    }
  };

  // Handler for switching Cash vs Bank Transfer in Record Sale Modal
  const handleSelectSaleMode = (mode: 'cash' | 'bank') => {
    setSaleMode(mode);
    if (mode === 'cash') {
      setSaleMethod('cash');
      setSaleRateStr(String(state.marketRates.cashUsdToLyd));
      if (cashLydAccounts.length > 0) {
        setSaleTargetLydId(cashLydAccounts[0].id);
      }
    } else {
      setSaleMethod('transfer');
      setSaleRateStr(String(state.marketRates.chequeUsdToLyd));
      if (bankLydAccounts.length > 0) {
        setSaleTargetLydId(bankLydAccounts[0].id);
      }
    }
  };

  const handleOpenNewDealModal = () => {
    handleSelectBuyMode('cash');
    setTargetUsdId(usdAccounts[0]?.id || '');
    setSellerContactId(undefined);
    setCounterparty('');
    setCounterpartyPhone('');
    setBuyReceiptImages([]);
    setIncludeImmediateSell(false);
    setImmSellUsdStr(usdBoughtStr);
    setImmSellReceiptImages([]);
    handleSelectImmSellMode('bank');
    setNewDealModal(true);
  };

  const handleCreateDeal = () => {
    if (
      parsedBuyUsd <= 0 ||
      parsedBuyRate <= 0 ||
      !sourceLydId ||
      !targetUsdId
    ) {
      return;
    }

    const srcAcc = accountMap.get(sourceLydId);
    if (!createUsdDeal({
      idempotencyKey: submissionKey + ":createUsdDeal",
      title:
        dealTitle.trim() ||
        `شراء ${parsedBuyUsd.toLocaleString()}$ (${
          buyMode === 'cash' ? 'نقدي كاش' : `تحويل - ${srcAcc?.bankName || ''}`
        })`,
      contactId: sellerContactId,
      counterparty: counterparty.trim() || undefined,
      counterpartyPhone: counterpartyPhone.trim() || undefined,
      totalUsdBought: parsedBuyUsd,
      buyRate: parsedBuyRate,
      buyCommissionLyd: parsedBuyComm,
      buyPaymentMethod: buyMethod,
      sourceLydAccountId: sourceLydId,
      usdHoldingAccountId: targetUsdId,
      buyReceiptImages:
        buyReceiptImages.length > 0 ? buyReceiptImages : undefined,
      notes: dealNotes.trim() || undefined,
      immediateSale:
        includeImmediateSell && parsedImmSellUsd > 0 && parsedImmSellRate > 0
          ? {
              usdAmount: parsedImmSellUsd,
              sellRate: parsedImmSellRate,
              commissionLyd: parsedImmSellComm,
              paymentMethod: immSellMethod,
              targetLydAccountId: immSellTargetLydId,
              buyerContactId: immBuyerContactId,
              buyerName: immBuyerName.trim() || undefined,
              buyerPhone: immBuyerPhone.trim() || undefined,
              receiptImages:
                immSellReceiptImages.length > 0
                  ? immSellReceiptImages
                  : undefined,
            }
          : undefined,
    })) return;
    setSubmissionKey(nextSubmissionKey());

    setDealTitle('');
    setCounterparty('');
    setCounterpartyPhone('');
    setDealNotes('');
    setBuyReceiptImages([]);
    setImmSellReceiptImages([]);
    setNewDealModal(false);
  };

  const handleOpenSaleModal = (deal: UsdDeal, personalTake: boolean) => {
    setActiveDealForSale(deal);
    setIsPersonalTakeMode(personalTake);
    setSaleUsdStr(String(deal.remainingUsd));
    if (personalTake) {
      setSaleRateStr(String(deal.effectiveBuyRate));
      setSaleMode('cash');
      setSaleMethod('cash');
      setPersonalUsdAccountId(deal.usdHoldingAccountId);
    } else {
      const defaultMode = deal.buyPaymentMethod === 'cash' ? 'bank' : 'cash';
      setSaleMode(defaultMode);
      if (defaultMode === 'cash') {
        setSaleMethod('cash');
        setSaleRateStr(String(state.marketRates.cashUsdToLyd));
        setSaleTargetLydId(cashLydAccounts[0]?.id || lydAccounts[0]?.id || '');
      } else {
        setSaleMethod('transfer');
        setSaleRateStr(String(state.marketRates.chequeUsdToLyd));
        setSaleTargetLydId(bankLydAccounts[0]?.id || lydAccounts[0]?.id || '');
      }
    }
    setSaleCommStr('0');
    setBuyerContactId(undefined);
    setBuyerName('');
    setBuyerPhone('');
    setSaleNotes('');
    setSaleReceiptImages([]);
  };

  const handleConfirmSale = () => {
    if (!activeDealForSale || !Number.isFinite(parsedSaleUsd) || parsedSaleUsd <= 0 ||
      roundMoney(parsedSaleUsd) > activeDealForSale.remainingUsd) return;
    const targetId = isPersonalTakeMode ? personalUsdAccountId : saleTargetLydId;
    const target = accountMap.get(targetId);
    if (!target || target.currency !== (isPersonalTakeMode ? 'USD' : 'LYD')) return;
    if (!recordDealSale({
      idempotencyKey: submissionKey + ":recordDealSale",
      dealId: activeDealForSale.id,
      usdAmount: parsedSaleUsd,
      sellRate: parsedSaleRate,
      commissionLyd: parsedSaleComm,
      paymentMethod: saleMethod,
      targetLydAccountId: targetId,
      sourceUsdAccountId: activeDealForSale.usdHoldingAccountId,
      contactId: buyerContactId,
      buyerName: buyerName.trim() || undefined,
      buyerPhone: buyerPhone.trim() || undefined,
      isPersonalTake: isPersonalTakeMode,
      receiptImages:
        saleReceiptImages.length > 0 ? saleReceiptImages : undefined,
      notes: saleNotes.trim() || undefined,
    })) return;
    setSubmissionKey(nextSubmissionKey());
    setSaleReceiptImages([]);
    setActiveDealForSale(null);
  };

  const buyMatchingAccounts =
    buyMode === 'cash'
      ? cashLydAccounts.length > 0
        ? cashLydAccounts
        : lydAccounts
      : bankLydAccounts.length > 0
      ? bankLydAccounts
      : lydAccounts;

  const immSellMatchingAccounts =
    immSellMode === 'cash'
      ? cashLydAccounts.length > 0
        ? cashLydAccounts
        : lydAccounts
      : bankLydAccounts.length > 0
      ? bankLydAccounts
      : lydAccounts;

  const saleMatchingAccounts =
    saleMode === 'cash'
      ? cashLydAccounts.length > 0
        ? cashLydAccounts
        : lydAccounts
      : bankLydAccounts.length > 0
      ? bankLydAccounts
      : lydAccounts;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      {/* Live Market Reference Banner: Cash Rate vs Bank Transfer Rate */}
      <View
        style={[
          styles.ratesBanner,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View style={styles.rateBox}>
          <Text style={[styles.rateBoxTitle, { color: theme.textSecondary }]}>
            سعر الدولار نقدي (كاش)
          </Text>
          <Text style={[styles.rateBoxValue, { color: theme.primary }]}>
            {formatRate(state.marketRates.cashUsdToLyd)}
          </Text>
        </View>
        <View
          style={[styles.rateDivider, { backgroundColor: theme.border }]}
        />
        <View style={styles.rateBox}>
          <Text style={[styles.rateBoxTitle, { color: theme.textSecondary }]}>
            سعر الدولار تحويل مصرفي / صك
          </Text>
          <Text style={[styles.rateBoxValue, { color: theme.blue }]}>
            {formatRate(state.marketRates.chequeUsdToLyd)}
          </Text>
        </View>
        <View
          style={[styles.rateDivider, { backgroundColor: theme.border }]}
        />
        <View style={styles.rateBox}>
          <Text style={[styles.rateBoxTitle, { color: theme.textSecondary }]}>
            الفرق بين التحويل والكاش
          </Text>
          <Text style={[styles.rateBoxValue, { color: theme.warning }]}>
            +
            {(
              state.marketRates.chequeUsdToLyd - state.marketRates.cashUsdToLyd
            ).toFixed(3)}{' '}
            د.ل
          </Text>
        </View>
      </View>

      {/* Top KPI Cards */}
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
            إجمالي صافي الأرباح المحققة
          </Text>
          <Text style={[styles.kpiVal, { color: theme.success }]}>
            +{formatMoney(totalRealizedProfit, 'LYD')}
          </Text>
          <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
            من {state.deals.length} صفقات مسجلة
          </Text>
        </View>

        <View
          style={[
            styles.kpiCard,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              borderTopWidth: 3,
              borderTopColor: theme.warning,
            },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: theme.textSecondary }]}>
            الرصيد المتبقي في الصفقات المفتوحة
          </Text>
          <Text style={[styles.kpiVal, { color: theme.warning }]}>
            {formatMoney(totalRemainingUsd, 'USD')}
          </Text>
          <Text style={[styles.kpiSub, { color: theme.textMuted }]}>
            ربح متوقع: كاش ({potentialProfitCash >= 0 ? '+' : ''}
            {Math.round(potentialProfitCash)} د.ل) | تحويل مصرفي (
            {potentialProfitCheque >= 0 ? '+' : ''}
            {Math.round(potentialProfitCheque)} د.ل)
          </Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.newDealBtn, { backgroundColor: theme.primary }]}
          onPress={handleOpenNewDealModal}
        >
          <Ionicons name="add-circle" size={20} color="#FFFFFF" />
          <Text style={styles.newDealBtnText}>
            فتح صفقة دولار (شراء نقدي أو تحويل مصرفي)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.exportDealsBtn,
            {
              backgroundColor: theme.blueSoft,
              borderColor: theme.blue,
            },
          ]}
          onPress={() => {
            const csv = generateDealsCsv(state);
            exportFileOrShare('سجل_صفقات_تداول_الدولار.csv', csv);
          }}
        >
          <Ionicons name="download-outline" size={18} color={theme.blue} />
          <Text style={[styles.exportDealsBtnText, { color: theme.blue }]}>
            تصدير Excel
          </Text>
        </TouchableOpacity>
      </View>

      {/* Compact Search & Status Dropdown Row */}
      <View
        style={{
          flexDirection: 'row-reverse',
          gap: 8,
          marginBottom: 14,
          alignItems: 'center',
        }}
      >
        <View
          style={[
            styles.searchBox,
            {
              flex: 1.4,
              marginBottom: 0,
              backgroundColor: theme.card,
              borderColor: theme.border,
            },
          ]}
        >
          <Ionicons name="search-outline" size={17} color={theme.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="بحث برقم الصفقة أو المتعامل..."
            placeholderTextColor={theme.textMuted}
          />
        </View>

        <View style={{ flex: 1 }}>
          <CalmDropdown
            compact
            value={statusFilter}
            options={[
              {
                value: 'all',
                label: `الكل (${state.deals.length})`,
                icon: 'layers-outline',
                badgeColor: theme.primary,
              },
              {
                value: 'active',
                label: `المفتوحة (${
                  state.deals.filter((d) => d.status !== 'closed').length
                })`,
                icon: 'time-outline',
                badgeColor: theme.warning,
              },
              {
                value: 'closed',
                label: `المغلقة (${
                  state.deals.filter((d) => d.status === 'closed').length
                })`,
                icon: 'checkmark-circle-outline',
                badgeColor: theme.success,
              },
            ]}
            onSelect={(val) => setStatusFilter(val as any)}
          />
        </View>
      </View>

      {/* Deals Cards (Clean & Low-Density) */}
      {filteredDeals.map((deal) => {
        const buyAcc = accountMap.get(deal.sourceLydAccountId);
        const isBuyCash = deal.buyPaymentMethod === 'cash';

        const progressPct =
          deal.totalUsdBought > 0
            ? Math.min(
                100,
                Math.round(
                  ((deal.soldUsd + deal.personalTakenUsd) /
                    deal.totalUsdBought) *
                    100
                )
              )
            : 0;

        return (
          <View
            key={deal.id}
            style={[
              styles.dealCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            {/* Deal Header */}
            <View style={styles.dealHeader}>
              <View style={styles.dealHeaderRight}>
                <View style={styles.dealCodeRow}>
                  <View
                    style={[
                      styles.dealNumberBadge,
                      {
                        backgroundColor: theme.cardAlt,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.dealNumberText, { color: theme.blue }]}
                    >
                      {deal.dealNumber}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.methodModeBadge,
                      {
                        backgroundColor: isBuyCash
                          ? theme.primarySoft
                          : theme.blueSoft,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: isBuyCash ? theme.primary : theme.blue,
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}
                    >
                      {getPaymentMethodLabel(deal.buyPaymentMethod)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          deal.status === 'closed'
                            ? theme.successSoft
                            : theme.warningSoft,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          deal.status === 'closed'
                            ? theme.success
                            : theme.warning,
                        fontSize: 11,
                        fontWeight: 'bold',
                      }}
                    >
                      {deal.status === 'closed'
                        ? 'مغلقة'
                        : `متبقي $${deal.remainingUsd.toLocaleString()}`}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.dealTitle, { color: theme.text }]}>
                  {deal.title}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: 'row-reverse',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <View
                  style={[
                    styles.profitBox,
                    {
                      backgroundColor:
                        deal.realizedProfitLyd >= 0
                          ? theme.successSoft
                          : theme.dangerSoft,
                      borderColor:
                        deal.realizedProfitLyd >= 0
                          ? theme.success
                          : theme.danger,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.profitBoxLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    الربح
                  </Text>
                  <Text
                    style={[
                      styles.profitBoxVal,
                      {
                        color:
                          deal.realizedProfitLyd >= 0
                            ? theme.success
                            : theme.danger,
                      },
                    ]}
                  >
                    {deal.realizedProfitLyd >= 0 ? '+' : ''}
                    {formatMoney(deal.realizedProfitLyd, 'LYD')}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.deleteDealSmallBtn,
                    {
                      backgroundColor: theme.dangerSoft,
                      borderColor: theme.danger,
                      paddingHorizontal: 8,
                      paddingVertical: 8,
                    },
                  ]}
                  onPress={() => setDealToDelete(deal)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={15}
                    color={theme.danger}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Concise Purchase Summary Strip (لحظة الشراء) */}
            <View
              style={[
                styles.momentBoxBuy,
                {
                  backgroundColor: theme.cardAlt,
                  borderColor: theme.border,
                  borderRightColor: theme.primary,
                },
              ]}
            >
              <View
                style={{
                  flexDirection: 'row-reverse',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: 'bold',
                    color: theme.text,
                    textAlign: 'right',
                  }}
                >
                  شراء {formatMoney(deal.totalUsdBought, 'USD')} بسعر{' '}
                  <Text style={{ color: theme.primary }}>
                    {formatRate(deal.buyRate)}
                  </Text>{' '}
                  ({formatMoney(deal.totalLydCost, 'LYD')})
                </Text>
                <Text style={{ fontSize: 11, color: theme.textSecondary }}>
                  {buyAcc?.name || ''} • البائع:{' '}
                  <Text style={{ color: theme.warning, fontWeight: 'bold' }}>
                    {deal.counterparty || 'غير محدد'}
                  </Text>{' '}
                  • {deal.buyDate}
                </Text>
              </View>

              <ReceiptInlineStrip
                images={deal.buyReceiptImages}
                title={`صور حوالة الشراء - الصفقة ${deal.dealNumber}`}
                compactLabel="حوالة الشراء"
                accentColor={theme.primary}
                onUpdateImages={(imgs) => updateDealBuyReceipts(deal.id, imgs)}
              />
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
                  المباع: ${deal.soldUsd.toLocaleString()} • المتبقي:{' '}
                  <Text style={{ color: theme.warning, fontWeight: 'bold' }}>
                    ${deal.remainingUsd.toLocaleString()}
                  </Text>
                </Text>
                <Text style={[styles.progressPct, { color: theme.primary }]}>
                  {progressPct}%
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
                      width: `${progressPct}%`,
                      backgroundColor: theme.primary,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Concise Moment of Sale History */}
            {deal.sales.length > 0 && (
              <View
                style={[
                  styles.salesHistoryBox,
                  {
                    backgroundColor: theme.cardAlt,
                    borderColor: theme.border,
                    borderRightColor: theme.blue,
                  },
                ]}
              >
                <Text
                  style={[styles.salesHistoryTitle, { color: theme.blue }]}
                >
                  عمليات البيع المسجلة ({deal.sales.length}):
                </Text>
                {deal.sales.map((s) => {
                  const targetAcc = accountMap.get(s.targetLydAccountId);
                  return (
                    <View
                      key={s.id}
                      style={[
                        styles.saleItemCard,
                        { borderTopColor: theme.border },
                      ]}
                    >
                      <View style={styles.saleItemHeader}>
                        <Text
                          style={[styles.saleItemMain, { color: theme.text }]}
                        >
                          {s.isPersonalTake
                            ? `سحب شخصي: $${s.usdAmount.toLocaleString()} بسعر التكلفة (${s.sellRate})`
                            : `بيع $${s.usdAmount.toLocaleString()} بسعر ${formatRate(
                                s.sellRate
                              )} (${formatMoney(s.netLydReceived, 'LYD')})`}
                        </Text>
                        {!s.isPersonalTake && (
                          <Text
                            style={[
                              styles.saleProfitBadge,
                              {
                                color:
                                  s.profitLyd >= 0
                                    ? theme.success
                                    : theme.danger,
                              },
                            ]}
                          >
                            {s.profitLyd >= 0 ? '+' : ''}
                            {formatMoney(s.profitLyd, 'LYD')}
                          </Text>
                        )}
                      </View>

                      {!s.isPersonalTake && (
                        <>
                          <Text
                            style={[
                              styles.saleItemSub,
                              { color: theme.textSecondary, marginTop: 2 },
                            ]}
                          >
                            {getPaymentMethodLabel(s.paymentMethod)} في{' '}
                            {targetAcc?.name || ''} • المشتري:{' '}
                            <Text
                              style={{
                                color: theme.warning,
                                fontWeight: 'bold',
                              }}
                            >
                              {s.buyerName || 'غير محدد'}
                            </Text>{' '}
                            • {s.date}
                          </Text>

                          <ReceiptInlineStrip
                            images={s.receiptImages}
                            title={`صور حوالة البيع - ${
                              s.buyerName || deal.dealNumber
                            }`}
                            compactLabel="حوالة البيع"
                            accentColor={theme.blue}
                            onUpdateImages={(imgs) =>
                              updateDealSaleReceipts(deal.id, s.id, imgs)
                            }
                          />
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Action Buttons if Deal still has Remaining USD */}
            {deal.remainingUsd > 0 && (
              <View style={styles.dealActionsRow}>
                <TouchableOpacity
                  style={[
                    styles.sellActionBtn,
                    { backgroundColor: theme.primary },
                  ]}
                  onPress={() => handleOpenSaleModal(deal, false)}
                >
                  <Ionicons name="cash-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.sellActionBtnText}>
                    تسجيل عملية بيع (تحديد سعر وطريقة البيع)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.personalTakeBtn,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => handleOpenSaleModal(deal, true)}
                >
                  <Ionicons
                    name="person-outline"
                    size={15}
                    color={theme.textSecondary}
                  />
                  <Text
                    style={[
                      styles.personalTakeBtnText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    سحب شخصي
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {/* Modal 0: Confirm Delete Deal */}
      <Modal
        visible={Boolean(dealToDelete)}
        transparent
        animationType="fade"
        onRequestClose={() => setDealToDelete(null)}
      >
        <View
          style={[styles.modalBackdrop, { backgroundColor: theme.overlay }]}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                maxWidth: 440,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.danger }]}>
              إلغاء وحذف الصفقة {dealToDelete?.dealNumber}
            </Text>
            <Text style={[styles.modalSub, { color: theme.textSecondary }]}>
              هل تريد حذف هذه الصفقة واسترجاع كافة أرصدة الحسابات (الدينار والدولار) إلى وضعها قبل الصفقة؟
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  { backgroundColor: theme.cardAlt, borderColor: theme.border },
                ]}
                onPress={() => setDealToDelete(null)}
              >
                <Text
                  style={[styles.cancelBtnText, { color: theme.textSecondary }]}
                >
                  تراجع
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: theme.danger }]}
                onPress={() => {
                  if (dealToDelete) {
                    if (!deleteUsdDeal(dealToDelete.id, true)) return;
                    setDealToDelete(null);
                  }
                }}
              >
                <Text style={styles.saveBtnText}>
                  نعم، حذف الصفقة واسترجاع الأرصدة
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 1: Open New USD Deal */}
      <Modal
        visible={newDealModal}
        transparent
        animationType="fade"
        onRequestClose={() => setNewDealModal(false)}
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
                فتح صفقة شراء دولار جديدة (تحديد طريقة وسعر لحظة الشراء)
              </Text>
              <Text style={[styles.modalSub, { color: theme.textSecondary }]}>
                اختر هل الشراء تم نقداً (كاش) أم عبر تحويل مصرفي/صك، وحدد الحساب وسعر الشراء لحظتها والشخص الذي اشتريت منه
              </Text>

              {/* Step 1: Buy Mode & Account via Dropdowns */}
              <Text
                style={[styles.sectionStepTitle, { color: theme.primary }]}
              >
                أولاً: طريقة الشراء والحساب وسعر لحظة الشراء
              </Text>

              <CalmDropdown
                label="طريقة الشراء (نقدي كاش أو تحويل مصرفي / صك):"
                value={buyMethod}
                options={[
                  {
                    value: 'cash',
                    label: 'شراء نقدي (كاش)',
                    subLabel: `السعر المرجعي للكاش: ${state.marketRates.cashUsdToLyd} د.ل`,
                    icon: 'cash-outline',
                    badgeColor: theme.primary,
                  },
                  {
                    value: 'transfer',
                    label: 'شراء بتحويل مصرفي',
                    subLabel: `السعر المرجعي للتحويل: ${state.marketRates.chequeUsdToLyd} د.ل`,
                    icon: 'business-outline',
                    badgeColor: theme.blue,
                  },
                  {
                    value: 'cheque',
                    label: 'شراء بصك مصرفي مصدق',
                    subLabel: `السعر المرجعي للصكوك: ${state.marketRates.chequeUsdToLyd} د.ل`,
                    icon: 'document-text-outline',
                    badgeColor: theme.blue,
                  },
                ]}
                onSelect={(val) => {
                  const method = val as PaymentMethodType;
                  if (method === 'cash') {
                    handleSelectBuyMode('cash');
                  } else {
                    handleSelectBuyMode('bank');
                    setBuyMethod(method);
                  }
                }}
              />

              <CalmDropdown
                label={
                  buyMode === 'cash'
                    ? 'الحساب النقدي (خزينة الكاش) الذي تم الشراء منه:'
                    : 'الحساب المصرفي الذي تم التحويل / إصدار الصك منه:'
                }
                value={sourceLydId}
                options={buyMatchingAccounts.map((acc) => ({
                  value: acc.id,
                  label: acc.name,
                  subLabel: `${formatMoney(acc.balance, 'LYD')} • ${
                    acc.isCash ? 'نقدي كاش' : acc.bankName
                  }`,
                  icon: acc.isCash ? 'cash-outline' : 'card-outline',
                  badgeColor: acc.color,
                }))}
                onSelect={setSourceLydId}
              />

              <CalmDropdown
                label="خزينة الدولار التي تستلم المبلغ:"
                value={targetUsdId}
                options={usdAccounts.map((acc) => ({
                  value: acc.id,
                  label: acc.name,
                  subLabel: formatMoney(acc.balance, 'USD'),
                  icon: acc.isCash ? 'cash-outline' : 'card-outline',
                  badgeColor: acc.color,
                }))}
                onSelect={setTargetUsdId}
              />
              {usdAccounts.length === 0 && (
                <Text accessibilityRole="alert" style={{ color: theme.warning, textAlign: 'right' }}>
                  أنشئ حساب دولار من شاشة الحسابات قبل فتح الصفقة.
                </Text>
              )}

              {/* Amount and Exact Buy Rate at Purchase Moment */}
              <View style={styles.twoColRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    الكمية المشتراة ($ USD)
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
                    value={usdBoughtStr}
                    onChangeText={(v) => {
                      setUsdBoughtStr(v);
                      setImmSellUsdStr(v);
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    سعر الشراء في لحظة الشراء (د.ل)
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.primary,
                        color: theme.text,
                      },
                    ]}
                    keyboardType="numeric"
                    value={buyRateStr}
                    onChangeText={setBuyRateStr}
                  />
                </View>
              </View>

              {/* Seller Person Selection via Dropdown */}
              <CalmDropdown
                label="الشخص / المكتب الذي اشتريت منه (اختر من المتعاملين أو اكتب اسماً جديداً):"
                value={sellerContactId || '__custom__'}
                options={[
                  {
                    value: '__custom__',
                    label: counterparty
                      ? `إدخال يدوي: ${counterparty}`
                      : 'كتابة اسم شخص جديد يدوياً...',
                    subLabel: 'أدخل الاسم ورقم الهاتف في الحقول أدناه',
                    icon: 'person-add-outline',
                    badgeColor: theme.textSecondary,
                  },
                  ...state.contacts.map((cnt) => ({
                    value: cnt.id,
                    label: cnt.name,
                    subLabel: `${cnt.phone} • ${cnt.role}`,
                    icon: 'person-outline',
                    badgeColor: theme.primary,
                  })),
                ]}
                onSelect={(id) => {
                  if (id === '__custom__') {
                    setSellerContactId(undefined);
                    return;
                  }
                  const cnt = state.contacts.find((c) => c.id === id);
                  if (cnt) {
                    setSellerContactId(cnt.id);
                    setCounterparty(cnt.name);
                    setCounterpartyPhone(cnt.phone);
                  }
                }}
              />

              <View style={styles.twoColRow}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    value={counterparty}
                    onChangeText={(txt) => {
                      setCounterparty(txt);
                      setSellerContactId(undefined);
                    }}
                    placeholder="اسم البائع / مكتب الصرافة..."
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    value={counterpartyPhone}
                    onChangeText={setCounterpartyPhone}
                    placeholder="رقم هاتف البائع (091/092...)"
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
              </View>

              <View style={styles.twoColRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    عمولة الشراء (إن وجدت)
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
                    value={buyCommStr}
                    onChangeText={setBuyCommStr}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.inputLabel, { color: theme.textSecondary }]}
                  >
                    وصف مختصر للصفقة
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
                    value={dealTitle}
                    onChangeText={setDealTitle}
                    placeholder="اختياري..."
                    placeholderTextColor={theme.textMuted}
                  />
                </View>
              </View>

              {/* Optional Buy Transfer Receipt Image Attachment */}
              <ReceiptAttachmentField
                label="إرفاق صورة الحوالة المالية / إيصال الشراء (اختياري):"
                images={buyReceiptImages}
                onChange={setBuyReceiptImages}
                accentColor={theme.primary}
              />

              {/* Live Buy Cost Preview */}
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
                    style={[
                      styles.previewLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    إجمالي تكلفة الشراء المخصومة من الحساب:
                  </Text>
                  <Text style={[styles.previewVal, { color: theme.text }]}>
                    {formatMoney(previewBuyTotalLyd, 'LYD')}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text
                    style={[
                      styles.previewLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    سعر الشراء الفعلي لكل 1$:
                  </Text>
                  <Text style={[styles.previewVal, { color: theme.primary }]}>
                    {formatRate(previewEffectiveRate)}
                  </Text>
                </View>
              </View>

              {/* Optional Step 2: Record Sell Moment right now */}
              <TouchableOpacity
                style={[
                  styles.immediateSellToggle,
                  {
                    backgroundColor: includeImmediateSell
                      ? theme.blueSoft
                      : theme.cardAlt,
                    borderColor: includeImmediateSell
                      ? theme.blue
                      : theme.border,
                  },
                ]}
                onPress={() => setIncludeImmediateSell(!includeImmediateSell)}
              >
                <Ionicons
                  name={includeImmediateSell ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={theme.blue}
                />
                <Text
                  style={[
                    styles.immediateSellToggleText,
                    { color: theme.blue },
                  ]}
                >
                  تسجيل عملية البيع الآن أيضاً (تحديد سعر البيع وطريقة البيع والمشتري في نفس اللحظة)
                </Text>
              </TouchableOpacity>

              {includeImmediateSell && (
                <View
                  style={[
                    styles.immediateSellBox,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.blue,
                    },
                  ]}
                >
                  <Text
                    style={[styles.sectionStepTitle, { color: theme.blue }]}
                  >
                    ثانياً: بيانات لحظة البيع وسعر البيع
                  </Text>

                  <CalmDropdown
                    label="طريقة البيع (نقدي كاش أو تحويل مصرفي / صك):"
                    value={immSellMethod}
                    options={[
                      {
                        value: 'cash',
                        label: 'بيع نقدي (كاش)',
                        subLabel: `سعر الكاش المرجعي: ${state.marketRates.cashUsdToLyd} د.ل`,
                        icon: 'cash-outline',
                        badgeColor: theme.primary,
                      },
                      {
                        value: 'transfer',
                        label: 'بيع بتحويل مصرفي',
                        subLabel: `سعر التحويل المرجعي: ${state.marketRates.chequeUsdToLyd} د.ل`,
                        icon: 'business-outline',
                        badgeColor: theme.blue,
                      },
                      {
                        value: 'cheque',
                        label: 'بيع بصك مصرفي مصدق',
                        subLabel: `سعر الصكوك المرجعي: ${state.marketRates.chequeUsdToLyd} د.ل`,
                        icon: 'document-text-outline',
                        badgeColor: theme.blue,
                      },
                    ]}
                    onSelect={(val) => {
                      const method = val as PaymentMethodType;
                      if (method === 'cash') {
                        handleSelectImmSellMode('cash');
                      } else {
                        handleSelectImmSellMode('bank');
                        setImmSellMethod(method);
                      }
                    }}
                  />

                  <CalmDropdown
                    label="الحساب المستلم لحصيلة البيع بالدينار:"
                    value={immSellTargetLydId}
                    options={immSellMatchingAccounts.map((acc) => ({
                      value: acc.id,
                      label: acc.name,
                      subLabel: `${formatMoney(acc.balance, 'LYD')} • ${
                        acc.isCash ? 'نقدي كاش' : acc.bankName
                      }`,
                      icon: acc.isCash ? 'cash-outline' : 'card-outline',
                      badgeColor: acc.color,
                    }))}
                    onSelect={setImmSellTargetLydId}
                  />

                  <View style={styles.twoColRow}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.inputLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        الكمية المباعة ($)
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
                        value={immSellUsdStr}
                        onChangeText={setImmSellUsdStr}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.inputLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        سعر البيع في لحظة البيع (د.ل)
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.inputBg,
                            borderColor: theme.blue,
                            color: theme.text,
                          },
                        ]}
                        keyboardType="numeric"
                        value={immSellRateStr}
                        onChangeText={setImmSellRateStr}
                      />
                    </View>
                  </View>

                  <CalmDropdown
                    label="الشخص / المشتري الذي بعت له:"
                    value={immBuyerContactId || '__custom__'}
                    options={[
                      {
                        value: '__custom__',
                        label: immBuyerName
                          ? `إدخال يدوي: ${immBuyerName}`
                          : 'كتابة اسم مشتري جديد يدوياً...',
                        subLabel: 'أدخل الاسم ورقم الهاتف أدناه',
                        icon: 'person-add-outline',
                        badgeColor: theme.textSecondary,
                      },
                      ...state.contacts.map((cnt) => ({
                        value: cnt.id,
                        label: cnt.name,
                        subLabel: `${cnt.phone} • ${cnt.role}`,
                        icon: 'person-outline',
                        badgeColor: theme.blue,
                      })),
                    ]}
                    onSelect={(id) => {
                      if (id === '__custom__') {
                        setImmBuyerContactId(undefined);
                        return;
                      }
                      const cnt = state.contacts.find((c) => c.id === id);
                      if (cnt) {
                        setImmBuyerContactId(cnt.id);
                        setImmBuyerName(cnt.name);
                        setImmBuyerPhone(cnt.phone);
                      }
                    }}
                  />

                  <View style={styles.twoColRow}>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.inputBg,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={immBuyerName}
                        onChangeText={(t) => {
                          setImmBuyerName(t);
                          setImmBuyerContactId(undefined);
                        }}
                        placeholder="اسم المشتري..."
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.inputBg,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={immBuyerPhone}
                        onChangeText={setImmBuyerPhone}
                        placeholder="رقم هاتف المشتري..."
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                  </View>

                  <ReceiptAttachmentField
                    label="إرفاق صورة حوالة البيع / الإيصال (اختياري):"
                    images={immSellReceiptImages}
                    onChange={setImmSellReceiptImages}
                    accentColor={theme.blue}
                  />

                  <View
                    style={[
                      styles.previewBox,
                      {
                        backgroundColor: theme.card,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <View style={styles.previewRow}>
                      <Text
                        style={[
                          styles.previewLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        صافي المستلم من البيع:
                      </Text>
                      <Text style={[styles.previewVal, { color: theme.text }]}>
                        {formatMoney(previewImmSellNetLyd, 'LYD')}
                      </Text>
                    </View>
                    <View style={styles.previewRow}>
                      <Text
                        style={[
                          styles.previewLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        صافي الربح المحقق (سعر الشراء {parsedBuyRate} ← سعر البيع{' '}
                        {parsedImmSellRate}):
                      </Text>
                      <Text
                        style={[
                          styles.previewVal,
                          {
                            color:
                              previewImmSellProfit >= 0
                                ? theme.success
                                : theme.danger,
                          },
                        ]}
                      >
                        {previewImmSellProfit >= 0 ? '+' : ''}
                        {formatMoney(previewImmSellProfit, 'LYD')}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => setNewDealModal(false)}
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
                  onPress={handleCreateDeal}
                >
                  <Text style={styles.saveBtnText}>
                    {includeImmediateSell
                      ? 'حفظ صفقة الشراء والبيع معاً'
                      : 'فتح صفقة الشراء واعتمادها'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Modal 2: Record Sale on Existing Deal */}
      <Modal
        visible={Boolean(activeDealForSale)}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveDealForSale(null)}
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
                {isPersonalTakeMode
                  ? `سحب شخصي من الصفقة ${activeDealForSale?.dealNumber}`
                  : `تسجيل عملية بيع من الصفقة ${activeDealForSale?.dealNumber} (لحظة البيع)`}
              </Text>

              {/* Reminder of Purchase Moment Details */}
              {activeDealForSale && (
                <View
                  style={[
                    styles.buyReminderBanner,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.buyReminderText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    بيانات لحظة الشراء لهذه الصفقة: تم شراء $
                    {activeDealForSale.totalUsdBought.toLocaleString()} بسعر{' '}
                    <Text
                      style={{ color: theme.primary, fontWeight: 'bold' }}
                    >
                      {formatRate(activeDealForSale.buyRate)}
                    </Text>{' '}
                    ({getPaymentMethodLabel(activeDealForSale.buyPaymentMethod)})
                    من {activeDealForSale.counterparty || 'غير محدد'} | المتبقي:{' '}
                    <Text
                      style={{ color: theme.warning, fontWeight: 'bold' }}
                    >
                      ${activeDealForSale.remainingUsd.toLocaleString()}
                    </Text>
                  </Text>
                </View>
              )}

              {/* Quick Portion Selector */}
              <View style={styles.quickPortionRow}>
                <Text
                  style={[styles.inputLabel, { color: theme.textSecondary }]}
                >
                  الكمية المراد بيعها الآن ($ USD):
                </Text>
                <View style={{ flexDirection: 'row-reverse', gap: 6 }}>
                  {[0.25, 0.5, 1].map((pct) => (
                    <TouchableOpacity
                      key={pct}
                      style={[
                        styles.portionChip,
                        {
                          backgroundColor: theme.blueSoft,
                          borderColor: theme.blue,
                        },
                      ]}
                      onPress={() => {
                        const rem = activeDealForSale?.remainingUsd || 0;
                        setSaleUsdStr(String(Math.round(rem * pct)));
                      }}
                    >
                      <Text
                        style={[
                          styles.portionChipText,
                          { color: theme.blue },
                        ]}
                      >
                        {pct === 1 ? 'كامل المتبقي' : `${pct * 100}%`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

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
                value={saleUsdStr}
                onChangeText={setSaleUsdStr}
              />

              {isPersonalTakeMode && (
                <CalmDropdown
                  label="محفظة الدولار الشخصية:"
                  value={personalUsdAccountId}
                  options={usdAccounts.map((acc) => ({
                    value: acc.id,
                    label: acc.name,
                    subLabel: acc.id === activeDealForSale?.usdHoldingAccountId
                      ? 'الاحتفاظ بالدولار في المحفظة الحالية'
                      : formatMoney(acc.balance, 'USD'),
                    icon: acc.isCash ? 'cash-outline' : 'card-outline',
                    badgeColor: acc.color,
                  }))}
                  onSelect={setPersonalUsdAccountId}
                />
              )}

              {!isPersonalTakeMode && (
                <>
                  <CalmDropdown
                    label="طريقة البيع واستلام القيمة في لحظة البيع:"
                    value={saleMethod}
                    options={[
                      {
                        value: 'cash',
                        label: 'بيع نقدي (كاش)',
                        subLabel: `سعر الكاش المرجعي: ${state.marketRates.cashUsdToLyd} د.ل`,
                        icon: 'cash-outline',
                        badgeColor: theme.primary,
                      },
                      {
                        value: 'transfer',
                        label: 'بيع بتحويل مصرفي',
                        subLabel: `سعر التحويل المرجعي: ${state.marketRates.chequeUsdToLyd} د.ل`,
                        icon: 'business-outline',
                        badgeColor: theme.blue,
                      },
                      {
                        value: 'cheque',
                        label: 'بيع بصك مصرفي مصدق',
                        subLabel: `سعر الصكوك المرجعي: ${state.marketRates.chequeUsdToLyd} د.ل`,
                        icon: 'document-text-outline',
                        badgeColor: theme.blue,
                      },
                    ]}
                    onSelect={(val) => {
                      const method = val as PaymentMethodType;
                      if (method === 'cash') {
                        handleSelectSaleMode('cash');
                      } else {
                        handleSelectSaleMode('bank');
                        setSaleMethod(method);
                      }
                    }}
                  />

                  <CalmDropdown
                    label={
                      saleMode === 'cash'
                        ? 'إيداع النقدية المستلمة في خزينة الكاش:'
                        : 'إيداع التحويل المصرفي / الصك في حساب مصرف:'
                    }
                    value={saleTargetLydId}
                    options={saleMatchingAccounts.map((acc) => ({
                      value: acc.id,
                      label: acc.name,
                      subLabel: `${formatMoney(acc.balance, 'LYD')} • ${
                        acc.isCash ? 'نقدي كاش' : acc.bankName
                      }`,
                      icon: acc.isCash ? 'cash-outline' : 'card-outline',
                      badgeColor: acc.color,
                    }))}
                    onSelect={setSaleTargetLydId}
                  />

                  {/* Sell Rate at Moment of Sale */}
                  <View style={styles.twoColRow}>
                    <View style={{ flex: 2 }}>
                      <Text
                        style={[
                          styles.inputLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        سعر البيع في لحظة البيع (د.ل لكل 1$)
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.inputBg,
                            borderColor: theme.blue,
                            color: theme.text,
                          },
                        ]}
                        keyboardType="numeric"
                        value={saleRateStr}
                        onChangeText={setSaleRateStr}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.inputLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        عمولة مخصومة (د.ل)
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
                        value={saleCommStr}
                        onChangeText={setSaleCommStr}
                      />
                    </View>
                  </View>

                  {/* Buyer Person Selection via Dropdown */}
                  <CalmDropdown
                    label="الشخص / الجهة التي بعت لها (اختر من المتعاملين أو أضف جديداً):"
                    value={buyerContactId || '__custom__'}
                    options={[
                      {
                        value: '__custom__',
                        label: buyerName
                          ? `إدخال يدوي: ${buyerName}`
                          : 'كتابة اسم مشتري جديد يدوياً...',
                        subLabel: 'أدخل الاسم ورقم الهاتف أدناه',
                        icon: 'person-add-outline',
                        badgeColor: theme.textSecondary,
                      },
                      ...state.contacts.map((cnt) => ({
                        value: cnt.id,
                        label: cnt.name,
                        subLabel: `${cnt.phone} • ${cnt.role}`,
                        icon: 'person-outline',
                        badgeColor: theme.blue,
                      })),
                    ]}
                    onSelect={(id) => {
                      if (id === '__custom__') {
                        setBuyerContactId(undefined);
                        return;
                      }
                      const cnt = state.contacts.find((c) => c.id === id);
                      if (cnt) {
                        setBuyerContactId(cnt.id);
                        setBuyerName(cnt.name);
                        setBuyerPhone(cnt.phone);
                      }
                    }}
                  />

                  <View style={styles.twoColRow}>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.inputBg,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={buyerName}
                        onChangeText={(t) => {
                          setBuyerName(t);
                          setBuyerContactId(undefined);
                        }}
                        placeholder="اسم المشتري / الشركة..."
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.inputBg,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={buyerPhone}
                        onChangeText={setBuyerPhone}
                        placeholder="رقم هاتف المشتري..."
                        placeholderTextColor={theme.textMuted}
                      />
                    </View>
                  </View>

                  <ReceiptAttachmentField
                    label="إرفاق صورة حوالة البيع / الإيصال المالي (اختياري):"
                    images={saleReceiptImages}
                    onChange={setSaleReceiptImages}
                    accentColor={theme.blue}
                  />
                </>
              )}

              {/* Live Profit & Rate Spread Preview Box */}
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
                    style={[
                      styles.previewLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    سعر الشراء لحظة الشراء مقابل سعر البيع الآن:
                  </Text>
                  <Text style={[styles.previewVal, { color: theme.text }]}>
                    {activeDealForSale?.buyRate} د.ل ← {parsedSaleRate} د.ل (
                    {previewRateSpread >= 0 ? '+' : ''}
                    {previewRateSpread})
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text
                    style={[
                      styles.previewLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    تكلفة شراء هذه الدفعة:
                  </Text>
                  <Text style={[styles.previewVal, { color: theme.text }]}>
                    {formatMoney(previewSaleCostBasis, 'LYD')}
                  </Text>
                </View>
                {!isPersonalTakeMode && (
                  <>
                    <View style={styles.previewRow}>
                      <Text
                        style={[
                          styles.previewLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        الصافي المودع بالحساب بالدينار:
                      </Text>
                      <Text style={[styles.previewVal, { color: theme.text }]}>
                        {formatMoney(previewSaleNetLyd, 'LYD')}
                      </Text>
                    </View>
                    <View style={styles.previewRow}>
                      <Text
                        style={[
                          styles.previewLabel,
                          { color: theme.textSecondary },
                        ]}
                      >
                        صافي الربح المحقق من هذه البيعة:
                      </Text>
                      <Text
                        style={[
                          styles.previewVal,
                          {
                            color:
                              previewSaleProfit >= 0
                                ? theme.success
                                : theme.danger,
                            fontSize: 16,
                          },
                        ]}
                      >
                        {previewSaleProfit >= 0 ? '+' : ''}
                        {formatMoney(previewSaleProfit, 'LYD')}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    {
                      backgroundColor: theme.cardAlt,
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => setActiveDealForSale(null)}
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
                  onPress={handleConfirmSale}
                >
                  <Text style={styles.saveBtnText}>
                    {isPersonalTakeMode
                      ? 'تأكيد السحب الشخصي'
                      : 'تأكيد البيع وإيداع الحصيلة'}
                  </Text>
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
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  ratesBanner: {
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  rateBox: {
    alignItems: 'center',
    flex: 1,
  },
  rateBoxTitle: {
    fontSize: 11,
    marginBottom: 2,
    textAlign: 'center',
    fontWeight: '600',
  },
  rateBoxValue: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  rateDivider: {
    width: 1,
    height: 28,
  },
  kpiRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  kpiCard: {
    flex: 1,
    minWidth: 220,
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
    fontSize: 22,
    fontWeight: 'bold',
  },
  kpiSub: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  newDealBtn: {
    flex: 2,
    minWidth: 200,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  newDealBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  exportDealsBtn: {
    flex: 1,
    minWidth: 120,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  exportDealsBtnText: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  searchBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    textAlign: 'right',
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
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dealCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  dealHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  dealHeaderRight: {
    flex: 1,
  },
  dealCodeRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  dealNumberBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  dealNumberText: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  methodModeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dealTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  profitBox: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  profitBoxLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  profitBoxVal: {
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 2,
  },
  deleteDealSmallBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  momentBoxBuy: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderRightWidth: 3,
  },
  momentHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  momentHeaderText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  momentGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
  },
  momentItem: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'flex-end',
  },
  momentLabel: {
    fontSize: 11,
  },
  momentVal: {
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 2,
    textAlign: 'right',
  },
  progressSection: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
  },
  progressPct: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
  },
  salesHistoryBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderRightWidth: 3,
  },
  salesHistoryTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 8,
  },
  saleItemCard: {
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  saleItemHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  saleItemMain: {
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  saleDetailsList: {
    gap: 2,
  },
  saleItemSub: {
    fontSize: 11,
    textAlign: 'right',
  },
  saleProfitBadge: {
    fontWeight: 'bold',
    fontSize: 13,
  },
  dealActionsRow: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginTop: 4,
  },
  sellActionBtn: {
    flex: 2,
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sellActionBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  personalTakeBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
  },
  personalTakeBtnText: {
    fontSize: 12,
    fontWeight: '600',
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
    maxWidth: 580,
    width: '100%',
    alignSelf: 'center',
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
    marginBottom: 12,
  },
  sectionStepTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 8,
    marginTop: 4,
  },
  modeBigBtn: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  modeBigBtnTitle: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  modeBigBtnSub: {
    fontSize: 11,
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
    marginTop: 4,
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
  immediateSellToggle: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  immediateSellToggleText: {
    fontSize: 12,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'right',
  },
  immediateSellBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  buyReminderBanner: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  buyReminderText: {
    fontSize: 12,
    textAlign: 'right',
    lineHeight: 18,
  },
  quickPortionRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  portionChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  portionChipText: {
    fontSize: 11,
    fontWeight: '600',
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
    alignItems: 'center',
  },
  previewLabel: {
    fontSize: 12,
  },
  previewVal: {
    fontWeight: 'bold',
    fontSize: 13,
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
