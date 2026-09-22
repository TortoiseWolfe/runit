import { expect, test } from '@playwright/test';

import { joinAsGuest, open, switchToHost } from './helpers';

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

  test('a guest already inside can reach it too, from where things visibly break', async ({
    page,
  }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme, 'Ada');

    // THE GAP THE FIRST DRAFT LEFT. The join screen serves the person who cannot get in;
    // a guest whose photo did not upload is already through the door and never sees that
    // screen again. Photos and Music are the two tabs where a guest NOTICES.
    await page.getByTestId('tab-photos').click();
    await expect(page.getByTestId('open-feedback')).toBeVisible();

    await page.getByTestId('tab-music').click();
    await expect(page.getByTestId('open-feedback')).toBeVisible();

    // Same sheet, not a second copy of the form -- two copies would be two places the
    // "here is what we are sending" sentence lives, and they would drift.
    await page.getByTestId('open-feedback').click();
    await expect(page.getByTestId('feedback-facts')).toContainText(/no email/i);
  });


  /**
   * THE HOST HAD NO ROUTE AT ALL, and she is the person who buys this.
   *
   * Before `HostConsoleFooter` her only path was five steps with an IDENTITY MUTATION in
   * the middle: `role-switch` calls `becomeGuest()` and lands on Chat, which deliberately
   * has none, then a tab, then a scroll, then a tap, then switch back. This asserts the
   * short way exists on every segment -- and deliberately never touches `role-switch`
   * after arriving, because a test that switched role would pass against the old path too.
   */
  for (const seg of ['broadcast', 'dj', 'photos', 'reports', 'event'] as const) {
    test(`a host can report from the ${seg} segment without changing who she is`, async ({
      page,
    }, info) => {
      await joinAsGuest(page, info.project.name as 'dark' | 'light');
      await switchToHost(page);
      if (seg !== 'broadcast') await page.getByTestId(`host-segment-${seg}`).click();

      // `:visible` and a COUNT, not toBeVisible on a bare testID -- expo-router keeps
      // popped screens mounted and CSS-hidden, so the guest tabs' copies are still in the
      // DOM (#80). The honest question is how many she can SEE, and the answer is one.
      const control = page.locator('[data-testid="open-feedback"]:visible');
      await expect(control).toHaveCount(1);
      await control.click();
      await expect(page.getByTestId('feedback-facts')).toContainText(/no email/i);
    });
  }

  test('a host who is standing in the console never has to leave it to report', async ({
    page,
  }, info) => {
    await joinAsGuest(page, info.project.name as 'dark' | 'light');
    await switchToHost(page);
    await page.locator('[data-testid="open-feedback"]:visible').click();
    await page.getByTestId('feedback-body').fill('The broadcast never sent.');
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('toast')).toContainText(/thanks/i);
    // Still a host, still on the console.
    await expect(page.getByTestId('host-broadcast')).toBeVisible();
  });

  /**
   * A CODE THAT NEVER ARRIVES. This screen waits on GoTrue, custom SMTP, Resend, DNS and a
   * spam filter, and every one of those has failed here -- five real sign-in emails once
   * landed carrying the DEFAULT template, with no six-digit code in them at all, against
   * this exact screen asking for six digits. A host in that state had nowhere to say so.
   */
  test('a host whose emailed code never arrives can say so from the sign-in screen', async ({
    page,
  }, info) => {
    await open(page, info.project.name as 'dark' | 'light', '/signin', 'signin-send');
    const control = page.locator('[data-testid="open-feedback"]:visible');
    await expect(control).toHaveCount(1);
    await control.click();
    await expect(page.getByTestId('feedback-facts')).toContainText(/no email/i);
  });

  /**
   * ARRIVING HERE IS ITSELF THE REPORT -- a truncated invitation, a stale route, a deep link
   * the app did not recognise. "Go home" threw away the only person who could describe it.
   *
   * IT SENDS rather than merely opening, because the control and the `<Toast/>` landed in
   * one commit and only a send proves the second one is there. Mutation-checked: dropping
   * `<Toast/>` from `+not-found` turns exactly this red and nothing else.
   */
  test('a wrong link is reportable, and the report says it landed', async ({ page }, info) => {
    await open(page, info.project.name as 'dark' | 'light', '/no-such-screen', 'open-feedback');
    await page.getByTestId('open-feedback').click();
    await page.getByTestId('feedback-body').fill('The link in my invitation went nowhere.');
    await page.getByTestId('feedback-send').click();
    await expect(page.getByTestId('toast')).toContainText(/thanks/i);
  });


  /**
   * THE BRIDGE PAGE'S ONLY WAY INTO THE PIPELINE.
   *
   * `web/i/index.html` is a static file with no framework -- it cannot open a sheet, and a
   * form on it would be a second implementation of one. It links here instead. Without this
   * param that link is a dead end, and the dead end would be silent: the join screen would
   * render perfectly and the person who came specifically to complain would have to find a
   * control below the fold.
   */
  test('somebody who arrived from the bridge page asking to report lands in the sheet', async ({
    page,
  }, info) => {
    await open(page, info.project.name as 'dark' | 'light', '/join?report=1', 'feedback-body');
    await expect(page.getByTestId('feedback-facts')).toContainText(/no email/i);
  });

  test('and the sheet is not open for everybody else', async ({ page }, info) => {
    // The other half, and it is the half a one-sided test would miss: `autoOpen` defaulting
    // true, or the param being read as "present" rather than "=1", both pass the test above
    // and open a modal over the join screen for every guest arriving from a normal link.
    await open(page, info.project.name as 'dark' | 'light', '/join?code=SR1017', 'join-submit');
    await expect(page.getByTestId('feedback-sheet')).toHaveCount(0);
  });

  test('and the chat tab keeps saying why a guest cannot type there', async ({ page }, info) => {
    const scheme = info.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme, 'Ada');

    // THE ASSERTION THAT CAUGHT THE FIRST ATTEMPT. The report control went in the chat
    // footer and displaced this line, which is what tells a guest why there is no compose
    // box. `guest-chat.spec.ts` holds it too; this holds the pair -- the control is
    // elsewhere AND that line survived.
    await expect(page.getByText('Announcements only · hosts post here')).toBeVisible();
    await expect(page.getByTestId('open-feedback')).toHaveCount(0);
  });

  test('a picture is offered, optional, and says so', async ({ page }, info) => {
    await open(page, info.project.name as 'dark' | 'light');
    await page.getByTestId('open-feedback').click();

    // OPTIONAL IN THE LABEL, because demanding a screenshot turns a ten-second report into
    // a task and a sentence on its own is worth filing.
    await expect(page.getByTestId('feedback-attach')).toContainText(/optional/i);
    // And the sentence above the button does NOT yet mention a picture, because there is
    // none -- it describes what will actually be sent, not what could be.
    await expect(page.getByTestId('feedback-facts')).not.toContainText(/the picture you chose/);
  });

  test('once one is attached, the sheet says the picture is going too', async ({ page }, info) => {
    await open(page, info.project.name as 'dark' | 'light');
    await page.getByTestId('open-feedback').click();
    await page.getByTestId('feedback-attach').click();

    // THE CONTROL CHANGES ITS OWN LABEL, so somebody can tell a picture went on without
    // having to remember whether they tapped it.
    await expect(page.getByTestId('feedback-attach')).toContainText(/attached/i);
    // AND THE "WHAT WE ARE SENDING" SENTENCE FOLLOWS IT. A report that quietly adds a file
    // to what it described earlier is the harvesting this sheet exists not to do.
    await expect(page.getByTestId('feedback-facts')).toContainText(/the picture you chose/);
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
