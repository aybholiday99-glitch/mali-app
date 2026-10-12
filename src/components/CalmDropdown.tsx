import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMali } from '../context/MaliContext';

export interface DropdownOption {
  value: string;
  label: string;
  subLabel?: string;
  icon?: string;
  badgeColor?: string;
}

interface CalmDropdownProps {
  label?: string;
  value: string;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
}

export const CalmDropdown: React.FC<CalmDropdownProps> = ({
  label,
  value,
  options,
  onSelect,
  placeholder = 'اختر من القائمة...',
  compact = false,
}) => {
  const { theme } = useMali();
  const [open, setOpen] = useState(false);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <View style={compact ? styles.compactWrapper : styles.wrapper}>
      {label ? (
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {label}
        </Text>
      ) : null}

      <TouchableOpacity
        activeOpacity={0.8}
        style={[
          styles.trigger,
          compact && styles.triggerCompact,
          {
            backgroundColor: theme.inputBg,
            borderColor: open ? theme.primary : theme.border,
          },
        ]}
        onPress={() => setOpen(true)}
      >
        <View style={styles.triggerRight}>
          {selectedOption?.icon ? (
            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor: theme.primarySoft,
                },
              ]}
            >
              <Ionicons
                name={selectedOption.icon as any}
                size={16}
                color={selectedOption.badgeColor || theme.primary}
              />
            </View>
          ) : null}

          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.triggerText,
                compact && { fontSize: 12 },
                {
                  color: selectedOption ? theme.text : theme.textMuted,
                },
              ]}
              numberOfLines={1}
            >
              {selectedOption ? selectedOption.label : placeholder}
            </Text>
            {selectedOption?.subLabel && !compact ? (
              <Text
                style={[styles.triggerSub, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {selectedOption.subLabel}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.triggerLeft}>
          {selectedOption?.subLabel && compact ? (
            <Text
              style={[styles.compactSubText, { color: theme.primary }]}
              numberOfLines={1}
            >
              {selectedOption.subLabel}
            </Text>
          ) : null}
          <Ionicons
            name="chevron-down"
            size={18}
            color={theme.textSecondary}
          />
        </View>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.backdrop, { backgroundColor: theme.overlay }]}
          onPress={() => setOpen(false)}
        >
          <View
            style={[
              styles.menuCard,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <View
              style={[
                styles.menuHeader,
                { borderBottomColor: theme.border },
              ]}
            >
              <Text style={[styles.menuTitle, { color: theme.text }]}>
                {label || placeholder}
              </Text>
              <TouchableOpacity
                style={[styles.closeBtn, { backgroundColor: theme.cardAlt }]}
                onPress={() => setOpen(false)}
              >
                <Ionicons name="close" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.optionsList}>
              {options.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.optionItem,
                      { borderBottomColor: theme.border },
                      isSelected && { backgroundColor: theme.primarySoft },
                    ]}
                    onPress={() => {
                      onSelect(opt.value);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.optionRight}>
                      {opt.icon ? (
                        <View
                          style={[
                            styles.optionIconBox,
                            {
                              backgroundColor: isSelected
                                ? theme.card
                                : theme.cardAlt,
                            },
                          ]}
                        >
                          <Ionicons
                            name={opt.icon as any}
                            size={18}
                            color={
                              isSelected
                                ? theme.primary
                                : opt.badgeColor || theme.textSecondary
                            }
                          />
                        </View>
                      ) : null}
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionLabel,
                            {
                              color: isSelected ? theme.primary : theme.text,
                              fontWeight: isSelected ? 'bold' : '600',
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                        {opt.subLabel ? (
                          <Text
                            style={[
                              styles.optionSub,
                              { color: theme.textSecondary },
                            ]}
                          >
                            {opt.subLabel}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    {isSelected ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={theme.primary}
                      />
                    ) : (
                      <Ionicons
                        name="ellipse-outline"
                        size={18}
                        color={theme.border}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 8,
  },
  compactWrapper: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    marginBottom: 5,
    marginTop: 4,
  },
  trigger: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  triggerCompact: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  triggerRight: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerText: {
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  triggerSub: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 1,
  },
  triggerLeft: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginRight: 6,
  },
  compactSubText: {
    fontSize: 11,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  menuCard: {
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '75%',
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  menuHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsList: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  optionItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderRadius: 10,
    marginVertical: 2,
  },
  optionRight: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  optionIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLabel: {
    fontSize: 14,
    textAlign: 'right',
  },
  optionSub: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 2,
  },
});
