/**
 * Type scale, transcribed from the canvas's inline styles.
 *
 * The canvas expresses letter-spacing in `em`; React Native's `letterSpacing`
 * is absolute points. tracking() converts, so call sites can keep the design's
 * own numbers. Consequence: tracking is frozen at the design's font size and
 * will not follow Dynamic Type -- see FIDELITY.md deviation 7.
 */

/** `tracking(0.14, 12)` -> 1.68 -- the canvas's `.14em` at 12px. */
export const tracking = (em: number, fontSize: number): number => em * fontSize;

export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * The recurring eyebrow: 11-13px, uppercase, wide tracking, faded.
 * Canvas uses .14em at 12px (page headers) and .12em / .1em at 11-13px.
 */
export const eyebrow = {
  section: { fontSize: 12, letterSpacing: tracking(0.14, 12), textTransform: 'uppercase' },
  card: { fontSize: 11, letterSpacing: tracking(0.12, 11), textTransform: 'uppercase' },
  list: { fontSize: 13, letterSpacing: tracking(0.1, 13), textTransform: 'uppercase' },
} as const;

/**
 * Opacity levels for the text hierarchy, baked via alpha().
 *
 * THE CANVAS'S OWN RAMP DOES NOT PASS WCAG AA, so this is per-scheme. The canvas
 * uses one table -- 0.85 / 0.7 / 0.6 / 0.55 / 0.5 / 0.45 -- and `alpha()` emits a
 * real rgba(), so each level composites against the ground rather than being
 * pre-flattened. Measured against the built export, that ramp fails 4.5:1 from
 * `muted` down in light and from `faint` down in dark.
 *
 * The two schemes need genuinely different numbers: #1F2937 on #F5F0EB has less
 * headroom than #E2E8F0 on #1A1A2E, so the minimum alpha reaching 4.5:1 (taken
 * as the worse of base-100 and base-200) is 0.666 light against 0.508 dark. One
 * shared table cannot serve both without flattening dark's hierarchy.
 *
 * Each ramp keeps the canvas's ORDERING and relative spacing and is lifted so its
 * lowest level clears that scheme's floor with a small margin. Worst measured
 * ratio is 4.65:1 light, 4.66:1 dark. See design/FIDELITY.md note H.
 *
 * Prefer `useTheme().fade` in components. This export is the light ramp and
 * exists for the few places outside the provider.
 */
export const fadeFor = {
  light: {
    strong: 0.97,
    body: 0.86,
    muted: 0.787,
    soft: 0.751,
    faint: 0.715,
    past: 0.678,
  },
  dark: {
    strong: 0.97,
    body: 0.801,
    muted: 0.689,
    soft: 0.633,
    faint: 0.576,
    past: 0.52,
  },
} as const;

/** Widened: `as const` would pin each level to its literal, so the dark ramp
 *  would not be assignable to the light one. */
export type Fade = Record<'strong' | 'body' | 'muted' | 'soft' | 'faint' | 'past', number>;

/** Light ramp, for use outside a ThemeProvider. Components use useTheme().fade. */
export const fade: Fade = fadeFor.light;
