import { expect, test } from '@playwright/test';

import { open } from './helpers';

/**
 * Making your own event -- issues #13 and #32.
 *
 * Runit had no supply side. Every event, host seat, folder and key in existence came
 * from a human running `supabase/seed-events.sql` with the database password, so a host
 * could operate an event somebody else conjured and could not have one. The question
 * that named it: "where is the hostess supposed to get a key to her own party."
 *
 * The answer is that she needs no key to get IN -- `create_event` binds her seat in the
 * same transaction that makes the event -- and needs one to get BACK in, because that
 * seat is bound to an anonymous session in a keystore that a reinstall wipes.
 *
 * WHAT THIS FILE CANNOT PROVE. It runs MemoryRepository, so nothing here says whether
 * `create_event` is granted correctly, whether it mints a folder, or whether the key it
 * returns actually opens the event from a different identity. Only Lane E can see that,
 * and it does: `supabase/verify-policies.sql` creates an event as one user, then claims
 * it back as ANOTHER, then rotates and proves the old key stops working. This file
 * proves the screens.
 */

/** Every code and key is drawn from this alphabet: no 0/O, no 1/I/L. */
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const KEY = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

async function fillTheForm(page: import('@playwright/test').Page) {
  await page.getByTestId('create-host-name').fill('Ruth');
  await page.getByTestId('create-name').fill("Ruth's 40th");
  await page.getByTestId('create-date').fill('2026-09-11');
  await page.getByTestId('create-time').fill('19:00');
  await page.getByTestId('create-venue').fill('The garden');
  await page.getByTestId('create-doors').fill('Doors 7:00 PM');
}

test.describe('making your own event', () => {
  test('the join screen offers a way in for the person running the party', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // Before this link there was no path to creating an event at all. It is deliberately
    // quiet -- nearly everyone here is a guest holding a code -- but it has to exist.
    await expect(page.getByTestId('join-create-event')).toBeVisible();
    await page.getByTestId('join-create-event').click();
    await expect(page.getByTestId('create-event')).toBeVisible();
  });

  test('does not offer Create until it has something to create', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/create', 'create-event');

    // A control that cannot act is not drawn, the same rule as the calendar pill.
    await expect(page.getByTestId('create-submit')).toHaveCount(0);
    await expect(page.getByTestId('create-blocked')).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);

    // A name alone is not enough: an event with no date is the bug this whole arc came
    // out of, so the form refuses to make one.
    await page.getByTestId('create-name').fill("Ruth's 40th");
    await expect(page.getByTestId('create-submit')).toHaveCount(0);

    await page.getByTestId('create-date').fill('2026-09-11');
    await expect(page.getByTestId('create-submit')).toBeVisible();
  });

  test('reads the typed date and time back before anything is created', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/create', 'create-event');

    await page.getByTestId('create-date').fill('2026-09-11');
    await page.getByTestId('create-time').fill('19:00');
    // The zone list folds away -- the chosen zone is always in words on the reading
    // line, its alternatives are behind the toggle. `zoneChoices` already puts this
    // phone's own zone first, so the common case needs no interaction at all.
    await expect(page.getByTestId('create-zone-America/New_York')).toHaveCount(0);
    await page.getByTestId('create-zone-toggle').click();
    await page.getByTestId('create-zone-America/New_York').click();
    await expect(page.getByTestId('create-zone-America/New_York')).toHaveCount(0);

    // The defence against a zone nobody meant to pick. Without it, the first thing a
    // host learns about her event's time is what her guests' calendars say.
    await expect(page.getByTestId('create-starts-preview')).toHaveText('Fri, Sep 11 · 7:00 PM');
  });

  test('hands over a join code and a recovery key, and says what the key is for', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/create', 'create-event');
    await fillTheForm(page);
    await page.getByTestId('create-submit').click();

    await expect(page.getByTestId('create-done')).toBeVisible();
    await expect(page.getByTestId('created-code')).toHaveText(CODE);
    await expect(page.getByTestId('created-key')).toHaveText(KEY);

    // The sentence matters as much as the string: this is the only moment the key
    // exists anywhere, and a host who does not know that will not write it down.
    await expect(page.getByText(/only way back into this event on another phone/)).toHaveCount(1);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('lands her in her own host console, with nothing left to claim', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/create', 'create-event');
    await fillTheForm(page);
    await page.getByTestId('create-submit').click();
    await page.getByTestId('created-continue').click();

    // She is the host because she made it. A guest session here would send her back to
    // the join screen holding a code for her own party.
    await expect(page.getByTestId('host-broadcast')).toBeVisible();
    await expect(page.getByTestId('host-segment-event')).toBeVisible();
  });

  test('the event she made is the event the app is running', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/create', 'create-event');
    await fillTheForm(page);
    await page.getByTestId('create-submit').click();
    const code = await page.getByTestId('created-code').innerText();
    await page.getByTestId('created-continue').click();

    // Read it back through the console's own edit screen rather than trusting the panel
    // that just displayed it -- that would pass on a create() wired to nothing.
    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('event-name')).toHaveValue("Ruth's 40th");
    await expect(page.getByTestId('event-venue')).toHaveValue('The garden');
    await expect(page.getByTestId('event-date')).toHaveValue('2026-09-11');
    await expect(page.getByTestId('event-time')).toHaveValue('19:00');

    // And the guests' half: the code on the invitation is the code she was handed.
    await page.getByTestId('role-switch').click();
    await page.getByTestId('leave-event').click();
    await page.getByTestId('leave-confirm').click();
    await expect(page.getByTestId('join-code')).toHaveValue(code);
    await expect(page.getByText(/Doors 7:00 PM · The garden$/)).toHaveCount(1);
  });

  test('the key is shown once and not again', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/create', 'create-event');
    await fillTheForm(page);
    await page.getByTestId('create-submit').click();
    const key = await page.getByTestId('created-key').innerText();
    await page.getByTestId('created-continue').click();

    // Only a bcrypt hash is stored, so there is genuinely nowhere to show it from. A
    // screen that offered it again would be lying about what it kept.
    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('created-key')).toHaveCount(0);
    await expect(page.getByText(key, { exact: true })).toHaveCount(0);
  });

  test('a lost key can be replaced, and the replacement is a different key', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/create', 'create-event');
    await fillTheForm(page);
    await page.getByTestId('create-submit').click();
    const first = await page.getByTestId('created-key').innerText();
    await page.getByTestId('created-continue').click();

    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('rotated-key')).toHaveCount(0);
    await page.getByTestId('rotate-key').click();

    await expect(page.getByTestId('rotated-key')).toHaveText(KEY);
    // A rotation that returned the same key would be a rotation in name only. That the
    // OLD one stops working is asserted where it can be: verify-policies.sql.
    await expect(page.getByTestId('rotated-key')).not.toHaveText(first);
    await expect(page.getByText(/previous key has\s+stopped working/)).toHaveCount(1);
  });
});

