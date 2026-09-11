import { expect, test, type Page } from '@playwright/test';

import { joinAsGuest, open, switchToHost } from './helpers';

/**
 * App Review Guideline 1.2, end to end in a browser.
 *
 * This lane exists because the unit suites prove the REPOSITORY reports and blocks,
 * and prove nothing about whether a guest can reach either control. A reviewer taps;
 * an adapter method is not a tap. Every assertion here starts from something visible
 * on a screen.
 *
 * `gst_priya` owns both a seeded song request (req_1, "Dancing Queen") and a seeded
 * PENDING photo (pho_1), which is what makes her the one guest who can demonstrate
 * the whole of it: her content is blockable, and her photo is in the host queue where
 * a block must NOT reach.
 */

/** Open the Music tab as a guest, where the seeded queue is. */
async function openMusic(page: Page, scheme: 'dark' | 'light') {
  await joinAsGuest(page, scheme);
  await page.getByTestId('tab-music').click();
  await expect(page.getByTestId('request-report-req_1')).toBeVisible();
}

async function openHostReports(page: Page) {
  await page.getByTestId('tab-chat').click();
  await switchToHost(page);
  await page.getByTestId('host-segment-reports').click();
  await expect(page.getByTestId('host-reports')).toBeVisible();
}

test.describe('Guideline 1.2 · reporting', () => {
  test('a guest can report a song, and the host sees it named rather than as an id', async ({
    page,
  }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    await page.getByTestId('request-report-req_1').click();
    await expect(page.getByTestId('report-reason-hate')).toBeVisible();
    await page.getByTestId('report-reason-hate').click();

    await openHostReports(page);
    // The label, not the uuid. A host cannot read `guests` and cannot join to the
    // request, so this string has to have been derived when the report was filed.
    await expect(page.getByTestId('host-reports')).toContainText('Dancing Queen');
    await expect(page.getByTestId('host-reports')).toContainText('Hate speech');
    await expect(page.getByTestId('host-reports')).toContainText('Reported by Ada');
  });

  test('the badge counts open reports, and resolving clears both', async ({ page }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await openMusic(page, scheme);
    await page.getByTestId('request-report-req_2').click();
    await page.getByTestId('report-reason-spam').click();

    await openHostReports(page);
    await expect(page.getByTestId('host-segment-reports')).toContainText('1');

    await page.getByTestId('host-reports').getByTestId(/^resolve-dismissed-/).click();

    await expect(page.getByTestId('reports-empty')).toBeVisible();
    await expect(page.getByTestId('host-segment-reports')).not.toContainText('1');
  });

  test('reporting the same thing twice says so instead of looking broken', async ({
    page,
  }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await openMusic(page, scheme);
    await page.getByTestId('request-report-req_1').click();
    await page.getByTestId('report-reason-spam').click();

    await page.getByTestId('request-report-req_1').click();
    await expect(page.getByTestId('report-already')).toBeVisible();
    // And the reasons are gone -- there is nothing left to choose.
    await expect(page.getByTestId('report-reason-spam')).toHaveCount(0);
  });

  test('you cannot report your own request, because there is nobody to report', async ({
    page,
  }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await openMusic(page, scheme);
    await page.getByTestId('request-input').fill('Mine – Me');
    await page.getByTestId('request-submit').click();

    const mine = page.getByTestId(/^request-report-/);
    const before = await mine.count();
    // Six seeded rows plus the new one is seven; only six carry a report control.
    expect(before).toBe(6);
  });
});

test.describe('Guideline 1.2 · blocking', () => {
  test('blocking takes their song out of the queue and offers the way back', async ({
    page,
  }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await openMusic(page, scheme);
    await expect(page.getByTestId('vote-req_1')).toBeVisible();

    await page.getByTestId('request-report-req_1').click();
    await page.getByTestId('report-block').click();

    // Gone from the queue, without reporting anything.
    await expect(page.getByTestId('vote-req_1')).toHaveCount(0);
    // And the pill appears -- it is absent until there is something to manage.
    await expect(page.getByTestId('blocked-pill')).toBeVisible();
  });

  test('unblocking puts them back, so a mis-tap is not permanent', async ({ page }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await openMusic(page, scheme);
    await page.getByTestId('request-report-req_1').click();
    await page.getByTestId('report-block').click();
    await expect(page.getByTestId('vote-req_1')).toHaveCount(0);

    await page.getByTestId('blocked-pill').click();
    // Named, not a uuid: guest_blocks.blocked_name is stamped for exactly this screen.
    await expect(page.getByTestId('blocked-list')).toContainText('Priya');
    await page.getByTestId(/^unblock-/).click();

    await page.getByTestId('tab-music').click();
    await expect(page.getByTestId('vote-req_1')).toBeVisible();
  });

  test('a block does not hide the photo from the HOST queue', async ({ page }, info) => {
    // The exemption that keeps moderation working: a guest must not be able to bury a
    // complaint by blocking the person they are complaining about.
    const scheme = info.project.name as 'dark' | 'light';
    await openMusic(page, scheme);
    await page.getByTestId('request-report-req_1').click();
    await page.getByTestId('report-block').click();
    await expect(page.getByTestId('blocked-pill')).toBeVisible();

    await page.getByTestId('tab-chat').click();
    await switchToHost(page);
    await page.getByTestId('host-segment-photos').click();
    // pho_1 is Priya's, and it is still awaiting approval.
    await expect(page.getByTestId('hide-pho_1')).toBeVisible();
  });
});

