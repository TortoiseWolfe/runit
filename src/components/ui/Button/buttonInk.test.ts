import { createRequire } from 'node:module';

import { DARK, LIGHT, srgbHexToOklab } from '@/theme';

import { buttonInk } from './buttonInk';

/**
 * `pnpm audit:styles` CANNOT SEE ANY OF THIS, which is the whole reason for the file.
 *
 * That lane scans SOURCE for colour LITERALS and runs each through React Native's own
 * parser, because a colour RN cannot parse normalises to `null` and renders TRANSPARENT
 * with no error. Every colour here is COMPUTED -- `mix()` builds the top stop and `alpha()`
 * builds the glow at runtime -- so there is no literal in the file to match, and a
 * derivation that produced `#NaNNaNNaN` or `rgba(255, 255, 255, )` would sail past a green
 * board and render a button with no face on it.
 *
 * So the same parser, resolved the same way, is pointed at the real output. Resolving it
 * through react-native's own tree rather than by a bare require is not superstition: there
 * are two copies installed (0.86.3 via react-native, 0.74.89 via react-native-web) and
 * `node-linker=hoisted` means a bare require gets whichever won the hoist -- the web
 * renderer's parser being the one this check exists to disbelieve.
 */
const req = createRequire(require.resolve('react-native/package.json'));
const raw = req('@react-native/normalize-colors');
const normalizeColor: (c: string) => number | null = raw.default ?? raw;

const SCHEMES = [
  ['dark', DARK],
  ['light', LIGHT],
] as const;

describe.each(SCHEMES)('buttonInk · %s', (_scheme, t) => {
  const FILLS = [t.primary, t.secondary, t.accent, t.error];

  it('produces only colours React Native can actually parse', () => {
    for (const fill of FILLS) {
      const ink = buttonInk(fill);
      const every = [ink.fill, ink.top, ...ink.glow.map((l) => String(l.color)), ...ink.bevel.map((l) => String(l.color))];
      for (const c of every) {
        expect({ c, parsed: normalizeColor(c) }).toEqual({ c, parsed: expect.any(Number) });
      }
    }
  });

  it('paints the DARKER stop as the solid fill, so the contrast gate reads the worst case', () => {
    for (const fill of FILLS) {
      const ink = buttonInk(fill);
      expect(ink.fill).toBe(fill);
      expect(srgbHexToOklab(ink.top)[0]).toBeGreaterThan(srgbHexToOklab(ink.fill)[0]);
    }
  });

  it('casts a glow in the button OWN colour, not a neutral drop shadow', () => {
    const ink = buttonInk(t.primary);
    const m = /rgba\((\d+), (\d+), (\d+)/.exec(String(ink.glow[0]?.color));
    if (!m) throw new Error(`the glow is not an rgba(): ${String(ink.glow[0]?.color)}`);
    const hex = `#${m.slice(1, 4).map((n) => Number(n).toString(16).toUpperCase().padStart(2, '0')).join('')}`;
    expect(hex).toBe(t.primary);
  });

  /**
   * LIGHT ABOVE, AND THE SIGNS SAY SO. A rim light with a negative offset, or an occlusion
   * with a positive one, is a button lit from below -- which looks merely "off" beside the
   * plates and wells in `depth.ts`, all of which are lit from above. Nothing else here
   * would catch a flipped sign.
   */
  it('is lit from above: rim light on the top edge, occlusion on the bottom', () => {
    const { bevel } = buttonInk(t.primary);
    const rim = bevel.find((l) => String(l.color).startsWith('rgba(255'))!;
    const occlusion = bevel.find((l) => String(l.color).startsWith('rgba(0'))!;
    expect(rim.inset).toBe(true);
    expect(occlusion.inset).toBe(true);
    expect(rim.offsetY).toBeGreaterThan(0);
    expect(occlusion.offsetY).toBeLessThan(0);
  });
});
