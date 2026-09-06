import { expect, test } from '@playwright/test';

import { WEDDING, open } from './helpers';

/**
 * Scanning an invitation -- issue #28.
 *
 * `README.md` has promised "guests scan a QR or type a code" since the first commit, and
 * only generation existed: `EventQr` on the host console, decoded by Lane F, and nothing
 * anywhere reading one back in. FIDELITY note O records the attempt to close that gap by
 * editing the README instead, and reverting it.
 *
 * WHAT THIS FILE PROVES AND WHAT IT CANNOT. There is no camera in this environment --
 * headless Chromium refuses `getUserMedia` and react-native-web has no `CameraView` -- so
 * `QrScanner.web.tsx` stands in, and under `EXPO_PUBLIC_FIDELITY=1` it offers one control
 * that feeds `codeFromScan` the exact string `joinLink()` produces. So these journeys
 * prove the WIRING: that a scan reaches the field, that the invitation is looked up for
 * it, that a join follows, and that every exit lands back on the keyboard. They prove
 * NOTHING about a lens, a permission prompt, or `barcodeScannerSettings`. The parsing --
 * where every real failure of a scanner lives -- is unit-tested in `src/lib/invite.test.ts`
 * against `joinLink`'s own output. FIDELITY note AL.
 */

test.describe('scanning an invitation', () => {
  test('the scanner is reachable, and typing never stops being an option', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // The field is the primary path and the control sits beside it, not over it.
    await expect(page.getByTestId('join-code')).toBeVisible();
    await page.getByTestId('join-scan').click();
    await expect(page.getByTestId('qr-scanner')).toBeVisible();

    // A scanner someone cannot get out of is worse than no scanner.
    await page.getByTestId('qr-cancel').click();
    await expect(page.getByTestId('qr-scanner')).toHaveCount(0);
    await expect(page.getByTestId('join-code')).toBeVisible();
  });

  test('a scan fills the field and resolves the invitation', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // `?invited=1`, NOT the default world, and the choice is the test. The default seed
    // has `event.current`, so the field arrives pre-filled from it and a scan that did
    // nothing at all would look identical to one that worked. `invitedSeed` is the middle
    // of the three worlds -- no event, but a code that resolves to one -- which is exactly
    // the state of a phone at a door.
    await open(page, scheme, '/join?invited=1');

    // The field starts empty in this world: nothing is joined and no link carried a code.
    await expect(page.getByTestId('join-code')).toHaveValue('');

    await page.getByTestId('join-scan').click();
    await page.getByTestId('qr-simulate').click();

    await expect(page.getByTestId('qr-scanner')).toHaveCount(0);
    await expect(page.getByTestId('join-code')).toHaveValue(WEDDING.code);
    // NOT JUST THE FIELD. A code that fills the box but resolves nothing leaves a guest
    // looking at "An event" -- the exact failure #15 was filed for. The lookup has to fire
    // for a scan the way it does for a tapped link.
    await expect(page.getByText(WEDDING.name)).toBeVisible();
  });

  test('and the scanned code is the one that joins', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // The DEFAULT world here, not `?invited=1`: an `EventPreview` carries seven of
    // `RunitEvent`'s twelve fields, so Memory cannot honestly model the join that follows
    // an invitation, and `invitation.spec.ts` says so rather than faking it.
    await open(page, scheme);

    // Which means the field arrives pre-filled from `event.current`, and a scan that did
    // nothing would be invisible. So put a code in it that does NOT match, and let the
    // scan be the only thing that could have replaced it.
    await page.getByTestId('join-code').fill('ZZ9999');
    await page.getByTestId('join-scan').click();
    await page.getByTestId('qr-simulate').click();
    await expect(page.getByTestId('join-code')).toHaveValue(WEDDING.code);

    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();

    // The end of the journey the README promised: scan, nickname, in. Had the scan not
    // reached the field, this join would be refused with "That code doesn't match an
    // event." and the feed would never mount.
    await expect(page.getByTestId('chat-feed')).toBeVisible();
  });
});
