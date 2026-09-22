/** Shape and spacing constants, read off the design canvas. */

/**
 * DaisyUI shape tokens. Identical in both scripthammer themes -- only the
 * colour ramp flips between light and dark.
 *   --radius-field: 0.5rem  --radius-selector: 0.75rem  --radius-box: 1.5rem
 * At the canvas's 16px root that is 8 / 12 / 24.
 */
export const radius = {
  field: 8,
  selector: 12,
  box: 24,
  /** The canvas writes `border-radius: 999px` for pills. */
  pill: 999,
} as const;

/** `--border: 1px`. Deliberately 1, not StyleSheet.hairlineWidth. */
export const border = 1;

/**
 * Safe-area deltas.
 *
 * The canvas wraps every artboard in <IOSDevice>, which paints a fake status
 * bar and home indicator. Measured from design/ios-frame.jsx:
 *   status bar  = padding 21 + row 22 + padding 19 = 62px
 *   home area   = 34px
 * Those are exactly the iPhone 16 Pro insets, so the designer sized the frame
 * to the real device. Subtract them to recover the intended padding:
 *   join screen    padding-top 70 - 62 = 8
 *   guest/host hdr padding-top 66 - 62 = 4
 *   join bottom    padding-bottom 40 - 34 = 6
 * Copying 66/70 verbatim onto a device would double-count the status bar.
 */
export const insetDelta = {
  header: 4,
  page: 8,
  pageBottom: 6,
  /** Canvas tab bar pads 28 below its content; clamp for home-button devices. */
  tabBarMin: 12,
} as const;

/** Guest tab bar, from the canvas: padding 8px top, 26px icons, 11px labels. */
export const tabBar = {
  paddingTop: 8,
  iconSize: 26,
  iconStroke: 1.8,
  labelSize: 11,
  gap: 4,
  buttonPaddingVertical: 6,
  /** Content height excluding the bottom safe-area inset. */
  contentHeight: 63,
} as const;

/** Toast sits 120px off the canvas floor; 29px of that clears the tab bar. */
export const toast = {
  offsetAboveTabBar: 29,
  insetHorizontal: 20,
  durationMs: 2200,
} as const;

/**
 * THE WIDEST ANYTHING IN THIS APP GETS, on any screen (2026-09-21).
 *
 * The canvas is an iPhone and nothing capped width, so on a 1920px desktop every field and button
 * stretched ~1850px and the owner called it a confusing mess. Set ONCE at the root, which is the
 * only place that reaches the host console -- its panels render their own ScrollViews, and only
 * three files use `<Screen>`.
 *
 * 560 and not 402. At exactly the phone's width a laptop shows a strip; 560 is a comfortable form
 * column that still reads as the phone app it is. And on a phone it changes nothing at all,
 * because 402 is narrower -- so every lane-B screenshot and gate is untouched.
 *
 * Modal sheets render in a portal OUTSIDE the root, so each one caps itself with this too.
 * `tests/e2e/desktop-layout.spec.ts` names 560 once and fails if anything is wider.
 */
export const contentMaxWidth = 560;
