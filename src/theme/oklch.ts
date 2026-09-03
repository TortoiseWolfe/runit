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
export function alpha(hex: string, a: number): string {
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
export function albumTileColor(hue: number, isDark: boolean): string {
  return oklchToSrgbHex(isDark ? 0.35 : 0.8, 0.05, hue);
}

/**
 * Host approval-queue thumbnail tint.
 * Canvas: `oklch(${isDark ? 40 : 78}% 0.07 ${hue})`
 */
export function pendingPhotoColor(hue: number, isDark: boolean): string {
  return oklchToSrgbHex(isDark ? 0.4 : 0.78, 0.07, hue);
}

/** The nine fixed hues the canvas cycles for album tiles. */
export const ALBUM_HUES: readonly number[] = [30, 200, 120, 280, 60, 340, 170, 20, 240];

/** Canvas: `hue: (nextPending * 67) % 360` -- hue is DATA, stored on the photo. */
export const hueForPhotoSeq = (seq: number): number => (seq * 67) % 360;
