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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
/**
 * APP STORE PRESET. `SHOT_PRESET=appstore` re-runs the same walk at the geometry
 * App Store Connect demands, into a separate directory.
 *
 * 414x896 at deviceScaleFactor 3 is 1242x2688 -- the 6.5" display size Apple lists
 * on the upload panel. The fidelity default is 402x874 @3x = 1206x2622, which is
 * real iPhone 16 Pro geometry and is what design/renders/ is compared against; it
 * is NOT an accepted store size, so the two cannot be the same run.
 *
 * The contrast and colour gates deliberately do NOT apply to this preset: those
 * measure the app against its own design tokens at the fidelity size, and running
 * them at a different viewport would compare a screenshot to a render that was
 * never taken there.
 */
const STORE = process.env.SHOT_PRESET === 'appstore';
const VIEWPORT = STORE ? { width: 414, height: 896 } : { width: 402, height: 874 };
// The insets must match the viewport or content rides under the status bar. 414x896
// is an iPhone 11 Pro Max: top 44, not the 62 of a 16 Pro. Export with
// EXPO_PUBLIC_FIDELITY_FRAME set to this before shooting the store preset.
const FIDELITY_FRAME = STORE ? '414x896x44x34' : '402x874x62x34';
const OUT = join(ROOT, 'design', STORE ? 'appstore' : 'screenshots');
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
    viewport: VIEWPORT,
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

  // The testID of the panel is not always the segment name -- /host/event renders
  // `host-event-details` -- so the pair carries both rather than deriving one.
  for (const [seg, panel, name] of [
    ['dj', 'dj', '03-host-dj'],
    ['photos', 'photos', '03-host-photos'],
    ['event', 'event-details', '03-host-event'],
  ]) {
    await page.click(`[data-testid="host-segment-${seg}"]`);
    await page.waitForSelector(`[data-testid="host-${panel}"]`, { timeout: 30_000 });
    await shot(name);
  }

  // 04 Pricing -- REMOVED with the /pricing route itself in v1. The screen listed
  // $19/$79/$599 and contained no Pressable at all, which is a Guideline 3.1.1 and
  // 2.1 problem rather than a design one. Denials now surface as a toast naming the
  // limit (src/domain/denials.ts), so there is no longer a screen to shoot. The
  // gating is still the product -- host-console.spec.ts proves it fires.

  if (errors.length) {
    console.log(`  [${scheme}] ${errors.length} page error(s):`);
    for (const e of [...new Set(errors)].slice(0, 5)) console.log('    ', e.slice(0, 200));
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(
  `\n${wrote} screenshots -> design/${STORE ? 'appstore' : 'screenshots'}/` +
    ` at ${VIEWPORT.width * 3}x${VIEWPORT.height * 3}, insets ${FIDELITY_FRAME}`,
);

/**
 * PROVENANCE. These PNGs are only comparable to design/renders/ -- or to each
 * other -- within one environment. The app pins no fonts, so glyph widths come
 * from whatever the machine has, and host and container differ by 5.53% of pixels
 * on the join screen. renders/ is committed and was generated on the host in
 * DejaVu. Stamp which machine wrote these so a Lane D read can tell. Issue #6.
 */
const inContainer = existsSync('/.dockerenv');
writeFileSync(
  join(OUT, '.provenance.json'),
  JSON.stringify(
    {
      environment: inContainer ? 'container' : 'host',
      note: inContainer
        ? 'Container fonts (Liberation et al). design/renders/ is DejaVu from the host -- do NOT read these two against each other.'
        : 'Host fonts (DejaVu). Matches design/renders/, so Lane D comparisons are valid.',
      node: process.versions.node,
      shots: shots.length,
    },
    null,
    2,
  ) + '\n',
);
console.log(`provenance: rendered on the ${inContainer ? 'container' : 'host'}`);

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
