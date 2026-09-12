import { expect, test, type Page } from '@playwright/test';

import { open } from './helpers';

/**
 * THE PARTY THAT IS OVER -- #41, and the world no fixture could reach until it landed.
 *
 * `src/domain/tiers.ts` claimed since it was written that a free event "goes read-only"
 * after a while. Nothing enforced it: a free event opened on Friday still took chat, songs
 * and photos the following Wednesday, and `eventTtlHours` had exactly one reader in the
 * whole repo -- a comment in a seed file.
 *
 * `?ended=1` boots a `house_party` event ten days past its start, which is the only way to
 * reach a closed window here: the wedding sits on a tier with no expiry and both free seeds
 * are current. Same reason `?empty=1` and `?stale=1` exist -- the failure is never "the
 * control is wrong", it is "no test can reach the state where the control is wrong".
 *
 * WHAT THESE CANNOT PROVE. `MemoryRepository` has no policies, so "Postgres refuses the
 * write" is a claim only lane E can make, and it asserts it on both the policy path and the
 * SECURITY DEFINER path -- which are different mechanisms, because a definer function
 * bypasses RLS entirely. These cover the half that lives in the app: that the refusal is
 * SAID rather than silent, and that reading never stops.
 */

/**
 * In through the front door, because `/chat?ended=1` cold lands on the JOIN screen: the
 * session is anonymous on the first render and `(guest)/_layout` redirects. That is correct
 * behaviour and is not what any of these tests are about.
 *
 * JOINING IS NOT GATED BY THE WINDOW, deliberately, and this helper is the proof that it
 * still works: joining is read ACCESS -- it is what `photos_read` and `broadcasts_read`
 * require -- so somebody handed a link a fortnight later can still see the album. An expiry
 * that locked people out of what they were invited to would be a different product.
 */
async function enterEnded(page: Page, scheme: 'dark' | 'light', flag = 'ended') {
  await open(page, scheme, `/join?${flag}=1`);
  await page.getByTestId('join-nickname').fill('Ada');
  await page.getByTestId('join-submit').click();
  await expect(page.getByTestId('chat-feed')).toBeVisible();
}

test.describe('an event that has ended', () => {
  test('says so on the tab a guest lands on, before anything is tapped', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await enterEnded(page, scheme);

    // A refusal you only meet by trying is a guest typing a request into a field that was
    // never going to take it. The sentence is what makes the toast a confirmation.
    await expect(page.getByTestId('event-ended')).toBeVisible();
    await expect(page.getByTestId('event-ended')).toContainText(/still yours/i);
  });

  test('and does not say so on an event that is still open', async ({ page }, testInfo) => {
    // The other half, and the one that catches a banner rendered unconditionally -- which
    // would pass every assertion above it and be wrong on every live party in the world.
    const scheme = testInfo.project.name as 'dark' | 'light';
    await enterEnded(page, scheme, 'fresh');
    await expect(page.getByTestId('event-ended')).toHaveCount(0);
  });

  test('refuses a song request out loud rather than swallowing it', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await enterEnded(page, scheme);
    await page.getByTestId('tab-music').click();

    await page.getByTestId('request-input').fill('Common People');
    await page.getByTestId('request-submit').click();

    // NAMED, not silent. `useGuardedAction` catches the EntitlementError and raises the
    // denial copy; a swallowed rejection would leave the guest watching nothing happen.
    await expect(page.getByTestId('toast')).toContainText(/ended/i);
    // AND THE TEXT SURVIVES. A refusal that also wipes what somebody typed punishes them
    // for the app's own message -- the same rule the broadcast composer follows.
    await expect(page.getByTestId('request-input')).toHaveValue('Common People');
  });

  test('refuses a photo the same way', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await enterEnded(page, scheme);
    await page.getByTestId('tab-photos').click();

    await page.getByTestId('shutter-small').click();
    await expect(page.getByTestId('toast')).toContainText(/ended/i);
  });

  test('still shows everything that is already there, which is the whole point', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await enterEnded(page, scheme);

    // READING NEVER STOPS. An expiry that blanked the screen would be a worse product than
    // no expiry: the album is still there to save until the retention clock runs out three
    // weeks later, and this is the half most likely to be got wrong by someone enforcing
    // the window with `using` instead of `with check`.
    await expect(page.getByTestId('chat-feed')).toContainText('Thanks for coming');

    await page.getByTestId('tab-photos').click();
    await expect(page.getByTestId('album')).toBeVisible();
    await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(1);

    await page.getByTestId('tab-music').click();
    await expect(page.getByTestId('music-queue')).toContainText('Common People');
  });

  test('draws nothing a person can see and cannot use', async ({ page }, testInfo) => {
    // The class assertion (`empty-world.spec.ts` holds the general form). A closed event is
    // a limit a host lifts by UPGRADING, so the house rule is a refusal that names the
    // limit, never a greyed control that explains nothing -- the treatment that got three
    // dead buttons reported as "the first button doesn't even work".
    const scheme = testInfo.project.name as 'dark' | 'light';
    await enterEnded(page, scheme);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });
});
