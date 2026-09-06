import { expect, test } from '@playwright/test';

import { WEDDING, joinAsGuest, switchToHost } from './helpers';

/**
 * The guest list — issue #25.
 *
 * The composer has always said "Send to 180 guests", and until now **nothing in the app
 * could set that number.** The `invitees` table has existed since the first migration with
 * four host-only policies and a count-folding trigger; there was simply no screen.
 *
 * WHAT WAS NEARLY DONE INSTEAD, and why it would have been wrong: deleting the copy. The
 * number is not a fiction — `invitedCount` and `guestCount` are two deliberately different
 * facts, documented in the type, in the schema, and in a test in `host-console.spec.ts`
 * literally named "the composer addresses all 180 invited, not the 173 standing in the
 * room". The gap was that no screen could set it.
 *
 * WHAT THIS FILE CANNOT PROVE. It runs `MemoryRepository`, so it says nothing about
 * whether the RLS holds, whether the fold fires, or whether a second host can read the
 * list. Lane E proves all of that against the live database — including the DELETE arm of
 * the fold, which had never executed before this issue. This file proves the screen.
 *
 * NOTHING HERE SENDS ANYTHING, and there is no control that could. `invitedAt` is written
 * by no code path in the product.
 */

const ADDRESS = 'sam@example.test';

test.describe('who is invited', () => {
  test('adding someone moves the number the composer addresses', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // BEFORE: the seeded 180, on the send button itself.
    await expect(page.getByTestId('broadcast-send')).toHaveText(
      `Send to ${WEDDING.invited} guests`,
    );

    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('invitee-email')).toBeVisible();
    await page.getByTestId('invitee-email').fill(ADDRESS);
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    // AFTER. The number moving is the entire claim of this issue — a list that renders
    // while the composer still says 180 would have changed nothing that matters.
    await page.getByTestId('host-segment-broadcast').click();
    await expect(page.getByTestId('broadcast-send')).toHaveText(
      `Send to ${WEDDING.invited + 1} guests`,
    );
  });

  test('removing them puts it back', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();

    await page.getByTestId('invitee-email').fill(ADDRESS);
    await page.getByTestId('invitee-add').click();
    const row = page.getByTestId('invitee-row');
    await expect(row).toHaveCount(1);

    // The remove control carries the row's own id, unlike the row wrapper — which is a
    // static repeated testID so a count assertion cannot be fooled by a text match.
    await page.locator('[data-testid^="invitee-remove-"]').first().click();
    await expect(row).toHaveCount(0);

    await page.getByTestId('host-segment-broadcast').click();
    await expect(page.getByTestId('broadcast-send')).toHaveText(
      `Send to ${WEDDING.invited} guests`,
    );
  });

  test('the same address twice is refused, and the field keeps what was typed', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();

    await page.getByTestId('invitee-email').fill(ADDRESS);
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    // Another case of the same address is the SAME PERSON — the unique index is
    // case-insensitive for exactly this reason, and double-mailing someone is the fastest
    // way to look broken.
    await page.getByTestId('invitee-email').fill(ADDRESS.toUpperCase());
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    // The address STAYS in the field. Vanishing it on a rejection leaves the host unable
    // to see what they typed, which is the moment they most need to.
    await expect(page.getByTestId('invitee-email')).toHaveValue(ADDRESS.toUpperCase());
  });
});