/**
 * Getting back OUT of the console you just made -- issue #37.
 *
 * The console renders exactly one non-segment control, `RoleSwitch`, and for a founder it
 * raised: `becomeGuest` opened with `requireGuest()`, and `create_event` binds a host seat
 * while deliberately minting no guest row. So the door out of the host console threw for
 * the person most likely to be standing in it, and the catch-all toasted "The host console
 * is only available to this event's host" -- at the host.
 *
 * WHAT THESE THREE CANNOT DO IS CATCH IT, and saying so is the point of this paragraph.
 * MemoryRepository never had the bug -- its `becomeGuest` never called `requireGuest`, so
 * with the fix removed these still pass. Measured, not assumed: the mutation was run.
 * They are regression guards for the SCREENS -- the door is drawn, it opens, it swings
 * back -- and nothing more.
 *
 * The fix itself is tested at the seam, in `SupabaseRepository.test.ts`, where a founder's
 * switch is asserted to call `join_event` at all. The half that lives in SQL -- her seat
 * excluded from `guest_count` and from `tier_limits.max_guests` by `public.guest_seats()`
 * -- is Lane E's. Memory keeps the same rule by arithmetic (it does not increment), which
 * is parity, not verification.
 *
 * The fixture change is still worth having: `create` now leaves `myGuestId` null, exactly
 * as `create_event` leaves a founder, so the state is at least REACHABLE here. That is the
 * same move as `?empty=1` making `Seed.event` nullable.
 */
test.describe('leaving the console you just made', () => {
  const create = async (page: import('@playwright/test').Page, scheme: 'dark' | 'light') => {
    await open(page, scheme, '/create', 'create-event');
    await fillTheForm(page);
    await page.getByTestId('create-submit').click();
    await page.getByTestId('created-continue').click();
    await expect(page.getByTestId('role-switch')).toBeVisible();
  };

  test('a founder can look at her own event from the floor', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await create(page, scheme);

    await page.getByTestId('role-switch').click();

    // The chat feed IS the guest side: reaching it means the switch completed rather
    // than throwing behind a toast.
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    // The failure this replaced was silent-looking but not silent -- it toasted. Asserting
    // the toast is absent is what separates "it worked" from "it failed politely".
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });

  test('her seat is not a guest arriving, so the room still reads empty', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await create(page, scheme);
    await page.getByTestId('role-switch').click();

    // Nobody has arrived. A host taking a seat to see her own party must not make the
    // room read "1 here" to the first person who walks in -- which is the same reason
    // create_event does not seat her in the first place.
    await expect(page.getByTestId('guest-count-pill')).toHaveText('0 here');
  });

  test('and the door swings both ways', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await create(page, scheme);
    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();

    // She still holds the seat, so the control is still drawn (#29 hides it only from
    // people who hold none) and still works.
    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('broadcast-draft')).toBeVisible();
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });
});
