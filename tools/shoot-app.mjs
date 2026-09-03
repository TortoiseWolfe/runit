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
  const file = candidates.find((f) => f.startsWith(DIST) && existsSync(f) && extname(f));
  if (!file) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log('serving', base);

const browser = await chromium.launch();
let wrote = 0;

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

  const shot = async (name) => {
    await settled();
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(OUT, `${name}.${scheme}.png`) });
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

  if (errors.length) {
    console.log(`  [${scheme}] ${errors.length} page error(s):`);
    for (const e of [...new Set(errors)].slice(0, 5)) console.log('    ', e.slice(0, 200));
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${wrote} screenshots -> design/screenshots/`);