/**
 * TAKING A REPORTED PHOTO DOWN -- #65, written BEFORE the code.
 *
 * Guideline 1.2 wants a way to report objectionable content AND for the developer to act on
 * it. RunIt had the first half. It could not do the second on any event it can create.
 *
 * `Hide` lives on the approvals queue, and `photos.pending` selects `'pending'` only.
 * `create_event` mints `house_party`, whose `photo_moderation` is false, so every photo lands
 * `'approved'` and never enters that queue -- and with no purchase path (#30) no event can
 * reach a tier where it does. So the queue is permanently empty and the only control that
 * could remove a photo is permanently undrawable. Resolving a report as "Removed" closed the
 * REPORT and left the PHOTO in the shared album.
 *
 * The panel's own comment states the assumption that breaks: "the host hides the photo ... on
 * its own screen". On the free tier that screen has no Hide.
 *
 * A FRESHLY CREATED EVENT, because that is the only place the bug exists -- `weddingSeed` is
 * on the Event tier, where moderation is on and the queue works.
 */
test.describe('Guideline 1.2 · taking it down (#65)', () => {
  test('a host can remove a reported photo on the free tier, where the queue is empty', async ({
    page,
  }, info) => {
    const scheme = info.project.name as 'dark' | 'light';

    await open(page, scheme, '/create', 'create-event');
    await page.getByTestId('create-host-name').fill('Ruth');
    await page.getByTestId('create-name').fill("Ruth's 40th");
    await page.getByTestId('create-date').fill('2027-01-09');
    await page.getByTestId('create-time').fill('19:00');
    await page.getByTestId('create-submit').click();
    await page.getByTestId('created-continue').click();

    // As a guest of her own party, put a photo in the album. On house_party it is
    // auto-approved, which is the whole problem: it never enters the approvals queue.
    await page.getByTestId('role-switch').click();
    await page.getByTestId('tab-photos').click();
    await page.getByTestId('shutter').click();
    const tile = page.locator('[data-testid^="tile-"]').first();
    await expect(tile).toBeVisible();

    // Report it.
    await page.locator('[data-testid^="report-tile-"]').first().click();
    await page.getByTestId('report-reason-hate').click();

    await page.getByTestId('tab-chat').click();
    await page.getByTestId('role-switch').click();

    // THE APPROVALS QUEUE IS EMPTY, which is the condition that made this unreachable.
    await page.getByTestId('host-segment-photos').click();
    await expect(page.getByTestId('host-photos')).toContainText(/All caught up/i);

    // So the take-down has to live on the REPORT.
    await page.getByTestId('host-segment-reports').click();
    const takeDown = page.locator('[data-testid^="report-takedown-"]').first();
    await expect(takeDown).toBeVisible();
    await takeDown.click();

    // The report closes AND the photo leaves the album -- both, or it is the same gap.
    await expect(page.getByTestId('reports-empty')).toBeVisible();
    await page.getByTestId('role-switch').click();
    await page.getByTestId('tab-photos').click();
    await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(0);
  });

  test('a take-down is offered only on a photo, not on a song or a person', async ({
    page,
  }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    // A reported SONG has no photo to remove; blocking the person is the remedy there and
    // it already exists. Drawing a take-down that cannot act is the failure this repo
    // keeps closing.
    await page.getByTestId('tab-music').click();
    await page.getByTestId('request-report-req_1').click();
    await page.getByTestId('report-reason-hate').click();
    // Back via chat: `role-switch` lives on the chat header, not on the Music tab.
    await page.getByTestId('tab-chat').click();
    await switchToHost(page);
    await page.getByTestId('host-segment-reports').click();
    await expect(page.locator('[data-testid^="report-takedown-"]')).toHaveCount(0);
  });
});
