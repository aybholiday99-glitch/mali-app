import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import { FinancialHistoryPanel } from '../components/FinancialHistoryPanel';
import { ConflictResolutionPanel } from '../components/ConflictResolutionPanel';
import { RecoveryArchivePanel } from '../components/RecoveryArchivePanel';
import { createSafeDiagnostics } from '../services/diagnosticsCore';
import { pickBackupFile, type BackupFileResult } from '../utils/backupFilePicker';
import { CENTRAL_SERVER_ONLY } from '../services/centralStoragePolicy';
import {
  exportFileOrShare,
  generateDealsCsv,
  generateTransactionsCsv,
  printFinancialStatement,
} from '../utils/exportHelper';
import { MIN_TOUCH_TARGET } from '../theme/responsive';

const formatArabicSyncTime = (timestamp?: string): string | null => {
  if (!timestamp) return null;
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('ar-LY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
};

const sanitizeSyncMessage = (msg?: string | null): string | null => {
  if (!msg) return null;
  let sanitized = msg;
  sanitized = sanitized.replace(/https?:\/\/[^\s)]+/g, '');
  sanitized = sanitized.replace(/[A-Za-z0-9_-]{25,}/g, '');
  sanitized = sanitized.replace(/PGRST\w+/gi, '');
  sanitized = sanitized.replace(/error:\s*/gi, '');
  sanitized = sanitized.replace(/\{.*?\}|\[.*?\]/g, '');
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  if (!sanitized) return null;
  return sanitized;
};

interface CloudModalProps {
  visible: boolean;
  onClose: () => void;
}

