import { useWindowDimensions, StyleSheet } from 'react-native';

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const MIN_TOUCH_TARGET = 48;

export const RADIUS = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  round: 9999,
} as const;

export const TYPOGRAPHY = {
  micro: { fontSize: 10, lineHeight: 15 },
  caption: { fontSize: 11, lineHeight: 16 },
  subText: { fontSize: 12, lineHeight: 18 },
  body: { fontSize: 13, lineHeight: 20 },
  bodyBold: { fontSize: 14, lineHeight: 21, fontWeight: 'bold' as const },
  subHeading: { fontSize: 15, lineHeight: 22, fontWeight: 'bold' as const },
  heading: { fontSize: 16, lineHeight: 24, fontWeight: 'bold' as const },
  h2: { fontSize: 18, lineHeight: 26, fontWeight: 'bold' as const },
  h1: { fontSize: 22, lineHeight: 30, fontWeight: 'bold' as const },
  kpi: { fontSize: 26, lineHeight: 34, fontWeight: 'bold' as const },
  hero: { fontSize: 30, lineHeight: 38, fontWeight: 'bold' as const },
} as const;

export const BREAKPOINTS = {
  smallPhone: 380, // e.g. 720x1600 (~360dp)
  mediumPhone: 480, // e.g. 1080x2400 (~412dp)
  largePhone: 720,  // e.g. 1440x3200 (~432dp-540dp)
  tablet: 720,      // e.g. 1600x2560 (~800dp)
} as const;

export interface ResponsiveLayout {
  width: number;
  height: number;
  isSmallPhone: boolean;
  isMediumPhone: boolean;
  isTablet: boolean;
  contentMaxWidth: number;
  cardWidth: (columns: number, gap?: number, horizontalPadding?: number) => number;
  spacing: typeof SPACING;
  touchTarget: typeof MIN_TOUCH_TARGET;
}

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  const isSmallPhone = width < BREAKPOINTS.smallPhone;
  const isTablet = width >= BREAKPOINTS.tablet;
  const isMediumPhone = !isSmallPhone && !isTablet;
  const contentMaxWidth = isTablet ? 780 : width;

  const cardWidth = (columns: number, gap: number = SPACING.md, horizontalPadding: number = SPACING.lg * 2): number => {
    const usableWidth = Math.min(width, contentMaxWidth) - horizontalPadding;
    if (columns <= 1) return usableWidth;
    return Math.floor((usableWidth - gap * (columns - 1)) / columns);
  };

  return {
    width,
    height,
    isSmallPhone,
    isMediumPhone,
    isTablet,
    contentMaxWidth,
    cardWidth,
    spacing: SPACING,
    touchTarget: MIN_TOUCH_TARGET,
  };
}

export const responsiveStyles = StyleSheet.create({
  touchTarget: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
  },
  touchTargetCenter: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rtlRow: {
    flexDirection: 'row-reverse',
  },
  rtlRowCenter: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  rtlRowBetween: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rtlText: {
    textAlign: 'right',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  modalCardResponsive: {
    width: '100%',
    maxWidth: 580,
    maxHeight: '90%',
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
  },
});
