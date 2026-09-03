/**
 * Runit colour tokens.
 *
 * These are the DaisyUI `scripthammer-dark` / `scripthammer-light` themes the
 * design canvas renders against, converted from oklch() to hex because React
 * Native cannot parse oklch (see ./oklch.ts).
 *
 * Every value carries its oklch source. tokens.test.ts re-parses those sources
 * straight out of design/theme.css, re-runs the conversion, and fails if any
 * hex here has drifted -- so this table cannot silently diverge from the design.
 * Do not hand-edit a value; change the design and re-run the test.
 */

export interface ThemeTokens {
  base100: string;
  base200: string;
  base300: string;
  baseContent: string;
  primary: string;
  primaryContent: string;
  secondary: string;
  secondaryContent: string;
  accent: string;
  accentContent: string;
  neutral: string;
  neutralContent: string;
  info: string;
  infoContent: string;
  success: string;
  successContent: string;
  warning: string;
  warningContent: string;
  error: string;
  errorContent: string;
  /** Derived, not a DaisyUI token: the canvas's inactive tab-bar glyph colour. */
  tabInactive: string;
}

export const DARK: ThemeTokens = {
  base100: '#1A1A2E', //           oklch(22.84% 0.038 282.93)
  base200: '#16162A', //           oklch(21.13% 0.039 282.53)
  base300: '#25254A', //           oklch(28.51% 0.067 281.32)
  baseContent: '#E2E8F0', //       oklch(92.88% 0.013 255.51)
  primary: '#A8B2C1', //           oklch(76.05% 0.024 258.37)
  primaryContent: '#1A1A2E', //    oklch(22.84% 0.038 282.93)
  secondary: '#E8D4B8', //         oklch(87.91% 0.043 76.31)
  secondaryContent: '#1A1A2E', //  oklch(22.84% 0.038 282.93)
  accent: '#38BDF8', //            oklch(75.35% 0.139 232.66)
  accentContent: '#1A1A2E', //     oklch(22.84% 0.038 282.93)
  neutral: '#2D2D4A', //           oklch(31.14% 0.052 282.99)
  neutralContent: '#D1D5DB', //    oklch(87.17% 0.009 258.34)
  info: '#77A8F9', //              oklch(73.08% 0.13 260.06)
  infoContent: '#1A1A2E', //       oklch(22.84% 0.038 282.93)
  success: '#22C55E', //           oklch(72.27% 0.192 149.58)
  successContent: '#1A1A2E', //    oklch(22.84% 0.038 282.93)
  warning: '#FDE046', //           oklch(90.52% 0.166 98.11)
  warningContent: '#1A1A2E', //    oklch(22.84% 0.038 282.93)
  error: '#F58989', //             oklch(74.7% 0.132 20.69)
  errorContent: '#1A1A2E', //      oklch(22.84% 0.038 282.93)
  tabInactive: '#979FAB', //       oklch(70% 0.02 258)
};

export const LIGHT: ThemeTokens = {
  base100: '#F5F0EB', //           oklch(95.76% 0.009 67.72)
  base200: '#EBE5DD', //           oklch(92.44% 0.013 75.36)
  base300: '#DDD5CB', //           oklch(87.66% 0.016 73.66)
  baseContent: '#1F2937', //       oklch(27.81% 0.03 256.85)
  primary: '#455060', //           oklch(42.79% 0.03 257.68)
  primaryContent: '#FFFFFF', //    oklch(100% 0 0)
  secondary: '#853A0D', //         oklch(44.28% 0.116 46.14)
  secondaryContent: '#FFFFFF', //  oklch(100% 0 0)
  accent: '#00557F', //            oklch(42.86% 0.098 239.94)
  accentContent: '#FFFFFF', //     oklch(100% 0 0)
  neutral: '#374151', //           oklch(37.29% 0.031 259.73)
  neutralContent: '#F9FAFB', //    oklch(98.46% 0.002 247.84)
  info: '#1B49AC', //              oklch(43.86% 0.167 262.77)
  infoContent: '#FFFFFF', //       oklch(100% 0 0)
  success: '#0C5D2A', //           oklch(42.03% 0.11 149.9)
  successContent: '#FFFFFF', //    oklch(100% 0 0)
  warning: '#6C4901', //           oklch(43.35% 0.09 76.98)
  warningContent: '#FFFFFF', //    oklch(100% 0 0)
  error: '#9C1B1B', //             oklch(44.94% 0.164 26.98)
  errorContent: '#FFFFFF', //      oklch(100% 0 0)
  tabInactive: '#5C646F', //       oklch(50% 0.02 258)
};

/**
 * The canvas's inactive tab glyph is generated, not a theme token:
 *   `isDark ? 'oklch(70% 0.02 258)' : 'oklch(50% 0.02 258)'`
 * Kept here so tokens.test.ts can verify it alongside the rest.
 */
export const TAB_INACTIVE_SOURCE = {
  dark: [0.7, 0.02, 258],
  light: [0.5, 0.02, 258],
} as const;

/** Maps a ThemeTokens key back to its DaisyUI custom-property name. */
export const TOKEN_TO_CSS_VAR: Record<Exclude<keyof ThemeTokens, 'tabInactive'>, string> = {
  base100: '--color-base-100',
  base200: '--color-base-200',
  base300: '--color-base-300',
  baseContent: '--color-base-content',
  primary: '--color-primary',
  primaryContent: '--color-primary-content',
  secondary: '--color-secondary',
  secondaryContent: '--color-secondary-content',
  accent: '--color-accent',
  accentContent: '--color-accent-content',
  neutral: '--color-neutral',
  neutralContent: '--color-neutral-content',
  info: '--color-info',
  infoContent: '--color-info-content',
  success: '--color-success',
  successContent: '--color-success-content',
  warning: '--color-warning',
  warningContent: '--color-warning-content',
  error: '--color-error',
  errorContent: '--color-error-content',
};
