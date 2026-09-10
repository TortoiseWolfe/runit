import { expect, test } from '@playwright/test';

import { INVITATION_LINE, WEDDING, open } from './helpers';

/**
 * The invitation, before it has been accepted -- issue #15.
 *
 * `events_read` admits members only, so against Supabase there is no event until you
 * have joined one. A guest arriving from a link or a QR therefore saw the literal
 * fallback 'An event', an empty subtitle, and no calendar pill: an invitation screen
 * that could not show the invitation. Reported from a phone as "first button doesn't
 * even work, I can't add the invite to my calendar, who set the date and where".
 *
 * `event_preview(code)` is the fix -- one SECURITY DEFINER function returning the public
 * face of an event and nothing else. `?invited=1` boots the world that exercises it: no
 * `event.current`, but a code that resolves.
 *
 * WHY THIS FIXTURE HAD TO EXIST. `weddingSeed` already has `event.current`, so the
 * invitation renders from that and the whole preview path could be deleted with every
 * other spec still green. That is the same shape as the bug that shipped three inert
 * controls -- not "a control is broken" but "no test can reach the state where it is".
 *
 * WHAT THIS FILE DOES NOT PROVE. It runs MemoryRepository, like all 142 journeys, so it
 * says nothing about whether `event_preview` is granted correctly, withholds the columns
 * it should, or is reachable by a non-member. Only Lane E can see that, and it does --
 * `supabase/verify-policies.sql`, run live. Issue #20 is the standing proposal to close
 * this gap properly.
 */

/**
 * THE FALLBACK CHANGED, AND THE CHANGE IS THE POINT rather than a rename.
 *
 * It was the literal `An event`, under an eyebrow reading "You're invited to" -- so the
 * screen ASSERTED an invitation and then failed to name it, which is what this file's own
 * docblock calls "an invitation screen that could not show the invitation". Worse, a code
 * that resolves to nothing renders identically to a cold open by design (`hooks.ts`
 * swallows the lookup), so a typo looked exactly like a fresh install.
 *
 * The same two lines now do honest work in both states: with a preview they are an
 * invitation, without one they are an instruction -- `Join an event` / `Enter your code`.
 * Every assertion below is unchanged in INTENT: the fallback must appear exactly once when
 * no event was found, and never when one was.
 */
const FALLBACK = 'Enter your code';

test.describe('an invitation arriving from a link', () => {
  test('names the event, its date and its venue before anyone has joined', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?invited=1&code=SR1017');

    // The name is the claim that the lookup ran at all: without it the screen falls back
    // to the instruction, which is a legitimate screen and would look perfectly healthy
    // in a screenshot. That is why this asserts the fallback is ABSENT as well as the
    // name being present.
    await expect(page.getByText(WEDDING.name, { exact: true })).toHaveCount(1);
    await expect(page.getByText(FALLBACK, { exact: true })).toHaveCount(0);

    // Date · doors · venue, assembled from three fields rather than read from one
    // string. Matching the date by SHAPE because the fixture anchors to yesterday on
    // purpose -- see INVITATION_LINE.
    await expect(page.getByText(INVITATION_LINE)).toHaveCount(1);
  });

  test('offers a calendar entry, and nothing that cannot be used', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?invited=1&code=SR1017');

    await expect(page.getByTestId('join-add-calendar')).toBeVisible();
    // The class assertion, same as empty-world.spec.ts. A preview that rendered a
    // spinner or a greyed pill while it resolved would fail here, which is why it
    // renders neither.
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('does not say how many people are already there', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?invited=1&code=SR1017');

    // THE PRIVACY CLAIM, and the one place the preview must be poorer than the event.
    // `event_preview` withholds guest_count in SQL; this is the same decision visible
    // from the outside. The fine print three lines below promises "guests can't see
    // each other", and a headcount for a room you have not entered is the first crack
    // in it. The pill returns the moment you join -- join.spec.ts proves that.
    await expect(page.getByTestId('join-guest-count')).toHaveCount(0);
    // The name IS there, so this is a claim about the count specifically rather than
    // about a screen that failed to render anything.
    await expect(page.getByText(WEDDING.name, { exact: true })).toHaveCount(1);
  });

  test('fills the code from the link, so nobody retypes what they were sent', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?invited=1&code=SR1017');

    await expect(page.getByTestId('join-code')).toHaveValue(WEDDING.code);
  });

  test('a code that names no event says nothing rather than something wrong', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?invited=1&code=ZZ9999');

    // A miss is zero rows and no exception -- not an error state. The screen falls back
    // to asking for a code, which is the correct answer to a code nobody has heard of:
    // it neither invents an event nor accuses the guest of anything.
    await expect(page.getByText(FALLBACK, { exact: true })).toHaveCount(1);
    await expect(page.getByText(INVITATION_LINE)).toHaveCount(0);
    await expect(page.getByTestId('join-add-calendar')).toHaveCount(0);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
  });

  test('no code in the link means no lookup at all', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?invited=1');

    // Deliberate: the lookup fires for a code somebody was GIVEN, never for one being
    // typed. A lookup per keystroke would mint an anonymous auth user for every
    // half-finished code and turn this field into a code-guessing probe.
    await expect(page.getByText(FALLBACK, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId('join-add-calendar')).toHaveCount(0);
  });

  /*
   * THE TRANSITION IS NOT TESTED HERE, AND IT IS NOT AN OVERSIGHT.
   *
   * Accepting an invitation -- typing a nickname and landing on Chat -- cannot be
   * modelled in this world. Against Supabase, `join_event` succeeds and `events_read`
   * then returns the whole row, so the full event materialises out of the database.
   * MemoryRepository has no database to materialise one from: an EventPreview carries
   * seven of RunitEvent's twelve fields, and the missing five are `tier`,
   * `activeFolderId`, `nowScheduleItemId`, `guestCount` and `invitedCount`.
   *
   * Inventing those in the fixture would make the fake more generous than the adapter,
   * which is the failure `previewOf` exists to prevent -- and it would put a tier and a
   * folder id on screen that no server ever sent. Better to leave the gap visible.
   *
   * So `?invited=1` proves the invitation SCREEN and nothing after it. The transition is
   * issue #20's to prove, against a real project, and the two-devices-on-one-code gate
   * covers it until then. A "Run it" here fails on `unknown_code`, which is a harness
   * artifact: the flag only exists in EXPO_PUBLIC_FIDELITY builds and never ships.
   */
});

test.describe('the joined world still reads the same invitation', () => {
  test('composes date, doors and venue from the event once you are in it', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // Regression guard for `invite = event ?? preview`. The joined path must produce
    // the identical line from `event.current` with no lookup involved -- otherwise the
    // preview would be quietly carrying a screen that used to work without it.
    await expect(page.getByText(INVITATION_LINE)).toHaveCount(1);
  });
});
