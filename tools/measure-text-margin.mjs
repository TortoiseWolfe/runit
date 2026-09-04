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
 * Measured 2026-09-03 against the same dist/:
 *   "11:30 PM"       host 65.33px  container 58.89px   column 72px
 *   "Full schedule"  host 78.13px  container 70.72px   1 line in both
 *
 * The HOST is the tighter environment -- DejaVu is wider than Liberation -- so it
 * is the worst case, and it clears the 72px column by 6.67px (9.3%). A font ~10%
 * wider than DejaVu would wrap "11:30 PM" and fail :228. That is the real margin.
 *
 * Requires a built dist/ (`pnpm export:web`).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ttf':'font/ttf' };
const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  for (const p of [join(DIST, url), join(DIST, url, 'index.html'), join(DIST, 'index.html')]) {
    try {
      const body = await readFile(p);
      res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' });
      return res.end(body);
    } catch {}
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(4199, r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 402, height: 874 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4199/join', { waitUntil: 'networkidle' });
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
