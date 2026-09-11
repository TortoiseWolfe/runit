import { expect, test, type Page } from '@playwright/test';

import { joinAsGuest, open, ready, switchToHost, TOKENS } from './helpers';

/**
 * Photos tab -- the shared album.
 *
 * The seed puts all nine APPROVED photos in Reception (fld_reception), which is
 * also the active folder, so Reception is the only folder that renders a grid.
 * Every other folder is empty of approved rows, and the screen swaps to its
 * full-bleed shutter pane when the active folder has nothing approved in it.
 * That is a product state, not a mockup toggle, and the switch test rides it.
 */

/**
 * The nine seeded approved rows in render order.
 *
 * The fixture stamps phoa_1..phoa_9 at 19:00..19:08 and the repository sorts
 * approved photos newest-first, so the grid must read phoa_9 down to phoa_1.
 */
const ALBUM_NEWEST_FIRST = Array.from({ length: 9 }, (_, i) => `tile-phoa_${9 - i}`);

/** Folder chips carry "{name} · {count}", in position order. */
const FOLDER_CHIPS = ['Getting ready · 38', 'Ceremony · 112', 'Reception · 97'];

/** 38 + 112 + 97 -- the number the empty-album pane counts up to. */
const TOTAL_PHOTOS = '247';

/** Join, cross to the Photos tab, and wait for the grid variant to mount. */
async function openPhotos(page: Page, scheme: 'dark' | 'light') {
  // joinAsGuest -> open -> ready(), so hydration is already settled here.
  await joinAsGuest(page, scheme);
  await page.getByTestId('tab-photos').click();
  await expect(page.getByTestId('album')).toBeVisible();
}

/**
 * Cross from the guest Photos tab into the host approval queue.
 *
 * The route is round-about on purpose: `role-switch` is rendered by the Chat
 * screen and the host chrome only, never by the Photos screen, so the crossing
 * has to go back through Chat. Doing it any other way would be asserting a
 * navigation the app does not offer.
 */
async function openHostPhotos(page: Page) {
  await page.getByTestId('tab-chat').click();
  await switchToHost(page);
  await page.getByTestId('host-segment-photos').click();
  await expect(page.getByTestId('host-photos')).toBeVisible();
}

/**
 * The tiles in render order.
 *
 * Reading the testID back is the only way to assert ORDER rather than mere
 * presence; it is the same public contract `getByTestId` uses, not a class name
 * or a structural path.
 */
function tileOrder(page: Page): Promise<string[]> {
  return page
    .getByTestId(/^tile-/)
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid') ?? ''));
}

