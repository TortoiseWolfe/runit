#!/usr/bin/env node
/**
 * Generates the app icon, adaptive-icon foreground and splash mark.
 *
 * WHY PLAYWRIGHT AND NOT AN IMAGE LIBRARY. Playwright is already a pinned
 * dependency of this repo and its browser ships in the checks image, so this
 * adds nothing to install and nothing to keep in sync. sharp/canvas would each
 * be a native module built against a Node this repo pins deliberately.
 *
 * THE MARK. Three stacked rows with the middle one lit and led by a dot: the
 * run of show, which is the app's own central metaphor -- `nowScheduleItemId`
 * drives every guest's Now/Next card, and the whole `would_rewind` guard exists
 * to protect that cursor. It also survives being 40px on a home screen, which
 * a wordmark would not.
 *
 * COLOURS COME FROM THE DARK SCHEME, not from taste: base100 as the ground,
 * secondary for the quiet rows, accent for the live one. Runit is a dark-first
 * app and its icon should not be the one light thing about it.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'assets');
mkdirSync(OUT, { recursive: true });

const GROUND = '#1A1A2E'; // tokens.dark.base100
const QUIET = '#C9B79C'; // tokens.dark.secondary (#E8D4B8) stepped toward the ground
const LIVE = '#38BDF8'; // tokens.dark.accent

/**
 * `bleed` fills the canvas with GROUND. iOS requires a 1024 icon with NO alpha
 * and NO pre-rounded corners -- the system masks it, and baking the radius in
 * produces a visibly double-rounded icon. Android's adaptive foreground is the
 * opposite: it must be transparent and keep its art inside the middle ~66%,
 * because the launcher mask crops hard.
 *
 * GEOMETRY IS CENTRED ARITHMETICALLY, not by eye. The first pass positioned the
 * rows by hand and landed with its centre of mass at x=428 in a 1024 canvas --
 * visibly low and left, with dead space top-right. The bounding box below is
 * computed and then translated, so "centred" is a property rather than a guess.
 *
 * HIERARCHY COMES FROM SIZE, NOT OPACITY. The quiet rows were cream at 0.55
 * over the indigo ground, which composites to #8B807A -- a muddy grey with none
 * of the warmth left. They are now a solid warm value, and the live row leads
 * instead by being half again as tall. That also kills the read the first pass
 * had, where three bars of equal height looked like a hamburger menu.
 */
function markup({ bleed, scale }) {
  const H_QUIET = 60;
  const H_LIVE = 96;
  const GAP = 40;
  const DOT_R = 34;
  const DOT_GAP = 46;

  const rows = [
    { w: 300, h: H_QUIET, c: QUIET, dot: false },
    { w: 460, h: H_LIVE, c: LIVE, dot: true },
    { w: 230, h: H_QUIET, c: QUIET, dot: false },
  ];

  const artH = rows.reduce((a, r) => a + r.h, 0) + GAP * (rows.length - 1);
  const artW = DOT_R * 2 + DOT_GAP + Math.max(...rows.map((r) => r.w));
  // Left edge of the ROWS; the dot hangs to their left, inside the same box.
  const rowX = (1024 - artW) / 2 + DOT_R * 2 + DOT_GAP;

  let y = (1024 - artH) / 2;
  const parts = [];
  for (const r of rows) {
    if (r.dot) {
      parts.push(
        `<circle cx="${rowX - DOT_GAP - DOT_R}" cy="${y + r.h / 2}" r="${DOT_R}" fill="${r.c}"/>`,
      );
    }
    parts.push(
      `<rect x="${rowX}" y="${y}" width="${r.w}" height="${r.h}" rx="${r.h / 2}" fill="${r.c}"/>`,
    );
    y += r.h + GAP;
  }

  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:1024px;height:1024px}
  body{background:${bleed ? GROUND : 'transparent'}}
</style>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    ${parts.join('\n    ')}
  </g>
</svg>`;
}

const TARGETS = [
  // iOS + the universal icon. Full bleed, opaque, no baked radius.
  { file: 'icon.png', bleed: true, scale: 1.18, omitBackground: false },
  // Android adaptive foreground: transparent, art pulled well inside the mask.
  { file: 'adaptive-icon.png', bleed: false, scale: 0.66, omitBackground: true },
  // Splash mark: transparent, centred by Expo over `backgroundColor`.
  { file: 'splash-icon.png', bleed: false, scale: 0.72, omitBackground: true },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
for (const t of TARGETS) {
  await page.setContent(markup({ bleed: t.bleed, scale: t.scale }));
  await page.screenshot({ path: join(OUT, t.file), omitBackground: t.omitBackground });
  console.log(`  wrote assets/${t.file}`);
}
await browser.close();
