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
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

import { serveDir } from './lib/serve.mjs';
import { capture, laneDir, writeReport } from './lib/artifacts.mjs';

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

// SERVED BY THE SHARED MODULE, which also fixes a real divergence: this file bound
// `server.listen(0, r)` with no host -- i.e. 0.0.0.0 -- publishing a build of the app,
// project URL and publishable key inlined, to the local network for the life of the run.
// Every sibling bound 127.0.0.1. The default is the safe one now.
const server = await serveDir(DIST);
const base = server.url;

const results = [];
const check = (ok, what, detail = '') => {
  results.push({ ok, what, detail });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${what}${detail ? ` (${detail})` : ''}`);
};

/**
 * WAIT OUT THE TOAST. It has cost three debugging cycles in this file alone.
 *
 * A toast lives ~2.2s, is absolutely positioned along the bottom of the screen, and
 * therefore (a) satisfies `waitForSelector('[data-testid="toast"]')` with the PREVIOUS
 * message, which once reported `request_song` as broken while the database had merged
 * correctly, and (b) covers the photo viewer's action bar, so clicking Close times out
 * against an element that is present, enabled and simply underneath something.
 *
 * `shoot-app.mjs` has had this helper since the screenshot walk existed. It does not stop
 * being true because the lane is new.
 */
const toastGone = () =>
  page
    .waitForSelector('[data-testid="toast"]', { state: 'detached', timeout: 15_000 })
    .catch(() => {});

/**
 * SEE IT, WITHOUT INSISTING REALTIME DELIVERED IT.
 *
 * Every host segment re-mounts and refetches when you navigate to it, so "the row reached
 * the host queue" and "a websocket pushed it within N seconds" are different claims.
 * Exactly ONE assertion in this file is about realtime delivery -- the broadcast -- and it
 * says so. Everything else is about the row being there, so it is allowed a refetch rather
 * than being quietly turned into a flaky test of the transport.
 *
 * Measured on this project: realtime usually delivers in 240ms-1.2s and occasionally not at
 * all inside a minute. Blurring the two claims is how a lane earns a reputation for
 * flakiness and gets switched off.
 */
const seeInConsole = async (segment, selector, ms = 20_000) => {
  const found = await page.waitForSelector(selector, { timeout: ms }).then(() => true).catch(() => false);
  if (found) return true;
  await page.getByTestId('host-segment-broadcast').click();
  await page.waitForSelector('[data-testid="host-broadcast"]', { timeout: 20_000 });
  await page.getByTestId(segment).click();
  return page.waitForSelector(selector, { timeout: ms }).then(() => true).catch(() => false);
};

const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const EVENT_NAME = `smoke ${STAMP}`;

/**
 * A WEEK OUT, DERIVED — not the hard-coded `2026-12-31` this used to fill (#47).
 *
 * That date was in the future when it was written and stops being so on 2027-01-01, at
 * which point every event this lane creates is born in the past. Two clocks already run
 * from `starts_at`: `photos_past_retention()` measures album retention from it, so a
 * past-dated `house_party` event's photos are immediately expired and the nightly sweep
 * starts finding rows a test made; and the album's own "kept for N days after the event"
 * copy renders as already-elapsed. Neither breaks today. Both would break quietly, months
 * after the commit that caused it.
 *
 * A DERIVED DATE IS FINE HERE AND WOULD NOT BE IN LANE B. `pnpm shots` is compared by eye
 * against committed renders, so a value that moves makes a reference set that can never be
 * clean -- which is why `00-create-key` is one of two screenshots that already differ run
 * to run. This lane writes to a live database and prints the event code it leaves behind;
 * it is non-deterministic by construction, so the honest thing is a date that stays true.
 */
const CREATE_DATE = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const ANNOUNCEMENT = `Smoke ${STAMP}: the cake is real.`;
const SONG = `Smoke ${STAMP}`;

console.log(`\nlane H -- ${url.replace(/https:\/\/([a-z0-9]{6}).*/, 'https://$1…')}, event "${EVENT_NAME}"\n`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
// ALWAYS ON, DISCARDED ON SUCCESS -- the same semantics `playwright.config.ts` gives the
// journeys with `retain-on-failure`. This lane runs once per build against a live backend
// and has no by-eye output to perturb, so the trace is worth its cost every time.
await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let code = '';
/**
 * Collected AS THE JOURNEY GOES, and swept after the try/catch rather than inside it.
 * A run that aborts is exactly the run you repeat, so a sweep that only fires on success
 * leaks bytes fastest when things are going worst -- which is how the first orphans in
 * this bucket happened.
 */
const sweepPaths = new Set();
/**
 * Hoisted so the FAILURE HANDLER can reach them. They were declared inside the try, which
 * meant the catch could not see the second client at all -- and the cross-client realtime
 * assertions are exactly the ones that fail on it.
 */
let bo = null;
let boCtx = null;
const boErrors = [];
const remember = (u) => {
  const m = u && decodeURIComponent(u).match(/\/object\/sign\/event-photos\/(.+?)\?/);
  if (m) sweepPaths.add(m[1]);
};

try {
  // ---------------------------------------------------------------- create
  await page.goto(`${base}/create`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="scheme-probe"]', { timeout: 30_000 });
  await page.getByTestId('create-host-name').fill('Smoke Host');
  await page.getByTestId('create-name').fill(EVENT_NAME);
  await page.getByTestId('create-date').fill(CREATE_DATE);
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
  const sentAt = Date.now();
  await page.getByTestId('broadcast-send').click();
  // 60s, and the elapsed time is REPORTED rather than swallowed. At 20s this step failed
  // on two runs out of five and passed on three -- a flaky gate is a gate that gets
  // switched off, and "it went green on the retry" is not a measurement. The number in
  // the detail column is what tells the next reader whether a cold realtime channel is
  // slow or whether something is actually wrong.
  await page.waitForFunction(
    (body) => document.body.innerText.includes(body),
    ANNOUNCEMENT,
    { timeout: 60_000 },
  );
  check(true, 'a broadcast inserts and comes back through the realtime channel', `${Date.now() - sentAt}ms`);

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
  await toastGone();

  // The merge branch, which no unit test can reach without a real unique index.
  await page.getByTestId('request-input').fill(`  ${SONG.toLowerCase()}!  - smoke test`);
  await page.getByTestId('request-submit').click();
  await page.waitForSelector('[data-testid="toast"]', { timeout: 20_000 });
  const toast = await page.getByTestId('toast').innerText();
  check(/already in the queue/i.test(toast), 'and asking again merges rather than splitting the vote', toast.trim());

  // ---------------------------------------------------------------- photos
  //
  // THE LONGEST UNPROVEN CHAIN IN THE APP, and every link is silent when it breaks. Two
  // objects go up -- #10 added a 400px thumbnail beside the 1600px original -- the row
  // names both, `event_photos_select` has to admit the THUMBNAIL as well as the original
  // (the policy matched only `storage_path` until it was widened, which would have made
  // every thumbnail unreadable to everyone), and `createSignedUrls` has to produce a URL
  // that actually resolves. None of it had ever run outside a fixture.
  //
  // `capture.web.ts` returns a synthetic 1x1 PNG under EXPO_PUBLIC_FIDELITY=1, so this
  // uploads ~100 bytes rather than a photograph. That is why the lane can afford to leave
  // objects behind -- see the sweep note in docs/smoke-live.md.
  //
  // NO APPROVAL QUEUE HERE, AND THAT IS THE TIER RATHER THAN A BUG. `create_event` mints
  // `house_party`, whose uploads are auto-approved, so a photo goes straight to the album
  // and the host's queue stays empty. Moderation is unreachable from any event this app
  // can currently create, because `events.tier` is outside the column grant and there is
  // no purchase path (#30). Lane H tests what a real event can actually do.
  await page.getByTestId('tab-photos').click();
  await page.waitForSelector('[data-testid="shutter"]', { timeout: 20_000 });
  await toastGone();
  const shotAt = Date.now();
  await page.getByTestId('shutter').click();

  // The toast is the app's own statement that the transfer SETTLED. `upload()` returns an
  // outcome instead of throwing, so waiting on a tile would wait on the wrong thing: a
  // FAILED transfer also renders a tile, carrying Retry.
  await page.waitForFunction(
    () => /Added to |awaiting host approval/i.test(document.body.innerText),
    undefined,
    { timeout: 60_000 },
  );
  const settled = await page.evaluate(() => document.body.innerText.match(/Upload failed[^\n]*/)?.[0] ?? '');
  check(settled === '', 'a guest upload reaches storage and the row lands (#10)', `${Date.now() - shotAt}ms`);

  const tile = page.locator('[data-testid^="tile-"]').first();
  await tile.waitFor({ timeout: 30_000 });
  check(true, 'and it appears in the album, auto-approved on the free tier');

  /**
   * THE ASSERTION THIS SECTION EXISTS FOR, and `naturalWidth > 0` alone is not it.
   *
   * An <img> whose src 403s renders NOTHING while every DOM assertion still passes -- the
   * element is present, the testID matches, the layout is unchanged, and the guest is
   * looking at a blank tile. So the image has to have DECODED. But decoding alone is
   * satisfied by the `data:` URI of the guest's own bytes, which would prove only that
   * `capture.web.ts` works -- so the src must also be a SIGNED STORAGE URL, and it must
   * name the THUMBNAIL. That last clause is the widened policy: `_t.jpg` matches no row
   * on `storage_path`, so before #10's fix this is the exact assertion that would fail.
   */
  const album = await page
    .waitForFunction(
      () => {
        const img = document.querySelector('[data-testid="album"] img');
        if (!img || !img.naturalWidth) return null;
        return { src: img.src, w: img.naturalWidth };
      },
      undefined,
      { timeout: 60_000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);
  remember(album?.src);
  check(
    !!album && /\/storage\/v1\/object\/sign\//.test(album.src) && album.src.includes('_t.jpg'),
    'the album renders the SIGNED THUMBNAIL, so event_photos_select admits thumb_path',
    album ? `${album.w}px, ${album.src.includes('_t.jpg') ? 'thumb' : 'NOT the thumb'}` : 'no image decoded',
  );

  /**
   * The full-size copy is signed on demand and by a DIFFERENT path -- `storage_path`, not
   * `thumb_path` -- so a policy admitting one and not the other passes everything above.
   */
  await tile.click();
  await page.waitForSelector('[data-testid="viewer-image"]', { timeout: 30_000 });
  // WAIT FOR THE SRC TO CHANGE, not for the first decoded image. The viewer deliberately
  // shows the THUMBNAIL first and swaps in the full size when it signs -- its own docblock
  // calls that three layers, each a real state rather than a spinner. An assertion that
  // resolves on "an image decoded" therefore catches the thumbnail every time and reports
  // `fullUrl` as broken. Measured: the swap happens, and it is what this asserts.
  const full = await page
    .waitForFunction(
      () => {
        const img = document.querySelector('[data-testid="viewer-image"] img, img[data-testid="viewer-image"]');
        if (!img || !img.naturalWidth || img.src.includes('_t.jpg')) return null;
        return { src: img.src, w: img.naturalWidth };
      },
      undefined,
      { timeout: 60_000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);
  remember(full?.src);
  check(
    !!full && /\/storage\/v1\/object\/sign\//.test(full.src) && !full.src.includes('_t.jpg'),
    'and the viewer signs the FULL-SIZE object, which is a different path (#38)',
    full ? (full.src.includes('_t.jpg') ? 'served the thumb instead' : 'full size') : 'no image decoded',
  );
  await toastGone();
  await page.getByTestId('viewer-close').click();

  // The host's own view of the same photo: the folder count is trigger-maintained over
  // APPROVED rows, so this is `fold_photo_count` having fired against real Postgres.
  //
  // BACK TO CHAT FIRST. `RoleSwitch` is drawn in the ChatScreen FOOTER and nowhere else --
  // deliberately, because that is the least-trafficked surface and a mis-tap on a tab
  // header would drop someone out of the party. Clicking it from the Photos tab waits for
  // an element that does not exist there, which is what the truncated error above was
  // hiding: the call log said `waiting for getByTestId('role-switch')`, not viewer-close.
  await page.getByTestId('tab-chat').click();
  await page.waitForSelector('[data-testid="chat-feed"]', { timeout: 20_000 });
  await page.getByTestId('role-switch').click();
  await page.waitForSelector('[data-testid="host-broadcast"]', { timeout: 30_000 });
  await page.getByTestId('host-segment-photos').click();
  await page.waitForSelector('[data-testid="host-photos"]', { timeout: 20_000 });
  const hostPanel = await page.getByTestId('host-photos').innerText();
  check(/1 photos|1 photo/.test(hostPanel), 'the folder count folded on the host side', hostPanel.match(/\d+ photos?/)?.[0] ?? '');
  check(/All caught up/i.test(hostPanel), 'and the free tier leaves no approval queue, as designed');

  // -------------------------------------------------------------- invitees
  //
  // `invitedCount` IS NOT `guestCount`, and the two never appear on the same screen --
  // which is why collapsing them is invisible by inspection. The composer addresses
  // everyone INVITED; the guest header counts everyone PRESENT. This is `fold_invited_count`
  // firing against real Postgres and the composer reading the folded number.
  await page.getByTestId('host-segment-event').click();
  await page.waitForSelector('[data-testid="host-event-details"]', { timeout: 20_000 });
  await page.getByTestId('invitee-email').fill(`smoke-${STAMP}@example.test`);
  await page.getByTestId('invitee-add').click();
  await page.waitForSelector('[data-testid="invitee-row"]', { timeout: 20_000 });
  check(true, 'a host can put someone on the guest list (#25)');

  await page.getByTestId('host-segment-broadcast').click();
  await page.waitForSelector('[data-testid="host-broadcast"]', { timeout: 20_000 });
  // WAIT FOR THE FOLD, do not read once. `fold_invited_count` runs in the database and the
  // new number reaches this client over realtime, so reading the composer the instant after
  // the insert is a race the write usually loses. Read once, this reported "Send to 0
  // guests" on one run in four -- which is a true statement about that millisecond and a
  // false one about the trigger.
  const composer = await page
    .waitForFunction(() => /Send to [1-9]\d* guests?/.test(document.body.innerText), undefined, { timeout: 45_000 })
    .then(() => page.getByTestId('host-broadcast').innerText())
    .catch(() => page.getByTestId('host-broadcast').innerText());
  check(/Send to 1 guest/.test(composer), 'and invited_count folds into the composer',
        composer.match(/Send to \d+ guests?/)?.[0] ?? 'no count');

  // ------------------------------------------------------- a SECOND guest
  //
  // THE UNLOCK FOR EVERYTHING BELOW. Reports refuse a self-report, blocking needs somebody
  // to block, and "seen by" needs a reader who is not the author -- so none of it is
  // reachable with one identity. A second browser context is a second anonymous user
  // joining by code, which is also the only way this suite has ever exercised realtime
  // BETWEEN clients rather than a client hearing its own echo.
  boCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  await boCtx.tracing.start({ screenshots: true, snapshots: true, sources: true });
  bo = await boCtx.newPage();
  bo.on('pageerror', (e) => boErrors.push(e.message));
  await bo.goto(`${base}/join?code=${code}`, { waitUntil: 'networkidle' });
  await bo.waitForSelector('[data-testid="join-submit"]', { timeout: 30_000 });
  await bo.getByTestId('join-nickname').fill('Bo');
  await bo.getByTestId('join-submit').click();
  await bo.waitForSelector('[data-testid="chat-feed"]', { timeout: 30_000 });
  check(true, 'a second guest joins by code, on a second identity');

  // The founder holds a guest seat too (#37), so `guests` has TWO rows here and the room
  // must still read ONE. `guest_seats()` excluding a host-held seat is the only reason.
  const boPill = (await bo.getByTestId('guest-count-pill').innerText()).trim();
  check(boPill.startsWith('1'), 'the room counts the guest and not the host (#37)', boPill);

  // Bo is looking at the feed, so ChatScreen's viewport sweep marks the announcement read.
  // MemoryRepository has exactly ONE reader and cannot model this at all.
  await page.getByTestId('host-segment-broadcast').click();
  const seen = await page
    .waitForFunction(() => /seen by ([1-9]\d*)/.test(document.body.innerText), undefined, { timeout: 45_000 })
    .then(() => page.getByTestId('host-broadcast').innerText())
    .catch(() => '');
  check(/seen by [1-9]/.test(seen), 'a real second reader moves "seen by" off zero (#24)',
        seen.match(/seen by \d+/)?.[0] ?? 'still zero');

  // --------------------------------------------------------------- reports
  await bo.getByTestId('tab-music').click();
  await bo.getByTestId('request-input').fill(`Bo ${STAMP} - Bo Band`);
  await bo.getByTestId('request-submit').click();
  await bo.waitForFunction((t) => document.body.innerText.includes(t), `Bo ${STAMP}`, { timeout: 30_000 });

  // Ada crosses back to the floor to see it. This is one client hearing ANOTHER client's
  // insert -- the thing a single-context suite cannot tell apart from its own echo.
  await page.getByTestId('role-switch').click();
  await page.waitForSelector('[data-testid="chat-feed"]', { timeout: 30_000 });
  await page.getByTestId('tab-music').click();
  const crossed = await page
    .waitForFunction((t) => document.body.innerText.includes(t), `Bo ${STAMP}`, { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  check(crossed, "another guest's request arrives over realtime, client to client");

  // The report badge is drawn on somebody else's row and NOT on your own, so exactly one
  // exists here -- which is both how this selects Bo's row and a claim worth making.
  const reportBadges = page.locator('[data-testid^="request-report-"]');
  check(await reportBadges.count() === 1, 'reporting is offered on their row and not on yours');
  await reportBadges.first().click();
  await page.waitForSelector('[data-testid="report-reason-spam"]', { timeout: 20_000 });
  await page.getByTestId('report-reason-spam').click();
  await page.waitForSelector('[data-testid="report-reason-spam"]', { state: 'detached', timeout: 20_000 });
  check(true, 'a guest can file a report through file_report()');

  await page.getByTestId('tab-chat').click();
  await page.waitForSelector('[data-testid="chat-feed"]', { timeout: 20_000 });
  await page.getByTestId('role-switch').click();
  await page.getByTestId('host-segment-reports').click();
  const sawReport = await seeInConsole('host-segment-reports', '[data-testid="host-reports"] [data-testid^="report-"]');
  check(sawReport, 'and it reaches the host queue, where Guideline 1.2 needs it');
  const reportRow = page.locator('[data-testid="host-reports"] [data-testid^="report-"]').first();

  // Resolving is a host UPDATE narrowed by a column grant to `resolved_at`/`resolution`;
  // `stamp_report_resolver` fills in who did it.
  const rid = (await reportRow.getAttribute('data-testid'))?.replace('report-', '') ?? '';
  await page.getByTestId(`resolve-dismissed-${rid}`).click();
  const cleared = await page
    .waitForSelector('[data-testid="reports-empty"]', { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(cleared, 'resolving clears it from the queue');

  // -------------------------------------------------------------- blocking
  //
  // A block is a GUEST's own filter, not moderation: `guest_blocks` is per blocker, and
  // the filtering happens before the queue hook returns. The host's view is untouched.
  await page.getByTestId('role-switch').click();
  await page.waitForSelector('[data-testid="chat-feed"]', { timeout: 30_000 });
  await page.getByTestId('tab-music').click();
  await page.locator('[data-testid^="request-report-"]').first().click();
  await page.waitForSelector('[data-testid="report-block"]', { timeout: 20_000 });
  await page.getByTestId('report-block').click();
  const gone = await page
    .waitForFunction((t) => !document.body.innerText.includes(t), `Bo ${STAMP}`, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(gone, "blocking takes their song out of the blocker's queue");

  // ...and it is reversible, which is what stops a mis-tap being permanent.
  await page.getByTestId('tab-chat').click();
  await page.getByTestId('blocked-pill').click();
  await page.waitForSelector('[data-testid="blocked-list"]', { timeout: 20_000 });
  const unblock = page.locator('[data-testid^="unblock-"]').first();
  await unblock.click();
  await page.getByTestId('blocked-done').click();
  await page.getByTestId('tab-music').click();
  const back = await page
    .waitForFunction((t) => document.body.innerText.includes(t), `Bo ${STAMP}`, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check(back, 'and unblocking puts it back, so a mis-tap is not permanent');

  check(boErrors.length === 0, 'no page errors on the second client', boErrors.slice(0, 2).join(' | '));
  // No path: discarded, exactly as `retain-on-failure` discards a passing journey's trace.
  await boCtx.tracing.stop().catch(() => {});
  await boCtx.close();

  // ------------------------------------------------- the connection itself (#45)
  //
  // THE ONLY PLACE THE SELF-HEAL CAN BE PROVEN. jest can drive the status callback and the
  // backoff against a fake; the 270 journeys boot MemoryRepository, which has no socket at
  // all and reaches the pill only through `?stale=1`. Here there is a real websocket to a
  // real project, and `setOffline` kills it on demand -- so this is deterministic rather
  // than waiting for the outage that produced #45 in the first place.
  //
  // Before this, a channel that joined and then died produced NO observable effect: the
  // subscribe callback was a one-shot promise settler, `liveError` was written by one line
  // and read by none, and every screen went on serving a frozen snapshot.
  await bo.close().catch(() => {});
  await page.getByTestId('tab-chat').click();
  await page.waitForSelector('[data-testid="chat-feed"]', { timeout: 20_000 });

  await page.context().setOffline(true);
  const noticed = await page
    .waitForSelector('[data-testid="connection-pill"]', { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  check(noticed, 'a real socket dying is NOTICED and said out loud (#45)');

  await page.context().setOffline(false);
  // GUARDED ON `noticed`, because waiting for something to DISAPPEAR passes instantly when
  // it was never there. Reverting the fix made this pass vacuously while the check above
  // correctly failed -- a green line reporting recovery from an outage the app never saw.
  const healed = noticed
    ? await page
        // The supervisor's backoff is 2s, 5s, 15s, 30s, so a recovery lands inside this
        // window without the test having to know which attempt did it.
        .waitForSelector('[data-testid="connection-pill"]', { state: 'detached', timeout: 60_000 })
        .then(() => true)
        .catch(() => false)
    : false;
  check(healed, 'and the app heals itself once the network comes back',
        noticed ? '' : 'not reached -- the outage was never noticed');

  check(errors.length === 0, 'no page errors during the journey', errors.slice(0, 2).join(' | '));

} catch (e) {
  // One row per line in the PASS/FAIL table, so its format stays scannable...
  check(false, 'the journey completed', String(e).split('\n')[0]);

  // ...and the whole of it goes to disk, where truncation cannot hide it. Playwright puts
  // the actionability reason -- "not visible", "intercepts pointer events", "waiting for
  // getByTestId(...)" -- in the call log BELOW the timeout line, and squashing that onto one
  // row turned two diagnosable failures into guesses while this lane was being built.
  const dir = laneDir('lane-h');
  await page.context().tracing.stop({ path: join(dir, 'trace.zip') }).catch(() => {});
  if (boCtx) await boCtx.tracing.stop({ path: join(dir, 'trace-bo.zip') }).catch(() => {});
  const failedAt = await capture(page, dir, 'failure');
  if (bo) await capture(bo, dir, 'failure-bo');
  writeReport(dir, {
    url: failedAt,
    error: e,
    console: [...errors, ...boErrors.map((x) => `[bo] ${x}`)],
    // The event code goes in the report too: without it the artifact is not enough to sweep
    // what this run left behind in the production project.
    extra: { event: EVENT_NAME, code: code || 'not created' },
  });
  console.error(`\n${String(e)}`);
  console.log('  artifacts: test-results/lane-h/  (trace.zip, failure.png, failure.html, failure.txt)');
  console.log('  open it:   pnpm exec playwright show-trace test-results/lane-h/trace.zip');
}

/**
 * SWEEP ITS OWN BYTES, pass or fail. `event_photos_delete` admits the HOST of the event
 * through the Storage API and this run is that host -- so the one piece of litter SQL
 * cannot reach is the one the run can remove itself. `storage.protect_delete()` refuses
 * every direct SQL delete on `storage.objects` (lane E asserts it), which is why the
 * documented sweep cannot do this and why #40's retention sweep needs a service role.
 *
 * BEST EFFORT, AND IT NEVER CHANGES THE VERDICT. A gate that went red because tidying
 * failed would be reporting the wrong thing.
 */
if (sweepPaths.size) {
  const swept = await page.evaluate(
    async ({ base: b, apikey, prefixes }) => {
      try {
        const raw = localStorage.getItem(`sb-${b.match(/https:\/\/([a-z0-9]+)\./)[1]}-auth-token`);
        if (!raw) return 'no session';
        // supabase-js base64-prefixes the stored session in recent versions.
        const json = raw.startsWith('base64-') ? atob(raw.slice(7)) : raw;
        const token = JSON.parse(json).access_token;
        const res = await fetch(`${b}/storage/v1/object/event-photos`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}`, apikey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes }),
        });
        return res.ok ? 'ok' : `http ${res.status}`;
      } catch (err) {
        return String(err).slice(0, 60);
      }
    },
    { base: url, apikey: key, prefixes: [...sweepPaths] },
  );
  console.log(`  swept ${sweepPaths.size} storage object(s): ${swept}`);
}

await page.context().tracing.stop().catch(() => {});
await browser.close();
server.close();

const failed = results.filter((r) => !r.ok).length;

/**
 * WHAT A GREEN RUN DOES NOT MEAN. Printed every time, because the risk with a lane like
 * this is that it starts reading as "the backend works" rather than "these journeys work".
 */
console.log('');
console.log('  not checked here, and neither is reachable from a browser:');
console.log('    push delivery -- `push.web.ts` returns null BY DESIGN. Its docblock says why');
console.log('      a fake token would be worse than none: it would flow to set_push_token and');
console.log('      be stored as a routable address that routes nowhere.');
console.log('    photo moderation -- `create_event` mints house_party, which auto-approves, and');
console.log('      no client can set `events.tier` (#30). The approval queue has no reachable');
console.log('      state in any event this app can currently create.');
console.log('');
if (code) {
  console.log(`  event "${EVENT_NAME}" (${code}) was left behind. See docs/smoke-live.md to sweep it.`);
}
if (failed) {
  console.error(`\x1b[31mFAIL: ${failed} of ${results.length} live-adapter checks failed.\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mlane H: ${results.length} live-adapter checks passed against the shipping backend.\x1b[0m`);
