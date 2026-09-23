#!/usr/bin/env node
/**
 * How much headroom do the suite's two GEOMETRIC assertions actually have?
 *
 * `tests/e2e/guest-chat.spec.ts:167` and `:228` both count rendered line boxes --
 * they fail when text wraps. Wrapping is a function of glyph widths, and this repo
 * pins no fonts at all: nothing in `src/` declares a `fontFamily`, `dist/` ships no
 * font files, and react-native-web's default stack resolves to whatever the machine
 * happens to have. So those two assertions are the suite's only real exposure to
 * issue #6's host-vs-container divergence, and until this tool existed their margin
 * was asserted rather than measured.
 *
 * Run it in BOTH environments and compare:
 *   node tools/measure-text-margin.mjs
 *   docker compose run --rm checks bash -c 'node tools/measure-text-margin.mjs'
 *
 * Measured 2026-09-23 against the same dist/:
 *   "11:30 PM"  host 65.33px  container 59.39px  column 72px
 *   "8:00 PM"   host 56.42px  container 51.53px  column 72px
 *
 * The container's font was NOT Liberation, which this docblock and FIDELITY note 6
 * both used to say. `fc-match system-ui` answered WenQuanYi Zen Hei, a CJK font, and
 * checks.Dockerfile now pins **Roboto** -- the font Android ships -- with run-checks.sh
 * asserting it. The numbers above are Roboto.
 *
 * The HOST is still the tighter environment and so the worst case available here: it
 * clears the 72px column by 6.67px (9.3%) where Roboto clears it by 12.61px (17.5%).
 * So Android has MORE headroom than this host, not less. SF Pro is unmeasurable here --
 * Apple does not redistribute it -- so iOS remains the open question, as everywhere.
 *
 * Requires a built dist/ (`pnpm export:web`).
 */
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { serveDir } from './lib/serve.mjs';
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const server = await serveDir(DIST);

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 402, height: 874 } });
const page = await ctx.newPage();
await page.goto(`${server.url}/join`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="scheme-probe"]');
await page.fill('[data-testid="join-nickname"]', 'Ada');
await page.click('[data-testid="join-submit"]');
await page.waitForSelector('[data-testid="chat-feed"]');

const fonts = await page.evaluate(() => getComputedStyle(document.body).fontFamily);

// :167 -- the "Full schedule" affordance must render on ONE line.
const label = await page.getByText('Full schedule', { exact: true }).evaluate((el) => {
  const r = document.createRange(); r.selectNodeContents(el);
  const rects = [...r.getClientRects()];
  return { lines: new Set(rects.map(x => Math.round(x.top))).size,
           textW: Math.max(...rects.map(x => x.width)),
           boxW: el.getBoundingClientRect().width };
});

await page.click('[data-testid="now-next-toggle"]');
await page.waitForTimeout(200);

// :228 -- every run-of-show time cell must render on ONE line inside a 72px column.
const times = await page.getByTestId('chat-feed')
  .getByText(/^\d{1,2}:\d{2} [AP]M$/).evaluateAll((els) => els.map((el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    const rects = [...r.getClientRects()];
    return { text: el.textContent.trim(),
             lines: new Set(rects.map(x => Math.round(x.top))).size,
             textW: +Math.max(...rects.map(x => x.width)).toFixed(2),
             colW: +el.getBoundingClientRect().width.toFixed(2) };
  }));

console.log(JSON.stringify({ fonts, label, times }, null, 2));
await browser.close(); server.close();
