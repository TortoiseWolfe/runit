import { expect, test } from '@playwright/test';

import { open } from './helpers';

/**
 * THE CHANNEL THAT REPLACES TESTFLIGHT'S AT LAUNCH -- #77.
 *
 * `tools/feedback-to-issues.mjs` is "the channel for testers who have no terminal", and it
 * stops working the day the app leaves TestFlight: that feedback exists only for beta builds.
 * After that a customer's only route to us is a support URL on a static page, and nobody
 * standing in a party opens a browser to complain about a button.
 *
 * WHAT THIS LANE CAN SEE: that the control exists where somebody stuck outside can reach it, that the sheet asks
 * for one thing, that it says what it is sending, and that nothing is sent until there is
 * something to say. WHAT IT CANNOT: that a row reaches Postgres, that the per-identity cap
 * refuses a seventh report, or that an issue is ever filed. Lane E holds the first two
 * (`a person can report a problem`, `one identity cannot fill the tracker`) and the third is
 * `pnpm feedback:sync`, which no lane runs because it writes to GitHub.
 */

test.describe('a customer with no GitHub account can still tell us something', () => {
  test('the way to report is on the screen somebody stuck outside can reach', async ({ page }, info) => {
    await open(page, info.project.name as 'dark' | 'light');
    // ON THE JOIN SCREEN, because the person most worth hearing from is the one who
    // CANNOT GET IN -- they never reach a tab inside the party. "The code would not take"
    // is exactly the report this product has been missing since 2026-09-11, when a real
    // party produced zero anonymous sign-ins and nobody could tell us why.
    // Mutation-checked: removing this control turns four of these red.
    await expect(page.getByTestId('open-feedback')).toBeVisible();
  });

  test('it asks for one thing, and says what else it is sending', async ({ page }, info) => {
    await open(page, info.project.name as 'dark' | 'light');
    await page.getByTestId('open-feedback').click();

    await expect(page.getByTestId('feedback-body')).toBeVisible();
    // THE DEVICE DETAIL IS SHOWN, NOT HARVESTED. A report that quietly collects is a
    // different product from one that says what it is collecting.
    await expect(page.getByTestId('feedback-facts')).toContainText(/app /);
    // And it promises the thing the schema actually guarantees: no name, no address, and
    // nobody else's content.
    await expect(page.getByTestId('feedback-facts')).toContainText(/no email/i);
  });

  test('nothing is sent until there is something to say', async ({ page }, info) => {
    await open(page, info.project.name as 'dark' | 'light');
    await page.getByTestId('open-feedback').click();

    // No Send button at all over an empty box, rather than a disabled one -- this repo's
    // gate against drawing a door nobody can open.
    await expect(page.getByTestId('feedback-send')).toHaveCount(0);
    await expect(page.getByTestId('feedback-empty')).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);

    await page.getByTestId('feedback-body').fill('The join code would not take.');
    await expect(page.getByTestId('feedback-send')).toBeVisible();
  });

  test('sending it closes the sheet and says thank you', async ({ page }, info) => {
    await open(page, info.project.name as 'dark' | 'light');
    await page.getByTestId('open-feedback').click();
    await page.getByTestId('feedback-body').fill('The join code would not take.');
    await page.getByTestId('feedback-send').click();

    // SAYING THANK YOU IS THE FEATURE. Somebody who reports into silence does not report
    // the second thing, and the second thing is usually the better report.
    await expect(page.getByTestId('toast')).toContainText(/thanks/i);
    await expect(page.getByTestId('feedback-sheet')).toHaveCount(0);
  });

  test('cancelling sends nothing and keeps them in the party', async ({ page }, info) => {
    await open(page, info.project.name as 'dark' | 'light');
    await page.getByTestId('open-feedback').click();
    await page.getByTestId('feedback-body').fill('never mind');
    await page.getByTestId('feedback-cancel').click();

    await expect(page.getByTestId('feedback-sheet')).toHaveCount(0);
    await expect(page.getByTestId('join-submit')).toBeVisible();
  });
});
