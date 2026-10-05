import { expect, test, type Page } from '@playwright/test';

import { joinAsGuest, open, switchToHost, UPCOMING } from './helpers';

/**
 * SPEC 012 -- a new host's three first things, at the top of Broadcast.
 *
 * Every tick here is caused from somewhere ELSE -- the event screen, the composer, the run of
 * show -- and the card is asserted to notice, because a checklist that ticked itself when its
 * own button was pressed would congratulate a host for opening a share sheet she dismissed.
 *
 * WHAT THIS CANNOT PROVE: that `onShare` reached a share sheet (headless Chromium has none;
 * host-console.spec.ts proves the press reaches the handler through its toast), or that
 * `expo-secure-store` remembers the hide on a phone -- this lane runs the `hints.web.ts`
 * half, against localStorage.
 */
type Scheme = 'dark' | 'light';

/** A party made in the app a moment ago: nobody invited, nobody here, nothing sent. */
const madeJustNow = async (page: Page, scheme: Scheme) => {
  await open(page, scheme, '/create', 'create-event');
  await page.getByTestId('create-host-name').fill('Ruth');
  await page.getByTestId('create-name').fill("Ruth's 40th");
  await page.getByTestId('create-date').fill(UPCOMING);
  await page.getByTestId('create-time').fill('19:00');
  await page.getByTestId('create-submit').click();
  await page.getByTestId('created-continue').click();
  await expect(page.getByTestId('host-broadcast')).toBeVisible();
};

/** `freshSeed`: people have arrived, but nothing has been announced and there is no plan. */
const freshWorldHost = async (page: Page, scheme: Scheme) => {
  await open(page, scheme, '/join?fresh=1');
  await page.getByTestId('join-nickname').fill('Ada');
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('chat-feed')).toBeVisible();
  await switchToHost(page);
};

const done = (page: Page, key: 'invite' | 'announce' | 'plan') =>
  expect(page.getByTestId(`host-start-${key}`)).toHaveAttribute('aria-label', /, done$/);
const open_ = (page: Page, key: 'invite' | 'announce' | 'plan') =>
  expect(page.getByTestId(`host-start-${key}`)).not.toHaveAttribute('aria-label', /, done$/);

test.describe('a new host is shown what to do first', () => {
  test('three things, nothing done, and exactly one button', async ({ page }, testInfo) => {
    await madeJustNow(page, testInfo.project.name as Scheme);
    await expect(page.getByTestId('host-start')).toBeVisible();
    await open_(page, 'invite');
    await open_(page, 'announce');
    await open_(page, 'plan');
    // The invite item's button IS the #70 nudge, under the same testID.
    await expect(page.getByTestId('empty-room-share')).toBeVisible();
    await expect(page.getByTestId('host-start-announce-go')).toHaveCount(0);
    await expect(page.getByTestId('host-start-plan-go')).toHaveCount(0);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('inviting someone on the event screen ticks the first item and moves the button on', async ({
    page,
  }, testInfo) => {
    await madeJustNow(page, testInfo.project.name as Scheme);
    await page.getByTestId('host-segment-event').click();
    await expect(page.getByTestId('invitee-email')).toBeVisible();
    await page.getByTestId('invitee-email').fill('sam@example.test');
    await page.getByTestId('invitee-add').click();
    await page.getByTestId('host-segment-broadcast').click();

    await done(page, 'invite');
    await expect(page.getByTestId('empty-room-share')).toHaveCount(0);
    await expect(page.getByTestId('host-start-announce-go')).toBeVisible();
  });

  test('each button takes her to the field, and doing the thing ticks it, until the card goes', async ({
    page,
  }, testInfo) => {
    await freshWorldHost(page, testInfo.project.name as Scheme);
    // People are here, so inviting is already done: the guest count alone proves a share worked.
    await done(page, 'invite');

    await page.getByTestId('host-start-announce-go').click();
    await expect(page.getByTestId('broadcast-draft')).toBeFocused();
    await page.getByTestId('broadcast-draft').fill('Welcome, everyone');
    await page.getByTestId('broadcast-send').click();
    await done(page, 'announce');

    await page.getByTestId('host-start-plan-go').click();
    await expect(page.getByTestId('schedule-title')).toBeFocused();
    await page.getByTestId('schedule-title').fill('Cake');
    await page.getByTestId('schedule-add').click();

    // All three done: nothing left to suggest, so nothing is drawn.
    await expect(page.getByTestId('host-start')).toHaveCount(0);
  });

  test('Hide removes it for this party on this device, and another party still shows it', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    await freshWorldHost(page, scheme);
    await expect(page.getByTestId('host-start')).toBeVisible();
    await page.getByTestId('host-start-hide').click();
    await expect(page.getByTestId('host-start')).toHaveCount(0);

    // A reload rebuilds the fixture from scratch, so only the device's memory can keep it
    // hidden. The read is one resolved promise over localStorage; the half second is the
    // window in which a broken read would have drawn the card, not a guess at a slow one.
    await page.reload();
    await freshWorldHost(page, scheme);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('host-start')).toHaveCount(0);

    // The positive control in the same browser: a DIFFERENT party is not hidden, so the
    // absence above is the hide being remembered and not the card being broken.
    await madeJustNow(page, scheme);
    await expect(page.getByTestId('host-start')).toBeVisible();
  });

  test('a party where all three are done never shows it', async ({ page }, testInfo) => {
    await joinAsGuest(page, testInfo.project.name as Scheme);
    await switchToHost(page);
    await expect(page.getByTestId('broadcast-draft')).toBeVisible();
    await expect(page.getByTestId('host-start')).toHaveCount(0);
  });
});
