import { expect, test, type Page } from '@playwright/test';

import { joinAsGuest, switchToHost } from './helpers';

/**
 * Adding a co-host — issue #16.
 *
 * Until this, `hosts.invite` threw unconditionally against Supabase and had **no UI caller
 * anywhere in `src/`**. So "add a DJ" was unbuilt at every price, while the $79 tier
 * advertised "5 hosts with roles (host, DJ, planner)" as a headline feature.
 *
 * A co-host gets a KEY, not an account: they type it on the join screen and `claim_host`
 * binds the seat to whatever anonymous session they hold. That is the point of the whole
 * key mechanism — the DJ and the floor staff should not need accounts.
 *
 * WHAT THIS FILE CANNOT PROVE. It runs `MemoryRepository`, so it says nothing about
 * whether `invite_host` exists, whether the caps are enforced, or whether a key redeems.
 * Only Lane E can see that, and it does: `verify-policies.sql` mints a seat, refuses it on
 * the free tier, refuses the founder collecting it, and has the DJ redeem it as a
 * different identity. This file proves the screen.
 */

const KEY = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

async function openEventTab(page: Page, scheme: 'dark' | 'light') {
  await joinAsGuest(page, scheme);
  await switchToHost(page);
  await page.getByTestId('host-segment-event').click();
  await expect(page.getByTestId('host-event-details')).toBeVisible();
}

/**
 * Open the add form, which folds away now.
 *
 * The SEATS stay on screen -- "who is helping" is answered without opening anything.
 * What folds is the machinery for adding one, and `invited-key` is deliberately left
 * OUTSIDE the fold, because it is shown exactly once and a collapsed section is not
 * somewhere a one-time key may ever be.
 */
async function openAddCoHost(page: Page) {
  // IDEMPOTENT, because a toggle is not. This helper is called once per co-host and the
  // section keeps its own open state, so an unconditional click would close the fold on
  // the second seat -- which is exactly how the cap test failed first time round.
  if (await page.getByTestId('cohost-name').isVisible()) return;
  await page.getByTestId('cohost-add-toggle').click();
  await expect(page.getByTestId('cohost-name')).toBeVisible();
}

/** Add one co-host and return the key the screen handed over. */
async function addCoHost(page: Page, name: string, role: 'dj' | 'planner' | 'host' = 'host') {
  await openAddCoHost(page);
  await page.getByTestId('cohost-name').fill(name);
  await page.getByTestId(`cohost-role-${role}`).click();
  await page.getByTestId('cohost-invite').click();
}

test.describe('host · adding a co-host', () => {
  test('lists the seats already at the event, by the label the console prints', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openEventTab(page, scheme);

    // Scoped to the SEAT ROWS, because "Planner" and "DJ" are also role-picker chips two
    // elements below — a bare text query cannot tell a seat from the control that makes
    // one, and would pass on a list that rendered nothing at all.
    const seats = page.getByTestId('seat-row');
    await expect(seats).toHaveCount(3);

    // `roleLabel` used to be stripped on its way out of BOTH adapters, so a seat list
    // could only ever show the permission grade. "Bride" is the whole reason that field
    // exists — it is what makes the event type a variable rather than a wedding with the
    // words changed.
    await expect(seats.filter({ hasText: 'Riley' })).toContainText('Bride');
    await expect(seats.filter({ hasText: 'DJ Marco' })).toContainText('DJ');
    await expect(seats.filter({ hasText: 'Jordan' })).toContainText('Planner');
  });

  test('hands over a key once, and says what to do with it', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openEventTab(page, scheme);

    await expect(page.getByTestId('invited-key')).toHaveCount(0);
    await addCoHost(page, 'Priya', 'dj');

    await expect(page.getByTestId('invited-key')).toHaveText(KEY);
    // The sentence carries as much as the string: a co-host with a key and no event code
    // cannot get in, and nobody would guess that from the key alone.
    await expect(page.getByText(/They type both on the join screen/)).toHaveCount(1);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('the new seat joins the list under the role that was picked', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openEventTab(page, scheme);
    await addCoHost(page, 'Priya', 'planner');

    await expect(page.getByTestId('cohost-name')).toHaveValue('');
    const seats = page.getByTestId('seat-row');
    await expect(seats).toHaveCount(4);
    // The picked role reached the seat rather than defaulting: Priya's row carries the
    // label, and the default in the picker is DJ, so "Planner" here is a real choice.
    await expect(seats.filter({ hasText: 'Priya' })).toContainText('Planner');
  });

  test('the key is gone when you come back, because it was never stored', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openEventTab(page, scheme);
    await addCoHost(page, 'Priya', 'dj');
    const key = await page.getByTestId('invited-key').innerText();

    // In-app navigation, so the repository survives and only the panel remounts. Only a
    // bcrypt hash is kept, so there is genuinely nowhere to show it from a second time —
    // a screen that offered it again would be lying about what it kept.
    await page.getByTestId('host-segment-broadcast').click();
    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('invited-key')).toHaveCount(0);
    await expect(page.getByText(key, { exact: true })).toHaveCount(0);
    // The seat is still there. The key is what vanished, not the co-host.
    await expect(page.getByTestId('seat-row').filter({ hasText: 'Priya' })).toHaveCount(1);
  });

  test('filling the host cap names the limit out loud, and adds no seat', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openEventTab(page, scheme);

    // The wedding is on the Event tier: 5 hosts, 3 seeded. Fill it the way
    // host-console.spec.ts fills the folder cap, because `housePartySeed` is not reachable
    // from the harness — see the note in CLAUDE.md.
    await addCoHost(page, 'Fourth');
    await addCoHost(page, 'Fifth');
    await expect(page.getByTestId('seat-row')).toHaveCount(5);

    // NOT disabled at the cap. A control that is visibly there and does nothing when
    // tapped reads as a bug, and disabling it makes the denial unreachable — this button
    // is drawn the way "+ New folder" is, for the same reason.
    // The cap now also reads on the closed section, so a host sees it without opening.
    await expect(page.getByTestId('cohost-add-summary')).toHaveText('5 hosts on this plan');
    await openAddCoHost(page);
    await expect(page.getByTestId('cohost-invite')).toContainText('5 hosts on this plan');
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);

    await addCoHost(page, 'Sixth');
    await expect(page.getByTestId('seat-row')).toHaveCount(5);
    // The repository throws EntitlementError and useGuardedAction turns it into a toast
    // naming the limit, rather than the button failing silently.
    await expect(page.getByTestId('toast')).toBeVisible();
  });

  test('will not mint a seat for nobody', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openEventTab(page, scheme);

    await openAddCoHost(page);
    await page.getByTestId('cohost-invite').click();
    // An empty name would create a seat labelled by its role alone, which is unreachable
    // for whoever holds the key: nothing on the console would say who it belongs to.
    await expect(page.getByTestId('invited-key')).toHaveCount(0);
  });
});
