import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { useMali } from '../context/MaliContext';

interface PagedRowsProps<T> {
  items: readonly T[];
  label: string;
  children: (item: T, index: number) => React.ReactNode;
  resetKey?: string;
  pageSize?: number;
  disabled?: boolean;
  horizontal?: boolean;
  scrollStyle?: StyleProp<ViewStyle>;
}

/** Presentation only: callers keep the complete collection for calculations and exports. */
export function PagedRows<T>({ items, label, children, resetKey = '', pageSize = 20,
  disabled = false, horizontal = false, scrollStyle }: PagedRowsProps<T>) {
  const { theme, mutationSessionGeneration } = useMali();
  const scope = JSON.stringify([mutationSessionGeneration, resetKey]);
  const size = Math.max(1, Math.min(50, Math.floor(pageSize) || 20));
  const lastPage = Math.max(0, Math.ceil(items.length / size) - 1);
  const [position, setPosition] = useState({ scope, page: 0 });
  const page = position.scope === scope ? Math.min(position.page, lastPage) : 0;
  // Clamp in the same render so a deletion/filter never exposes a stale or empty page.
  if (position.scope !== scope || position.page !== page) setPosition({ scope, page });
  const start = page * size;
  const rows = items.slice(start, start + size).map((item, index) => children(item, start + index));

  const controls = lastPage > 0 ? (
    <View accessibilityRole="toolbar" accessibilityLabel={`صفحات ${label}`} style={styles.pager}>
      <Text accessibilityLiveRegion="polite" style={[styles.summary, { color: theme.textSecondary }]}>
        {label}: {start + 1}–{Math.min(start + size, items.length)} من {items.length} · الصفحة {page + 1} من {lastPage + 1}
      </Text>
      <View style={styles.actions}>
        {([
          ['الأولى', 0, page === 0], ['السابقة', page - 1, page === 0],
          ['التالية', page + 1, page === lastPage], ['الأخيرة', lastPage, page === lastPage],
        ] as const).map(([title, target, atEdge]) => (
          <TouchableOpacity key={title} accessibilityRole="button" accessibilityLabel={`${label}: الصفحة ${title}`}
            accessibilityState={{ disabled: disabled || atEdge }} disabled={disabled || atEdge}
            style={[styles.button, { backgroundColor: theme.cardAlt, borderColor: theme.border,
              opacity: disabled || atEdge ? 0.5 : 1 }]}
            onPress={() => { if (!disabled && !atEdge) setPosition({ scope, page: target }); }}>
            <Text style={{ color: theme.text }}>{title}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  ) : null;

  return <>
    {controls}
    {horizontal
      ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={scrollStyle}>{rows}</ScrollView>
      : rows}
    {controls}
  </>;
}

const styles = StyleSheet.create({
  pager: { width: '100%', marginVertical: 8, gap: 6 },
  summary: { textAlign: 'right', fontSize: 12 },
  actions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, alignItems: 'center',
    justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
});
