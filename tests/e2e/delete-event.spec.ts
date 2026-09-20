import { expect, test } from '@playwright/test';

import { UPCOMING, open } from './helpers';

/**
 * DELETING ONE PARTY AND KEEPING YOUR ACCOUNT -- #73.
 *
 * `create_event` allows TEN events per identity, forever, and nothing frees one. A host who
 * made three to try the app has burned three of her ten permanently, and until now the only
 * remedy was #19's account deletion -- the nuclear option wearing a cap remedy's clothes.
 *
 * WHAT LANE B CAN SEE: the control, the counting, the sentence, and that the world is gone
 * afterwards. WHAT IT CANNOT: that a byte left a bucket, or that a co-host is refused. The
 * first needs the Edge Function, which no lane here executes; the second needs two
 * identities, which `MemoryRepository` does not have. Lane E asserts the seat rule
 * (`a co-host holding a seat there is NOT the founder`) and that even the founder cannot
 * DELETE the row from a client.
 */

/** A party she just made, which is the one a host actually deletes. */
async function ownEvent(page: import('@playwright/test').Page, scheme: 'dark' | 'light') {
  await open(page, scheme, '/create', 'create-event');
  await page.getByTestId('create-host-name').fill('Ruth');
  await page.getByTestId('create-name').fill('Test party');
  await page.getByTestId('create-date').fill(UPCOMING);
  await page.getByTestId('create-time').fill('19:00');
  await page.getByTestId('create-submit').click();
  // The code is shown once on the way through and nowhere after, and it is how a journey
  // names the row that should disappear.
  const code = await page.getByTestId('created-code').innerText();
  await page.getByTestId('created-continue').click();
  await page.getByTestId('host-segment-event').click();
  return code;
}

test.describe('a host can delete one party without deleting herself', () => {
  test('the control is on the event panel, below everything she might be reaching for', async ({
    page,
  }, testInfo) => {
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await expect(page.getByTestId('event-delete')).toBeVisible();
  });

  test('it names the party, because a host with several is one tap from the wrong one', async ({
    page,
  }, testInfo) => {
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('event-delete').click();
    await expect(page.getByTestId('delete-event-sheet')).toContainText('Test party');
  });

  test('it counts first, and a party nobody came to still gets a sentence', async ({
    page,
  }, testInfo) => {
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('event-delete').click();

    // The commonest thing a host deletes is the test event she made to see how the app
    // works. A blank space above a red button is not a confirmation.
    await expect(page.getByTestId('delete-event-impact')).toHaveText(
      'Nobody has added anything to it yet.',
    );
  });

  test('cancelling leaves the party exactly where it was', async ({ page }, testInfo) => {
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('event-delete').click();
    await page.getByTestId('delete-event-cancel').click();

    await expect(page.getByTestId('delete-event-sheet')).toHaveCount(0);
    await expect(page.getByTestId('event-name')).toHaveValue('Test party');
  });

  test('confirming takes the party and leaves her standing somewhere', async ({
    page,
  }, testInfo) => {
    const code = await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('event-delete').click();
    await page.getByTestId('delete-event-confirm').click();

    // `/join`, not a dead console over an event that no longer exists.
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByTestId('join-submit')).toBeVisible();
    // THAT party is gone.
    await expect(page.getByTestId(`my-event-${code}`)).toHaveCount(0);
    // AND HER OTHERS ARE NOT, which is the whole difference between this and #19. The first
    // draft of this test asserted the list was EMPTY and failed -- correctly, because her
    // other parties had survived exactly as they should.
    await expect(page.getByTestId('my-events')).toBeVisible();
  });

  test('nothing on this sheet is a door that will not open', async ({ page }, testInfo) => {
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('event-delete').click();
    await expect(page.getByTestId('delete-event-sheet')).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });
});
