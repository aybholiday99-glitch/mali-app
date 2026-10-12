export interface ThemePalette {
  mode: 'light' | 'dark';
  bg: string;
  surface: string;
  surfaceSoft: string;
  card: string;
  cardAlt: string;
  inputBg: string;
  overlay: string;
  headerBg: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  // Calm professional accents
  primary: string; // Deep Calm Teal / Sage
  primarySoft: string;
  primaryText: string;
  blue: string; // Soft Royal / Slate Blue for Banks
  blueSoft: string;
  amber: string; // Warm Amber for USD / Alerts
  amberSoft: string;
  warning: string;
  warningSoft: string;
  danger: string; // Soft Coral Red for Expenses / Payables
  dangerSoft: string;
  success: string; // Calm Emerald for Profit / Cash
  successSoft: string;
  purple: string;
}

export const CALM_LIGHT_THEME: ThemePalette = {
  mode: 'light',
  bg: '#F4F6F9',
  surface: '#FFFFFF',
  surfaceSoft: '#F8FAFC',
  card: '#FFFFFF',
  cardAlt: '#F8FAFC',
  inputBg: '#F8FAFC',
  overlay: 'rgba(15, 23, 42, 0.55)',
  headerBg: '#FFFFFF',
  border: '#E2E8F0',
  text: '#1E293B',
  textSecondary: '#475569',
  textMuted: '#64748B',
  primary: '#0D9488', // Calm Teal
  primarySoft: '#F0FDFA',
  primaryText: '#FFFFFF',
  blue: '#2563EB',
  blueSoft: '#EFF6FF',
  amber: '#D97706',
  amberSoft: '#FEF3C7',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#E11D48',
  dangerSoft: '#FFF1F2',
  success: '#059669',
  successSoft: '#ECFDF5',
  purple: '#7C3AED',
};

export const CALM_DARK_THEME: ThemePalette = {
  mode: 'dark',
  bg: '#0F172A',
  surface: '#1E293B',
  surfaceSoft: '#162032',
  card: '#1E293B',
  cardAlt: '#162032',
  inputBg: '#0F172A',
  overlay: 'rgba(0, 0, 0, 0.75)',
  headerBg: '#1E293B',
  border: '#334155',
  text: '#F1F5F9',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  primary: '#14B8A6',
  primarySoft: 'rgba(20, 184, 166, 0.14)',
  primaryText: '#042F2E',
  blue: '#38BDF8',
  blueSoft: 'rgba(56, 189, 248, 0.14)',
  amber: '#FBBF24',
  amberSoft: 'rgba(251, 191, 36, 0.14)',
  warning: '#FBBF24',
  warningSoft: 'rgba(251, 191, 36, 0.14)',
  danger: '#FB7185',
  dangerSoft: 'rgba(251, 113, 133, 0.14)',
  success: '#34D399',
  successSoft: 'rgba(52, 211, 153, 0.14)',
  purple: '#A78BFA',
};