export const CloudAndExportModal: React.FC<CloudModalProps> = props => {
  const {mutationSessionGeneration}=useMali();
  return <CloudModalContents key={mutationSessionGeneration} {...props}/>;
};
const CloudModalContents: React.FC<CloudModalProps> = ({
  visible,
  onClose,
}) => {
  const {
    state,
    theme,
    isSyncing,
    lastSyncMessage,
    cloudSyncStatus,
    currentUser,
    mutationStatus,
    retryPendingMutation,
    pullFromCloud,
    importStateJson,
  } = useMali();

  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportBox, setShowImportBox] = useState(false);
  const [pickedBackup,setPickedBackup]=useState<Extract<BackupFileResult,{status:'selected'}>|null>(null);
  const [readingBackup,setReadingBackup]=useState(false);
  const backupPickerPending=useRef(false);

  const isConnected = !currentUser?.isLocalOnly && Boolean(
    state.supabaseConfig.url?.trim() && state.supabaseConfig.anonKey?.trim()
  );
  const formattedLastSyncTime = formatArabicSyncTime(state.supabaseConfig.lastSyncedAt);
  const sanitizedLastSyncMessage = sanitizeSyncMessage(lastSyncMessage);
  const sanitizedStatusBanner = sanitizeSyncMessage(statusBanner);

  const handleBackupFile = async () => {
    if(backupPickerPending.current)return;backupPickerPending.current=true;setReadingBackup(true);
    try{const result=await pickBackupFile();if(result.status==='selected'){setPickedBackup(result);setImportJsonText('');setShowImportBox(true);setStatusBanner('تمت قراءة الملف. راجع الاختيار ثم أكد الاسترجاع؛ لم تتغير الخزنة بعد.');}
      else if(result.status==='error')setStatusBanner(result.message);
    }finally{backupPickerPending.current=false;setReadingBackup(false);}
  };

  if (CENTRAL_SERVER_ONLY) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
          <View style={[styles.modalContainer, { backgroundColor: theme.card, borderColor: theme.border, padding: 20 }]}>
            <Text style={[styles.title, { color: theme.text }]}>التخزين المركزي — مالي</Text>
            <Text style={{ color: theme.textSecondary, marginTop: 12, marginBottom: 16, textAlign: 'right' }}>
              جميع السجلات المالية الجديدة تُعتمد مباشرة على الخادم. لا توجد مزامنة محلية أو تنزيل تقارير إلى هاتف العميل. يلزم الاتصال بالإنترنت.
            </Text>
            {lastSyncMessage ? <Text style={{ color: theme.text, marginBottom: 12, textAlign: 'right' }}>{sanitizedLastSyncMessage}</Text> : null}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="تحديث البيانات من الخادم"
              disabled={isSyncing} onPress={() => { void pullFromCloud(); }}
              style={[styles.closeBtn, { backgroundColor: theme.cardAlt, marginBottom: 10, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }]}>
              <Text style={{ color: theme.text, textAlign: 'center' }}>{isSyncing ? 'جارٍ تحديث البيانات…' : 'تحديث البيانات من الخادم'}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="إغلاق إعدادات الخادم"
              onPress={onClose} style={[styles.closeBtn, { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }]}>
              <Text style={{ color: theme.text, textAlign: 'center' }}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <View
          style={[
            styles.modalContainer,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View
            style={[
              styles.headerRow,
              {
                backgroundColor: theme.cardAlt,
                borderBottomColor: theme.border,
              },
            ]}
          >
            <Text style={[styles.title, { color: theme.text }]}>
              المزامنة السحابية وتصدير التقارير
            </Text>
            <TouchableOpacity
              accessibilityRole="button" accessibilityLabel="إغلاق المزامنة والتصدير"
              style={[styles.closeBtn, { backgroundColor: theme.card }]}
              onPress={onClose}
            >
              <Ionicons name="close" size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea}>
            <FinancialHistoryPanel />
            {visible && <RecoveryArchivePanel />}
            {cloudSyncStatus.outbox?.stop?.reason === 'conflict' && <ConflictResolutionPanel key={`${state.localRevision}:${cloudSyncStatus.outbox.stop.result.updatedAt}`} />}
            <View style={[styles.sectionBox,{backgroundColor:theme.cardAlt,borderColor:theme.border}]}>
              <Text accessibilityLiveRegion="polite" style={[styles.sectionTitle,{color:theme.text}]}>{mutationStatus.phase==='storage-error'?'لم يتأكد الحفظ على الجهاز؛ أعد تأكيد نفس العملية':mutationStatus.phase==='saving'?'جارٍ التحقق من الحفظ على الجهاز':currentUser?.isLocalOnly?'الحفظ المحلي على هذا الجهاز':cloudSyncStatus.phase==='blocked'?'توقفت المزامنة لحماية بياناتك':cloudSyncStatus.phase==='retrying'?'تعذر الاتصال؛ ستُعاد المحاولة عند فتح التطبيق':cloudSyncStatus.phase==='storage-error'?'تعذر الحفظ على الجهاز؛ يلزم إعادة المحاولة':cloudSyncStatus.phase==='uploading'?'جارٍ رفع النسخة المحفوظة':state.pendingCloudSync?'نسخة محفوظة على الجهاز تنتظر الرفع':'حالة الحفظ والمزامنة'}</Text>
              {mutationStatus.phase==='storage-error' && <TouchableOpacity accessibilityRole="button" style={styles.sqlToggleBtn} onPress={async()=>{
                setStatusBanner(await retryPendingMutation()?'تم تأكيد نفس العملية على الجهاز دون إعادة احتسابها أو تكرارها.':'لم يتأكد الحفظ بعد. بقي الطلب لإعادة المحاولة؛ تحقق من مساحة التخزين.');
              }}><Text style={[styles.sqlToggleText,{color:theme.primary}]}>إعادة تأكيد حفظ العملية السابقة</Text></TouchableOpacity>}
              <Text style={[styles.sectionSub,{color:theme.textSecondary}]}>تعمل إعادة المزامنة أثناء فتح التطبيق. عند التعارض تبقى النسختان محفوظتين ويتوقف الرفع حتى اختيار حلّ واضح.</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.sqlToggleBtn} onPress={async()=>{
                const report=createSafeDiagnostics(state,cloudSyncStatus,Platform.OS,!!currentUser?.isLocalOnly);
                const ok=await exportFileOrShare('mali-support-diagnostics.json',JSON.stringify(report,null,2),'application/json');
                setStatusBanner(ok?'تم فتح تنزيل أو مشاركة تقرير حالة التطبيق. يحتوي أعداد السجلات وحالة الحفظ فقط.':'تعذر تجهيز أو مشاركة تقرير الحالة.');
              }}><Text style={[styles.sqlToggleText,{color:theme.primary}]}>تصدير تقرير الحالة للدعم دون أسماء أو أرصدة أو صور أو مفاتيح</Text></TouchableOpacity>
            </View>
            {sanitizedStatusBanner || sanitizedLastSyncMessage ? (
              <View
                style={[
                  styles.bannerBox,
                  {
                    backgroundColor: theme.blueSoft,
                    borderColor: theme.blue,
                  },
                ]}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={18}
                  color={theme.blue}
                />
                <Text style={[styles.bannerText, { color: theme.blue }]}>
                  {sanitizedStatusBanner || sanitizedLastSyncMessage}
                </Text>
              </View>
            ) : null}

            {/* Section 1: Export PDF / Excel / Backup */}
            <View
              style={[
                styles.sectionBox,
                { backgroundColor: theme.cardAlt, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                1. تصدير كشوفات الحساب والتقارير (Excel / PDF)
              </Text>
              <Text
                style={[styles.sectionSub, { color: theme.textSecondary }]}
              >
                استخرج كشوفات حركاتك المصرفية والنقدية وصفقات الدولار بضغطة واحدة
              </Text>

              <View style={styles.exportButtonsGrid}>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.exportCardBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={async () => {
                    const csv = generateTransactionsCsv(state);
                    const ok = await exportFileOrShare('كشف_حساب_الحركات_مالي.csv', csv);
                    setStatusBanner(ok ? 'تم فتح التنزيل أو المشاركة لكشف الحركات. احفظ الملف في الوجهة التي تختارها.' : 'تعذر تجهيز أو مشاركة كشف الحركات. أعد المحاولة وتحقق من مساحة التخزين.');
                  }}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={22}
                    color={theme.primary}
                  />
                  <Text style={[styles.exportBtnTitle, { color: theme.text }]}>
                    كشف الحركات الشامل (Excel)
                  </Text>
                  <Text
                    style={[
                      styles.exportBtnSub,
                      { color: theme.textSecondary },
                    ]}
                  >
                    جميع المصاريف والإيرادات وتسييل الصكوك
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.exportCardBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={async () => {
                    const csv = generateDealsCsv(state);
                    const ok = await exportFileOrShare('كشف_صفقات_الدولار_مالي.csv', csv);
                    setStatusBanner(ok ? 'تم فتح التنزيل أو المشاركة لتقرير الدولار. احفظ الملف في الوجهة التي تختارها.' : 'تعذر تجهيز أو مشاركة تقرير الدولار. أعد المحاولة وتحقق من مساحة التخزين.');
                  }}
                >
                  <Ionicons
                    name="trending-up-outline"
                    size={22}
                    color={theme.warning}
                  />
                  <Text style={[styles.exportBtnTitle, { color: theme.text }]}>
                    تقرير صفقات الدولار (Excel)
                  </Text>
                  <Text
                    style={[
                      styles.exportBtnSub,
                      { color: theme.textSecondary },
                    ]}
                  >
                    الكميات وأسعار الشراء والبيع وصافي الأرباح
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.exportCardBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={async () => {
                    const ok = await printFinancialStatement(state);
                    setStatusBanner(ok ? 'تم فتح الطباعة أو مشاركة PDF. احفظ التقرير في الوجهة التي تختارها.' : 'تعذر تجهيز أو مشاركة PDF. أعد المحاولة وتحقق من مساحة التخزين.');
                  }}
                >
                  <Ionicons
                    name="print-outline"
                    size={22}
                    color={theme.blue}
                  />
                  <Text style={[styles.exportBtnTitle, { color: theme.text }]}>
                    التقرير المالي الشامل (PDF / طباعة)
                  </Text>
                  <Text
                    style={[
                      styles.exportBtnSub,
                      { color: theme.textSecondary },
                    ]}
                  >
                    كشف حساب رسمي جاهز للطباعة أو الحفظ كـ PDF
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  style={[
                    styles.exportCardBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={async () => {
                    const safeBackupPayload = {
                      backupVersion: 2,
                      exportedAt: new Date().toISOString(),
                      lastModifiedAt: state.lastModifiedAt || new Date().toISOString(),
                      accounts: state.accounts,
                      contacts: state.contacts,
                      transactions: state.transactions,
                      deals: state.deals,
                      debts: state.debts,
                      procedures: state.procedures,
                      budgets: state.budgets,
                      marketRates: state.marketRates,
                      financialAudit: state.financialAudit,
                    };
                    const ok = await exportFileOrShare(
                      'نسخة_احتياطية_مالي.json',
                      JSON.stringify(safeBackupPayload, null, 2),
                      'application/json'
                    );
                    setStatusBanner(ok ? 'تم فتح التنزيل أو المشاركة للنسخة الكاملة مع السجل المالي وبدون مفاتيح الاتصال. احفظ الملف ثم تحقق من إمكانية استرجاعه.' : 'تعذر تجهيز أو مشاركة النسخة الاحتياطية. أعد المحاولة وتحقق من مساحة التخزين.');
                  }}
                >
                  <Ionicons
                    name="archive-outline"
                    size={22}
                    color={theme.purple}
                  />
                  <Text style={[styles.exportBtnTitle, { color: theme.text }]}>
                    نسخة احتياطية كاملة (JSON)
                  </Text>
                  <Text
                    style={[
                      styles.exportBtnSub,
                      { color: theme.textSecondary },
                    ]}
                  >
                    حفظ واسترجاع كافة البيانات بملف واحد
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Section 2: Cloud Sync Status (Read-Only) */}
            <View
              style={[
                styles.sectionBox,
                { backgroundColor: theme.cardAlt, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                2. حالة المزامنة السحابية
              </Text>
              <Text
                style={[styles.sectionSub, { color: theme.textSecondary }]}
              >
                المزامنة السحابية التلقائية تحافظ على تحديث بياناتك المالية بأمان وفورية
              </Text>

              <View
                style={[
                  styles.syncStatusCard,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.syncBadgeRow}>
                  <View
                    style={[
                      styles.syncBadge,
                      {
                        backgroundColor: isConnected ? (theme.successSoft || '#DCFCE7') : theme.surfaceSoft,
                        borderColor: isConnected ? (theme.success || '#16A34A') : theme.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={isConnected ? 'cloud-done-outline' : 'cloud-offline-outline'}
                      size={18}
                      color={isConnected ? (theme.success || '#16A34A') : theme.textMuted}
                    />
                    <Text
                      style={[
                        styles.syncBadgeText,
                        {
                          color: isConnected ? (theme.success || '#16A34A') : theme.textSecondary,
                        },
                      ]}
                    >
                      {isConnected ? 'المزامنة السحابية التلقائية مفعلة' : 'غير متصل بالسحابة'}
                    </Text>
                  </View>
                </View>

                {formattedLastSyncTime ? (
                  <View style={styles.syncMetaRow}>
                    <Ionicons name="time-outline" size={16} color={theme.textMuted} />
                    <Text style={[styles.syncMetaLabel, { color: theme.textSecondary }]}>
                      آخر مزامنة ناجحة:
                    </Text>
                    <Text style={[styles.syncMetaVal, { color: theme.text }]}>
                      {formattedLastSyncTime}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.syncMetaRow}>
                    <Ionicons name="time-outline" size={16} color={theme.textMuted} />
                    <Text style={[styles.syncMetaLabel, { color: theme.textMuted }]}>
                      لم يتم تسجيل مزامنة سابقة بعد
                    </Text>
                  </View>
                )}

                {sanitizedLastSyncMessage ? (
                  <View
                    style={[
                      styles.syncMessageBanner,
                      {
                        backgroundColor: theme.surfaceSoft,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Ionicons name="information-circle-outline" size={16} color={theme.primary} />
                    <Text style={[styles.syncMessageText, { color: theme.textSecondary }]}>
                      {sanitizedLastSyncMessage}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Section 3: Restore Backup or Reset Demo Data */}
            <View
              style={[
                styles.sectionBox,
                { backgroundColor: theme.cardAlt, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                3. إدارة البيانات والنسخ الاحتياطي
              </Text>
              <View style={styles.syncActionsRow}>
                <TouchableOpacity accessibilityRole="button" disabled={readingBackup} accessibilityState={{disabled:readingBackup,busy:readingBackup}} style={[styles.pullBtn,{backgroundColor:theme.card,borderColor:theme.border}]} onPress={handleBackupFile}>
                  <Text style={[styles.pullBtnText,{color:theme.primary}]}>{readingBackup?'جارٍ اختيار النسخة…':'اختيار ملف نسخة JSON'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button" accessibilityState={{expanded:showImportBox}}
                  style={[
                    styles.pullBtn,
                    {
                      backgroundColor: theme.blueSoft,
                      borderColor: theme.blue,
                    },
                  ]}
                  onPress={() => {setPickedBackup(null);setShowImportBox(!showImportBox);}}
                >
                  <Ionicons
                    name="folder-open-outline"
                    size={16}
                    color={theme.blue}
                  />
                  <Text style={[styles.pullBtnText, { color: theme.blue }]}>
                    استرجاع نسخة JSON
                  </Text>
                </TouchableOpacity>


              </View>

              {showImportBox && (
                <View style={{ marginTop: 10 }}>
                  <Text
                    style={[
                      styles.inputLabel,
                      { color: theme.textSecondary },
                    ]}
                  >
                    الصق محتوى ملف النسخة الاحتياطية (JSON) هنا:
                  </Text>
                  {pickedBackup ? <Text style={[styles.sectionSub,{color:theme.text}]}>{pickedBackup.name} · {Math.ceil(pickedBackup.bytes/1024)} KB. ستُحفظ نسخة الاسترجاع والدليل السابق قبل الاستبدال.</Text> : <TextInput
                    accessibilityLabel="محتوى نسخة JSON للاسترجاع"
                    style={[
                      styles.input,
                      {
                        minHeight: 80,
                        backgroundColor: theme.inputBg,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    multiline
                    value={importJsonText}
                    onChangeText={setImportJsonText}
                    placeholder='{"accounts": [...], "deals": [...]}'
                    placeholderTextColor={theme.textMuted}
                  />}
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[
                      styles.pushBtn,
                      { marginTop: 8, backgroundColor: theme.primary },
                    ]}
                    onPress={async () => {
                      const ok = await importStateJson(pickedBackup?.content || importJsonText);
                      setStatusBanner(
                        ok
                          ? 'تم استرجاع النسخة الاحتياطية بنجاح!'
                          : 'تعذر التحقق أو الحفظ أو تغيرت الجلسة. بقيت النسخة والبيانات السابقة محفوظة؛ راجع رسالة الحالة وأعد المحاولة.'
                      );
                      if (ok) {setShowImportBox(false);setPickedBackup(null);setImportJsonText('');}
                    }}
                  >
                    <Text style={styles.pushBtnText}>تأكيد الاسترجاع</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  modalContainer: {
    borderRadius: 18,
    maxHeight: '90%',
    borderWidth: 1,
    overflow: 'hidden',
    maxWidth: 620,
    width: '100%',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeBtn: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    padding: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArea: {
    padding: 16,
  },
  bannerBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  bannerText: {
    fontSize: 12,
    flex: 1,
    textAlign: 'right',
    fontWeight: '600',
  },
  sectionBox: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 12,
  },
  exportButtonsGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 10,
  },
  exportCardBtn: {
    flex: 1,
    minWidth: '46%',
    borderRadius: 12,
    padding: 12,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  exportBtnTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 6,
    textAlign: 'right',
  },
  exportBtnSub: {
    fontSize: 11,
    marginTop: 2,
    textAlign: 'right',
  },
  inputLabel: {
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 4,
    marginTop: 8,
    fontWeight: '600',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: MIN_TOUCH_TARGET,
    textAlign: 'right',
    fontSize: 13,
  },
  syncStatusCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    gap: 12,
  },
  syncBadgeRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  syncBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    minHeight: MIN_TOUCH_TARGET,
  },
  syncBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  syncMetaRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  syncMetaLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  syncMetaVal: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  syncMessageBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  syncMessageText: {
    fontSize: 12,
    flex: 1,
    textAlign: 'right',
  },
  syncActionsRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  pushBtn: {
    flex: 1,
    minWidth: 150,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pushBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  pullBtn: {
    flex: 1,
    minWidth: 140,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  pullBtnText: {
    fontWeight: 'bold',
    fontSize: 12,
  },
  sqlToggleBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    minHeight: MIN_TOUCH_TARGET,
  },
  sqlToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
