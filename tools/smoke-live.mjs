#!/usr/bin/env node
/**
 * LANE H -- the adapter that actually ships, against the database that actually ships.
 *
 * ISSUE #20, and the reason it kept getting quoted. Every one of the 262 Playwright
 * journeys boots `MemoryRepository`. They prove the SCREENS and say nothing about
 * `SupabaseRepository` -- and three separate bugs this month were invisible to a green
 * board for exactly that reason: a founder stranded in her own console (#37), "seen by 0"
 * forever (#24), and a role switch that could only ever refuse (#29). Each was found by
 * holding a phone.
 *
 * WHAT ONLY THIS LANE CAN SEE, which is the whole justification for pointing tests at a
 * live project:
 *
 *   1. RPC ARGUMENT NAMES. PostgREST resolves overloads by argument NAME, so `p_titel`
 *      is not a type error -- it is a 404 at runtime against a function that exists.
 *      Nothing in TypeScript checks this; `database.types.ts` is hand-written.
 *   2. COLUMN NAMES AND FILTERS. `FakeClient` records what was sent and never evaluates
 *      it. A `.eq('event', id)` that should be `event_id` passes every unit test.
 *   3. RLS ADMITTING WHAT THE APP NEEDS. Lane E proves policies REFUSE the right things
 *      by forging claims inside a transaction. It does not drive the app, and forged
 *      claims bypass GoTrue entirely -- sixteen assertions once passed against a project
 *      where `signInAnonymously()` had never succeeded.
 *   4. ANONYMOUS SIGN-IN ITSELF, which is a dashboard toggle no token can flip and which
 *      was OFF while build #3 shipped.
 *
 * WHY IT RUNS AGAINST THE LIVE PROJECT, AND WHAT THAT COSTS. The free plan counts paused
 * projects toward its two-project limit, so this organisation cannot hold a third; a
 * dedicated test project is $0 and simply unavailable. The costs are real and accepted
 * rather than discovered later:
 *
 *   - Every run signs in ANONYMOUSLY, and Supabase never garbage-collects those users.
 *   - Every run leaves one event, one folder, one host seat and one guest behind.
 *
 * So this suite is deliberately NON-DESTRUCTIVE -- it touches nothing that already exists.
 * It creates its own event, works only inside it, and prints the code so it can be swept.
 * It never rotates a key, closes an event, moderates a photo or writes to a seeded row.
 * `docs/smoke-live.md` has the cleanup SQL.
 *
 * IT SKIPS LOUDLY, exactly as lane E does and for the same reason: the credentials are in
 * `.env.local`, CI has no secret store, and a gate that fails closed without them gets
 * switched off within a week.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist-live');

/** `.env.local` is where this repo already keeps the project URL and publishable key. */
function envLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const t = readFileSync(join(ROOT, '.env.local'), 'utf8');
    return (t.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '').trim();
  } catch {
    return '';
  }
}

