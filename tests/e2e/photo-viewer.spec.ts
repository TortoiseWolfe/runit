import { expect, test, type Page } from '@playwright/test';

import { joinAsGuest } from './helpers';

/**
 * Looking at a photo — issue #38.
 *
 * Before this, **tapping a photo did nothing at all.** The tile was a plain `View`; only
 * the small `⋯` badge inside it was pressable, and that opens the report sheet. A shared
 * photo album had no way to see a photo larger than a ~120pt square.
 *
 * That was invisible while the album rendered coloured placeholders, and became the first
 * thing anyone would reach for once #10 made it render actual images.
 *
 * WHAT THIS FILE CANNOT PROVE. It runs `MemoryRepository`, where `fullUrl()` returns this
 * device's own bytes and there is no bucket, so nothing here says a signed URL resolves or
 * that a photo from another guest is fetchable. It proves the SCREEN: that a tile opens the
 * viewer, that the viewer closes, and that reporting is still reachable from inside it.
 */

test.describe('opening a photo', () => {
  test('a tile opens the viewer, which was previously not a control at all', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-photos').click();

    await expect(page.getByTestId('viewer-stage')).toHaveCount(0);
    await page.getByTestId(/^tile-/).first().click();
    await expect(page.getByTestId('viewer-stage')).toBeVisible();
  });

  test('closes, and does not strand anyone behind a full-screen photo', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-photos').click();
    await page.getByTestId(/^tile-/).first().click();
    await expect(page.getByTestId('viewer-stage')).toBeVisible();

    await page.getByTestId('viewer-close').click();
    await expect(page.getByTestId('viewer-stage')).toHaveCount(0);
    // Back on the album rather than on a blank screen.
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible();
  });

  test('reporting is still reachable from inside the viewer', async ({ page }, testInfo) => {
    // Guideline 1.2 wants reporting available, and a guest who has just enlarged something
    // is the likeliest person to want it. The two modals must not stack: the viewer closes
    // first, or the report sheet sits behind a full-screen photo and reads as a freeze.
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-photos').click();
    await page.getByTestId(/^tile-/).first().click();

    await page.getByTestId('viewer-report').click();
    await expect(page.getByTestId('viewer-stage')).toHaveCount(0);
    await expect(page.getByTestId('report-sheet-backdrop')).toBeVisible();
  });

  test('a save control is there, because a RunIt photo exists nowhere else', async ({
    page,
  }, testInfo) => {
    // #39. Capture writes to the app's cache, there is no share sheet, and retention is
    // coming -- so this is the only way anybody keeps a photo they took.
    //
    // WHAT THIS PROVES AND WHAT IT DOES NOT: that the control is present and reachable,
    // and that tapping it does not throw. `save.web.ts` returns early under
    // EXPO_PUBLIC_FIDELITY=1 and touches nothing, so **no file is written and none could
    // be checked here.** A camera roll is Lane C, by hand; iOS not at all.
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-photos').click();
    await page.getByTestId(/^tile-/).first().click();

    await expect(page.getByTestId('viewer-save')).toBeVisible();
    await page.getByTestId('viewer-save').click();
    // The viewer stays open: saving is not leaving.
    await expect(page.getByTestId('viewer-stage')).toBeVisible();
  });

  test('the album still counts nine tiles, not eighteen', async ({ page }, testInfo) => {
    // The tile became a Pressable and kept its testID on the SAME node. Wrapping it in a
    // new parent, or naming the viewer control `tile-something`, would silently double
    // this count -- which has happened here once already.
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-photos').click();
    await expect(page.getByTestId(/^tile-/)).toHaveCount(9);
  });
});

/**
 * The retention line — issue #23.
 *
 * It ships only because #39 gave it something to point at. A deadline nobody can act on is
 * not a warning, it is bad news, so the sentence names the control and the control exists.
 *
 * NOTHING DELETES ANYTHING YET. The copy says how long photos are KEPT, which is true;
 * promising a removal that no code performs would be the failure this whole session has
 * been unpicking.
 */
test.describe('how long the album lasts', () => {
  test('the album says how long photos are kept, and what to do about it', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-photos').click();

    // The demo wedding sits on the Event tier: a year.
    await expect(page.getByTestId('album-retention')).toContainText('365 days');
    // The line is useless without naming the way to act on it.
    await expect(page.getByTestId('album-retention')).toContainText('Save');
  });

  test('it is at the FOOT of the album, not the first thing anyone meets', async ({
    page,
  }, testInfo) => {
    // A deadline should not greet someone opening a shared photo album at a party. It
    // should be there when they scroll to the end and start choosing favourites.
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-photos').click();

    const feed = await page.getByTestId('album').innerText();
    const tileText = 'photos in the album';
    expect(feed.indexOf(tileText)).toBeLessThan(feed.indexOf('Photos here are kept'));
  });
});

