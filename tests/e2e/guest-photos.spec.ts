import { expect, test, type Page } from '@playwright/test';

import { joinAsGuest, switchToHost, TOKENS } from './helpers';

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
    // That is also why there is no way back via a chip: the chip row is part of
    // the grid variant. Losing the tiles is the observable half of the switch.
    await expect(page.getByTestId('album')).toHaveCount(0);
    await expect(page.getByTestId(/^tile-/)).toHaveCount(0);
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
