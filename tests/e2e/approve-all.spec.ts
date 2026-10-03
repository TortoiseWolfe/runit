import { expect, test } from '@playwright/test';

import { joinAsGuest, switchToHost } from './helpers';

/**
 * A host mid-event has no hands free to approve forty photos one tap at a time. The wedding
 * seed's queue is what is approved here; the assertion is the queue emptying and the toast
 * carrying the count, not a button existing.
 */
test.describe('the approval queue', () => {
  test('can be approved in one tap, and the toast says how many', async ({ page }, testInfo) => {
    await joinAsGuest(page, testInfo.project.name as 'dark' | 'light');
    await switchToHost(page);
    await page.getByTestId('host-segment-photos').click();
    const rows = page.locator('[data-testid^="approve-"]:not([data-testid="approve-all"])');
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);
    await page.getByTestId('approve-all').click();
    await expect(page.getByTestId('toast')).toContainText(`${before} photos approved`);
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId('approve-all')).toHaveCount(0);
  });
});
