import React, { useRef,useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';
import { FinancialHistoryPanel } from '../components/FinancialHistoryPanel';
import { createSafeDiagnostics } from '../services/diagnosticsCore';
import { pickBackupFile,type BackupFileResult } from '../utils/backupFilePicker';
import { SUPABASE_SQL_SCHEMA } from '../services/supabaseSync';
import {
  exportFileOrShare,
  generateDealsCsv,
  generateTransactionsCsv,
  printFinancialStatement,
} from '../utils/exportHelper';

interface CloudModalProps {
  visible: boolean;
  onClose: () => void;
}

export const CloudAndExportModal: React.FC<CloudModalProps> = ({
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
    updateSupabaseConfig,
    syncToCloud,
    pullFromCloud,
    importStateJson,
  } = useMali();

  const [urlInput, setUrlInput] = useState(state.supabaseConfig.url);
  const [anonKeyInput, setAnonKeyInput] = useState(
    state.supabaseConfig.anonKey
  );
  const [workspaceKeyInput, setWorkspaceKeyInput] = useState(
    state.supabaseConfig.workspaceKey || 'mali-personal-vault'
  );
  const [autoSync, setAutoSync] = useState(state.supabaseConfig.autoSync);
  const [showSql, setShowSql] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportBox, setShowImportBox] = useState(false);
  const [pickedBackup,setPickedBackup]=useState<Extract<BackupFileResult,{status:'selected'}>|null>(null);
  const [readingBackup,setReadingBackup]=useState(false);
  const backupPickerPending=useRef(false);

  const buildCurrentConfig = () => ({
    url: urlInput.trim(),
    anonKey: anonKeyInput.trim(),
    workspaceKey: workspaceKeyInput.trim() || 'mali-personal-vault',
    autoSync,
    lastSyncedAt: state.supabaseConfig.lastSyncedAt,
  });

  const handleSaveConfig = async () => {
    const cfg = buildCurrentConfig();
    setStatusBanner(await updateSupabaseConfig(cfg) ? 'تم حفظ إعدادات المزامنة على هذا الجهاز.' : 'تعذر حفظ الإعدادات. راجع التخزين وانتظر تحميل الخزنة أو استرجع نسخة صحيحة.');
  };

  const handlePush = async () => {
    const cfg = buildCurrentConfig();
    if (!await updateSupabaseConfig(cfg)) {
      setStatusBanner('تعذر اعتماد الإعدادات. انتظر تحميل الخزنة أو استرجع نسخة صحيحة.');
      return;
    }
    const res = await syncToCloud();
    setStatusBanner(res.message);
  };

  const handlePull = async () => {
    const cfg = buildCurrentConfig();
    const res = await pullFromCloud(cfg);
    setStatusBanner(res.message);
  };

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
              المزامنة السحابية (Supabase) وتصدير التقارير
            </Text>
            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: theme.card }]}
              onPress={onClose}
            >
              <Ionicons name="close" size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea}>
            <FinancialHistoryPanel />
            <View style={[styles.sectionBox,{backgroundColor:theme.cardAlt,borderColor:theme.border}]}>
              <Text accessibilityLiveRegion="polite" style={[styles.sectionTitle,{color:theme.text}]}>{cloudSyncStatus.phase==='blocked'?'توقفت المزامنة لحماية بياناتك':cloudSyncStatus.phase==='retrying'?'تعذر الاتصال؛ ستُعاد المحاولة عند فتح التطبيق':cloudSyncStatus.phase==='storage-error'?'تعذر الحفظ على الجهاز؛ يلزم إعادة المحاولة':cloudSyncStatus.phase==='uploading'?'جارٍ رفع النسخة المحفوظة':state.pendingCloudSync?'نسخة محفوظة على الجهاز تنتظر الرفع':'حالة الحفظ والمزامنة'}</Text>
              <Text style={[styles.sectionSub,{color:theme.textSecondary}]}>تعمل إعادة المزامنة أثناء فتح التطبيق. عند التعارض تبقى النسختان محفوظتين ويتوقف الرفع حتى اختيار حلّ واضح.</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.sqlToggleBtn} onPress={async()=>{
                const report=createSafeDiagnostics(state,cloudSyncStatus,Platform.OS,!!currentUser?.isLocalOnly);
                const ok=await exportFileOrShare('mali-support-diagnostics.json',JSON.stringify(report,null,2),'application/json');
                setStatusBanner(ok?'تم فتح تنزيل أو مشاركة تقرير حالة التطبيق. يحتوي أعداد السجلات وحالة الحفظ فقط.':'تعذر تجهيز أو مشاركة تقرير الحالة.');
              }}><Text style={[styles.sqlToggleText,{color:theme.primary}]}>تصدير تقرير الحالة للدعم دون أسماء أو أرصدة أو صور أو مفاتيح</Text></TouchableOpacity>
            </View>
            {statusBanner || lastSyncMessage ? (
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
                  {statusBanner || lastSyncMessage}
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

            {/* Section 2: Supabase Cloud Sync */}
            <View
              style={[
                styles.sectionBox,
                { backgroundColor: theme.cardAlt, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                2. إعداد المزامنة السحابية الفورية (Supabase Cloud)
              </Text>
              <Text
                style={[styles.sectionSub, { color: theme.textSecondary }]}
              >
                التطبيق يعمل بنظام Offline-First (يحفظ على جهازك فوراً)، وعند إدخال بيانات مشروعك في Supabase يزامن بين الهاتف والكمبيوتر تلقائياً.
              </Text>

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                رابط مشروع Supabase (Project URL)
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
                value={urlInput}
                onChangeText={setUrlInput}
                placeholder="https://xyzcompany.supabase.co"
                placeholderTextColor={theme.textMuted}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                مفتاح الوصول العام (Anon Public Key)
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
                value={anonKeyInput}
                onChangeText={setAnonKeyInput}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                placeholderTextColor={theme.textMuted}
              />

              <Text
                style={[styles.inputLabel, { color: theme.textSecondary }]}
              >
                معرف الخزنة الخاصة بك (Workspace Key للمزامنة بين أجهزتك)
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
                value={workspaceKeyInput}
                onChangeText={setWorkspaceKeyInput}
                placeholder="mali-personal-vault"
                placeholderTextColor={theme.textMuted}
              />

              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setAutoSync(!autoSync)}
              >
                <Ionicons
                  name={autoSync ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={theme.primary}
                />
                <Text
                  style={[
                    styles.checkboxText,
                    { color: theme.textSecondary },
                  ]}
                >
                  تفعيل المزامنة السحابية التلقائية عند كل حركة جديدة
                </Text>
              </TouchableOpacity>

              <View style={styles.syncActionsRow}>
                <TouchableOpacity accessibilityRole="button" disabled={readingBackup} accessibilityState={{disabled:readingBackup,busy:readingBackup}} style={[styles.pullBtn,{backgroundColor:theme.card,borderColor:theme.border}]} onPress={async()=>{
                  if(backupPickerPending.current)return;backupPickerPending.current=true;setReadingBackup(true);
                  try{const result=await pickBackupFile();if(result.status==='selected'){setPickedBackup(result);setImportJsonText('');setShowImportBox(true);setStatusBanner('تمت قراءة الملف. راجع الاختيار ثم أكد الاسترجاع؛ لم تتغير الخزنة بعد.');}
                    else if(result.status==='error')setStatusBanner(result.message);
                  }finally{backupPickerPending.current=false;setReadingBackup(false);}
                }}><Text style={[styles.pullBtnText,{color:theme.primary}]}>{readingBackup?'جارٍ اختيار النسخة…':'اختيار ملف نسخة JSON'}</Text></TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pushBtn,
                    { backgroundColor: theme.primary },
                  ]}
                  onPress={handlePush}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons
                      name="cloud-upload-outline"
                      size={18}
                      color="#FFFFFF"
                    />
                  )}
                  <Text style={styles.pushBtnText}>
                    رفع البيانات للسحابة (Push)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pullBtn,
                    {
                      backgroundColor: theme.blueSoft,
                      borderColor: theme.blue,
                    },
                  ]}
                  onPress={handlePull}
                  disabled={isSyncing}
                >
                  <Ionicons
                    name="cloud-download-outline"
                    size={18}
                    color={theme.blue}
                  />
                  <Text style={[styles.pullBtnText, { color: theme.blue }]}>
                    جلب من السحابة (Pull)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.saveCfgBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={handleSaveConfig}
                >
                  <Text
                    style={[
                      styles.saveCfgBtnText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    حفظ الإعدادات
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.sqlToggleBtn}
                onPress={() => setShowSql(!showSql)}
              >
                <Ionicons
                  name="code-slash-outline"
                  size={16}
                  color={theme.primary}
                />
                <Text
                  style={[styles.sqlToggleText, { color: theme.primary }]}
                >
                  {showSql
                    ? 'إخفاء كود تهيئة جدول قاعدة بيانات Supabase (SQL)'
                    : 'عرض كود تهيئة جدول قاعدة بيانات Supabase (SQL Schema)'}
                </Text>
              </TouchableOpacity>

              {showSql && (
                <View style={styles.sqlBox}>
                  <Text selectable style={styles.sqlCode}>
                    {SUPABASE_SQL_SCHEMA}
                  </Text>
                </View>
              )}
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
                <TouchableOpacity
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
    padding: 6,
    borderRadius: 8,
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
    borderWidth: 1,
    alignItems: 'flex-end',
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
    textAlign: 'right',
    fontSize: 13,
  },
  checkboxRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  checkboxText: {
    fontSize: 12,
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
  saveCfgBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveCfgBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sqlToggleBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  sqlToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sqlBox: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  sqlCode: {
    color: '#38BDF8',
    fontFamily: 'monospace',
    fontSize: 11,
  },
});