test.describe('Photos tab · shared album', () => {
  test('the album renders one tile per approved photo — nine of them, newest first', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openPhotos(page, scheme);

    // The count IS the guard. This grid once drew nine tiles in the browser and
    // nothing at all on a device, because a percentage width inside a wrapping,
    // gapped row has no basis in Yoga. Nine is also the number that proves the
    // status filter: Reception holds three PENDING photos as well, so an album
    // that forgot to filter by status would render twelve.
    //
    // Being honest about the limit: a green count here is evidence the data
    // path and the render loop are right. It is NOT evidence about native
    // layout -- only `pnpm android` can speak to that -- so this spec makes no
    // geometric claim at all.
    await expect(page.getByTestId(/^tile-/)).toHaveCount(9);

    // Order, not just presence: nine distinct approved rows, newest first.
    // A grid that rendered the same photo nine times, or sorted oldest-first,
    // both survive a bare count and both die here.
    expect(await tileOrder(page)).toEqual(ALBUM_NEWEST_FIRST);
  });

  test('each folder chip names its folder and its photo count, in run order', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openPhotos(page, scheme);

    // An array form asserts count, copy and order in one shot.
    await expect(page.getByTestId(/^folder-/)).toHaveText(FOLDER_CHIPS);
  });

  test('Reception is the active folder and is the only chip drawn as selected', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openPhotos(page, scheme);

    // A painted token, not a class name. This is deliberately the fallback:
    // the chip sets accessibilityState.selected, but react-native-web drops
    // that for accessibilityRole="button" (aria-selected is not valid on
    // role=button), so the rendered chip exposes NO aria-selected to assert on
    // -- verified against the export, not assumed. The fill is the only signal
    // the component actually publishes.
    //
    // Asserting all three makes the claim "exactly one is active" rather than
    // "this one is".
    await expect(page.getByTestId('folder-fld_reception')).toHaveCSS(
      'background-color',
      TOKENS[scheme].primary,
    );
    await expect(page.getByTestId('folder-fld_getting_ready')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await expect(page.getByTestId('folder-fld_ceremony')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
  });

  test('an upload waits for a host: it joins neither the album nor the folder count', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openPhotos(page, scheme);

    await page.getByTestId('shutter-small').click();
    // Wait on the toast first: it only fires after the write resolves, so the
    // two assertions below are reading post-upload state, not winning a race
    // against a render that has not happened yet.
    await expect(page.getByTestId('toast')).toHaveText(
      'Uploaded to Reception · awaiting host approval',
    );

    // Event tier moderates photos, so the new row is pending: the album still
    // shows nine approved tiles and Reception still counts 97. If an upload
    // ever short-circuits approval, both numbers move and this fails.
    await expect(page.getByTestId(/^tile-/)).toHaveCount(9);
    await expect(page.getByTestId('folder-fld_reception')).toHaveText('Reception · 97');
  });

  test('the upload really files into the active folder, not just the toast that says so', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openPhotos(page, scheme);

    await page.getByTestId('folder-fld_ceremony').click();
    await expect(page.getByTestId('shutter')).toBeVisible();
    await page.getByTestId('shutter').click();
    await expect(page.getByTestId('toast')).toHaveText(
      'Uploaded to Ceremony · awaiting host approval',
    );

    // WHY THIS TEST EXISTS. The canvas bug being guarded is that the toast read
    // the active folder from a STALE CLOSURE, so it could name a folder the
    // upload did not go to. A test that only reads the toast cannot see that
    // bug -- the toast is the thing that lies. Verified by mutation: pinning
    // `photos.upload` to file into Reception regardless of the active folder
    // leaves every toast assertion in this file green.
    //
    // The approval queue is the only place a guest's upload becomes an
    // observable destination, so the claim gets settled there.
    await openHostPhotos(page);

    // Each pending row prints "{when} · → {folder}". Exactly one went to
    // Ceremony -- ours -- and the three seeded Reception rows are still three.
    // If the upload filed into the wrong folder these read 0 and 4.
    const queue = page.getByTestId('host-photos');
    await expect(queue.getByText('→ Ceremony')).toHaveCount(1);
    await expect(queue.getByText('→ Reception')).toHaveCount(3);

    // The queue grew from the seeded 3 to 4, so the row was genuinely added
    // rather than swapped in for one of the seeds.
    await expect(page.getByTestId('host-segment-photos')).toHaveText('Photos · 4');
  });

  test('the shutter puts REAL BYTES on the record, from the capture path and not a literal', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openPhotos(page, scheme);

    // Reception is the active folder and has nine approved photos, so the album
    // shows the compact shutter rather than the large empty-state one.
    await page.getByTestId('shutter-small').click();
    await expect(page.getByTestId('toast')).toContainText('awaiting host approval');

    await openHostPhotos(page);

    // Four rows pending: the three seeded ones plus ours. Exactly ONE carries an
    // image, which is the seeded-rows-have-no-bytes claim and the ours-does claim
    // in a single count -- no round trip needed to establish the "before".
    await expect(page.getByTestId('host-segment-photos')).toHaveText('Photos · 4');
    const shots = page.getByTestId('host-photos').locator('img');
    await expect(shots).toHaveCount(1);

    // THE POINT OF THIS TEST, and why it asserts the VALUE rather than presence.
    // `upload()` used to be called with a hardcoded `localUri: null` -- the one
    // line in the app that lied. Asserting only that an <img> exists would pass
    // just as well against a hardcoded literal put back in its place; verified by
    // mutation, replacing `await capturePhoto()` with a fixed object leaves every
    // other test in this file green.
    //
    // Under EXPO_PUBLIC_FIDELITY the web capture returns a known 1x1 PNG
    // (src/lib/capture.web.ts). Matching that exact prefix proves the URI came
    // out of the capture path and was carried through state -> repository ->
    // record -> render, rather than being minted anywhere in between.
    await expect(shots.first()).toHaveAttribute(
      'src',
      /^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/,
    );

    // What this CANNOT prove, stated rather than implied: that a camera opened.
    // react-native-web has no camera and this lane never will. Only a device can
    // witness a real capture -- design/FIDELITY.md note G.
  });

  test('a failed upload stays with the guest, offers Retry, and never reaches the host queue', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';

    // ?flaky=1 injects a transfer that reports progress then fails once. It is
    // double-gated on EXPO_PUBLIC_FIDELITY (src/app/_layout.tsx), so it cannot be
    // reached in a real build. Without it these states are unreachable at all:
    // the in-memory adapter has no network, so its transfer completes instantly.
    await page.goto('/join?flaky=1');
    await ready(page, scheme);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await page.getByTestId('tab-photos').click();
    await expect(page.getByTestId('album')).toBeVisible();

    await page.getByTestId('shutter-small').click();

    // THE TOAST MUST NOT CLAIM SUCCESS. `upload()` deliberately does not throw on
    // a transfer failure, so the guarded call returns true either way -- and the
    // toast used to announce "Uploaded to Reception · awaiting host approval"
    // over a tile that was simultaneously offering Retry. A device found that;
    // this lane had the same test and did not assert the toast, so it did not.
    const toast = page.getByTestId('toast');
    await expect(toast).toContainText('Upload failed');
    await expect(toast).not.toContainText('awaiting host approval');

    // The guest sees their own failure, with a way out of it.
    const retry = page.getByTestId(/^retry-pho_/);
    await expect(retry).toHaveCount(1);
    await expect(retry).toHaveAccessibleName(/Retry upload/);

    // THE ASSERTION THAT MATTERS MOST. A photo whose bytes never arrived is not
    // work a host can do: showing it in the moderation queue would give them
    // live Approve/Hide over nothing and inflate the console badge. The old
    // selector included 'uploading' in `pending`, so this is a real regression
    // guard, not a restatement.
    await openHostPhotos(page);
    await expect(page.getByTestId('host-segment-photos')).toHaveText('Photos · 3');
    await expect(page.getByTestId('host-photos').locator('img')).toHaveCount(0);

    // Back to the guest, retry, and it lands.
    await page.getByTestId('role-switch').click();
    await page.getByTestId('tab-photos').click();
    await page.getByTestId(/^retry-pho_/).click();

    await expect(page.getByTestId(/^retry-pho_/)).toHaveCount(0);
    await openHostPhotos(page);
    await expect(page.getByTestId('host-segment-photos')).toHaveText('Photos · 4');
    await expect(page.getByTestId('host-photos').locator('img')).toHaveCount(1);
  });

  test('tapping another folder chip moves the album, and the shutter follows it', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openPhotos(page, scheme);

    // Upload into Reception FIRST, so the toast is already on screen saying
    // "Reception". The Ceremony assertion below is then a transition, not a
    // first render that would have read the same either way.
    await page.getByTestId('shutter-small').click();
    await expect(page.getByTestId('toast')).toHaveText(
      'Uploaded to Reception · awaiting host approval',
    );

    await page.getByTestId('folder-fld_ceremony').click();

    // Ceremony has 112 photos but none of the nine approved rows, so the grid
    // variant unmounts entirely and the empty-album shutter pane takes over.
    // Losing the tiles is the observable half of the switch.
    await expect(page.getByTestId('album')).toHaveCount(0);
    await expect(page.getByTestId(/^tile-/)).toHaveCount(0);
    await expect(page.getByTestId('shutter')).toBeVisible();

    // AND THERE IS A WAY BACK. This assertion used to say the opposite -- it
    // recorded, as expected behaviour, that the chip row was part of the grid
    // variant and vanished with it. That stranded the guest: two of the three
    // seeded folders are empty, so it was one tap away, and an upload lands
    // `pending` so the pane never flips back on its own. The only escape was a
    // force-quit, which loses the session, the nickname and every vote.
    await expect(page.getByTestId('folder-fld_reception')).toBeVisible();
    await page.getByTestId('folder-fld_reception').click();
    await expect(page.getByTestId('album')).toBeVisible();
    await expect(page.getByTestId(/^tile-/)).toHaveCount(9);

    // Back to Ceremony to finish what this test was originally about.
    await page.getByTestId('folder-fld_ceremony').click();
    await expect(page.getByTestId('shutter')).toBeVisible();

    // The pane states its destination, and counts every folder, not the one on
    // screen -- 38 + 112 + 97.
    await expect(page.getByText('Filing into · Ceremony')).toBeVisible();
    await expect(page.getByText(TOTAL_PHOTOS, { exact: true })).toBeVisible();

    // The real claim: the upload destination moved with the chip. The toast
    // text has to CHANGE from Reception to Ceremony for this to pass, which is
    // what kills a hard-coded name or a shutter holding a stale folder.
    await page.getByTestId('shutter').click();
    await expect(page.getByTestId('toast')).toHaveText(
      'Uploaded to Ceremony · awaiting host approval',
    );

    // Two pending uploads later the album total is still 247: moderated
    // uploads do not touch a folder's count until a host approves them.
    await expect(page.getByText(TOTAL_PHOTOS, { exact: true })).toBeVisible();
  });
});

