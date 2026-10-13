import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMali } from '../context/MaliContext';
import type { CloudConflictReview } from '../types/cloudConflict';
import type { ConflictChoice } from '../services/conflictResolutionCore';
import { exportFileOrShare } from '../utils/exportHelper';

/** Every decision is explicit, tied to the displayed versions, and checked again by the provider. */
export function ConflictResolutionPanel() {
  const { theme, inspectCloudConflict, resolveCloudConflict } = useMali();
  const [review, setReview] = useState<CloudConflictReview | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function choose(choice: ConflictChoice) {
    if (pending.current || !review || !reason.trim()) return;
    pending.current = true; setBusy(true);
    try {
      const result = await resolveCloudConflict(review.token, choice, reason.trim());
      if (!mounted.current) return;
      setMessage(result.message);
      if (result.review) { setReview(result.review); setReason(''); }
      else if (result.ok) setReview(null);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const label = { color: theme.text }, detail = { color: theme.textSecondary };
  const button = [styles.button, { borderColor: theme.border, backgroundColor: theme.card }];
  return <View style={[styles.box, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
    <Text accessibilityRole="header" style={[styles.title, label]}>مراجعة تعارض النسختين</Text>
    <Text style={[styles.text, detail]}>يتوقف الرفع أثناء التعارض. حمّل النسخ المحفوظة وراجعها، ثم اختر النسخة التي تريد اعتمادها مع سبب القرار. يحتفظ التطبيق بالنسخ السابقة قبل الحفظ.</Text>
    <TouchableOpacity accessibilityRole="button" style={button} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => {
      const current = inspectCloudConflict(); setReview(current); setReason('');
      setMessage(current ? 'هذه النسخة السحابية محفوظة من وقت التعارض. سنتحقق من أحدث نسخة قبل اعتماد قرارك.' : 'تعذر فتح تعارض صالح. انتظر اكتمال الحفظ أو أعد فتح الخزنة.');
    }}><Text style={[styles.text, label]}>عرض النسخة المحلية والسحابية المحفوظة</Text></TouchableOpacity>
    {review && <>
      {[['المحلية الحالية', review.local], ['السحابية التي تمت مراجعتها', review.cloud]] .map(([name, snapshot]) => {
        const data = snapshot as CloudConflictReview['local'];
        return <View key={name as string} style={styles.version}>
          <Text style={[styles.title, label]}>{name as string}</Text>
          <Text selectable style={[styles.text, detail]}>حسابات: {data.accounts.length} · حركات: {data.transactions.length} · صفقات: {data.deals.length} · ديون: {data.debts.length} · أحداث السجل: {data.financialAudit?.length || 0}</Text>
          <Text selectable style={[styles.text, label]}>LYD: {data.accounts.filter(row => row.currency === 'LYD').reduce((sum, row) => sum + row.balance, 0).toFixed(2)} · USD: {data.accounts.filter(row => row.currency === 'USD').reduce((sum, row) => sum + row.balance, 0).toFixed(2)}</Text>
        </View>;
      })}
      <Text selectable style={[styles.text, detail]}>وقت النسخة السحابية: {review.token.cloudTimestamp}</Text>
      <TouchableOpacity accessibilityRole="button" style={button} onPress={async () => {
        if (pending.current) return; pending.current = true; setBusy(true);
        try {
          const ok = await exportFileOrShare('mali-conflict-versions.json', JSON.stringify({ version: 1, local: review.local, reviewedCloud: review.cloud, attempted: review.attempted, originalCloud: review.originalCloud }, null, 2), 'application/json');
          if (mounted.current) setMessage(ok ? 'تم فتح تنزيل أو مشاركة النسخ. احفظها في الوجهة التي تختارها.' : 'تعذر تجهيز ملف النسخ. بقي التعارض محفوظاً.');
        } finally { pending.current = false; if (mounted.current) setBusy(false); }
      }} disabled={busy} accessibilityState={{ disabled: busy }}><Text style={[styles.text, label]}>تنزيل جميع النسخ قبل القرار</Text></TouchableOpacity>
      <TextInput accessibilityLabel="سبب اعتماد نسخة لحل التعارض" placeholder="اكتب سبب اختيار النسخة" placeholderTextColor={theme.textMuted} value={reason} onChangeText={setReason} editable={!busy} multiline maxLength={2000} style={[styles.input, label, { borderColor: theme.border, backgroundColor: theme.card }]} />
      <Text style={[styles.text, detail]}>اعتماد المحلية يحفظها ثم يحاول رفعها مقابل النسخة السحابية المعروضة. اعتماد السحابية يستبدل محتوى الخزنة على هذا الجهاز، بعد حفظ المحلية في أرشيف الاسترجاع. لا يرفع الاختيار السحابي أي بيانات.</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy || !reason.trim() }} disabled={busy || !reason.trim()} style={button} onPress={() => choose('keep-local')}><Text style={[styles.text, label]}>اعتماد النسخة المحلية ومتابعة المزامنة</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy || !reason.trim() }} disabled={busy || !reason.trim()} style={button} onPress={() => choose('adopt-cloud')}><Text style={[styles.text, label]}>اعتماد النسخة السحابية على هذا الجهاز</Text></TouchableOpacity>
    </>}
    {busy && <ActivityIndicator color={theme.primary} accessibilityLabel="جارٍ التحقق وحفظ النسخ" />}
    {message && <Text accessibilityLiveRegion="polite" style={[styles.text, label]}>{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14, gap: 10 },
  title: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  text: { fontSize: 13, lineHeight: 22, textAlign: 'right' },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12, justifyContent: 'center' },
  input: { minHeight: 64, borderWidth: 1, borderRadius: 12, padding: 12, textAlign: 'right' },
  version: { paddingVertical: 8, gap: 4 },
});