const url = envLocal('EXPO_PUBLIC_SUPABASE_URL');
const key = envLocal('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

if (!url || !key) {
  console.log('\x1b[33mSKIPPED: live adapter smoke (lane H)\x1b[0m');
  console.log('  EXPO_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY are not set, so NOTHING HERE');
  console.log('  EXERCISED SupabaseRepository. Every other Playwright run in this suite');
  console.log('  boots MemoryRepository and proves the screens only -- issue #20.');
  process.exit(0);
}
if (!existsSync(DIST)) {
  console.log('\x1b[33mSKIPPED: live adapter smoke (lane H)\x1b[0m');
  console.log('  No dist-live/. Run: pnpm export:web:live');
  console.log('  (a separate output directory from dist/, because that one is built');
  console.log('   against MemoryRepository and the 262 journeys depend on it)');
  process.exit(0);
}

let chromium;
for (const spec of ['playwright', '@playwright/test']) {
  try { ({ chromium } = require(spec)); break; } catch {}
}
if (!chromium) { console.error('pnpm add -D @playwright/test'); process.exit(1); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const candidates = [join(DIST, path), join(DIST, `${path}.html`), join(DIST, path, 'index.html'), join(DIST, 'index.html')];
  for (const f of candidates) {
    try {
      const body = await readFile(f);
      res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
      res.end(body);
      return;
    } catch {}
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (ok, what, detail = '') => {
  results.push({ ok, what, detail });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${what}${detail ? ` (${detail})` : ''}`);
};

const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const EVENT_NAME = `smoke ${STAMP}`;
const ANNOUNCEMENT = `Smoke ${STAMP}: the cake is real.`;
const SONG = `Smoke ${STAMP}`;

console.log(`\nlane H -- ${url.replace(/https:\/\/([a-z0-9]{6}).*/, 'https://$1…')}, event "${EVENT_NAME}"\n`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let code = '';
try {
  // ---------------------------------------------------------------- create
  await page.goto(`${base}/create`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="scheme-probe"]', { timeout: 30_000 });
  await page.getByTestId('create-host-name').fill('Smoke Host');
  await page.getByTestId('create-name').fill(EVENT_NAME);
  await page.getByTestId('create-date').fill('2026-12-31');
  await page.getByTestId('create-time').fill('19:00');
  await page.getByTestId('create-venue').fill('The test flat');
  await page.getByTestId('create-submit').click();

  // create_event is the whole supply path in one call: anonymous sign-in, the RPC and
  // its p_ argument names, the event row, a folder, active_folder_id, the founding host
  // seat, and a bcrypt'd recovery key.
  await page.waitForSelector('[data-testid="created-key"]', { timeout: 45_000 });
  code = (await page.getByTestId('created-code').innerText()).trim();
  check(/^[A-HJ-NP-Z2-9]{6}$/.test(code), 'create_event ran against Postgres and returned a code', code);

  await page.getByTestId('created-continue').click();
  await page.waitForSelector('[data-testid="host-broadcast"]', { timeout: 30_000 });
  check(true, 'the founder lands in her own host console, so is_host() matched');

  // ------------------------------------------------------------- broadcast
  await page.getByTestId('broadcast-draft').fill(ANNOUNCEMENT);
  await page.getByTestId('broadcast-send').click();
  await page.waitForFunction(
    (body) => document.body.innerText.includes(body),
    ANNOUNCEMENT,
    { timeout: 20_000 },
  );
  check(true, 'a broadcast inserts and comes back through the realtime channel');

  // ----------------------------------------------------------- guest view
  // #37 against the real backend: create_event mints her no `guests` row, so this is
  // join_event being called on demand -- and `guest_seats()` deciding it is not a guest
  // arriving. Only this lane can see either.
  await page.getByTestId('role-switch').click();
  await page.waitForSelector('[data-testid="chat-feed"]', { timeout: 30_000 });
  check(true, 'a founder can take a seat and reach the guest side (#37)');

  const feed = await page.getByTestId('chat-feed').innerText();
  check(feed.includes(ANNOUNCEMENT), 'and the announcement is readable from the guest side');

  const headcount = await page.getByTestId('guest-count-pill').innerText();
  check(headcount.trim().startsWith('0'), 'her seat is not counted in the room (#37)', headcount.trim());

  // ------------------------------------------------------------- a request
  // request_song is the newest RPC in the schema and the least proven: an upsert on a
  // partial unique index, reporting which branch ran through `xmax = 0`.
  await page.getByTestId('tab-music').click();
  await page.getByTestId('request-input').fill(`${SONG} - Smoke Test`);
  await page.getByTestId('request-submit').click();
  await page.waitForFunction(
    (title) => document.body.innerText.includes(title),
    SONG,
    { timeout: 20_000 },
  );
  check(true, 'request_song inserts and the queue re-renders (#44)');

  // THE FIRST TOAST HAS TO GO FIRST, and this cost a run. It lives ~2.2s, the second
  // request is issued well inside that, and `waitForSelector('[data-testid="toast"]')`
  // then resolves instantly against the STALE one -- reading "Request sent to the DJ"
  // and reporting the merge as broken while the database had merged correctly. Exactly
  // the trap `shoot-app.mjs` already documents for screenshots; it does not stop being
  // true because the lane is new.
  await page.waitForSelector('[data-testid="toast"]', { state: 'detached', timeout: 15_000 });

  // The merge branch, which no unit test can reach without a real unique index.
  await page.getByTestId('request-input').fill(`  ${SONG.toLowerCase()}!  - smoke test`);
  await page.getByTestId('request-submit').click();
  await page.waitForSelector('[data-testid="toast"]', { timeout: 20_000 });
  const toast = await page.getByTestId('toast').innerText();
  check(/already in the queue/i.test(toast), 'and asking again merges rather than splitting the vote', toast.trim());

  check(errors.length === 0, 'no page errors during the journey', errors.slice(0, 2).join(' | '));
} catch (e) {
  check(false, 'the journey completed', String(e).split('\n')[0]);
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok).length;
console.log('');
if (code) {
  console.log(`  event "${EVENT_NAME}" (${code}) was left behind. See docs/smoke-live.md to sweep it.`);
}
if (failed) {
  console.error(`\x1b[31mFAIL: ${failed} of ${results.length} live-adapter checks failed.\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mlane H: ${results.length} live-adapter checks passed against the shipping backend.\x1b[0m`);
