import { expect, test, type Page } from '@playwright/test';

import { UPCOMING, WEDDING, joinAsGuest, open, switchToHost } from './helpers';

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

/**
 * Make sure the guest-list section is open, whichever way it started.
 *
 * IT STARTS BOTH WAYS NOW. `defaultOpen` is true while the list is empty, because a host who
 * has invited nobody needs the contacts picker and the send control on screen rather than
 * folded behind a row summarising as "Nobody yet" -- which is what S7Y9RX shipped with, and
 * nobody opened it.
 *
 * `weddingSeed` LOOKS like the non-empty case and is not: it carries `invitedCount: 180` with
 * no `invitees` rows behind it (MemoryRepository.ts:922 says why), so the list here is empty
 * too and the section opens. A count and a list are different things -- the same distinction
 * #70 turned on -- and this is where that bites.
 *
 * So these tests stop caring which way it started. The DEFAULT is pinned explicitly, both
 * ways, in 'a guest list nobody has started' at the foot of this file.
 */
async function openInvitees(page: Page) {
  if (await page.getByTestId('invitee-email').isVisible()) return;
  await page.getByTestId('invitees-toggle').click();
  await expect(page.getByTestId('invitee-email')).toBeVisible();
}

const ADDRESS = 'sam@example.test';

test.describe('who is invited', () => {
  /**
   * THE NUMBER STILL MOVES; IT MOVED SURFACES (#72). This read the SEND BUTTON, because
   * `invitedCount` used to drive it — and #25's claim was exactly that: "a list that renders
   * while the composer still says 180 would have changed nothing that matters."
   *
   * The composer names the ROOM now, because that is who a broadcast can reach, so it no
   * longer moves when the invitation list does — correctly. The claim survives on the guest
   * list's own row, which is where the number is true.
   */
  test('adding someone moves the number on the guest list', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();

    // BEFORE: the seeded 180, on the row that carries it.
    await expect(page.getByTestId('invitees-toggle')).toContainText(
      `${WEDDING.invited} invited`,
    );

    await openInvitees(page);
    await expect(page.getByTestId('invitee-email')).toBeVisible();
    await page.getByTestId('invitee-email').fill(ADDRESS);
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    // AFTER.
    await expect(page.getByTestId('invitees-toggle')).toContainText(
      `${WEDDING.invited + 1} invited`,
    );

    // AND THE COMPOSER DID NOT MOVE, which is the other half and is new. Inviting somebody
    // does not change who an announcement reaches — only joining does.
    await page.getByTestId('host-segment-broadcast').click();
    await expect(page.getByTestId('broadcast-send')).toHaveText(
      `Send to ${WEDDING.present + 1} guests`,
    );
  });

  test('removing them puts it back', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();

    await openInvitees(page);

    await page.getByTestId('invitee-email').fill(ADDRESS);
    await page.getByTestId('invitee-add').click();
    const row = page.getByTestId('invitee-row');
    await expect(row).toHaveCount(1);

    // The remove control carries the row's own id, unlike the row wrapper — which is a
    // static repeated testID so a count assertion cannot be fooled by a text match.
    await page.locator('[data-testid^="invitee-remove-"]').first().click();
    await expect(row).toHaveCount(0);

    // Back to the seeded count, on the row that carries it.
    await expect(page.getByTestId('invitees-toggle')).toContainText(
      `${WEDDING.invited} invited`,
    );
  });

  test('the same address twice is refused, and the field keeps what was typed', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();

    await openInvitees(page);

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
    await openInvitees(page);

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
    await openInvitees(page);

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
    await openInvitees(page);

    // `weddingSeed` seeds no invitee rows, so the control must not be drawn at all --
    // the same rule as the invite row on BroadcastPanel.
    await expect(page.getByTestId('invitee-row')).toHaveCount(0);
    await expect(page.getByTestId('invitee-send')).toHaveCount(0);
  });

  /*
   * SEND EMAILS THE LIST, PRE-ADDRESSED IN BCC -- and a browser cannot claim it went.
   *
   * It opened a blank share sheet for months while its docblock promised "pre-addressed", and
   * this journey asserted the row flipped to "sent" afterwards. That was the FIXTURE's lie:
   * `MemoryRepository.send` opened nothing and stamped everyone. A real browser hands a
   * `mailto:` to the mail app and hears nothing back, so it stamps nobody. The stamped state is
   * reachable only through iOS's composer, which reports `sent`; MemoryRepository.test.ts
   * injects that and pins it. This proves what the web actually does.
   *
   * The BCC line is read from where the harness composer records it rather than inferred from
   * a toast. A test that only watched for a toast would pass on a Send that addressed nobody,
   * which is exactly the bug.
   */
  test('it emails the list in BCC, and a browser does not claim it was sent', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await openInvitees(page);

    await page.getByTestId('invitee-email').fill(ADDRESS.toUpperCase());
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    // The number is EMAILS, not people -- Send never texts anybody.
    const send = page.getByTestId('invitee-send');
    await expect(send).toHaveText('Email the invitation to 1');
    await send.click();

    const mailto = await page.evaluate(() => (globalThis as { __runitLastMailto?: string }).__runitLastMailto);
    expect(mailto?.startsWith('mailto:?')).toBe(true);
    const params = new URLSearchParams(mailto!.slice('mailto:?'.length));
    expect(params.get('bcc')).toBe(ADDRESS); // lowercased, as the unique index treats it
    expect(params.has('to')).toBe(false);
    expect(params.get('subject')).toMatch(/^You're invited to /);

    await expect(page.getByTestId('toast')).toContainText('in BCC');
    // NOT stamped: nothing confirmed it went, so the row does not say it did and Send still
    // offers the same person.
    await expect(page.getByTestId('invitee-row')).not.toContainText('sent');
    await expect(send).toHaveText('Email the invitation to 1');
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  /*
   * A PHONE NUMBER GOES ON THE LIST, AND SEND DOES NOT TEXT IT. The field was email-only, so a
   * host at a desktop -- no contacts picker there -- could not add one at all. And a group text
   * would put every guest's number in front of every other guest, so the screen says to use
   * Share rather than drawing a Send that cannot be private.
   */
  test('a phone number goes on the list, and Send does not text it', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await openInvitees(page);

    await page.getByTestId('invitee-email').fill('(555) 555-0100');
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    // Nobody to email, so no Send -- and no Copy, which would have nothing to copy.
    await expect(page.getByTestId('invitee-send')).toHaveCount(0);
    await expect(page.getByTestId('invitee-copy')).toHaveCount(0);
    await expect(page.getByTestId('invitee-phones')).toContainText('1 with only a phone number');
    await expect(page.getByTestId('invitee-phones')).toContainText('from Share');
  });

  test('a typo is refused rather than filed as an email', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await openInvitees(page);

    await page.getByTestId('invitee-email').fill('sam');
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(0);
    await expect(page.getByTestId('toast')).toContainText(/email address or a phone number/);
  });
});

