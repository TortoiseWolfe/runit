#!/usr/bin/env node
/**
 * Build the wall poster the Android emulator's virtual scene shows to the app's camera.
 *
 *   pnpm qr:poster            # writes design/device/qr-poster.png
 *
 * WHY A TOOL AND NOT A SAVED IMAGE. Lane C is the only lane that can point a lens at
 * anything (#42), and the thing worth pointing it at is OUR OWN GENERATOR'S OUTPUT --
 * scanning a QR made by some other library would prove that `expo-camera` reads QRs,
 * which nobody doubts, and nothing about whether `EventQr` and `codeFromScan` agree.
 * So this drives the same web export Lane F decodes, screenshots the same
 * `[data-testid="event-qr"]` element, and mounts it on a poster.
 *
 * IT DECODES THE POSTER BEFORE WRITING IT, and that gate is the whole point of doing
 * this in a script rather than by hand. When a scan fails on the emulator there are two
 * candidate causes -- the app cannot read QRs, or the wall is unreadable -- and they
 * point at completely different fixes. Proving the poster decodes HERE leaves only one.
 *
 * THE QUIET ZONE IS NOT PADDING FOR LOOKS. The spec asks for four modules of clear
 * margin; `EventQr`'s plate gives 12pt, which is enough on a phone screen held close and
 * not enough on a 2m wall seen at an angle across a virtual room. The poster is mostly
 * white on purpose.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

import { serveDir } from './lib/serve.mjs';

const ROOT = join(import.meta.dirname, '..');
const TMP = join(ROOT, '.qr-poster-element.png');
const OUT = join(ROOT, 'design/device/qr-poster.png');

// The poster is square because `Toren1BD.posters` declares the wall poster `size 2 2`;
// a non-square image is stretched onto that plane, and a stretched QR is a broken one.
const SIDE = 1024;
// Fraction of the poster the code itself occupies. The rest is quiet zone.
const FILL = 0.62;

const INVITE_ORIGIN = /INVITE_ORIGIN = '([^']+)'/.exec(
  readFileSync(join(ROOT, 'src/lib/invite.ts'), 'utf8'),
)?.[1];
if (!INVITE_ORIGIN) {
  console.error('FAIL: could not read INVITE_ORIGIN out of src/lib/invite.ts');
  process.exit(1);
}
// Same seeded event as Lane F, and read the same way -- this file keeping its own copy of
// the format would let the poster and the app drift apart silently.
const EXPECTED = `${INVITE_ORIGIN}/i/SR1017`;

const server = await serveDir(join(ROOT, 'dist'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 402, height: 874 },
    // 4x, one more than Lane F. This image gets resampled twice more before a camera sees
    // it -- once onto the poster, once by the virtual scene's renderer.
    deviceScaleFactor: 4,
    colorScheme: 'light',
  });
  await page.goto(`${server.url}/join`, { waitUntil: 'networkidle' });
  await page.getByTestId('join-nickname').fill('Riley');
  await page.getByTestId('join-submit').click();
  await page.getByTestId('role-switch').click();
  await page.getByTestId('host-qr-toggle').click();
  await page.waitForSelector('[data-testid="event-qr"]');
  await page.getByTestId('event-qr').screenshot({ path: TMP });

  const src = PNG.sync.read(readFileSync(TMP));

  // Nearest-neighbour, deliberately. A QR is a grid of hard-edged squares and every
  // smoothing filter softens exactly the edges a decoder is looking for.
  const target = Math.round(SIDE * FILL);
  const scale = Math.min(target / src.width, target / src.height);
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const offX = Math.round((SIDE - w) / 2);
  const offY = Math.round((SIDE - h) / 2);

  const out = new PNG({ width: SIDE, height: SIDE });
  out.data.fill(0xff); // white, opaque

  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const s = (sy * src.width + sx) << 2;
      const d = ((y + offY) * SIDE + (x + offX)) << 2;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = 0xff;
    }
  }

  const buf = PNG.sync.write(out);

  // THE GATE. Decode the poster we are about to write, not the element we screenshotted.
  const check = PNG.sync.read(buf);
  const found = jsQR(new Uint8ClampedArray(check.data), check.width, check.height);
  if (!found) {
    console.error('\x1b[31mFAIL: the poster does not decode.\x1b[0m');
    console.error('  Downscaling to the poster resolution destroyed it — raise SIDE or FILL.');
    process.exit(1);
  }
  if (found.data !== EXPECTED) {
    console.error('\x1b[31mFAIL: the poster encodes the wrong string.\x1b[0m');
    console.error(`  decoded: ${found.data}`);
    console.error(`  wanted:  ${EXPECTED}`);
    process.exit(1);
  }

  mkdirSync(join(ROOT, 'design/device'), { recursive: true });
  writeFileSync(OUT, buf);
  console.log(`\x1b[32mok: ${SIDE}x${SIDE} poster decodes to ${found.data}\x1b[0m`);
  console.log(`  ${OUT}`);
} finally {
  await browser.close();
  server.close();
  try {
    unlinkSync(TMP);
  } catch {
    /* may not exist if we failed before the screenshot */
  }
}
