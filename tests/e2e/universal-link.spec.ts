import { expect, test } from '@playwright/test';

import { WEDDING, open } from './helpers';

/**
 * Arriving on a universal link — issue #33.
 *
 * The QR used to encode `runit://join?code=…`, which `src/lib/invite.ts` described in its
 * own docblock as "a dead string" to anyone without the app. A printed card is handed to
 * strangers, so the single person a printed QR exists for got nothing at all.
 *
 * It now encodes `https://<origin>/i/<CODE>`. With the association file in place iOS opens
 * the app on that path, which is why `src/app/i/[code].tsx` has to exist — otherwise
 * expo-router falls through to `+not-found` and an invitation opens the app on an error
 * screen, which is worse than opening the browser.
 *
 * WHAT THIS FILE CANNOT PROVE, AND IT IS THE IMPORTANT HALF. Nothing here shows that iOS
 * accepts the association file, that Apple's CDN fetched it, or that a tap on a real phone
 * reaches the app rather than Safari. There is no Mac in this environment and Apple caches
 * the file for days. This proves the ROUTE — that the app knows what to do with the path
 * once it is handed one. `src/lib/invite.test.ts` proves the four config artefacts agree.
 * A device is the only thing that proves the rest, and until one has, treat the universal
 * link as unverified.
 */

test.describe('a link that opens the app', () => {
  test('lands on the join screen with the code already filled', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // The path half of https://<origin>/i/SR1017 — what iOS hands expo-router.
    await open(page, scheme, `/i/${WEDDING.code}`);

    await expect(page.getByTestId('join-code')).toHaveValue(WEDDING.code);
    // A guest who followed an invitation has done the code half already; the nickname is
    // the only thing still being asked of them.
    await expect(page.getByTestId('join-nickname')).toHaveValue('');
  });

  test('takes the code however it was typed or scanned', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // A QR may carry any case, and a link may be retyped by hand.
    await open(page, scheme, '/i/sr1017');
    await expect(page.getByTestId('join-code')).toHaveValue(WEDDING.code);
  });

  test('a truncated link still leaves someone somewhere they can act', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // `/i/` with nothing after it is a link that got cut in a message. They are holding an
    // invitation either way, so the join screen is the right place — not `+not-found`,
    // which reads as "this event does not exist" and is a different, wrong claim.
    await open(page, scheme, '/i/');

    await expect(page.getByTestId('join-submit')).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('the invitation still opens the event, not just the screen', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // End to end through the route: a scanned code should be joinable without retyping it,
    // which is the entire promise a QR makes.
    await open(page, scheme, `/i/${WEDDING.code}`);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();

    await expect(page.getByTestId('chat-feed')).toBeVisible();
  });
});