/*
 * COPY ADDRESSES, the route that always works -- a desktop whose default mail app is not the
 * one the host uses, and a list too long for one `mailto:` link. Read back off the real
 * clipboard, which Chromium grants to a test that asks.
 */
test.describe('copying the addresses', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('puts every email on the clipboard, ready for BCC', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-event').click();
    await openInvitees(page);

    for (const a of ['Ruth@example.test', 'sam@example.test', '(555) 555-0100']) {
      await page.getByTestId('invitee-email').fill(a);
      await page.getByTestId('invitee-add').click();
    }
    await expect(page.getByTestId('invitee-row')).toHaveCount(3);

    await page.getByTestId('invitee-copy').click();
    await expect(page.getByTestId('toast')).toContainText('Copied 2 addresses');
    // The phone is not an address to paste into BCC, and the case is folded.
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'ruth@example.test, sam@example.test',
    );
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
    await openInvitees(page);
  };

  test('there is nothing to save until somebody is on the list', async ({ page }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light');
    // A control that cannot act is not drawn -- the rule three dead buttons were found for.
    await expect(page.getByTestId('guest-list-save')).toHaveCount(0);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  /*
   * A LIST CAN BE NAMED, which is what makes one reusable at all. Save named the list after the
   * PARTY with no way to type anything else, so a host wanting a "Family" list she brings to
   * every event could only get one by calling a party "Family". The owner asked for exactly
   * that list on 2026-09-21 and could not have made it.
   */
  test('a list can be named, so one called Family comes back at any party', async ({
    page,
  }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light');
    for (const a of ['ruth@example.test', '(555) 555-0100']) {
      await page.getByTestId('invitee-email').fill(a);
      await page.getByTestId('invitee-add').click();
    }
    await expect(page.getByTestId('invitee-row')).toHaveCount(2);

    await page.getByTestId('guest-list-name').fill('Family');
    await page.getByTestId('guest-list-save').click();

    await expect(page.getByTestId('toast')).toContainText('Saved as "Family"');
    // Offered back under the name she typed, with both members -- the phone included.
    await expect(page.locator('[data-testid^="guest-list-gl"]')).toContainText('Family (2)');
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

/**
 * THE GUEST LIST ANNOUNCES ITSELF WHEN IT IS EMPTY.
 *
 * Every test above works `weddingSeed`, which has 180 invitees -- so the section is closed,
 * every one of them taps `invitees-toggle` first, and none could ever have noticed what a
 * host with an EMPTY list sees. Which is the state that matters: S7Y9RX ran a real party on
 * 2026-09-11 with `invitees` at 0, and the contacts picker and the only send control in the
 * product were both folded behind a row summarising as "Nobody yet" -- a status line, not a
 * door. Nobody opened it and nobody joined.
 *
 * BOTH HALVES ARE ASSERTED because only the pair is the behaviour. Open-when-empty alone
 * would be satisfied by a section that never closes, which would undo the 1309px-on-an-874px
 * -viewport problem `Disclosure` was built for.
 */
/** The only world where the guest list is empty AND the counts agree with it. */
async function newEventConsole(page: Page, scheme: 'dark' | 'light') {
  await open(page, scheme, '/create', 'create-event');
  await page.getByTestId('create-host-name').fill('Ruth');
  await page.getByTestId('create-name').fill("Ruth's 40th");
  await page.getByTestId('create-date').fill(UPCOMING);
  await page.getByTestId('create-time').fill('19:00');
  await page.getByTestId('create-submit').click();
  await page.getByTestId('created-continue').click();
}

test.describe('a guest list nobody has started', () => {
  test('is already open, so the contacts picker is on screen without a tap', async ({
    page,
  }, testInfo) => {
    await newEventConsole(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('host-segment-event').click();

    // No `invitees-toggle` click anywhere in this test. That is the assertion.
    await expect(page.getByTestId('invitee-from-contacts')).toBeVisible();
    await expect(page.getByTestId('invitee-email')).toBeVisible();
  });

  test('and the row says what is behind it, not only that it is empty', async ({
    page,
  }, testInfo) => {
    await newEventConsole(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('host-segment-event').click();

    // The STATE still leads -- `Disclosure`'s docblock is explicit that a summary restating
    // the title makes the screen worse. What follows names what the title does not.
    await expect(page.getByTestId('invitees-toggle')).toContainText('Nobody yet');
    await expect(page.getByTestId('invitees-toggle')).toContainText(/contacts/i);
  });

  /**
   * AND IT STILL FOLDS ONCE THERE IS A LIST. Without this the change is "never close it",
   * which re-creates the 1309px-on-an-874px-viewport screen `Disclosure` exists to fix.
   *
   * IT CANNOT USE `weddingSeed`, and that is the trap this change fell into on its first
   * run: the wedding carries `invitedCount: 180` with NO `invitees` rows behind it
   * (MemoryRepository.ts:922 says why), so the list there is empty and the section correctly
   * opens -- which closed it under every existing test's toggle click. A count and a list are
   * different things, which is the same distinction #70 turned on.
   *
   * So the non-empty state is reached the way a host reaches it: add somebody, then return to
   * the segment so the panel decides again.
   */
  test('but a list that exists stays folded, summarised by its count', async ({
    page,
  }, testInfo) => {
    await newEventConsole(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('host-segment-event').click();
    await page.getByTestId('invitee-email').fill('sam@example.test');
    await page.getByTestId('invitee-add').click();
    await expect(page.getByTestId('invitee-row')).toHaveCount(1);

    await page.getByTestId('host-segment-broadcast').click();
    await page.getByTestId('host-segment-event').click();

    await expect(page.getByTestId('invitees-toggle')).toContainText('1 invited');
    await expect(page.getByTestId('invitee-from-contacts')).toHaveCount(0);
    await openInvitees(page);
    await expect(page.getByTestId('invitee-from-contacts')).toBeVisible();
  });
});
