import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BASE100_SOURCE, DEPTH, DEPTH_CSS, type Depth } from './depth';
import type { BoxShadowValue } from 'react-native';
import { DARK, LIGHT } from './tokens';
import { oklchToSrgbHex } from './oklch';

/**
 * The depth inks are DERIVED from base-100, so nothing ties them to the design unless
 * something checks. This is that check, and it is the same shape as `tokens.test.ts`
 * re-parsing `theme.css` and `tiers.test.ts` re-parsing the migration's seed.
 *
 * Without it, `BASE100_SOURCE` is a pair of numbers somebody typed once. The canvas could
 * change base-100 tomorrow and every shadow in the app would go on describing the old
 * ground -- silently, because a wrong shadow looks like a shadow.
 */
const CSS = readFileSync(join(__dirname, '../../design/theme.css'), 'utf8');

/** Same slice as tokens.test.ts: first `{` to the first `}` of the theme's block. */
function themeBlock(theme: string): string {
  const at = CSS.indexOf(`[data-theme="${theme}"]`);
  if (at === -1) throw new Error(`no block for ${theme}`);
  const open = CSS.indexOf('{', at);
  return CSS.slice(open, CSS.indexOf('}', open));
}

function base100Of(theme: string): [number, number, number] {
  const m = /--color-base-100\s*:\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(
    themeBlock(theme),
  );
  if (!m) throw new Error(`no --color-base-100 in ${theme}`);
  return [Number(m[1]) / 100, Number(m[2]), Number(m[3])];
}

describe.each([
  ['dark', 'scripthammer-dark', DARK] as const,
  ['light', 'scripthammer-light', LIGHT] as const,
])('depth · %s', (scheme, themeName, table) => {
  it('derives its inks from the base-100 the canvas actually declares', () => {
    expect(BASE100_SOURCE[scheme]).toEqual(base100Of(themeName));
  });

  it('the source it uses is the same colour the token table paints', () => {
    const [l, c, h] = BASE100_SOURCE[scheme];
    expect(oklchToSrgbHex(l, c, h)).toBe(table.base100);
  });

  it('every primitive carries BOTH inks, so neither scheme relies on one alone', () => {
    const d = DEPTH[scheme];
    for (const [name, layers] of Object.entries(d) as [keyof Depth, BoxShadowValue[]][]) {
      const colours = layers.map((layer) => String(layer.color));
      // The edge is the only layer with no blur and a 1px offset; the rest are shadow.
      const hasEdge = layers.some((layer) => layer.blurRadius === 0);
      const hasShadow = layers.some((layer) => layer.blurRadius !== 0);
      expect(`${name}:edge=${hasEdge}`).toBe(`${name}:edge=true`);
      expect(`${name}:shadow=${hasShadow}`).toBe(`${name}:shadow=true`);
      expect(colours.every((colour) => colour.startsWith('rgba('))).toBe(true);
    }
  });

  it('a well and a groove are CUT -- every layer inset; a plate is not', () => {
    expect(DEPTH[scheme].well.every((layer) => layer.inset)).toBe(true);
    expect(DEPTH[scheme].groove.every((layer) => layer.inset)).toBe(true);
    // The plate's drop must fall OUTSIDE it, or it is a well wearing a plate's name --
    // the exact confusion ScriptHammer recorded when both resolved to the same shape.
    expect(DEPTH[scheme].plate.filter((layer) => !layer.inset).length).toBeGreaterThan(0);
  });
});

it('the two schemes do not resolve to the same inks', () => {
  // If they did, one ground would be carrying the other's contrast and the whole
  // two-ink argument would be decoration.
  expect(String(DEPTH.dark.plate[0]!.color)).not.toBe(String(DEPTH.light.plate[0]!.color));
});

it('RN can parse every colour these emit', () => {
  // The one failure mode this repo is shaped around: an unparseable colour renders
  // TRANSPARENT and silently. rgba() is in RN's grammar; oklch() is not.
  const all = [...Object.values(DEPTH.dark), ...Object.values(DEPTH.light)].flat();
  expect(all.length).toBeGreaterThanOrEqual(16);
  for (const layer of all) {
    expect(String(layer.color)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
  }
});

describe.each(['dark', 'light'] as const)('depth · %s · the CSS string', (scheme) => {
  it.each(['plate', 'well', 'groove'] as const)(
    '%s says the same thing as the object form it was generated from',
    (name) => {
      const layers = DEPTH[scheme][name];
      // One colour per layer, and every layer's colour present. Counted on `rgba(`
      // rather than on the `, ` separator: each layer ends with its colour, so the
      // separator is followed by the next layer's offset, never by a colour.
      const colours = DEPTH_CSS[scheme][name].split('rgba(').length - 1;
      expect(colours).toBe(layers.length);
      for (const layer of layers) {
        expect(DEPTH_CSS[scheme][name]).toContain(String(layer.color));
      }
      // `inset` is the keyword the whole cut/raised distinction rests on. A serialiser
      // that dropped it would turn every well into a plate, silently and everywhere.
      const insets = layers.filter((l) => l.inset).length;
      expect(DEPTH_CSS[scheme][name].split('inset').length - 1).toBe(insets);
    },
  );
});
