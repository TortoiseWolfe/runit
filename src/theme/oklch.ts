/**
 * OKLCH -> sRGB.
 *
 * WHY THIS FILE EXISTS: React Native's colour parser
 * (@react-native/normalize-colors) accepts hex, named colours, rgb/rgba,
 * hsl/hsla and hwb -- and nothing else. Verified empirically against the
 * installed RN 0.86.3: `oklch(...)`, `oklab(...)` and `color(...)` all
 * normalise to `null`, which React Native renders as transparent, silently.
 *
 * Every colour in the Runit design canvas is oklch(), and two families of them
 * are generated at runtime from a hue, so a static lookup table alone is not
 * enough. Hence a real converter.
 *
 * Pipeline: OKLCH -> OKLab -> LMS -> linear sRGB -> gamma-encoded sRGB.
 * Reference: https://bottosson.github.io/posts/oklab/
 */

const clamp255 = (u: number): number => Math.max(0, Math.min(255, Math.round(u * 255)));

/** Linear-light channel -> gamma-encoded sRGB byte. */
function encode(u: number): number {
  const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.abs(u), 1 / 2.4) - 0.055;
  return clamp255(v);
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * @param l Lightness, 0..1 (NOT a percentage -- pass 0.2284 for `22.84%`)
 * @param c Chroma
 * @param h Hue in degrees
 */
export function oklchToSrgb(l: number, c: number, h: number): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;

  const L = lp * lp * lp;
  const M = mp * mp * mp;
  const S = sp * sp * sp;

  return [
    encode(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    encode(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    encode(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  ];
}

/** `oklchToSrgbHex(0.2284, 0.038, 282.93)` -> `'#1A1A2E'` */
export function oklchToSrgbHex(l: number, c: number, h: number): string {
  const [r, g, b] = oklchToSrgb(l, c, h);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/**
 * Bake an opacity into a colour.
 *
 * The canvas leans on CSS `opacity` for its whole type hierarchy (.85, .7, .6,
 * .55, .5, .45). Applying RN's `opacity` style to a <Text> works, but it
 * composites the whole node -- so nested opacities multiply and a parent's
 * fade drags its children with it. Baking alpha into the colour keeps the
 * arithmetic explicit and the result identical. See FIDELITY.md deviation 9.
 */
/**
 * MEMOISED, BECAUSE THE INPUT SPACE IS TINY AND THE CALL SITES ARE NOT. `alpha` has ~165
 * JSX call sites over a few dozen token/level pairs; `albumTileColor` and `pendingPhotoColor`
 * run per tile over 360 hues x 2 schemes; `mix` runs per primary Button render over two
 * fills. The conversions are pure, so a Map keyed on the arguments returns the same string
 * the arithmetic would -- `oklch.test.ts` round-trips every token through them unchanged.
 */
function memo1<A extends (string | number | boolean)[], R>(f: (...a: A) => R): (...a: A) => R {
  const cache = new Map<string, R>();
  return (...a: A) => {
    const k = a.join('\u0000');
    let v = cache.get(k);
    if (v === undefined) {
      v = f(...a);
      cache.set(k, v);
    }
    return v;
  };
}

export const alpha = memo1(alphaRaw);
function alphaRaw(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`;
}

/**
 * Album-grid placeholder tint.
 * Canvas: `oklch(${isDark ? 35 : 80}% 0.05 ${hue})`
 */
export const albumTileColor = memo1(albumTileColorRaw);
function albumTileColorRaw(hue: number, isDark: boolean): string {
  return oklchToSrgbHex(isDark ? 0.35 : 0.8, 0.05, hue);
}

/**
 * Host approval-queue thumbnail tint.
 * Canvas: `oklch(${isDark ? 40 : 78}% 0.07 ${hue})`
 */
export const pendingPhotoColor = memo1(pendingPhotoColorRaw);
function pendingPhotoColorRaw(hue: number, isDark: boolean): string {
  return oklchToSrgbHex(isDark ? 0.4 : 0.78, 0.07, hue);
}

/** The nine fixed hues the canvas cycles for album tiles. */
export const ALBUM_HUES: readonly number[] = [30, 200, 120, 280, 60, 340, 170, 20, 240];

/** Canvas: `hue: (nextPending * 67) % 360` -- hue is DATA, stored on the photo. */
export const hueForPhotoSeq = (seq: number): number => (seq * 67) % 360;

/* ---------------------------------------------------------------------------
 * sRGB -> OKLab, and the mix that needs it.
 *
 * The forward direction above is enough for a colour the canvas AUTHORED, because the
 * canvas writes oklch and we convert it once. It is not enough for a colour DERIVED from
 * another at runtime -- which is what a gradient stop is. `tokens.ts` keeps each token's
 * oklch source in a COMMENT (the test re-parses `theme.css`, not the comment), so at
 * runtime a token is a hex string and nothing else. Lightening it correctly means going
 * back.
 *
 * WHY NOT LERP IN sRGB. Mixing gamma-encoded channels darkens and desaturates through the
 * middle -- the classic muddy midpoint. The design system's own answer is
 * `color-mix(in oklab, ...)`, which appears ~40 times in `design/theme.css` and is how
 * ScriptHammer's raised button gets its top stop. Doing it in a different space here would
 * mean the app's buttons are lit by different physics from everything else in the theme.
 * ------------------------------------------------------------------------ */

/** Gamma-encoded sRGB byte -> linear light. The inverse of `encode` above. */
function decode(u8: number): number {
  const u = u8 / 255;
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * sRGB hex -> OKLab `[L, a, b]`.
 *
 * The matrices are Ottosson's, and they are the inverses of the ones `oklchToSrgb` uses --
 * `oklch.test.ts` proves that by round-tripping every token in the table rather than by
 * trusting the transcription.
 */
export function srgbHexToOklab(hex: string): [number, number, number] {
  const [r8, g8, b8] = parseHex(hex);
  const r = decode(r8);
  const g = decode(g8);
  const b = decode(b8);

  const L = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const M = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const S = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lp = Math.cbrt(L);
  const mp = Math.cbrt(M);
  const sp = Math.cbrt(S);

  return [
    0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp,
    1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp,
    0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp,
  ];
}

/** OKLab `[L, a, b]` -> sRGB hex. Shares the cube/matrix tail of `oklchToSrgb`. */
export function oklabToSrgbHex(l: number, a: number, b: number): string {
  const c = Math.hypot(a, b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return oklchToSrgbHex(l, c, h);
}

/**
 * What CSS `color-mix(in oklab, a ${(1 - t) * 100}%, b)` computes.
 *
 * `t` is how much of `b` lands: `mix(x, '#FFFFFF', 0.08)` is ScriptHammer's
 * `color-mix(in oklab, x 92%, #fff)`, the top stop of every raised button on that site.
 */
export const mix = memo1(mixRaw);
function mixRaw(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const [l1, a1, b1] = srgbHexToOklab(a);
  const [l2, a2, b2] = srgbHexToOklab(b);
  return oklabToSrgbHex(
    l1 + (l2 - l1) * k,
    a1 + (a2 - a1) * k,
    b1 + (b2 - b1) * k,
  );
}
