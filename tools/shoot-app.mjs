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

/**
 * CONTRAST PROBE (WCAG 2.1 SC 1.4.3, Level AA).
 *
 * Unlike touch targets -- which react-native-web drops `hitSlop` for, making this
 * lane structurally blind -- contrast IS honestly measurable here. `alpha()` emits
 * a real `rgba()` and the backgrounds are real painted DOM backgrounds, so
 * compositing computed colour over the nearest opaque ancestor is measuring the
 * truth rather than approximating it.
 *
 * Runs on every screen the harness already visits, in both schemes.
 */
async function auditContrast(page) {
  return page.evaluate(() => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].split(',').map((v) => parseFloat(v));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    // First ancestor that actually paints. Stop before <body>: the theme provider
    // paints base-100 onto body itself, so a walk that reaches it always "finds"
    // a plausible ground and can never report a failure.
    const backdrop = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.95) return c;
      }
      const c = parse(getComputedStyle(document.body).backgroundColor);
      return c && c.a > 0.95 ? c : null;
    };

    const out = [];
    for (const el of document.querySelectorAll('*')) {
      // Leaf text only, and only what is actually on screen.
      if (el.children.length) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) continue;
      // The fidelity harness renders an invisible scheme probe; it is not UI.
      if (el.getAttribute('data-testid') === 'scheme-probe') continue;

      const fg = parse(st.color);
      const bg = backdrop(el);
      if (!fg || !bg) continue;

      const comp = over(fg, bg);
      const l1 = Math.max(lum(comp), lum(bg));
      const l2 = Math.min(lum(comp), lum(bg));
      const ratio = (l1 + 0.05) / (l2 + 0.05);

      // SC 1.4.3: 3:1 for large text (>=18pt, or >=14pt bold), else 4.5:1.
      const size = parseFloat(st.fontSize);
      const bold = parseInt(st.fontWeight, 10) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;

      if (ratio + 0.005 < need) {
        out.push({ text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, size });
      }
    }
    return out;
  });
}

const contrast = [];

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
    contrast.push(...(await auditContrast(page)).map((f) => ({ ...f, scheme, name })));
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

// CONTRAST GATE. Deduped: the same string on the same screen in both schemes is
// one defect, not two.
const seen = new Map();
for (const f of contrast) {
  seen.set(`${f.scheme}|${f.name}|${f.text}|${f.ratio}`, f);
}
const fails = [...seen.values()];
if (fails.length) {
  console.error(`\nFAIL: ${fails.length} text/background pair(s) below WCAG AA:`);
  for (const f of fails.sort((a, b) => a.ratio - b.ratio)) {
    console.error(
      `  ${f.ratio}:1 (needs ${f.need}:1)  ${f.scheme}/${f.name}  ${f.size}px  "${f.text}"`,
    );
  }
  process.exit(1);
}
console.log(`contrast gate: every rendered text pair clears WCAG AA across ${shots.length} screens`);
