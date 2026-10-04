import { expect, test } from '@playwright/test';

import { UPCOMING, open } from './helpers';

/**
 * SPEC 002. A host chooses her plan herself, free during the beta. Until this existed the
 * only way an event was anything but `house_party` was a developer running an UPDATE per
 * event -- a person, not a product.
 *
 * WHAT THIS LANE CAN AND CANNOT PROVE. It boots MemoryRepository, which refuses exactly what
 * the backend refuses (a non-founder, an unknown tier) and no more; lane E holds the SQL
 * function itself, including the closed-beta refusal, which no journey can reach because
 * the fixture has no beta switch. What a journey CAN prove is the surface: the row reads
 * the plan and its caps from the ladder, the sheet opens, a choice repaints the row from
 * the event observable without a reload, and no control on that sheet is a door that will
 * not open.
 */
async function ownEvent(page: import('@playwright/test').Page, scheme: 'dark' | 'light') {
  await open(page, scheme, '/create', 'create-event');
  await page.getByTestId('create-host-name').fill('Ruth');
  await page.getByTestId('create-name').fill('Test party');
  await page.getByTestId('create-date').fill(UPCOMING);
  await page.getByTestId('create-time').fill('19:00');
  await page.getByTestId('create-submit').click();
  await page.getByTestId('created-continue').click();
  await page.getByTestId('host-segment-event').click();
}

test.describe('a host chooses her plan', () => {
  test('a party she just made is on the free plan, and the row says what that holds', async ({ page }, testInfo) => {
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await expect(page.getByTestId('plan-name')).toHaveText('House party');
    await expect(page.getByTestId('plan-caps')).toContainText('10 guests');
    await expect(page.getByTestId('plan-change')).toBeVisible();
  });

  test('choosing Event repaints the row from the event, without a reload', async ({ page }, testInfo) => {
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('plan-change').click();
    await expect(page.getByTestId('plan-sheet')).toBeVisible();
    // The current plan has no Choose: a control that would do nothing is not drawn.
    await expect(page.getByTestId('plan-pick-house_party')).toHaveCount(0);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
    await page.getByTestId('plan-pick-event').click();
    await expect(page.getByTestId('toast')).toContainText('Event plan');
    await expect(page.getByTestId('plan-name')).toHaveText('Event');
    await expect(page.getByTestId('plan-caps')).toContainText('200 guests');
    await expect(page.getByTestId('plan-caps')).toContainText('unlimited photos');
  });

  test('keeping it as it is changes nothing', async ({ page }, testInfo) => {
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('plan-change').click();
    await page.getByTestId('plan-sheet-cancel').click();
    await expect(page.getByTestId('plan-sheet')).toHaveCount(0);
    await expect(page.getByTestId('plan-name')).toHaveText('House party');
  });

  test('no price appears anywhere on the sheet', async ({ page }, testInfo) => {
    // The pricing screen was cut (#30) because prices with no purchase path invite App Review
    // 3.1.1. The plan picker must never grow one back.
    await ownEvent(page, testInfo.project.name as 'dark' | 'light');
    await page.getByTestId('plan-change').click();
    await expect(page.getByTestId('plan-sheet')).toBeVisible();
    await expect(page.getByTestId('plan-sheet')).not.toContainText('$');
    await expect(page.getByTestId('plan-sheet')).toContainText('Free during the beta');
  });
});
