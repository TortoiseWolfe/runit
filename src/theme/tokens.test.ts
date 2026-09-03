/**
 * THE DESIGN-SOURCE GUARD.
 *
 * Ties every committed hex in tokens.ts back to the imported design file. It
 * re-parses design/theme.css, re-runs the oklch -> sRGB conversion, and fails
 * on any drift. No hand-maintained middle layer: if someone edits a token by
 * hand, or the design is re-imported with different values, this breaks.
 *
 * This is the only automated check that can catch the failure mode that
 * motivated the whole theming approach -- a colour that looks right in a
 * browser and renders transparent on a device.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { oklchToSrgbHex, alpha, albumTileColor, pendingPhotoColor, hueForPhotoSeq } from './oklch';
import { DARK, LIGHT, TOKEN_TO_CSS_VAR, TAB_INACTIVE_SOURCE, type ThemeTokens } from './tokens';

const CSS = readFileSync(join(__dirname, '../../design/theme.css'), 'utf8');

/** Pull one `[data-theme="<name>"] { ... }` declaration block out of the CSS. */
function themeBlock(name: string): string {
  const marker = `[data-theme="${name}"]`;
  const at = CSS.indexOf(marker);
  if (at === -1) throw new Error(`no ${marker} in design/theme.css`);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open, close);
}

/** `--color-primary: oklch(76.05% 0.024 258.37);` -> { '--color-primary': [l,c,h] } */
function parseOklchVars(block: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  const re = /(--color-[a-z0-9-]+)\s*:\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out[m[1]!] = [Number(m[2]) / 100, Number(m[3]), Number(m[4])];
  }
  return out;
}

const SOURCES = {
  dark: parseOklchVars(themeBlock('scripthammer-dark')),
  light: parseOklchVars(themeBlock('scripthammer-light')),
};

describe('oklch -> sRGB conversion', () => {
  const anchors: [string, number, number, number, string][] = [
    ['white', 1, 0, 0, '#FFFFFF'],
    ['black', 0, 0, 0, '#000000'],
    ['red', 0.628, 0.2577, 29.23, '#FF0000'],
    ['green', 0.866, 0.2948, 142.5, '#00FF00'],
  ];
  it.each(anchors)('anchors on %s', (_n, l, c, h, expected) => {
    expect(oklchToSrgbHex(l, c, h)).toBe(expected);
  });

  it('clamps out-of-gamut chroma into sRGB rather than producing garbage', () => {
    const hex = oklchToSrgbHex(0.5, 0.4, 150);
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe.each([
  ['DARK', DARK, SOURCES.dark, 'dark'],
  ['LIGHT', LIGHT, SOURCES.light, 'light'],
] as const)('%s tokens match design/theme.css', (_label, table, sources, scheme) => {
  const entries = Object.entries(TOKEN_TO_CSS_VAR) as [
    Exclude<keyof ThemeTokens, 'tabInactive'>,
    string,
  ][];

  it.each(entries)('%s (%s)', (key, cssVar) => {
    const src = sources[cssVar];
    expect(src).toBeDefined();
    const [l, c, h] = src!;
    expect(table[key]).toBe(oklchToSrgbHex(l, c, h));
  });

  it('derives tabInactive from the canvas expression', () => {
    const [l, c, h] = TAB_INACTIVE_SOURCE[scheme];
    expect(table.tabInactive).toBe(oklchToSrgbHex(l, c, h));
  });

  // Coverage floor. A guard whose selector stops matching passes having
  // measured nothing -- so assert we actually found the sources we checked.
  it('parsed at least 20 colour tokens out of the stylesheet', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(20);
  });
});

describe('runtime-generated colours', () => {
  it('album tiles use 0.05 chroma at 35%/80% lightness', () => {
    expect(albumTileColor(30, true)).toBe(oklchToSrgbHex(0.35, 0.05, 30));
    expect(albumTileColor(30, false)).toBe(oklchToSrgbHex(0.8, 0.05, 30));
  });

  it('pending photos use 0.07 chroma at 40%/78% lightness', () => {
    expect(pendingPhotoColor(200, true)).toBe(oklchToSrgbHex(0.4, 0.07, 200));
    expect(pendingPhotoColor(200, false)).toBe(oklchToSrgbHex(0.78, 0.07, 200));
  });

  it('reproduces the canvas hue sequence for new uploads', () => {
    // Canvas: hue: (nextPending * 67) % 360, seeded at nextPending = 4
    expect([4, 5, 6].map(hueForPhotoSeq)).toEqual([268, 335, 42]);
  });
});

describe('alpha()', () => {
  it('bakes opacity into rgba without touching the channels', () => {
    expect(alpha('#1A1A2E', 0.6)).toBe('rgba(26, 26, 46, 0.6)');
  });

  it('expands 3-digit hex', () => {
    expect(alpha('#FFF', 1)).toBe('rgba(255, 255, 255, 1)');
  });

  it('clamps out-of-range opacity', () => {
    expect(alpha('#000000', 5)).toBe('rgba(0, 0, 0, 1)');
    expect(alpha('#000000', -2)).toBe('rgba(0, 0, 0, 0)');
  });
});
