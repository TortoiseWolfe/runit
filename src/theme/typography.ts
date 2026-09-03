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

/** Opacity levels the canvas uses for its text hierarchy. Baked via alpha(). */
export const fade = {
  strong: 0.85,
  body: 0.7,
  muted: 0.6,
  soft: 0.55,
  faint: 0.5,
  past: 0.45,
} as const;
