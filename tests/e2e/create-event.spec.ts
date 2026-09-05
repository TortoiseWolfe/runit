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
    await page.getByTestId('create-zone-America/New_York').click();

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