/**
 * THE FIRST SENTENCE A GUEST READS, AND IT WAS FALSE -- #67, written before the code.
 *
 * The Photos empty state hardcoded "Photos upload to the album and appear once a host
 * approves them." `create_event` mints `house_party`, whose `photoModeration` is false, so
 * on every event this app can create the photo appears IMMEDIATELY -- the toast a second
 * later says "Added to All photos" and the tile is there. The app contradicted itself in
 * about two seconds, on the first screen a guest meets at a party that has just started.
 *
 * The screen already knew how to say this correctly: `album-moderated`, in the grid branch,
 * renders the same claim CONDITIONALLY. Only the empty state asserted it unconditionally --
 * and the empty state is the one a new party shows.
 *
 * WHAT THIS LANE CANNOT REACH, said rather than implied: the moderated-AND-empty case. No
 * client can set a tier (#30), so a journey cannot produce an event where moderation is on
 * and the album is empty. The negative is what shipped broken and the negative is what is
 * pinned here; the conditional itself is covered by `album-moderated` in the grid.
 */
test.describe('what the empty album promises (#67)', () => {
  test('does not promise approval on a tier that approves nothing', async ({ page }, info) => {
    const scheme = info.project.name as 'dark' | 'light';

    await open(page, scheme, '/create', 'create-event');
    await page.getByTestId('create-host-name').fill('Ruth');
    await page.getByTestId('create-name').fill("Ruth's 40th");
    await page.getByTestId('create-date').fill('2027-01-09');
    await page.getByTestId('create-time').fill('19:00');
    await page.getByTestId('create-submit').click();
    await page.getByTestId('created-continue').click();
    await page.getByTestId('role-switch').click();
    await page.getByTestId('tab-photos').click();

    // The empty state, on the only tier any event can have.
    await expect(page.getByTestId('album-blurb')).toBeVisible();
    await expect(page.getByTestId('album-blurb')).not.toContainText(/approve/i);

    // And it still says something true and useful, rather than saying nothing -- a blank
    // reassurance is not an improvement on a false one.
    await expect(page.getByTestId('album-blurb')).toContainText(/straight|right away|immediately/i);
  });

  test('and the app does not contradict itself two seconds later', async ({ page }, info) => {
    const scheme = info.project.name as 'dark' | 'light';

    await open(page, scheme, '/create', 'create-event');
    await page.getByTestId('create-host-name').fill('Ruth');
    await page.getByTestId('create-name').fill("Ruth's 40th");
    await page.getByTestId('create-date').fill('2027-01-09');
    await page.getByTestId('create-time').fill('19:00');
    await page.getByTestId('create-submit').click();
    await page.getByTestId('created-continue').click();
    await page.getByTestId('role-switch').click();
    await page.getByTestId('tab-photos').click();

    await page.getByTestId('shutter').click();

    // THE CONTRADICTION, pinned: the photo is in the album at once, so any promise of
    // approval on the screen before it was false. This is the assertion that would go red
    // if the tier default ever changed without the copy following.
    await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(1);
    await expect(page.getByTestId('album-moderated')).toHaveCount(0);
  });
});

