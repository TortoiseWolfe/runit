import type { BoxShadowValue } from 'react-native';

import { alpha, mix } from '@/theme';

/**
 * A RAISED BUTTON'S COLOURS, derived from the one colour it is filled with.
 *
 * Ported from ScriptHammer's `sh-btn-primary` (`src/app/globals.css:999`), which is the
 * signature of that design system and the thing the owner asked for by name. Its CSS:
 *
 *   background: linear-gradient(180deg, color-mix(in oklab, X 92%, #fff), X);
 *   box-shadow:
 *     0 18px 34px -12px color-mix(in oklab, X 75%, transparent),
 *     inset 0 1px 0 rgba(255,255,255,0.55),
 *     inset 0 -3px 6px rgba(0,0,0,0.22);
 *
 * Three physical claims, and each maps to one thing below: the face is LIT FROM ABOVE, the
 * object is RAISED so it pools colour beneath itself, and its top rim catches the light
 * while its bottom edge occludes it. Same light source as `depth.ts` -- from above -- which
 * is what stops a button and a plate on the same screen disagreeing about where the sun is.
 *
 * DERIVED AT RUNTIME, NOT LOOKED UP, for the reason `depth.ts` gives at length: React
 * Native cannot parse `oklch()` or `color-mix()` and has no relative-colour syntax, so the
 * arithmetic the browser would do runs here instead. `mix()` is the oklab mix, not an sRGB
 * lerp -- `oklch.test.ts` fails if that changes.
 *
 * THE FILL IS THE DARKER STOP, AND THAT IS LOAD-BEARING FOR A GATE. The gradient is an SVG
 * drawn over the Pressable; `pnpm shots`' contrast gate reads the computed
 * `backgroundColor` and composites the label over it. Painting the gradient's LIGHT stop as
 * the background would hand that gate the best case while a person reads the label against
 * the worst one. So the solid colour underneath is the bottom of the ramp.
 */
export interface ButtonInk {
  /** Solid colour painted under the gradient. The bottom stop, and the contrast gate's reading. */
  fill: string;
  /** The gradient's top stop -- the lit face. */
  top: string;
  /** Sits on the Pressable itself: the coloured pool a raised object casts. */
  glow: BoxShadowValue[];
  /** Sits on a layer ABOVE the gradient: rim light on top, occlusion at the bottom. */
  bevel: BoxShadowValue[];
}

/** `color-mix(in oklab, X 92%, #fff)` -- how much white the lit face carries. */
const TOP_STOP_WHITE = 0.08;
/** `color-mix(in oklab, X 75%, transparent)` -- the glow is the fill, made translucent. */
const GLOW_ALPHA = 0.75;

/**
 * THE ONE LAYER THAT IS NOT ScriptHammer'S NUMBERS, and the colour gate is why.
 *
 * Its button is a compact pill -- `min-height 2.75rem`, `1.875rem` of side padding -- and
 * `0 18px 34px -12px` is the pool an object that size casts. Every button here is FULL
 * WIDTH, so the first port of those numbers spread the glow SIDEWAYS across the page
 * gutter, and `pnpm shots` caught it: `00-host-signin` read base-100 as `#1B1C30` against
 * `#1A1A2E` in dark and `#F2EDE8` against `#F5F0EB` in light. Measured, not predicted --
 * the gate samples one fixed pixel, 6pt from the button's own left edge, and the halo
 * reached it.
 *
 * THAT IS THE BUTTON BEING WRONG, NOT THE GATE BEING FUSSY. base-100 is a token; a control
 * that repaints the page it sits on has overridden the theme, and a soft coloured wash
 * spilling into the margins of a sparse screen is the "confusing mess" this whole arc
 * exists to undo.
 *
 * So the pool is TUCKED: spread it in far enough that its sides never clear the button's
 * own edge, and offset it down far enough that its bottom does. Horizontal reach is
 * `-12 + 18/2 = -3`, three points INSIDE the button, so the sides cannot tint anything.
 * Downward reach is `8 - 12 + 9 = +5`, which is the visible pool. That is also what a wide
 * flat plate actually does under a light from above -- the sideways halo was never physics,
 * it was a pill's numbers on a plank.
 *
 * The gradient and the bevel are what make this thing look raised. The glow is the smallest
 * of the three and the only one that touches the page, so it is the one that yields.
 */
/**
 * Cached per fill. `tokens.primary` has exactly two values, and this used to run two
 * sRGB->OKLab conversions and one back on EVERY render of every primary Button -- per
 * keystroke on the join and create screens, once a second during the sign-in countdown.
 */
const inks = new Map<string, ButtonInk>();
export function buttonInk(fill: string): ButtonInk {
  let ink = inks.get(fill);
  if (!ink) {
    ink = buttonInkRaw(fill);
    inks.set(fill, ink);
  }
  return ink;
}
function buttonInkRaw(fill: string): ButtonInk {
  return {
    fill,
    top: mix(fill, '#FFFFFF', TOP_STOP_WHITE),
    glow: [{ offsetX: 0, offsetY: 8, blurRadius: 18, spreadDistance: -12, color: alpha(fill, GLOW_ALPHA) }],
    bevel: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255, 255, 255, 0.55)', inset: true },
      { offsetX: 0, offsetY: -3, blurRadius: 6, color: 'rgba(0, 0, 0, 0.22)', inset: true },
    ],
  };
}
