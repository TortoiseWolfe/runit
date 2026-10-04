import { expect, test } from '@playwright/test';

import { joinAsGuest, open } from './helpers';

/**
 * SPEC 010 (#107): A HOST WHO LANDS AS A GUEST CLAIMS HER SEAT FROM INSIDE THE PARTY.
 *
 * Measured at the first wedding beta: the host opened her own link in another browser, joined
 * her own party as a guest, and the only way back was Leave -> the join screen's optional key
 * field. Nothing inside the party pointed there. Now her name sheet does.
 *
 * `?guest=1` boots the wedding seen by somebody who holds NO host seat -- the stranded host's
 * exact state. Every other seed is staff, so the link is correctly absent there, and the last
 * test holds that half.
 */
async function joinAsPlainGuest(page: import('@playwright/test').Page, scheme: 'dark' | 'light') {
  await open(page, scheme, '/join?guest=1', 'join-submit');
  await page.getByTestId('join-nickname').fill('Ceci');
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('chat-feed')).toBeVisible();
}

test.describe('a host who landed as a guest (spec 010)', () => {
  test('a wrong key is refused, and she is still a guest with the sheet open', async ({ page }, testInfo) => {
    await joinAsPlainGuest(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('name-pill').click();
    await page.getByTestId('name-host-key-open').click();
    // An empty field draws no button: a control that could only refuse is not drawn.
    await expect(page.getByTestId('name-host-key-submit')).toHaveCount(0);
    await page.getByTestId('name-host-key').fill('NOPE-NOPE-NOPE');
    await page.getByTestId('name-host-key-submit').click();
    await expect(page.getByTestId('toast')).toContainText("That host key isn't right");
    await expect(page.getByTestId('name-sheet')).toBeVisible();
    await expect(page.getByTestId('role-switch')).toHaveCount(0);
  });

  test('her key makes her the host, without leaving the party', async ({ page }, testInfo) => {
    await joinAsPlainGuest(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('name-pill').click();
    await page.getByTestId('name-host-key-open').click();
    // Lower case and no dashes: claimHost canonicalises, as the join screen's field does.
    await page.getByTestId('name-host-key').fill('demohostkey0');
    await page.getByTestId('name-host-key-submit').click();
    await expect(page.getByTestId('toast')).toContainText('You are the host of this event.');
    await expect(page.getByTestId('host-broadcast')).toBeVisible();
    // AND THE SEAT IS HELD, not just the screen reached: back on the guest side she gets
    // "Host view", which draws only for holdsHostSeat (the Memory/Supabase parity in T3).
    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await expect(page.getByTestId('role-switch')).toHaveText('Host view →');
  });

  test('somebody who already holds a host seat is not offered it', async ({ page }, testInfo) => {
    await joinAsGuest(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('name-pill').click();
    await expect(page.getByTestId('name-sheet')).toBeVisible();
    await expect(page.getByTestId('name-host-key-open')).toHaveCount(0);
  });
});
