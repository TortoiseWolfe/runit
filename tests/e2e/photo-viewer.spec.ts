import { expect, test } from '@playwright/test';

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
