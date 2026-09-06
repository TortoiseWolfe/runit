import { expect, test } from '@playwright/test';

import { joinAsGuest, open, switchToHost } from './helpers';

/**
 * The connection surface -- issue #45.
 *
 * A channel that joined and then died produced no observable effect anywhere: the subscribe
 * callback was a one-shot promise settler, `liveError` was written by one line and read by
 * none, and every screen went on serving a frozen snapshot. Measured twice in ~15 live runs.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. `MemoryRepository` has no socket, so it is `live` by
 * definition and these journeys reach the other state only through `?stale=1` -- the same
 * idiom as `?empty=1` and `?flaky=1`, and added for the same reason: without it the pill is
 * unreachable in the only lane that can screenshot it. So this proves the SURFACE -- that it
 * is drawn on both the guest and host sides, that it replaces the headcount rather than
 * lying beside it, and that it is a control rather than a label.
 *
 * It proves nothing about detection or recovery. That is jest (the status callback, the
 * bounded backoff, the identity guard) and lane H, where `context.setOffline` can kill a
 * real socket.
 */
test.describe('when the live connection has stopped', () => {
  test('the guest header says so, in place of a headcount it can no longer trust', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    // The healthy case first, so the swap is a change rather than an absence.
    await expect(page.getByTestId('guest-count-pill')).toBeVisible();
    await expect(page.getByTestId('connection-pill')).toHaveCount(0);

    await open(page, scheme, '/join?stale=1');
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();

    await expect(page.getByTestId('connection-pill')).toBeVisible();
    // A headcount fed by a dead channel is stale, so showing it is a small lie. The pill
    // takes its place rather than sitting beside it.
    await expect(page.getByTestId('guest-count-pill')).toHaveCount(0);
  });

  test('it follows the guest to every tab, because every tab is frozen', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?stale=1');
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();

    for (const tab of ['photos', 'music']) {
      await page.getByTestId(`tab-${tab}`).click();
      await expect(page.getByTestId('connection-pill')).toBeVisible();
    }
  });

  test('and the HOST sees it too, on a console that does not use EventHeader', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?stale=1');
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await switchToHost(page);

    // She is the person whose announcements silently vanish. A guest-only pill would have
    // left her without one -- the shape of #29 and #37, where the surface existed
    // everywhere except where the affected person was standing.
    await expect(page.getByTestId('connection-pill')).toBeVisible();
  });

  test('is a control, not a label -- and never a disabled one', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?stale=1');
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();

    // `stale` means the backoff is spent and nothing further happens on its own, so the
    // pill has to be the way back. A control that names a problem and cannot act on it is
    // the shape closed three times already (#29, #37, #24).
    await expect(page.getByTestId('connection-pill')).toHaveAttribute('role', 'button');
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
    // Tapping reconnects. Against MemoryRepository that is a no-op, which is the honest
    // limit of this lane -- the assertion is that the control exists and is reachable.
    await page.getByTestId('connection-pill').click();
  });
});
