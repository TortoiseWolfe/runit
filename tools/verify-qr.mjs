#!/usr/bin/env node
/**
 * DECODE the QR the app renders, rather than assert that a component mounted.
 *
 * This is the only check that can catch the failure that matters: a QR encoding the wrong
 * string renders perfectly, scans perfectly, and takes the guest nowhere. An e2e test that
 * finds `[data-testid=event-qr]` proves the box is on screen and nothing about what is in
 * it, and no other lane here can read a barcode -- Chromium's BarcodeDetector is
 * unavailable on this platform (checked).
 *
 *   pnpm verify:qr
 *
 * Drives the web export to the host console, opens the QR, screenshots that element, and
 * decodes the pixels. Exits non-zero if the payload is not the join link for the seeded
 * event.
 */
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

import { serveDir } from './lib/serve.mjs';

const ROOT = join(import.meta.dirname, '..');
const SHOT = join(ROOT, '.qr-verify.png');
// The seeded event the harness boots. Must match fixtures/wedding.ts.
//
// AN HTTPS URL SINCE #33, and that is the thing this lane exists to catch. A QR renders
// and scans perfectly whatever string is inside it, so the payload changing from
// `runit://join?code=…` to a universal link is invisible to every other check -- the box
// looks identical. The old payload was a dead string to anyone without the app, which is
// precisely the person a printed card is handed to.
//
// Read from src/lib/invite.ts rather than typed again here: this file asserting its own
// copy of the format would pass while the app encoded something else entirely.
const INVITE_ORIGIN = /INVITE_ORIGIN = '([^']+)'/.exec(
  readFileSync(join(ROOT, 'src/lib/invite.ts'), 'utf8'),
)?.[1];
if (!INVITE_ORIGIN) {
  console.error('FAIL: could not read INVITE_ORIGIN out of src/lib/invite.ts');
  process.exit(1);
}
const EXPECTED = `${INVITE_ORIGIN}/i/SR1017`;

// IMPORTED, NOT SPAWNED. This used to start `serve-dist.mjs` as a child and scrape its URL
// off stdout -- and that server writes its `No dist/` guard to STDERR before exiting 1, so
// the promise never settled and this lane HUNG instead of failing. Importing also drops the
// fixed port 4173, which `playwright.config.ts` uses too: an open `test:e2e:ui` session
// collided with this.
const server = await serveDir(join(ROOT, 'dist'));
const base = server.url;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 402, height: 874 },
    // 3x so the modules are several pixels wide. A 1x QR decodes unreliably for the same
    // reason a blurry photo of one does.
    deviceScaleFactor: 3,
    colorScheme: 'dark',
  });
  await page.goto(`${base}/join`, { waitUntil: 'networkidle' });
  await page.getByTestId('join-nickname').fill('Riley');
  await page.getByTestId('join-submit').click();
  await page.getByTestId('role-switch').click();
  await page.getByTestId('host-qr-toggle').click();
  await page.waitForSelector('[data-testid="event-qr"]');
  await page.getByTestId('event-qr').screenshot({ path: SHOT });

  const png = PNG.sync.read(readFileSync(SHOT));
  const found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

  if (!found) {
    console.error('\x1b[31mFAIL: the rendered QR could not be decoded at all.\x1b[0m');
    console.error('  It renders, so this is a contrast, quiet-zone or resolution problem —');
    console.error('  exactly what a camera in a dim room would hit.');
    process.exit(1);
  }
  if (found.data !== EXPECTED) {
    console.error('\x1b[31mFAIL: the QR encodes the wrong string.\x1b[0m');
    console.error(`  decoded: ${found.data}`);
    console.error(`  wanted:  ${EXPECTED}`);
    process.exit(1);
  }
  console.log(`\x1b[32mok: the QR decodes to ${found.data}\x1b[0m`);
} finally {
  await browser.close();
  server.close();
  try {
    unlinkSync(SHOT);
  } catch {
    /* the screenshot may not exist if we failed before taking it */
  }
}
