#!/usr/bin/env node
/**
 * Generates every icon the app ships, from ONE source of truth:
 * `design/brand/runit-logo.svg`.
 *
 * THE MARK. The capital `I` of RunIt is a spotlight -- a squared amber stem standing on
 * the baseline, wearing a glowing lens where a capital has no business carrying a dot.
 * The beam it throws crosses `Run` and pools under the word. The trick is that the light
 * source and the letter are the same object: remove the lamp and the word is misspelled.
 *
 * WHY PLAYWRIGHT AND NOT AN IMAGE LIBRARY. It is already a pinned dependency of this repo
 * and its browser ships in the checks image, so this adds nothing to install and nothing
 * to keep in sync. sharp/canvas would each be a native module built against a Node this
 * repo pins deliberately.
 *
 * IT WAITS FOR THE ANIMATION TO SETTLE, AND THAT IS LOAD-BEARING. The artwork carries a
 * 6.4s SMIL beam-swing with `fill="freeze"`. Screenshot it at t=0 and you capture a
 * mid-swing beam and a dim lens -- a wrong icon that looks entirely plausible. Measured:
 * the t=0 and settled renders differ (621,790 vs 628,666 bytes). If you ever shorten
 * SETTLE_MS below the animation's duration, every icon silently becomes a frame from the
 * middle of it.
 *
 * IT ASSERTS, IT DOES NOT ONLY WRITE. Nothing in this repo checked these files before --
 * this script was wired to no npm script and no gate, so the icons were generated once
 * and never verified. The checks below are the ones that actually bite:
 *   - iOS REJECTS an icon with an alpha channel, so `icon.png` must be PNG colour type 2.
 *   - Android's launcher mask crops hard, so the adaptive foreground's ink must sit inside
 *     the middle ~66%.
 *   - Android SILHOUETTES a notification icon to flat white by its alpha, so a full-colour
 *     wordmark collapses into an unreadable blob there. It gets its own monochrome mark.
 *   - A rasteriser that produced an empty page would pass every one of those and ship a
 *     black square, so the luminance spread is measured too -- the same reasoning as
 *     `scan-on-device.mjs` measuring that the camera preview paints.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'assets');
const SVG = join(ROOT, 'design', 'brand', 'runit-logo.svg');
mkdirSync(OUT, { recursive: true });

/** The SMIL settle is 6.4s with fill="freeze". Anything less captures a moving beam. */
const SETTLE_MS = 7500;
const SIZE = 1024;

const source = readFileSync(SVG, 'utf8');

const fail = (msg, ...rest) => {
  console.error(`\x1b[31mFAIL: ${msg}\x1b[0m`);
  for (const line of rest) console.error(`  ${line}`);
  process.exit(1);
};
const ok = (msg) => console.log(`\x1b[32m  ok\x1b[0m ${msg}`);

/**
 * The three full-bleed rects ARE the background. Dropping them is what turns the artwork
 * into a foreground, which is what both Android targets need -- the launcher composites
 * its own `adaptiveIcon.backgroundColor`, and Expo composites the splash over
 * `backgroundColor`. Matched on the exact `url(#…)` fills rather than on "the first three
 * rects", so a future rect in the artwork cannot be silently swallowed.
 */
function foregroundOnly(svg) {
  let n = 0;
  const out = svg.replace(
    /\s*<rect width="1024" height="1024" fill="url\(#(background|coolAtmosphere|warmAtmosphere)\)"\/>/g,
    () => {
      n += 1;
      return '';
    },
  );
  if (n !== 3) fail(`expected 3 background rects in the artwork, stripped ${n}`, `check ${SVG}`);
  return out;
}

/** Scale about the centre, so art pulls inside a launcher mask without moving off-centre. */
const scaled = (inner, k) =>
  inner.replace(
    /(<svg[^>]*>)/,
    `$1<g transform="translate(${SIZE / 2} ${SIZE / 2}) scale(${k}) translate(${-SIZE / 2} ${-SIZE / 2})">`,
  ).replace(/<\/svg>\s*$/, '</g></svg>');

/**
 * THE NOTIFICATION MARK IS THE LAMP ALONE, and it is the one place a micro-mark belongs.
 * Android paints notification icons from the ALPHA channel in the system tint, so gradients,
 * glows and the drop shadow all flatten to one colour -- the wordmark would arrive as a
 * smear. The lamp is two shapes and survives that, and it is drawn here rather than cropped
 * out of the logo because the logo's lamp is 86x392 units: no square crop contains it
 * without also importing the `n` and the `t`, which spells nothing.
 *
 * Geometry is taken from the artwork so the two cannot drift: stem x754-820 y367-650,
 * lens cx787 cy301 r43.
 */
function notificationMark() {
  const lamp = { x1: 744, y1: 258, x2: 830, y2: 650 };
  const k = (SIZE * 0.66) / (lamp.y2 - lamp.y1);
  const cx = (lamp.x1 + lamp.x2) / 2;
  const cy = (lamp.y1 + lamp.y2) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <g transform="translate(${SIZE / 2} ${SIZE / 2}) scale(${k}) translate(${-cx} ${-cy})">
    <rect x="754" y="367" width="66" height="283" fill="#FFFFFF"/>
    <circle cx="787" cy="301" r="43" fill="#FFFFFF"/>
  </g>
</svg>`;
}

const page$ = (svg) =>
  `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent}
svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`;

const TARGETS = [
  {
    file: 'icon.png',
    svg: () => source,
    // Full bleed and OPAQUE. iOS rejects an icon with an alpha channel, and the system
    // masks the corners itself -- baking a radius in renders visibly double-rounded.
    omitBackground: false,
    expect: { alpha: false, painted: true },
  },
  {
    file: 'adaptive-icon.png',
    svg: () => scaled(foregroundOnly(source), 0.66),
    omitBackground: true,
    expect: { alpha: true, inkInside: 0.72 },
  },
  {
    file: 'splash-icon.png',
    svg: () => scaled(foregroundOnly(source), 0.78),
    omitBackground: true,
    expect: { alpha: true },
  },
  {
    file: 'notification-icon.png',
    svg: notificationMark,
    omitBackground: true,
    expect: { alpha: true, monochrome: true },
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});

for (const t of TARGETS) {
  await page.setContent(page$(t.svg()));
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: join(OUT, t.file), omitBackground: t.omitBackground });
  console.log(`  wrote assets/${t.file}`);
}
await browser.close();

// ---------------------------------------------------------------- the assertions

for (const t of TARGETS) {
  const raw = readFileSync(join(OUT, t.file));
  // Colour type lives at byte 25 of a PNG: 2 = RGB, 6 = RGBA. This is the one that gets a
  // build rejected by App Store Connect, and it is four bytes of reading.
  const colourType = raw[25];
  const png = PNG.sync.read(raw);

  if (png.width !== SIZE || png.height !== SIZE) {
    fail(`${t.file} is ${png.width}x${png.height}, expected ${SIZE}x${SIZE}`);
  }

  if (t.expect.alpha === false && colourType !== 2) {
    fail(
      `${t.file} has an alpha channel (PNG colour type ${colourType})`,
      'iOS rejects a transparent app icon -- App Store Connect refuses the build.',
    );
  }
  if (t.expect.alpha === true && colourType !== 6) {
    fail(`${t.file} is opaque (PNG colour type ${colourType}), expected RGBA`);
  }

  // Ink = anything not fully transparent, and where it is on the canvas.
  let minX = SIZE, minY = SIZE, maxX = 0, maxY = 0, ink = 0;
  const lum = [];
  for (let y = 0; y < SIZE; y += 2) {
    for (let x = 0; x < SIZE; x += 2) {
      const i = (y * SIZE + x) << 2;
      const [r, g, b, a] = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
      if (a > 8) {
        ink += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    }
  }
  if (ink === 0) fail(`${t.file} is entirely transparent -- nothing rendered`);

  if (t.expect.painted) {
    // A blank or flat render passes every check above and ships a solid square. A dead
    // surface is uniform: near-zero spread. Same reasoning as the camera-preview check.
    const mean = lum.reduce((a, v) => a + v, 0) / lum.length;
    const sd = Math.sqrt(lum.reduce((a, v) => a + (v - mean) ** 2, 0) / lum.length);
    if (sd < 12) fail(`${t.file} looks unpainted (luminance spread ${sd.toFixed(1)})`);
    ok(`${t.file} painted (mean ${mean.toFixed(1)}, spread ${sd.toFixed(1)}), no alpha`);
  }

  if (t.expect.inkInside) {
    // The launcher mask crops hard; art outside the safe zone loses its edges.
    const widest = Math.max(maxX - minX, maxY - minY) / SIZE;
    if (widest > t.expect.inkInside) {
      fail(
        `${t.file} ink spans ${(widest * 100).toFixed(0)}% of the canvas`,
        `Android's launcher mask crops beyond ~${t.expect.inkInside * 100}%.`,
      );
    }
    ok(`${t.file} ink spans ${(widest * 100).toFixed(0)}%, inside the launcher mask`);
  }

  if (t.expect.monochrome) {
    // Android paints this from the alpha channel in the system tint. Anything that is not
    // white here is a colour nobody will ever see, and a sign the wrong art got used.
    const coloured = lum.filter((v) => v < 250).length;
    if (coloured > 0) {
      fail(`${t.file} has ${coloured} non-white pixels`, 'Android silhouettes this to flat white.');
    }
    ok(`${t.file} is flat white on transparent, as Android will paint it`);
  }

  if (!t.expect.painted && !t.expect.inkInside && !t.expect.monochrome) {
    ok(`${t.file} ${png.width}x${png.height}, RGBA`);
  }
}

// The palette is reported rather than asserted: a brand colour changing is a decision, and
// a diff is where a decision should be visible. A gate here would only be re-run and raised.
const palette = [...new Set(source.match(/#[0-9A-Fa-f]{6}/g) ?? [])].sort();
console.log(`\n  ${palette.length} colours in the artwork: ${palette.join(' ')}`);
console.log('\x1b[32mevery icon written and checked\x1b[0m');
