import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useMali } from '../context/MaliContext';

/** Lock immediately, before React renders disabled controls, and fence late form cleanup. */
export function useFinancialSubmission(resetSession: () => void) {
  const { mutationStatus, mutationSessionGeneration } = useMali();
  const [pending, setPending] = useState(false);
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
        if (mounted.current && generation.current === mutationSessionGeneration) { setPending(false); resetSession(); }
      });
    }
  }, [mutationSessionGeneration, resetSession]);

  async function submit<T>(operation: () => Promise<T>): Promise<T | false> {
    if (busy.current || mutationStatus.phase === 'saving') return false;
    const token = generation.current;
    busy.current = true;
    setPending(true);
    try {
      const result = await operation();
      return mounted.current && generation.current === token ? result : false;
    } catch {
      return false;
    } finally {
      if (mounted.current && generation.current === token) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return { submit, saving: pending || mutationStatus.phase === 'saving' };
}

export function FinancialSaveNotice() {
  const { mutationStatus, lastSyncMessage, theme } = useMali();
  if (mutationStatus.phase === 'idle') return null;
  return <Text accessibilityRole="alert" style={{ color: mutationStatus.phase === 'saving' ? theme.textSecondary : theme.danger,
    textAlign: 'right', marginVertical: 8 }}>
    {mutationStatus.phase === 'saving' ? 'جارٍ الحفظ على الجهاز…' : lastSyncMessage || 'تعذر تأكيد الحفظ. أعد المحاولة بالبيانات نفسها.'}
  </Text>;
}
