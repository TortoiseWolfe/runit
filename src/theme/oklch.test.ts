import { DARK, LIGHT } from './tokens';
import { mix, oklabToSrgbHex, oklchToSrgbHex, srgbHexToOklab } from './oklch';

/**
 * The inverse transform has no canvas to be checked against.
 *
 * `tokens.test.ts` can re-parse `design/theme.css` because the canvas AUTHORS those
 * colours. Nothing authors `srgbHexToOklab` -- it is nine transcribed constants, and a
 * digit typed wrong there produces a colour that is merely slightly off, which looks
 * exactly like a design decision. So the check is a PROPERTY: the two directions must
 * undo each other, over every colour the app actually paints.
 */

const EVERY_TOKEN = [...Object.values(DARK), ...Object.values(LIGHT)];

describe('srgbHexToOklab · the inverse of oklchToSrgb', () => {
  it('round-trips every token in both schemes, byte for byte', () => {
    for (const hex of EVERY_TOKEN) {
      const [l, a, b] = srgbHexToOklab(hex);
      expect(oklabToSrgbHex(l, a, b)).toBe(hex);
    }
  });

  it('round-trips the canvas oklch that base-100 is authored as', () => {
    // dark base-100: oklch(22.84% 0.038 282.93). Forward, then back, then forward again.
    const hex = oklchToSrgbHex(0.2284, 0.038, 282.93);
    expect(hex).toBe(DARK.base100);
    const [l, a, b] = srgbHexToOklab(hex);
    expect(l).toBeCloseTo(0.2284, 3);
    expect(Math.hypot(a, b)).toBeCloseTo(0.038, 3);
  });

  it('reports white as L=1 with no chroma, and black as L=0', () => {
    const [wl, wa, wb] = srgbHexToOklab('#FFFFFF');
    expect(wl).toBeCloseTo(1, 5);
    expect(Math.hypot(wa, wb)).toBeCloseTo(0, 5);
    expect(srgbHexToOklab('#000000')[0]).toBeCloseTo(0, 5);
  });
});

describe('mix · what color-mix(in oklab, ...) computes', () => {
  it('returns the ends untouched', () => {
    expect(mix(DARK.primary, '#FFFFFF', 0)).toBe(DARK.primary);
    expect(mix(DARK.primary, '#FFFFFF', 1)).toBe('#FFFFFF');
  });

  it('clamps rather than extrapolating past either end', () => {
    expect(mix(DARK.primary, '#FFFFFF', -1)).toBe(DARK.primary);
    expect(mix(DARK.primary, '#FFFFFF', 4)).toBe('#FFFFFF');
  });

  it('never darkens anything, in either scheme', () => {
    for (const hex of EVERY_TOKEN) {
      const before = srgbHexToOklab(hex)[0];
      const after = srgbHexToOklab(mix(hex, '#FFFFFF', 0.08))[0];
      expect(after).toBeGreaterThanOrEqual(before);
    }
  });

  /**
   * NOT EVERY COLOUR CAN MOVE, and the first version of the test above asserted otherwise.
   * `LIGHT.neutralContent` is `#F9FAFB`, oklch L 0.985 -- an 8% step toward white there is
   * smaller than one 8-bit step, so the mix is mathematically lighter and quantises back to
   * the same hex. That is a fact about near-white fills, not a bug, and it is the reason
   * this is asserted over the colours a BUTTON can actually be filled with rather than over
   * the whole table: if the fill a screen passes stops taking a top stop, the button has
   * quietly gone flat and nothing else here would say so.
   */
  it.each([
    ['dark', DARK],
    ['light', LIGHT],
  ])('gives a visibly lighter top stop to every fill a button takes (%s)', (_scheme, t) => {
    for (const fill of [t.primary, t.secondary, t.accent, t.error]) {
      const before = srgbHexToOklab(fill)[0];
      const after = srgbHexToOklab(mix(fill, '#FFFFFF', 0.08))[0];
      expect(after - before).toBeGreaterThan(0.002);
    }
  });

  /**
   * THE SPACE IS THE POINT, so something has to fail if it changes. A channel-wise lerp in
   * gamma-encoded sRGB is the obvious wrong implementation and it produces a DIFFERENT
   * colour -- close enough to look plausible in a screenshot, which is why a test says so
   * rather than an eye.
   */
  it('is not a lerp in gamma-encoded sRGB', () => {
    const srgbLerp = (a: string, b: string, t: number) => {
      const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
      const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
      return `#${out.map((n) => n.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
    };
    // Mid-mix, where the two spaces diverge most.
    expect(mix(LIGHT.secondary, '#FFFFFF', 0.5)).not.toBe(srgbLerp(LIGHT.secondary, '#FFFFFF', 0.5));
  });
});