/**
 * MOVING BETWEEN PHOTOS WITHOUT CLOSING THE VIEWER.
 *
 * `PhotoViewer` took `photo: Photo | null` and nothing else -- no list, no index, no next.
 * You opened a photo and the only way to the one beside it was to close and tap again, nine
 * times. The canvas does not draw a viewer at all, so this was never a fidelity gap; it is a
 * convention the design skipped.
 *
 * WHAT THESE TESTS CANNOT SEE. Swipe ships beside the buttons and Chromium cannot swipe, so
 * every assertion here drives the BUTTONS. That is not a shortcut -- it is why both exist:
 * the gesture is the convention on a phone, and the controls are what a screen reader can
 * reach, what a 24pt audit can measure, and what any lane in CI can prove. The gesture is
 * witnessed on a device or not at all.
 *
 * And no lane here renders an actual image: `MemoryRepository.fullUrl` returns `localUri`,
 * which is null for all nine seeded rows, so the stage is the hue tile throughout. These
 * assert WHICH photo is open, by its uploader and by the counter -- never by pixels.
 */
test.describe('moving through the album from inside the viewer', () => {
  const openFirst = async (page: Page, scheme: 'dark' | 'light') => {
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-photos').click();
    await page.getByTestId(/^tile-/).first().click();
    await expect(page.getByTestId('viewer-stage')).toBeVisible();
  };

  test('says where you are in the album, which nothing did before', async ({ page }, testInfo) => {
    await openFirst(page, testInfo.project.name as 'dark' | 'light');
    await expect(page.getByTestId('viewer-position')).toHaveText('1 of 9');
  });

  test('next moves to the following photo and the position moves with it', async ({
    page,
  }, testInfo) => {
    await openFirst(page, testInfo.project.name as 'dark' | 'light');
    // The uploader's name is the only thing on this screen that identifies WHICH photo is
    // open -- the stage is a hue tile in every lane that runs in CI. Captured before and
    // compared after, so a next button that moved the counter and nothing else fails here.
    const before = await page.getByTestId('viewer-by').innerText();

    await page.getByTestId('viewer-next').click();

    await expect(page.getByTestId('viewer-position')).toHaveText('2 of 9');
    await expect(page.getByTestId('viewer-by')).not.toHaveText(before);
  });

  test('and previous comes back to exactly where you were', async ({ page }, testInfo) => {
    await openFirst(page, testInfo.project.name as 'dark' | 'light');
    const first = await page.getByTestId('viewer-by').innerText();

    await page.getByTestId('viewer-next').click();
    await expect(page.getByTestId('viewer-position')).toHaveText('2 of 9');
    await page.getByTestId('viewer-prev').click();

    await expect(page.getByTestId('viewer-position')).toHaveText('1 of 9');
    await expect(page.getByTestId('viewer-by')).toHaveText(first);
  });

  /**
   * HIDDEN AT THE ENDS, NOT DISABLED. A control that is drawn and does nothing is the defect
   * `aria-disabled` is this repo's gate for, and a guest cannot tell a dead button from a
   * broken one. Both ends are checked because they are separate conditions.
   */
  test('offers no previous on the first photo and no next on the last', async ({
    page,
  }, testInfo) => {
    await openFirst(page, testInfo.project.name as 'dark' | 'light');
    await expect(page.getByTestId('viewer-prev')).toHaveCount(0);
    await expect(page.getByTestId('viewer-next')).toBeVisible();

    for (let i = 0; i < 8; i += 1) await page.getByTestId('viewer-next').click();

    await expect(page.getByTestId('viewer-position')).toHaveText('9 of 9');
    await expect(page.getByTestId('viewer-next')).toHaveCount(0);
    await expect(page.getByTestId('viewer-prev')).toBeVisible();
  });

  /**
   * THE REGRESSION THE FILE ALREADY WARNS ABOUT, one control further on. `tile-*` is counted
   * to assert the album is nine; naming a viewer control `tile-something` silently doubled
   * that count once already. `viewer-prev` and `viewer-next` are deliberately not `tile-`,
   * and this is what would notice if that ever changed.
   */
  test('the new controls do not join the album count', async ({ page }, testInfo) => {
    await openFirst(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('viewer-next').click();
    await expect(page.getByTestId(/^tile-/)).toHaveCount(9);
  });

  test('closing from the middle of the album still returns to the grid', async ({
    page,
  }, testInfo) => {
    await openFirst(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('viewer-next').click();
    await page.getByTestId('viewer-next').click();
    await expect(page.getByTestId('viewer-position')).toHaveText('3 of 9');

    await page.getByTestId('viewer-close').click();
    await expect(page.getByTestId('viewer-stage')).toHaveCount(0);
    await expect(page.getByTestId(/^tile-/)).toHaveCount(9);
  });
});
