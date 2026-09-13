import { expect, test } from '@playwright/test';

import { open, ready } from './helpers';

/**
 * Host sign-in by emailed code -- #18.
 *
 * WHAT THESE JOURNEYS CAN AND CANNOT PROVE, stated up front in the shape `join.spec.ts`
 * uses, because the gap is large here.
 *
 * They boot `MemoryRepository`. It has no auth users and no `hosts` rows keyed on a uid, so
 * the ONE mistake this whole feature is designed around -- calling `signInWithOtp` for a
 * host who is still holding the anonymous identity her event is bound to, minting a new uid
 * and orphaning the event -- is INVISIBLE here and in every other lane but H. What is
 * provable is that the screen asks for the mode, carries it, and hands it back unchanged,
 * which is the part a screen can get wrong.
 *
 * The fixture accepts exactly one code. It is `FIXTURE_EMAIL_CODE` in
 * `src/data/memory/MemoryRepository.ts`; a Playwright spec cannot import from `src/`, so it
 * is repeated here ONCE, named, rather than sprinkled as a literal.
 */
const CODE = '424242';

test.describe('a host signs in with an emailed code', () => {
  test('the way in is a quiet link on the join screen, and it leads somewhere', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    await page.click('[data-testid="join-signin"]');
    await expect(page.getByTestId('host-signin')).toBeVisible();
    await expect(page.getByTestId('signin-email')).toBeVisible();
  });

  /**
   * THE PRODUCT PROMISE, AND THIS TEST IS THE ONLY THING KEEPING IT. The fine print on the
   * join screen says "No account, no phone number", and the reason sign-in is a LINK rather
   * than a field is that a field underneath that sentence makes it read as false to every
   * guest who opens the app -- which is nearly everyone.
   *
   * Mutation-checked by adding an email field to JoinScreen: this reds.
   */
  test('no email field is anywhere on the join path', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    await expect(page.getByTestId('signin-email')).toHaveCount(0);
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    // The three fields a guest sees, and no fourth.
    await expect(page.getByTestId('join-code')).toBeVisible();
    await expect(page.getByTestId('join-nickname')).toBeVisible();
    await expect(page.getByTestId('join-host-key')).toBeVisible();
  });

  test('an address brings up the code field', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/signin', 'host-signin');
    await expect(page.getByTestId('signin-code')).toHaveCount(0);
    await page.fill('[data-testid="signin-email"]', 'ruth@example.com');
    await page.click('[data-testid="signin-send"]');
    await expect(page.getByTestId('signin-code')).toBeVisible();
    // The address stays on screen. A host who mistyped it is otherwise watching an inbox
    // that will never receive anything, with nothing telling her why.
    await expect(page.getByTestId('signin-email')).toHaveValue('ruth@example.com');
  });

  test('a wrong code is refused, in the words the copy table holds', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/signin', 'host-signin');
    await page.fill('[data-testid="signin-email"]', 'ruth@example.com');
    await page.click('[data-testid="signin-send"]');
    await page.fill('[data-testid="signin-code"]', '000000');
    await page.click('[data-testid="signin-verify"]');
    // VERBATIM from JOIN_COPY.bad_email_code. Pinned because the whole point of that table
    // is that a reason and its sentence cannot drift apart.
    await expect(page.getByTestId('toast')).toHaveText(
      "That code isn't right. Codes last 10 minutes — ask for a new one.",
    );
    // Still on the screen, with the code still there to correct.
    await expect(page.getByTestId('signin-code')).toBeVisible();
  });

  test('the right code signs in and lands where the events are', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/signin', 'host-signin');
    await page.fill('[data-testid="signin-email"]', 'ruth@example.com');
    await page.click('[data-testid="signin-send"]');
    await page.fill('[data-testid="signin-code"]', CODE);
    await page.click('[data-testid="signin-verify"]');
    // `/join`, not a second event list built here: JoinScreen already renders
    // <MyEventsList hideCurrent /> from #17, and `submitEmailCode` has just refreshed it.
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByTestId('join-submit')).toBeVisible();
  });

  /**
   * A code is issued FOR AN ADDRESS. GoTrue refuses one presented against a different one,
   * and `MemoryRepository.pendingEmail` models that refusal -- so a screen that let the
   * address be edited while keeping the code phase open would send a request that can only
   * fail, and blame the code.
   */
  test('editing the address after a code was sent starts over', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/signin', 'host-signin');
    await page.fill('[data-testid="signin-email"]', 'ruth@example.com');
    await page.click('[data-testid="signin-send"]');
    await expect(page.getByTestId('signin-code')).toBeVisible();

    await page.fill('[data-testid="signin-email"]', 'grace@example.com');
    await expect(page.getByTestId('signin-code')).toHaveCount(0);
    await expect(page.getByTestId('signin-send')).toBeVisible();
  });

  /**
   * The house rule, and it has teeth here: the resend control is throttled for 60 seconds
   * by `max_frequency`, and the tempting way to express that is a disabled button. This
   * repo's gate is that a drawn control which does nothing is what `aria-disabled` is FOR,
   * so the screen renders the reason instead and brings the control back when it works.
   */
  test('nothing on this screen is a door that will not open', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/signin', 'host-signin');
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
    await page.fill('[data-testid="signin-email"]', 'ruth@example.com');
    await page.click('[data-testid="signin-send"]');
    await expect(page.getByTestId('signin-code')).toBeVisible();
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
    // While the throttle runs there is a sentence and no button, rather than a dead button.
    await expect(page.getByTestId('signin-resend-wait')).toBeVisible();
    await expect(page.getByTestId('signin-resend')).toHaveCount(0);
  });

  test('back returns to the join screen', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/signin', 'host-signin');
    await page.click('[data-testid="signin-back"]');
    await ready(page, scheme);
    await expect(page.getByTestId('join-submit')).toBeVisible();
  });
});
