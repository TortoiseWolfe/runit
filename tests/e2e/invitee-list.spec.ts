import { expect, test, type Page } from '@playwright/test';

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
 * SOMETHING SENDS NOW, AND THIS FILE'S OLD DOCBLOCK SAID OTHERWISE. It read "nothing here
 * sends anything, and there is no control that could" -- true for the life of the repo, and
 * false as of #60. `invitees.send` hands the invitation to the phone's own composer and
 * stamps `invitedAt` through `mark_invited`.
 *
 * WHAT THE SEND ASSERTIONS BELOW ACTUALLY PROVE, said rather than implied: that the control
 * exists, that it addresses the UNSENT, that the rows change state and that the label follows.
 * They do NOT prove a composer opened -- `MemoryRepository` has no OS and `share.web.ts` is a
 * stub that resolves false without building anything. Only a phone witnesses the sheet, and
 * nothing witnesses delivery, because the OS reports that the sheet was used and nothing after.
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
    await page.getByTestId('invitees-toggle').click();
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

    await page.getByTestId('invitees-toggle').click();

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

    await page.getByTestId('invitees-toggle').click();

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

/**
 * BUILDING THE LIST FROM THE ADDRESS BOOK, AND WHAT THE WEB CAN SEE OF IT (#60).
 *
 * `contacts.web.ts` returns null -- deliberately, and for the reason `expo-secure-store`
 * taught this repo: an Expo native module's web build is a stub by DEFAULT, so a shared-code
 * caller throws rather than degrading. So the harness cannot open a picker.
 *
 * That makes these tests about the CALLER's behaviour, which is the half that has been wrong
 * before: the control must be drawn, must be reachable, must not be aria-disabled, and a
 * dismissed picker must leave the list alone and say nothing. A toast apologising for a
 * decision the host made is the failure `capture.ts` states the rule for.
 */
test.describe('adding from contacts', () => {
  test('the control is there and is not a dead button', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await page.getByTestId('invitees-toggle').click();

    await expect(page.getByTestId('invitee-from-contacts')).toBeVisible();
    // The class assertion, same as empty-world.spec.ts. A control that cannot act must not
    // be drawn disabled -- it reads as broken software, which is how three of these were
    // found, each separately, on a phone.
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('a picker that returns nothing changes nothing and does not apologise', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await page.getByTestId('invitees-toggle').click();

    const before = await page.getByTestId('invitee-row').count();
    await page.getByTestId('invitee-from-contacts').click();

    // Backing out is a decision. The list is untouched and no toast fires -- on web the
    // stub returns null, which is the same shape as a dismissal on a phone.
    await expect(page.getByTestId('invitee-row')).toHaveCount(before);
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });
});

/**
 * SENDING -- the column that had no writer.
 */
test.describe('sending the invitation', () => {
  test('there is nobody to send to until somebody is on the list', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await page.getByTestId('invitees-toggle').click();

    // `weddingSeed` seeds no invitee rows, so the control must not be drawn at all --
    // the same rule as the invite row on BroadcastPanel.
    await expect(page.getByTestId('invitee-row')).toHaveCount(0);
    await expect(page.getByTestId('invitee-send')).toHaveCount(0);
  });

  test('it names how many are UNSENT, and stops offering them once they are sent', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await page.getByTestId('invitees-toggle').click();

    await page.getByTestId('invitee-email').fill(ADDRESS);
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    // BEFORE: one person, nobody sent to. The number on the button is the UNSENT count,
    // which is the whole reason it is not just "Send".
    const send = page.getByTestId('invitee-send');
    await expect(send).toHaveText('Send the invitation to 1');

    await send.click();

    // AFTER: the row says so, and the button stops offering to send to somebody who has
    // already been sent to. A button that always reads "Send to 1" would pass a mere
    // existence check and tell the host nothing.
    await expect(page.getByTestId('invitee-row')).toContainText('sent');
    await expect(send).toHaveText('Send the invitation again');
  });
});

/**
 * A GUEST LIST THAT OUTLIVES THE EVENT (#59).
 *
 * `invitees` is keyed to the event and cascades with it -- right for a roster, wrong for an
 * address book. These prove the SCREEN: that a roster can be saved, that a saved list is
 * offered back, and that attaching it copies rather than points.
 *
 * WHAT THEY CANNOT PROVE, because Lane B is `MemoryRepository`: that the RLS holds, that
 * another identity cannot read your lists, or that `forget_person` reaches an event you host
 * but not one you do not. Lane E proves all four against a real database.
 */
test.describe('saved guest lists', () => {
  const open = async (page: Page, scheme: 'dark' | 'light') => {
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await page.getByTestId('invitees-toggle').click();
  };

  test('there is nothing to save until somebody is on the list', async ({ page }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light');
    // A control that cannot act is not drawn -- the rule three dead buttons were found for.
    await expect(page.getByTestId('guest-list-save')).toHaveCount(0);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('saving the roster offers it back, with its size', async ({ page }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('invitee-email').fill(ADDRESS);
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    await expect(page.getByTestId('guest-list-save')).toHaveText('Save these 1 as a list');
    await page.getByTestId('guest-list-save').click();

    // The COUNT is the assertion with teeth. A list that renders its name proves a row
    // exists; only the size proves the members were copied into it.
    await expect(page.locator('[data-testid^="guest-list-gl"]')).toContainText(/\(1\)/);
  });

  test('attaching a saved list copies people in, and twice adds nobody', async ({
    page,
  }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('invitee-email').fill(ADDRESS);
    await page.getByTestId('invitee-add').click();
    await page.getByTestId('guest-list-save').click();
    const saved = page.locator('[data-testid^="guest-list-gl"]').first();
    await expect(saved).toBeVisible();

    // Clear the roster, then bring it back from the list. This is the whole feature: the
    // people survive the event they were typed into.
    await page.getByTestId('invitee-row').first().getByText('Remove').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(0);

    await saved.click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    // ATTACHING AGAIN ADDS NOBODY, which is what "by copy with deduplication" means and
    // what a host doing it twice by accident must not be punished for.
    await saved.click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);
    await expect(page.getByTestId('toast')).toContainText(/already invited/i);
  });
});