/**
 * RETRY ON AN ALBUM WITH NOTHING IN IT -- #70.
 *
 * The retry journey above is real and could never have caught this: it waits for
 * `album` before shooting, so it only ever enters the GRID branch, which is the one
 * branch that draws Retry. `PhotosScreen` returned the shutter pane on
 * `visible.length === 0` alone, and that pane references `mine` nowhere -- so a guest
 * whose upload failed on an empty album was told "tap Retry" by `actions.ts:277` on a
 * screen with no Retry on it.
 *
 * ON A MODERATED EVENT IT IS NOT A MOMENT, IT IS THE WHOLE NIGHT: uploads land `pending`,
 * `pending` is never `approved`, so `visible` never fills from her own photos.
 *
 * `?fresh=1&flaky=1` is the world, and neither flag alone reaches it. `freshSeed` is the
 * only fixture with an EMPTY active folder (`weddingSeed` and `housePartySeed` both seed
 * approved photos, which is why every existing assertion starts in the grid); `?flaky=1`
 * is the only way to reach `failed` at all, because the in-memory transfer completes
 * instantly.
 */
test.describe('a failed upload on an empty album', () => {
  const shootIntoNothing = async (page: Page, scheme: 'dark' | 'light') => {
    await page.goto('/join?fresh=1&flaky=1');
    await ready(page, scheme);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await page.getByTestId('tab-photos').click();

    // THE SHUTTER PANE, not the grid -- asserted rather than assumed, because if this
    // fixture ever grows an approved photo the test below would still pass while proving
    // something else entirely.
    await expect(page.getByTestId('shutter')).toBeVisible();
    await expect(page.getByTestId('album')).toHaveCount(0);
    await page.getByTestId('shutter').click();
  };

  test('offers the Retry the toast promises, instead of a screen with no Retry on it', async ({
    page,
  }, testInfo) => {
    await shootIntoNothing(page, testInfo.project.name as 'dark' | 'light');

    await expect(page.getByTestId('toast')).toContainText('tap Retry');
    // The control the toast just named, on the same screen, reachable.
    await expect(page.locator('[data-testid^="retry-"]')).toHaveCount(1);
  });

  test('and the Retry works, so the photo lands rather than merely being offered', async ({
    page,
  }, testInfo) => {
    await shootIntoNothing(page, testInfo.project.name as 'dark' | 'light');

    const retry = page.locator('[data-testid^="retry-"]').first();
    await expect(retry).toBeVisible();
    await retry.click();

    // flakyTransfer fails attempt 1 only, so the second lands. Without this clause the
    // test proves a button is drawn and nothing about whether it does anything -- and a
    // Retry that renders and no-ops is the defect one level down.
    await expect(page.locator('[data-testid^="retry-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(1);
  });
});
