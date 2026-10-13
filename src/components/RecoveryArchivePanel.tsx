import React, { useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMali } from '../context/MaliContext';
import { createRecoveryArchiveReader, type RecoveryArchive, type RecoveryArchiveSummary } from '../services/recoveryArchiveReader';
import { exportFileOrShare } from '../utils/exportHelper';

export function RecoveryArchivePanel() {
  const { currentUser, mutationSessionGeneration } = useMali();
  if (!currentUser) return null;
  return <ArchiveContents key={`${mutationSessionGeneration}:${currentUser.id}`} ownerId={currentUser.id} generation={mutationSessionGeneration} />;
}
function ArchiveContents({ ownerId, generation }: { ownerId: string; generation: number }) {
  const { theme, currentUser, mutationSessionGeneration } = useMali();
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<RecoveryArchiveSummary[]>([]), [cursor, setCursor] = useState<string>();
  const [archive, setArchive] = useState<RecoveryArchive | null>(null), [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  const identity = useRef({ ownerId: currentUser?.id, generation: mutationSessionGeneration });
  useLayoutEffect(() => { identity.current = { ownerId: currentUser?.id, generation: mutationSessionGeneration }; }, [currentUser?.id, mutationSessionGeneration]);
  useLayoutEffect(() => { const active = mounted; active.current = true; return () => { active.current = false; }; }, []);
  const current = () => mounted.current && identity.current.ownerId === ownerId && identity.current.generation === generation;
  const run = async (operation: (reader: ReturnType<typeof createRecoveryArchiveReader>) => Promise<void>) => {
    if (pending.current || !current()) return;
    pending.current = true; setBusy(true); setMessage(null);
    try { await operation(createRecoveryArchiveReader(AsyncStorage, ownerId, current)); }
    catch { if (current()) setMessage('تعذر قراءة هذه النسخة أو تصديرها. بقي الأرشيف محفوظاً؛ أعد المحاولة أو اختر نسخة أخرى.'); }
    finally { pending.current = false; if (current()) setBusy(false); }
  };
  const load = (more = false) => run(async reader => {
    const page = await reader.list(more ? cursor : undefined);
    if (!current()) return;
    // Keep one small page in memory; selection is cleared whenever the page changes.
    setRows(page.rows); setCursor(page.nextCursor); setArchive(null); setLoaded(true);
  });
  const inspect = (id: string) => run(async reader => {
    setArchive(null);
    const selected = await reader.inspect(id);
    if (current()) setArchive(selected);
  });
  const exportVersion = (versionId: string) => run(async reader => {
    if (!archive) return;
    const content = await reader.exportVersion(archive.id, versionId);
    if (!current()) return;
    const ok = await exportFileOrShare(`mali-recovery-${versionId}.json`, content, 'application/json', current);
    if (current()) setMessage(ok ? 'تم فتح تنزيل أو مشاركة النسخة. احفظ الملف ثم استخدم استرجاع النسخة الاحتياطية إذا أردت اعتمادها.' : 'لم تتم مشاركة النسخة. أعد المحاولة وتحقق من مساحة التخزين.');
  });
  const date = (value: string) => new Date(value).toLocaleString('ar-LY', { timeZone: 'Africa/Tripoli' });
  const buttonStyle = [styles.button, { borderColor: theme.border, backgroundColor: theme.card, opacity: busy ? 0.6 : 1 }];
  return <View style={[styles.box, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded, disabled: busy }} disabled={busy} style={styles.heading} onPress={() => {
      setExpanded(value => !value); if (!expanded && !loaded) void load();
    }}><Text style={[styles.title, { color: theme.text }]}>النسخ المحفوظة قبل الاسترجاع وحل التعارض {expanded ? '−' : '+'}</Text></TouchableOpacity>
    {expanded && <>
      <Text style={[styles.detail, { color: theme.textSecondary }]}>هذه نسخ سابقة على هذا الجهاز. تصديرها لا يغيّر الخزنة الحالية.</Text>
      {busy && <ActivityIndicator color={theme.primary} accessibilityLabel="جارٍ قراءة النسخ المحفوظة" />}
      {loaded && !rows.length && <Text style={[styles.detail, { color: theme.textSecondary }]}>لا توجد نسخ استرجاع محفوظة لهذا الحساب على الجهاز.</Text>}
      {rows.map(row => <TouchableOpacity key={row.id} accessibilityRole="button" accessibilityState={{ disabled: busy, selected: archive?.id === row.id }} disabled={busy} style={buttonStyle} onPress={() => void inspect(row.id)}>
        <Text style={[styles.title, { color: theme.text }]}>{date(row.createdAt)}</Text>
        <Text style={[styles.detail, { color: theme.primary }]}>{archive?.id === row.id ? 'النسخة المحددة' : 'عرض النسخ المتاحة'}</Text>
      </TouchableOpacity>)}
      <View style={styles.navigation}>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={buttonStyle} onPress={() => void load()}><Text style={{ color: theme.primary }}>تحديث الأحدث</Text></TouchableOpacity>
        {cursor && <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={buttonStyle} onPress={() => void load(true)}><Text style={{ color: theme.primary }}>عرض نسخ أقدم</Text></TouchableOpacity>}
      </View>
      {archive && <View style={[styles.versions, { borderColor: theme.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{archive.source === 'conflict' ? 'نسخ قرار حل التعارض' : 'نسخ استرجاع ملف احتياطي'} · {date(archive.createdAt)}</Text>
        {archive.versions.map(version => <View key={version.id} style={styles.version}>
          <Text style={[styles.detail, { color: theme.text }]}>{version.label}</Text>
          {version.readable ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`تصدير ${version.label}`} accessibilityState={{ disabled: busy }} disabled={busy} style={buttonStyle} onPress={() => void exportVersion(version.id)}><Text style={{ color: theme.primary }}>تصدير هذه النسخة</Text></TouchableOpacity>
            : <Text style={[styles.detail, { color: theme.textSecondary }]}>غير قابلة للقراءة كنسخة مالية سليمة. بقي الأصل محفوظاً؛ اختر نسخة أخرى.</Text>}
        </View>)}
      </View>}
      {message && <Text accessibilityLiveRegion="polite" style={[styles.detail, { color: theme.text }]}>{message}</Text>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 16, gap: 8 },
  heading: { minHeight: 48, justifyContent: 'center', paddingVertical: 8 },
  title: { fontSize: 14, fontWeight: '600', textAlign: 'right', lineHeight: 22 },
  detail: { fontSize: 13, lineHeight: 22, textAlign: 'right' },
  button: { minHeight: 48, minWidth: 48, borderWidth: 1, borderRadius: 10, padding: 12, justifyContent: 'center', alignItems: 'flex-end' },
  navigation: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  versions: { borderTopWidth: 1, paddingTop: 12, gap: 12 },
  version: { gap: 6 },
});
