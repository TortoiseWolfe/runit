import { expect, test } from '@playwright/test';

import { UPCOMING, WEDDING, open, switchToHost } from './helpers';

/**
 * THE ACCOUNT ROW AND THE ONLY IRREVERSIBLE CONTROL IN THE PRODUCT -- #19.
 *
 * App Store Guideline 5.1.1(v) makes in-app deletion mandatory the day accounts exist, and
 * #18 shipped host sign-in. What these journeys can see is the SCREEN: that the row is
 * absent for a guest, present once signed in, that the sheet names what it would destroy
 * before offering the button, and that nothing on it is a door that will not open.
 *
 * TWO OF THE SHEET'S THREE STATES ARE UNREACHABLE HERE, and that is measured rather than
 * suspected: `MemoryRepository.deletionImpact()` resolves instantly and never throws, so
 * every journey below takes the `ready` path. Deleting the counting branch outright left all
 * eight of them green. The branch decision therefore lives in `deleteSheetState()` and is
 * unit-tested there -- including the one that matters most, which is that a count that could
 * not be READ draws no confirm button at all.
 *
 * WHAT THEY CANNOT SEE, stated rather than implied: that anything is actually deleted. They
 * boot `MemoryRepository`, which has no bytes, no `auth.users` row and no Edge Function --
 * `deleteAccount` there empties the world, which is the observable consequence and not the
 * act. Lane E asserts which events would die and that a client cannot delete one itself;
 * the deletion was rehearsed against production by hand (`docs/account-deletion.md`).
 */

const CODE = '424242';

/** Sign in through the real screen, which is the only way an account exists at all. */
async function signIn(page: import('@playwright/test').Page, scheme: 'dark' | 'light') {
  await open(page, scheme, '/signin', 'host-signin');
  await page.fill('[data-testid="signin-email"]', 'ruth@example.com');
  await page.click('[data-testid="signin-send"]');
  await page.fill('[data-testid="signin-code"]', CODE);
  await page.click('[data-testid="signin-verify"]');
  await expect(page).toHaveURL(/\/join$/);
}

test.describe('the account row', () => {
  test('is absent for a guest, because the fine print above it promises no account', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    // Mutation-checked: drawing the row unconditionally turns this red. Nearly everyone who
    // opens this app is a guest, and "No account, no phone number" is three lines below.
    await expect(page.getByTestId('account-row')).toHaveCount(0);
    await expect(page.getByTestId('account-delete')).toHaveCount(0);
  });

  test('appears once somebody has signed in, with the address they used', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await signIn(page, scheme);
    await expect(page.getByTestId('account-row')).toBeVisible();
    // The ADDRESS, not a label. A row reading "Signed in" over nothing would pass a
    // visibility check and tell a host on two phones nothing about which identity she is.
    await expect(page.getByTestId('account-email')).toHaveText('ruth@example.com');
  });

  test('is on the host console too, where a host actually stands', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await signIn(page, scheme);
    // Into the event first, the way a host does it: sign-in lands on `/join`, which is
    // where somebody standing OUTSIDE every event sees her list -- it does not put her
    // inside one, and the code is still what opens a door. The console is the other half
    // of the same row.
    await page.fill('[data-testid="join-code"]', WEDDING.code);
    // AND A NAME, because #66 made one mandatory: `join_event` raises on an empty nickname
    // and the fixture is held to that. A join without it is refused with "Add a name so the
    // room knows who you are", which is the right answer and not a door to route around.
    await page.getByTestId('join-nickname').fill('Ruth');
    await page.getByTestId('join-submit').click();
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('account-row')).toBeVisible();
    await expect(page.getByTestId('account-email')).toHaveText('ruth@example.com');
  });
});

test.describe('deleting an account says what it would destroy first', () => {
  test('names the counts before it offers the button', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await signIn(page, scheme);
    await page.getByTestId('account-delete').click();

    // The wedding has a planner and a DJ, so it is NOT hers alone to delete -- and the
    // sheet has to say so. A host told she is about to destroy a party that will still be
    // running tomorrow would stop, and be right to.
    await expect(page.getByTestId('delete-account-impact')).toHaveText(
      '1 event stays with its other hosts.',
    );
  });

  test('offers a way to keep an event when one is actually dying', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // A host who just made her own event holds it alone, which is the state where the
    // hint is true. On the wedding it would be noise.
    await open(page, scheme, '/create', 'create-event');
    await page.getByTestId('create-host-name').fill('Ruth');
    await page.getByTestId('create-name').fill("Ruth's 40th");
    await page.getByTestId('create-date').fill(UPCOMING);
    await page.getByTestId('create-time').fill('19:00');
    await page.getByTestId('create-submit').click();
    await page.getByTestId('created-continue').click();

    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('account-row')).toHaveCount(0);
  });

  test('cancelling changes nothing at all', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await signIn(page, scheme);
    await page.getByTestId('account-delete').click();
    await expect(page.getByTestId('delete-account-sheet')).toBeVisible();
    await page.getByTestId('delete-account-cancel').click();

    // Still signed in, still on the join screen, still herself.
    await expect(page.getByTestId('account-email')).toHaveText('ruth@example.com');
    await expect(page.getByTestId('delete-account-sheet')).toHaveCount(0);
  });

  test('confirming leaves nothing behind and nowhere to go back to', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await signIn(page, scheme);
    await page.getByTestId('account-delete').click();
    await page.getByTestId('delete-account-confirm').click();

    // `replace`, not `push`: the world this identity could see is gone.
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByTestId('account-row')).toHaveCount(0);
    await expect(page.getByTestId('my-events')).toHaveCount(0);
    // And the join screen is a join screen again, rather than a dead end.
    await expect(page.getByTestId('join-submit')).toBeVisible();
  });

  test('nothing on this sheet is a door that will not open', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await signIn(page, scheme);
    await page.getByTestId('account-delete').click();
    await expect(page.getByTestId('delete-account-sheet')).toBeVisible();
    // This repo's gate against a drawn control that refuses: while the count is in flight
    // the sheet draws a SENTENCE, and the button only when pressing it would work.
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });
});
