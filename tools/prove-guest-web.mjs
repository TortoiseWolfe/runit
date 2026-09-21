#!/usr/bin/env node
/**
 * DOES THE GUEST BUILD RUN? Not "does it export" -- does a person land in a party (#78).
 *
 * `pnpm export:web:guest` produces a bundle, and `pnpm audit:guest-build` proves that bundle
 * is not the harness one. Neither proves it WORKS: a build that exports cleanly and boots to
 * a white screen passes both. This drives a real browser at it and asserts four things that
 * are each false in a different failure.
 *
 * AGAINST A LOCAL SUPABASE STACK, AND THAT IS THE WHOLE REASON THIS EXISTS RATHER THAN A
 * LANE-H FLAG. Booting this app signs in anonymously before a person can do anything, so
 * pointing the measurement at production would write an `auth.users` row Supabase never
 * collects, plus an event, on every run -- the cost `docs/smoke-live.md` accepts for lane H
 * because only production can answer what lane H asks. Nothing here needs production. So
 * this is free, repeatable, destroys nothing, and can be run on every change instead of
 * before a build.
 *
 * IT REFUSES A NON-LOOPBACK URL, and that is not ceremony. It CREATES AN EVENT. A pasted
 * production URL would quietly add rows to the live project while printing the same green
 * lines, which is exactly the class of accident `smoke-live.mjs` running on import already
 * cost this repo one event (`ZZANV9`).
 *
 * NO CLEANUP, deliberately. The local stack is disposable -- `pnpm supabase db reset --local`
 * rebuilds it from the committed migration in seconds -- so a sweep here would be machinery
 * guarding nothing. Lane H sweeps because it cannot reset production.
 *
 * Recipe and ports: `docs/guest-web.md`.
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serveDir } from './lib/serve.mjs';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist-guest');

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;

/*
 * The ports come from `supabase/config.toml`, so they cannot drift from the stack this repo
 * actually starts. Read rather than hardcoded -- the same reason `tiers.test.ts` re-parses the
 * migration's seed instead of copying its numbers.
 */
const toml = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');
const apiPort = toml.match(/\[api\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];
if (!apiPort) {
  console.error(red('FAIL: no [api] port in supabase/config.toml, so the local stack cannot be addressed.'));
  process.exit(1);
}

const API = arg('api', `http://127.0.0.1:${apiPort}`);
const KEY = arg('key', process.env.LOCAL_PUBLISHABLE_KEY ?? '');

const host = new URL(API).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(red(`REFUSED: --api points at ${host}, which is not loopback.`));
  console.error('  This creates an event. Against a real project that is a row somebody has to sweep.');
  console.error('  Lane H is the tool that writes to production, on purpose: pnpm smoke:live');
  process.exit(1);
}
if (!KEY) {
  console.error(yellow('SKIPPED: no publishable key for the local stack, so nothing was measured.'));
  console.error('  Start it and pass the key it prints:');
  console.error('    pnpm supabase start');
  console.error('    pnpm prove:guest --key=sb_publishable_…');
  process.exit(1);
}

/** One event, made the way the app makes it: anonymous session, then `create_event`. */
async function seedEvent() {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const session = await r.json().catch(() => ({}));
  const jwt = session.access_token;
  if (!jwt) throw new Error(`no anonymous session (${r.status}). Is enable_anonymous_sign_ins on?`);

  // A NAME NO FIXTURE HAS. `weddingSeed` is "Sam & Riley's Wedding" and `housePartySeed` has
  // its own -- so reading THIS back off the screen is what proves the row came from Postgres
  // rather than from MemoryRepository. A generic name would prove nothing.
  const name = `Local Proof ${new Date().toISOString().slice(11, 19)}`;
  const res = await fetch(`${API}/rest/v1/rpc/create_event`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_name: name,
      p_starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      p_timezone: 'America/New_York',
      p_venue: 'A laptop',
      p_doors_label: 'Doors 7:00 PM',
      p_host_name: 'Local Host',
    }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`create_event ${res.status}: ${JSON.stringify(out).slice(0, 200)}`);
  const row = Array.isArray(out) ? out[0] : out;
  return { code: row.code, name };
}

const { code, name } = await seedEvent();
console.log(`  seeded ${code} on the local stack -- "${name}"`);

const server = await serveDir(DIST);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 180)));

let failure = null;
try {
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });

  // 1. IT BOOTS. A white screen and a crashed bundle both fail here.
  await page.waitForSelector('[data-testid="join-submit"]', { timeout: 45_000 });
  console.log(green('  1. booted, and the join screen rendered'));

  // 2. IT JOINS, AND THE PARTY IS THE ONE IN POSTGRES. `weddingSeed` is "Sam & Riley's
  //    Wedding"; this name exists in no fixture, so reading it off the screen is what proves
  //    the row came from the database rather than from MemoryRepository -- which would render
  //    a perfectly good party and satisfy every other DOM assertion here.
  await page.getByTestId('join-code').fill(code);
  await page.getByTestId('join-nickname').fill('Local Guest');
  await page.getByTestId('join-submit').click();
  await page.waitForFunction((n) => document.body.innerText.includes(n), name, { timeout: 30_000 });
  console.log(green(`  2. joined ${code}, and the screen names the event row: "${name}"`));

  /*
   * 3. AND THE JOIN IS WHAT MINTED THE SESSION -- checked AFTER the join, deliberately.
   *
   * The first draft asserted this on BOOT and failed, and the app was right. Sign-in here is
   * LAZY: `signInAnonymously()` sits on the join path, so a cold visitor holds the `anon` role
   * until they type a code. Asserting a session on boot measured an eagerness this app does
   * not have and never claimed -- the tool was wrong, not the build. It still catches the
   * failure it was written for, because MemoryRepository writes no `sb-` key ever.
   */
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('sb-')).length);
  if (keys === 0) throw new Error('no GoTrue session after joining -- this bundle is not the backend build');
  console.log(green(`  3. the join minted ${keys} GoTrue session key(s) -- a real Supabase session`));

  // 4. AND THE HARNESS IS NOT IN IT. `scheme-probe` renders only under EXPO_PUBLIC_FIDELITY=1
  //    (`src/app/_layout.tsx`), so its absence is the runtime half of `audit:guest-build`'s
  //    static one -- a flag arriving from a shell or a CI job dies here.
  if ((await page.locator('[data-testid="scheme-probe"]').count()) !== 0) {
    throw new Error('scheme-probe is in the DOM -- this is a harness build wearing a guest name');
  }
  console.log(green('  4. no scheme-probe -- the harness flag is genuinely absent at runtime'));
} catch (e) {
  failure = e;
  const shot = join(ROOT, 'test-results/guest-web/screen.png');
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  console.error(red(`\nFAIL: ${e.message}`));
  console.error(`  url:  ${page.url()}`);
  console.error(`  shot: ${shot}`);
  const body = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (body) console.error(`  body: ${body.slice(0, 400).replace(/\n/g, ' / ')}`);
}

if (consoleErrors.length) {
  console.log(yellow(`\n  ${consoleErrors.length} console error(s):`));
  for (const e of consoleErrors.slice(0, 6)) console.log(`    ${e}`);
}

await browser.close();
server.close();

if (!failure) {
  console.log(green('\nOK: the guest build runs, talks to Supabase, and joins a real event.'));
  // The same sentence lane H prints about push, for the same reason: a green board must not
  // be read as coverage it does not have.
  console.log('  NOT covered here: push, a real camera, and universal links. Those need a phone.');
}
process.exit(failure ? 1 : 0);
