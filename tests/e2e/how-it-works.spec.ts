import { expect, test } from '@playwright/test';

import { open } from './helpers';

/**
 * SPEC 013 -- the join screen links the guide.
 *
 * The guide is served by the production site, so the request is answered here rather than
 * fetched: this lane must not depend on a deploy, and lane G is what proves the live page is
 * the guide (`id="help-guide"`). What THIS proves is that a person with no code can find it,
 * and that the tap opens the guide's address.
 */
const HELP = 'https://runit-app.pages.dev/help/';

test.describe('a person with no code can find out what RunIt is', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(`${HELP}**`, (r) =>
      r.fulfill({ contentType: 'text/html', body: '<main id="help-guide">How RunIt works</main>' }),
    );
  });

  test('the cold open offers the guide, and it opens at the guide', async ({ page }, testInfo) => {
    // `?empty=1` is somebody who installed the app with nothing in hand -- no event, no code.
    await open(page, testInfo.project.name as 'dark' | 'light', '/join?empty=1');
    const link = page.getByTestId('join-how-it-works');
    await expect(link).toBeVisible();
    await expect(link).toContainText('How RunIt works');
    const [guide] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    expect(guide.url()).toBe(HELP);
    await expect(guide.locator('#help-guide')).toBeVisible();
  });

  test('and it is still there for a guest holding a code', async ({ page }, testInfo) => {
    await open(page, testInfo.project.name as 'dark' | 'light');
    await expect(page.getByTestId('join-how-it-works')).toBeVisible();
  });
});
