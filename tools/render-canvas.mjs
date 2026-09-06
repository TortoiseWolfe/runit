/**
 * Render the Claude Design canvas to reference PNGs.
 *
 * The canvas is self-bootstrapping: design/support.js loads React 18 UMD and
 * @babel/standalone from unpkg, transpiles the ios-frame.jsx import, then boots
 * on DOMContentLoaded. So we only have to serve design/ over HTTP (it does
 * fetch(location.href), which file:// forbids) and wait.
 *
 * Requires network access for those CDN loads.
 *
 * Usage: node tools/render-canvas.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { serveDir } from './lib/serve.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DESIGN = join(ROOT, 'design');
const OUT = join(DESIGN, 'renders');
mkdirSync(OUT, { recursive: true });

// `spa: false` and a custom index: this serves the CANVAS, a directory of real files, so a
// missing one must 404 rather than fall back to an SPA shell that does not exist here.
const server = await serveDir(DESIGN, { spa: false, index: 'Runit.dc.html' });
const url = `${server.url}/Runit.dc.html`;
console.log('serving', url);

const browser = await chromium.launch();
let wrote = 0;

for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`  [console] ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load' });

  // Wait for the runtime to fetch React + Babel from CDN, transpile the .jsx,
  // and mount all three IOSDevice frames.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-om-starter="ios-frame"]').length >= 3,
    null, { timeout: 90_000 },
  );
  await page.waitForTimeout(700); // let webfonts/layout settle

  const rootName = await page.evaluate(() => window.__dcRootName());
  const frames = page.locator('[data-om-starter="ios-frame"]');
  const joinFrame = frames.nth(0), guest = frames.nth(1), host = frames.nth(2);

  const out = (name) => join(OUT, `${name}.${scheme}.png`);
  const shot = async (loc, name) => {
    await loc.screenshot({ path: out(name) });
    wrote++; console.log('  wrote', name);
  };

  const setProps = (o) => page.evaluate(
    ([n, ov]) => window.__dcSetProps(n, ov), [rootName, o]);

  // Full sheet
  await page.screenshot({ path: out('00-canvas-full'), fullPage: true });
  wrote++; console.log('  wrote 00-canvas-full');

  // 01 Join
  await shot(joinFrame, '01-join');

  // 02 Guest — tab buttons live in the label row above the frame
  const tabBtn = n => page.getByRole('button', { name: n, exact: true }).first();

  await setProps({ photosVariant: 'album', musicVariant: 'nowplaying' });
  await tabBtn('Chat').click(); await page.waitForTimeout(250);
  await shot(guest, '02-guest-chat');
  await guest.getByRole('button', { name: /Full schedule|Hide/ }).first().click();
  await page.waitForTimeout(250);
  await shot(guest, '02-guest-chat-schedule-open');
  await guest.getByRole('button', { name: /Full schedule|Hide/ }).first().click();

  await tabBtn('Photos').click(); await page.waitForTimeout(250);
  await shot(guest, '02-guest-photos-album');
  await setProps({ photosVariant: 'shutter', musicVariant: 'nowplaying' });
  await page.waitForTimeout(250);
  await shot(guest, '02-guest-photos-shutter');

  await tabBtn('Music').click(); await page.waitForTimeout(250);
  await shot(guest, '02-guest-music-nowplaying');
  await setProps({ photosVariant: 'shutter', musicVariant: 'list' });
  await page.waitForTimeout(250);
  await shot(guest, '02-guest-music-list');

  // 03 Host — segmented control lives inside the frame
  for (const [label, name] of [[/^Broadcast$/, '03-host-broadcast'],
                               [/^DJ queue/, '03-host-dj'],
                               [/^Photos/, '03-host-photos']]) {
    await host.getByRole('button', { name: label }).first().click();
    await page.waitForTimeout(250);
    await shot(host, name);
  }

  // 04 Pricing
  await page.locator('#pricing').screenshot({ path: out('04-pricing') });
  wrote++; console.log('  wrote 04-pricing');

  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${wrote} renders -> design/renders/`);
