import type { BoxShadowValue } from 'react-native';

import { alpha, oklchToSrgbHex } from './oklch';
import type { Scheme } from './ThemeProvider';

/**
 * Depth: a raised PLATE holds content, a cut WELL holds data, a GROOVE holds inputs.
 * One light source, from above.
 *
 * Adopted from ScriptHammer's "Machine Shop" system, and it is worth being exact about
 * what did and did not come across. The IDEA transferred; the MECHANISM could not.
 * ScriptHammer derives its inks live with `oklch(from var(--color-base-100) calc(l * 0.42)
 * c h / 0.55)`. React Native cannot parse `oklch()` at all -- it normalises to `null` and
 * renders transparent, which `tools/audit-native-styles.mjs` fails the build over -- and
 * relative colour syntax has no RN equivalent whatsoever. So the same arithmetic runs
 * HERE, once, at module load, through this repo's own converter.
 *
 * NOT IN `tokens.ts`, and that is deliberate rather than shy. `tokens.test.ts` locks every
 * key of `ThemeTokens` to a `--color-*` var in `design/theme.css`; these are DERIVED from
 * base-100 rather than authored beside it, so putting them there would mean inventing
 * canvas vars to satisfy a test. `fade` in `typography.ts` set this precedent for exactly
 * the same reason -- FIDELITY note H: "This is app code, not a token."
 *
 * WHY TWO INKS, AND WHY THE 32-THEME ARGUMENT STILL APPLIES AT TWO. ScriptHammer's stated
 * reason is that its base-100 lightness spans L=0 to L=1 across 32 themes, so a single ink
 * goes invisible at one end. RunIt has two schemes, which looks like it removes the need --
 * but the two schemes sit at the EXTREMES, which is the same problem with fewer samples.
 * Measured from the values below:
 *
 *   dark   base-100 L 0.228 -> shadow L 0.096 (little room, and it is subtle there)
 *                           -> edge   L 0.653 (large room, and it carries the effect)
 *   light  base-100 L 0.958 -> shadow L 0.402 (large room, it carries the effect)
 *                           -> edge   L 0.981 (almost none, and it all but vanishes)
 *
 * The two ramps trade places between the schemes exactly as designed. A single-ink system
 * would be near-invisible on one of the app's two grounds -- so both primitives keep both
 * inks, and neither scheme was hand-tuned to make that true.
 */

/**
 * base-100's own oklch, per scheme. `depth.test.ts` re-parses `design/theme.css` and fails
 * if either drifts, which is what stops these inks quietly describing a colour the app
 * stopped painting. Same guard, same reason, as `TAB_INACTIVE_SOURCE` in `tokens.ts`.
 */
export const BASE100_SOURCE: Record<Scheme, readonly [number, number, number]> = {
  dark: [0.2284, 0.038, 282.93],
  light: [0.9576, 0.009, 67.72],
};

/** Surface pushed toward black; headroom is L, so it fades out on the dark scheme. */
const SHADOW_L = (l: number) => l * 0.42;
/** Surface pushed toward white -- the machined edge, the lit lip of a cut face. */
const EDGE_L = (l: number) => l + (1 - l) * 0.55;

export interface DepthInks {
  shadow: string;
  shadowSoft: string;
  edge: string;
}

function inksFor(scheme: Scheme): DepthInks {
  const [l, c, h] = BASE100_SOURCE[scheme];
  const shadow = oklchToSrgbHex(SHADOW_L(l), c, h);
  const edge = oklchToSrgbHex(EDGE_L(l), c, h);
  return {
    shadow: alpha(shadow, 0.55),
    shadowSoft: alpha(shadow, 0.32),
    edge: alpha(edge, 0.5),
  };
}

export interface Depth {
  /** Raised: content sits on top of the page. */
  plate: BoxShadowValue[];
  /** Cut: data sits down inside the page. */
  well: BoxShadowValue[];
  /** Machined channel: inputs and thin strips. Pure inset, no outer drop. */
  groove: BoxShadowValue[];
}

/**
 * THE ARRAY FORM IS THE DEFINITION, and `DEPTH_CSS` below is generated from it. The object
 * form is what `BoxShadowValue` documents (`StyleSheetTypes.d.ts:343-351`) and cannot be
 * misread; a string has to survive a parser. Views take the object form. `TextInput` cannot
 * -- `TextStyle.boxShadow` is typed `string` -- which is the only reason the string exists.
 *
 * A cut is the plate inverted, and the physics say so: light from above puts the shadow
 * INSIDE the top edge of a recess and lights its bottom lip. A groove is a tighter well,
 * which is why the two share a shape.
 */
function depthFor(scheme: Scheme): Depth {
  const { shadow, shadowSoft, edge } = inksFor(scheme);
  return {
    plate: [
      { offsetX: 0, offsetY: 6, blurRadius: 12, spreadDistance: -5, color: shadow },
      { offsetX: 0, offsetY: 2, blurRadius: 4, spreadDistance: -2, color: shadowSoft },
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: edge, inset: true },
    ],
    well: [
      { offsetX: 0, offsetY: 8, blurRadius: 16, spreadDistance: -6, color: shadow, inset: true },
      { offsetX: 0, offsetY: 2, blurRadius: 3, spreadDistance: -2, color: shadow, inset: true },
      { offsetX: 0, offsetY: -1, blurRadius: 0, color: edge, inset: true },
    ],
    groove: [
      { offsetX: 0, offsetY: 3, blurRadius: 8, color: shadow, inset: true },
      { offsetX: 0, offsetY: -1, blurRadius: 0, color: edge, inset: true },
    ],
  };
}

export const DEPTH: Record<Scheme, Depth> = {
  dark: depthFor('dark'),
  light: depthFor('light'),
};

/**
 * The same shadows as a CSS string, because `TextStyle.boxShadow` is typed `string` while
 * `ViewStyle`'s takes the object array (`StyleSheetTypes.d.ts:516` against the `TextStyle`
 * branch). A `TextInput` therefore cannot take the object form at all.
 *
 * SERIALISED FROM THE ARRAY rather than written out a second time. Two hand-maintained
 * spellings of one shadow is the drift this repo keeps closing -- `depth.test.ts` asserts
 * the two agree layer for layer, so they cannot separate quietly.
 *
 * WHAT IS UNVERIFIED, and it should be said rather than discovered: no lane here renders
 * iOS, and the only `boxShadow` strings shipping today (`Toast.tsx:74`,
 * `PhotosScreen.tsx:370`) are simple outer drops with no `inset` keyword. Whether RN's
 * string parser handles `inset` on a device is a claim only a build can settle. The object
 * form used on every View is not exposed to that question.
 */
const css = (layers: BoxShadowValue[]): string =>
  layers
    .map((l) =>
      [
        l.inset ? 'inset' : null,
        `${l.offsetX}px`,
        `${l.offsetY}px`,
        `${l.blurRadius ?? 0}px`,
        `${l.spreadDistance ?? 0}px`,
        String(l.color),
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(', ');

export const DEPTH_CSS: Record<Scheme, Record<keyof Depth, string>> = {
  dark: { plate: css(DEPTH.dark.plate), well: css(DEPTH.dark.well), groove: css(DEPTH.dark.groove) },
  light: {
    plate: css(DEPTH.light.plate),
    well: css(DEPTH.light.well),
    groove: css(DEPTH.light.groove),
  },
};
