import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, type TextInput } from 'react-native';
import { useMali } from '../context/MaliContext';

/** Lock immediately, before React renders disabled controls, and fence late form cleanup. */
export function useFinancialSubmission(resetSession: () => void) {
  const { mutationStatus, mutationSessionGeneration } = useMali();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = useRef(new Map<string, TextInput>());
  const fieldCallbacks = useRef(new Map<string, React.RefCallback<TextInput>>());
  const fieldRef = useCallback((name: string) => {
    if (!fieldCallbacks.current.has(name)) {
      fieldCallbacks.current.set(name, node => {
        if (node) fields.current.set(name, node);
        else fields.current.delete(name);
      });
    }
    return fieldCallbacks.current.get(name)!;
  }, []);
  const busy = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(mutationSessionGeneration);
  const resetGeneration = useRef(mutationSessionGeneration);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    generation.current = mutationSessionGeneration;
    if (resetGeneration.current !== mutationSessionGeneration) {
      resetGeneration.current = mutationSessionGeneration;
      busy.current = false;
      queueMicrotask(() => {
        if (mounted.current && generation.current === mutationSessionGeneration) { setPending(false); setError(null); resetSession(); }
      });
    }
  }, [mutationSessionGeneration, resetSession]);

  function reject(message: string, field?: string) {
    setError(message);
    if (field) fields.current.get(field)?.focus();
  }

  async function submit<T>(operation: () => Promise<T>): Promise<T | false> {
    if (busy.current || mutationStatus.phase === 'saving') return false;
    const token = generation.current;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await operation();
      if (!mounted.current || generation.current !== token) return false;
      if (!result) setError('تعذر تنفيذ العملية. راجع المبلغ والحساب المختار ثم أعد المحاولة.');
      return result;
    } catch {
      if (mounted.current && generation.current === token) setError('تعذر تأكيد الحفظ. احتفظ بالبيانات وأعد المحاولة.');
      return false;
    } finally {
      if (mounted.current && generation.current === token) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return { submit, saving: pending || mutationStatus.phase === 'saving', error, reject, fieldRef };
}

export function FinancialSaveNotice({ error }: { error?: string | null } = {}) {
  const { mutationStatus, lastSyncMessage, theme } = useMali();
  if (mutationStatus.phase === 'idle' && !error) return null;
  const saving = mutationStatus.phase === 'saving';
  return <Text accessibilityRole={saving ? 'text' : 'alert'} accessibilityLiveRegion={saving ? 'polite' : 'assertive'}
    style={{ color: saving ? theme.textSecondary : theme.danger,
    textAlign: 'right', marginVertical: 8 }}>
    {saving ? 'جارٍ الحفظ على الجهاز…' : mutationStatus.phase === 'storage-error'
      ? lastSyncMessage || 'تعذر تأكيد الحفظ. أعد المحاولة بالبيانات نفسها.' : error}
  </Text>;
}
