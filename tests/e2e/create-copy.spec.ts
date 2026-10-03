import { expect, test } from '@playwright/test';

import { UPCOMING, open } from './helpers';

/**
 * The code and the recovery key can be COPIED, not only read. The key exists exactly once --
 * `create_event`'s return value, only the hash is stored -- and the screen used to ask a host
 * to write twelve characters down by hand. Chromium grants the clipboard here so the
 * assertion is what landed on it, not that a button exists.
 */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('the created screen', () => {
  test('puts the recovery key on the clipboard, and says so', async ({ page }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light', '/create', 'create-event');
    await page.getByTestId('create-host-name').fill('Ruth');
    await page.getByTestId('create-name').fill('Copy test');
    await page.getByTestId('create-date').fill(UPCOMING);
    await page.getByTestId('create-time').fill('19:00');
    await page.getByTestId('create-submit').click();
    const key = (await page.getByTestId('created-key').innerText()).trim();
    expect(key.length).toBeGreaterThan(8);
    await page.getByTestId('created-key-copy').click();
    await expect(page.getByTestId('toast')).toContainText('Recovery key copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
  });

  test('and the join code too', async ({ page }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light', '/create', 'create-event');
    await page.getByTestId('create-host-name').fill('Ruth');
    await page.getByTestId('create-name').fill('Copy test');
    await page.getByTestId('create-date').fill(UPCOMING);
    await page.getByTestId('create-time').fill('19:00');
    await page.getByTestId('create-submit').click();
    const code = (await page.getByTestId('created-code').innerText()).trim();
    await page.getByTestId('created-code-copy').click();
    await expect(page.getByTestId('toast')).toContainText('Code copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  });
});
