import { expect, test } from '@playwright/test';

import { INVITATION_LINE, WEDDING, joinAsGuest, switchToHost } from './helpers';

/**
 * A host correcting their own event -- issue #14.
 *
 * `authenticated` held UPDATE on exactly one column of `events`, `active_folder_id`. So
 * the name, the date, the venue and the timezone were whatever the seed SQL wrote, once,
 * and nobody could change them. Reported from a phone as "who set the date and where".
 *
 * A SCREEN THE CANVAS NEVER DREW. `Runit.dc.html` has three host segments -- Broadcast,
 * DJ queue, Photos -- and models the event's details as hardcoded strings in its state
 * block, never as something editable. Reports was the first divergence from that track;
 * this is the second. FIDELITY note S.
 *
 * WHAT THIS FILE CANNOT SEE. It runs MemoryRepository, so a passing run here says
 * nothing about whether the column grant was actually widened -- against Supabase a
 * non-host's UPDATE affects zero rows and raises nothing, which is invisible to any
 * assertion in this directory. `supabase/verify-policies.sql` is what proves the grant,
 * and it now asserts all five columns write, that `tier` and `code` still refuse with
 * 42501, and that a guest's UPDATE of `name` affects zero rows silently.
 */

type Page = import('@playwright/test').Page;

async function openDetails(page: Page, scheme: 'dark' | 'light') {
  await joinAsGuest(page, scheme);
  await switchToHost(page);
  await page.getByTestId('host-segment-event').click();
  await expect(page.getByTestId('host-event-details')).toBeVisible();
}

/**
 * Back to the join screen WITHOUT a page load, which is the only way to read saved
 * state.
 *
 * `page.goto('/join')` re-seeds: MemoryRepository is built in the root layout's useMemo,
 * so a reload throws away every write the test just made and the assertion afterwards
 * would be reading the fixture. This walks the app instead -- host to guest, then the
 * footer's Leave, which calls `closeEvent()`.
 *
 * `closeEvent` sets the session anonymous and deliberately does NOT discard the event,
 * so /join still renders it. That is the same distinction FIDELITY note R draws: closing
 * an event is not leaving one.
 */
async function backToJoin(page: Page) {
  await page.getByTestId('role-switch').click();
  await page.getByTestId('leave-event').click();
  await page.getByTestId('leave-confirm').click();
  await expect(page.getByTestId('join-submit')).toBeVisible();
}

test.describe('host · event details', () => {
  test('opens filled in with the event as it stands', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openDetails(page, scheme);

    // A form that opened empty would read as "there is nothing set" and invite a host to
    // retype what is already correct -- and to lose whatever they did not retype.
    await expect(page.getByTestId('event-name')).toHaveValue(WEDDING.name);
    await expect(page.getByTestId('event-venue')).toHaveValue(WEDDING.venue);
    await expect(page.getByTestId('event-doors')).toHaveValue(WEDDING.doors);
    // Shape, not a literal: the fixture anchors to yesterday on purpose.
    await expect(page.getByTestId('event-date')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId('event-time')).toHaveValue('16:00');
  });

  test('a saved name reaches the guests, which is the whole point', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openDetails(page, scheme);

    await page.getByTestId('event-name').fill('The Reception');
    await page.getByTestId('event-save').click();

    // Read it back somewhere a GUEST looks, not in the field that was just typed into.
    // Asserting the input holds what was typed would pass on a Save button wired to
    // nothing at all.
    await page.getByTestId('role-switch').click();
    await expect(page.getByText('The Reception', { exact: true })).toHaveCount(1);
    await expect(page.getByText(WEDDING.name, { exact: true })).toHaveCount(0);
  });

  test('a saved venue and doors line rebuild the invitation', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openDetails(page, scheme);

    await page.getByTestId('event-venue').fill('The Old Chapel');
    await page.getByTestId('event-doors').fill('Doors 6:30 PM');
    await page.getByTestId('event-save').click();

    // /join is not session-guarded, so a joined guest can navigate back to it inside the
    // same page load -- which is what makes this a reading of live state rather than a
    // re-seed. The old line must be gone, not merely the new one present.
    await backToJoin(page);
    await expect(page.getByText(/Doors 6:30 PM · The Old Chapel$/)).toHaveCount(1);
  });

  test('the time is read in the event zone, and says so before it is saved', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openDetails(page, scheme);

    await page.getByTestId('event-date').fill('2026-09-11');
    await page.getByTestId('event-time').fill('19:00');

    // The reading is the defence against a mistyped zone, and against the disagreement
    // that shipped: HOUSE7 holds a start time of 11:13 AM under a label reading
    // "Doors 7:00 PM", because starts_at was seeded as now() + 7 days and nothing ever
    // rendered it. A host cannot correct what they cannot see.
    await expect(page.getByTestId('event-starts-preview')).toHaveText('Fri, Sep 11 · 7:00 PM');

    // Same instant, different venue: the wall clock is what the door sign says, so
    // moving the zone moves the instant and NOT the reading.
    //
    // The zone list folds away now -- the current zone is always on the reading line in
    // words, but its alternatives are behind the toggle, because `zoneChoices` already
    // pre-selects this phone's own zone and nearly every host is standing at their venue.
    await expect(page.getByTestId('event-zone-Europe/London')).toHaveCount(0);
    await page.getByTestId('event-zone-toggle').click();
    await page.getByTestId('event-zone-Europe/London').click();
    // Choosing closes it, so the list cannot sit between the reading and the next field.
    await expect(page.getByTestId('event-zone-Europe/London')).toHaveCount(0);
    await expect(page.getByTestId('event-starts-preview')).toHaveText('Fri, Sep 11 · 7:00 PM');
  });

  test('an unparseable date does not save a wrong one', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openDetails(page, scheme);

    await page.getByTestId('event-date').fill('11/09/2026');
    await page.getByTestId('event-name').fill('Should Not Land');
    await page.getByTestId('event-save').click();

    // Silently coercing a half-typed date into some instant is how an event ends up on
    // the wrong evening. Refusing the whole save is the honest response, and the reading
    // above the fields is what tells a host why.
    await page.getByTestId('role-switch').click();
    await expect(page.getByText('Should Not Land', { exact: true })).toHaveCount(0);
    await expect(page.getByText(WEDDING.name, { exact: true })).toHaveCount(1);
  });

  test('the console offers the segment at all', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // Five segments now. A screen reachable only by typing its URL is not shipped.
    await expect(page.getByTestId('host-segment-event')).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });
});

test.describe('host · event details · the invitation it feeds', () => {
  test('leaves the invitation intact when nothing is edited', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openDetails(page, scheme);
    await page.getByTestId('event-save').click();

    await backToJoin(page);
    // Saving an untouched form must be a no-op, not a round trip through the date
    // converter that lands a minute off. This is the round-trip assertion:
    // instantToWallClock -> the fields -> wallClockToInstant -> the same instant.
    await expect(page.getByText(INVITATION_LINE)).toHaveCount(1);
  });
});
