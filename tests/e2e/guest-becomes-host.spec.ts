import { expect, test } from '@playwright/test';

import { WEDDING, open } from './helpers';

/**
 * `?guest=1` IS THE WHOLE REASON THESE TESTS CAN SEE ANYTHING. Every other seed answers
 * `holdsHostSeat: true`, so in them a "guest" is also staff and gets the console switch
 * where a real guest gets this control. Measured: without this world, deleting the control
 * left the entire board green.
 */
async function joinAsPlainGuest(page: import('@playwright/test').Page, scheme: 'dark' | 'light') {
  await open(page, scheme, '/join?guest=1', 'join-submit');
  await page.getByTestId('join-nickname').fill('Ada');
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('chat-feed')).toBeVisible();
}

/**
 * THE PATH FROM GUEST TO HOST, WHICH IS HOW THIS PRODUCT GROWS -- #76.
 *
 * Somebody is at a party, enjoys it, and wants their own. Before this there was exactly one
 * link to the create screen in the whole app, on the join screen, which a guest sees once --
 * before they join -- and never again. Reaching it meant tapping Leave and tearing down the
 * party they were standing in. And leaving was a ONE-WAY DOOR: `my_events()` listed host
 * seats only, so the party they left was not in their list and the only way back was the
 * six-character code off a place card at a venue they had left.
 *
 * A real party ran on this app on 2026-09-11 and produced zero anonymous sign-ins. The whole
 * supply side ran through one quiet link on one screen.
 *
 * There is NO PERMISSION GATE and there never was: `create_event` is granted to
 * `authenticated`, which an anonymous guest session already holds. What was missing was a
 * door, and a way back through it.
 *
 * WHAT LANE B CANNOT SHOW, stated rather than implied: the party you have JUST LEFT
 * appearing in the list. `MemoryRepository.closeEvent` keeps `event.current` set -- the join
 * screen still draws the invitation afterwards -- and that screen's list passes
 * `hideCurrent`, so the one row this work is most about is the one row it will never render
 * here. Against Supabase `event.current` goes null and the row is the only route back. Lane
 * E asserts it instead: *"a party she JOINED is in her list now"*, and that it reads `guest`.
 */

test.describe('a guest can make their own party without leaving this one', () => {
  test('the way to host is on the guest tab, not behind Leave', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsPlainGuest(page, scheme);

    // Mutation-checked: removing this control turns this red. It sits in the footer slot
    // where a HOST gets her console switch -- the same slot, the right control for who you
    // are. A guest used to get nothing there.
    await expect(page.getByTestId('guest-make-your-own')).toBeVisible();
    await page.getByTestId('guest-make-your-own').click();
    await expect(page.getByTestId('create-event')).toBeVisible();
  });

  test('the parties they are a guest at are in their list', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsPlainGuest(page, scheme);
    await page.getByTestId('leave-event').click();
    await page.getByTestId('leave-confirm').click();

    // `my_events()` carries GUEST seats now. Before #76 it joined `hosts` only, so this
    // list was empty for a guest and the only way back to a party was the six-character
    // code off a place card at a venue they had left.
    await expect(page.getByTestId('my-events')).toBeVisible();
    await expect(page.getByTestId('my-event-BD4417')).toBeVisible();
  });

  test('that row says Guest, not a host title it invented', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsPlainGuest(page, scheme);
    await page.getByTestId('leave-event').click();
    await page.getByTestId('leave-confirm').click();

    // `my_events()` returns NULL role and role_label for a guest seat, so the word comes
    // from `seat`. A row reading "Bride" over somebody else's party would be `hosts` data
    // that came from nowhere -- and would offer a console she cannot open.
    await expect(page.getByTestId('my-event-BD4417')).toContainText('Guest');
    await expect(page.getByTestId('my-event-BD4417')).not.toContainText('Bride');
  });

  test('walking into one returns them as a guest, not into a console', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsPlainGuest(page, scheme);
    await page.getByTestId('leave-event').click();
    await page.getByTestId('leave-confirm').click();
    await page.getByTestId('my-event-BD4417').click();

    // The guest tabs, and the guest control in the footer slot. Opening a guest row into a
    // host console would hand somebody the run of a party they are a guest at.
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await expect(page.getByTestId('guest-make-your-own')).toBeVisible();
    await expect(page.getByTestId('role-switch')).toHaveCount(0);
  });

  test('a person with no party and no seat still sees no list', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // `?empty=1` is the cold open: no event, no seat anywhere. An empty "Your events"
    // heading there would be a promise to the guests who are most of this app's users.
    await open(page, scheme, '/join?empty=1', 'join-submit');
    await expect(page.getByTestId('my-events')).toHaveCount(0);
  });
});
