/**
 * LANE B -- screenshot the built app at the design's exact artboard size.
 *
 * Serves the web export and drives it at 402x874 @3x in both colour schemes.
 * Run `pnpm export:web` first (it must be built with EXPO_PUBLIC_FIDELITY=1 so
 * safe-area-context reports real iPhone geometry instead of zeros).
 *
 * This validates layout, colour, copy and the state machine. It does NOT
 * validate native rendering -- see design/FIDELITY.md.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pixelAt } from './px.mjs';

const require = createRequire(import.meta.url);
let chromium;
for (const spec of ['playwright', '@playwright/test']) {
  try { ({ chromium } = require(spec)); break; } catch {}
}
if (!chromium) { console.error('pnpm add -D @playwright/test'); process.exit(1); }

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'design', 'screenshots');
if (!existsSync(DIST)) { console.error('No dist/. Run: pnpm export:web'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const candidates = [join(DIST, path), join(DIST, `${path}.html`), join(DIST, path, 'index.html')];
  // SPA fallback: web.output is "single", so every route is served by the one
  // index.html and resolved client-side. See design/FIDELITY.md note F for why
  // this is not "static".
  const file = candidates.find((f) => f.startsWith(DIST) && existsSync(f) && extname(f))
    ?? join(DIST, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log('serving', base);

const browser = await chromium.launch();
let wrote = 0;
const shots = [];

for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Wait for the app to RESOLVE the scheme rather than sleeping. The static
  // export serves light-themed HTML (pre-rendered in Node, where there is no
  // matchMedia) and hydration corrects it a beat later; a fixed sleep catches
  // that flash and produces a light screenshot for a dark run.
  const settled = () =>
    page.waitForFunction(
      (want) => document.querySelector('[data-testid="scheme-probe"]')?.textContent === want,
      scheme,
      { timeout: 30_000 },
    );

  // The join toast lives 2.2s and survives a tab switch, so without this every
  // subsequent screenshot carries a stale toast over the composer.
  const toastGone = () =>
    page.waitForSelector('[data-testid="toast"]', { state: 'detached', timeout: 6000 })
      .catch(() => {});

  const shot = async (name) => {
    await settled();
    await toastGone();
    await page.waitForTimeout(150);
    const file = join(OUT, `${name}.${scheme}.png`);
    await page.screenshot({ path: file });
    shots.push({ file, scheme, name });
    wrote++; console.log('  wrote', `${name}.${scheme}`);
  };

  // 01 Join
  await page.goto(`${base}/join`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="join-submit"]', { timeout: 30_000 });
  await shot('01-join');

  // Join for real, so the guarded routes are reachable.
  await page.fill('[data-testid="join-nickname"]', 'Ada');
  await page.click('[data-testid="join-submit"]');
  await page.waitForSelector('[data-testid="chat-feed"]', { timeout: 30_000 });
  await shot('02-guest-chat');

  await page.click('[data-testid="now-next-toggle"]');
  await shot('02-guest-chat-schedule-open');
  await page.click('[data-testid="now-next-toggle"]');

  for (const [tab, name] of [['photos', '02-guest-photos'], ['music', '02-guest-music']]) {
    await page.click(`[data-testid="tab-${tab}"]`);
    await shot(name);
  }

  // 03 Host console. The canvas puts guest and host on one sheet; the app needs
  // an explicit switch, which is also how the harness reaches these artboards.
  await page.click('[data-testid="tab-chat"]');
  await page.click('[data-testid="role-switch"]');
  await page.waitForSelector('[data-testid="host-broadcast"]', { timeout: 30_000 });
  await shot('03-host-broadcast');

  for (const [seg, name] of [['dj', '03-host-dj'], ['photos', '03-host-photos']]) {
    await page.click(`[data-testid="host-segment-${seg}"]`);
    await page.waitForSelector(`[data-testid="host-${seg}"]`, { timeout: 30_000 });
    await shot(name);
  }

  // 04 Pricing
  await page.goto(`${base}/pricing`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pricing"]', { timeout: 30_000 });
  await shot('04-pricing');

  // 04b The same screen as a guest actually reaches it -- turned away by a
  // limit, with the denial headline in place of the marketing blurb and the
  // tier that lifts it ringed. The gating is the product; a ladder screenshot
  // with no denial on it does not show the product working.
  await page.goto(`${base}/pricing?reason=limit&detail=guests&highlight=event`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('[data-testid="pricing"]', { timeout: 30_000 });
  await shot('04-pricing-paywall');

  if (errors.length) {
    console.log(`  [${scheme}] ${errors.length} page error(s):`);
    for (const e of [...new Set(errors)].slice(0, 5)) console.log('    ', e.slice(0, 200));
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${wrote} screenshots -> design/screenshots/`);

/**
 * COLOUR GATE.
 *
 * Read the painted background back out of each PNG and check it is the right
 * theme's base-100. This is not belt-and-braces: a static web export served
 * light-themed HTML that React never repainted, so every dark screenshot came
 * out light while the app's own state said "dark". The DOM lied; only the
 * pixels told the truth.
 */
const BASE100 = { dark: '#1A1A2E', light: '#F5F0EB' };
const wrong = shots.filter((s) => pixelAt(s.file, 20, 1400) !== BASE100[s.scheme]);
if (wrong.length) {
  console.error(`\nFAIL: ${wrong.length} screenshot(s) painted the wrong theme:`);
  for (const s of wrong) {
    console.error(`  ${s.name}.${s.scheme}: ${pixelAt(s.file, 20, 1400)}, expected ${BASE100[s.scheme]}`);
  }
  process.exit(1);
}
console.log(`colour gate: all ${shots.length} screenshots painted the expected base-100`);
