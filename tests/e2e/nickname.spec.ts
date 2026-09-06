import { expect, test } from '@playwright/test';

import { joinAsGuest } from './helpers';

/**
 * Your own name -- issues #43 and #36.
 *
 * A guest typed a nickname once, on the join screen, and NO SCREEN EVER SHOWED IT BACK.
 * `grep -rn nickname src/features` found it in `JoinScreen` (the field) and otherwise only
 * as somebody ELSE's name, on a row you might report. So a guest learned theirs was wrong
 * the way the room did -- denormalised onto a song request, in front of everyone -- and
 * there was nothing anywhere to change it.
 *
 * The capability existed in SQL the whole time and nothing called it. What looked like the
 * route, `guests_update_self`, could never fire: `guests` has no SELECT policy, so the read
 * behind `UPDATE ... WHERE` matched nothing and PostgREST always sends a WHERE. That policy
 * is deleted rather than left as documentation for an implementation that fails silently.
 *
 * WHAT THIS FILE CANNOT PROVE. MemoryRepository, so nothing here says whether
 * `set_nickname` is granted to `authenticated`, refuses a non-guest, or rewrites the
 * denormalised copies inside ONE transaction. Lane E covers those, live.
 *
 * AND ONE GUARD IT DOES NOT REACH, stated rather than implied: the pill is drawn only when
 * the session is a guest with a non-empty name, and no journey here can produce an empty
 * one -- every path into `EventHeader` carries a nickname, including a host who has taken a
 * seat (#37), whose name is her host display name. Deleting that condition passes all eight
 * of these. It stays because `Session` permits the empty string and a bare rounded box in
 * the header is not something to find out about on a phone.
 */

const SEEDED = 'Ada';
// NOT a name containing the old one. `Adaline` was the first choice and made the assertion
// below unfalsifiable in the other direction: `not.toContainText('Ada')` fails on a correct
// rename, because the new name contains the old one as a substring.
const RENAMED = 'Wren';

test.describe('changing the name the room sees', () => {
  test('shows a guest their own name, which nothing did before', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme, SEEDED);

    await expect(page.getByTestId('name-pill')).toHaveText(SEEDED);
    // On every tab, because identity is not a chat concern -- your name is on the song
    // request and on the photo just as much.
    await page.getByTestId('tab-music').click();
    await expect(page.getByTestId('name-pill')).toHaveText(SEEDED);
  });

  test('a rename reaches the song request you already sent', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme, SEEDED);

    await page.getByTestId('tab-music').click();
    await page.getByTestId('request-input').fill('Blue Monday - New Order');
    await page.getByTestId('request-submit').click();
    await expect(page.getByTestId('music-queue')).toContainText(SEEDED);

    await page.getByTestId('name-pill').click();
    await page.getByTestId('name-input').fill(RENAMED);
    await page.getByTestId('name-save').click();

    await expect(page.getByTestId('name-pill')).toHaveText(RENAMED);
    // THE HALF THAT MAKES IT A RENAME. `requested_by_name` is denormalised and `not null`
    // so a deleted guest does not blank the history; a rename that moved only the pill
    // would leave the old name in front of the room, which is the state someone opens this
    // to fix.
    await expect(page.getByTestId('music-queue')).toContainText(RENAMED);
    await expect(page.getByTestId('music-queue')).not.toContainText(SEEDED);
  });

  test('will not take an empty name, and does not draw a control that refuses', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme, SEEDED);

    await page.getByTestId('name-pill').click();
    await page.getByTestId('name-input').fill('   ');
    // The house rule: a control that cannot act is not drawn, rather than drawn disabled.
    await expect(page.getByTestId('name-save')).toHaveCount(0);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);

    await page.getByTestId('name-cancel').click();
    await expect(page.getByTestId('name-pill')).toHaveText(SEEDED);
  });

  test('cancelling leaves the name alone, and reopening shows the real one', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme, SEEDED);

    await page.getByTestId('name-pill').click();
    await page.getByTestId('name-input').fill('Discarded');
    await page.getByTestId('name-cancel').click();
    await expect(page.getByTestId('name-pill')).toHaveText(SEEDED);

    // A draft that survived a cancel would offer the discarded name back as if it were
    // real -- and the next Save would take it.
    await page.getByTestId('name-pill').click();
    await expect(page.getByTestId('name-input')).toHaveValue(SEEDED);
  });
});
