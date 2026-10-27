import type { MaliState } from '../types/mali';

export const LIBYAN_BANKS = [
  'خزينة نقدية (كاش)',
  'مصرف الجمهورية',
  'مصرف الأمان',
  'مصرف النوران',
  'المصرف التجاري الوطني',
  'مصرف الوحدة',
  'مصرف الصحارى',
  'مصرف شمال أفريقيا',
  'مصرف المتحد',
  'مصرف اليقين',
  'مصرف الأندلس',
  'مصرف الإسلامي الليبي',
  'محفظة إلكترونية / بطاقة دولية',
];

export interface ExpensePurposeItem {
  key: string;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
}

export const QUICK_EXPENSE_PURPOSES: ExpensePurposeItem[] = [
  {
    key: 'أكل ومطاعم',
    label: 'أكل ومطاعم',
    shortLabel: 'أكل ومطاعم',
    icon: 'restaurant-outline',
    color: '#0D9488',
  },
  {
    key: 'ملابس وتسوق',
    label: 'ملابس وتسوق',
    shortLabel: 'ملابس',
    icon: 'shirt-outline',
    color: '#8B5CF6',
  },
  {
    key: 'وقود وسيارة',
    label: 'سيارة ووقود',
    shortLabel: 'سيارة ووقود',
    icon: 'car-sport-outline',
    color: '#F59E0B',
  },
  {
    key: 'عائلة ومنزل',
    label: 'مقاضي وعائلة',
    shortLabel: 'مقاضي ومنزل',
    icon: 'cart-outline',
    color: '#10B981',
  },
  {
    key: 'فواتير واتصالات',
    label: 'فواتير ورصيد',
    shortLabel: 'فواتير واتصالات',
    icon: 'phone-portrait-outline',
    color: '#2563EB',
  },
  {
    key: 'صحة وعلاج',
    label: 'صحة وصيدلية',
    shortLabel: 'صحة وعلاج',
    icon: 'medkit-outline',
    color: '#E11D48',
  },
  {
    key: 'مطاعم وكافيهات',
    label: 'قهوة وترفيه',
    shortLabel: 'قهوة وترفيه',
    icon: 'cafe-outline',
    color: '#D97706',
  },
  {
    key: 'أخرى',
    label: 'غرض آخر',
    shortLabel: 'غرض آخر',
    icon: 'ellipsis-horizontal-circle-outline',
    color: '#64748B',
  },
];

export const EXPENSE_CATEGORIES = [
  'أكل ومطاعم',
  'ملابس وتسوق',
  'وقود وسيارة',
  'عائلة ومنزل',
  'فواتير واتصالات',
  'صحة وعلاج',
  'مطاعم وكافيهات',
  'رسوم وعمولات مصرفية',
  'أخرى',
];

export const INCOME_CATEGORIES = [
  'راتب ودخل ثابت',
  'أرباح تداول عملات',
  'أعمال حرة وتجارة',
  'استرداد ديون',
  'إيداع نقدي / تغذية',
  'أخرى',
];

export const INITIAL_MALI_STATE: MaliState = {
  marketRates: {
    cashUsdToLyd: 6.22,
    chequeUsdToLyd: 6.38,
    defaultChequeDiscountPercent: 2.5,
    updatedAt: '2026-10-12T09:00:00Z',
  },
  supabaseConfig: {
    url: 'https://evcwoaerlykghgdevrhb.supabase.co',
    anonKey: 'sb_publishable_thjoIAP26oAUvYPMPUJoJQ_uhex9L6s',
    workspaceKey: 'mali-personal-vault',
    autoSync: true,
  },
  contacts: [],
  accounts: [],
  deals: [],
  transactions: [],
  debts: [],
  procedures: [],
  budgets: [],
};
