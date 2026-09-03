import { expect, test, type Page } from '@playwright/test';

import { TOKENS, WEDDING, open, switchToHost } from './helpers';

/**
 * Artboard 01 -> Chat: getting into the event.
 *
 * Every test starts with `open()` from ./helpers, which waits on the
 * scheme-probe. The export is a SPA and its first paint precedes hydration, so
 * an assertion that skips that wait is racing the mount, not testing anything.
 *
 * WHY THE REJECTION PATH GETS THE MOST ATTENTION HERE. The canvas
 * (design/Runit.dc.html) set `joined: true` on tap, unconditionally -- it never
 * compared the code against the event, so "that code is wrong" was not a state
 * it could represent. Validation is ours, added in
 * MemoryRepository.session.joinAsGuest. Ours is exactly the part nothing
 * upstream has ever proven, so it is proven here.
 *
 * State is per page load: MemoryRepository is built in the root layout's
 * useMemo, so every `open()` re-seeds the wedding.
 *
 * WHAT THIS FILE CANNOT PROVE, STATED PLAINLY. `guestCount` is rendered in
 * exactly one place -- the "{n} here" pill in the Chat header -- and both the
 * guest and host layouts redirect an anonymous session to /join. So there is no
 * screen on which the room's count can be read BEFORE joining, and no e2e
 * assertion can distinguish "seeded 172, join adds one" from "seeded 173, join
 * adds nothing". Verified, not assumed: patching the built bundle to seed 173
 * and delete the increment leaves this whole file green. The seed's own value
 * is pinned by src/data/memory/MemoryRepository.test.ts, which can call the
 * repository directly; what is pinned HERE is everything around it -- that the
 * number is one more than the seed, that it is the same after two separate
 * joins in two page loads, that a refused code never reaches it, and that
 * crossing into the host console and back does not quietly add another. Do not
 * write a comment claiming this file catches a doctored seed. It does not.
 */

/** The "{n} here" pill. Anchored: the chat footer also ends in "hosts post here". */
const HERE_PILL = /^\d+ here$/;

/**
 * The room's own count of who is present, read off the Chat header.
 * `toHaveCount(1)` does double duty -- it waits for the header to commit, and
 * it fails loudly if the anchored pattern ever matches two things at once.
 */
async function peopleHere(page: Page): Promise<number> {
  const pill = page.getByText(HERE_PILL);
  await expect(pill).toHaveCount(1);
  return Number((await pill.innerText()).replace(/\D/g, ''));
}

/** Right shape, belongs to no event. */
const BAD_CODE = 'ZZ9999';

test.describe('Join', () => {
  test('the screen arrives bound to the seeded event: its name, its code filled in, an empty nickname, "Run it" on the button', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // The name is the claim that the screen is reading the seeded event at all:
    // JoinScreen falls back to the literal 'An event' when the observable gives
    // it nothing, and that fallback looks perfectly healthy on a screenshot.
    await expect(page.getByText(WEDDING.name, { exact: true })).toHaveCount(1);

    // "Scanned the QR? Your code is filled in." -- until a camera scan exists,
    // the seeded code is the stand-in. Asserting the nickname is empty in the
    // same breath is what makes this a claim about the CODE specifically,
    // rather than a claim that some form state happens to be populated.
    await expect(page.getByTestId('join-code')).toHaveValue(WEDDING.code);
    await expect(page.getByTestId('join-nickname')).toHaveValue('');

    // The CTA's resting label. Note what is deliberately NOT asserted anywhere
    // in this file: that it flips to "You're in ✓". It cannot be observed --
    // useJoinActions calls router.replace('/chat') in the same tick that sets
    // `joined`, so JoinScreen unmounts before the other branch of that ternary
    // ever paints. An assertion that the label is still "Run it" after a
    // refused join passes just as happily against a hardcoded string
    // (confirmed by patching the ternary out of the bundle), so it is not here.
    await expect(page.getByTestId('join-submit')).toHaveText('Run it');

    // And the count this file spends most of its time on is not on this screen
    // at all -- which is the whole reason there is no pre-join reading of it.
    await expect(page.getByText(HERE_PILL)).toHaveCount(0);
  });

  test('a code that matches no event is refused out loud, and does not leave the screen', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    await page.getByTestId('join-code').fill(BAD_CODE);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();

    // The message the repository throws, surfaced verbatim. It has to name the
    // problem: "could not join" would not tell a guest to check the code.
    //
    // This is also the reason <Toast> is now mounted inside JoinScreen. The
    // guest and host layouts each had one, but /join sits outside both, so
    // join() called show() into a void and a bad code failed in total silence.
    // This assertion is what catches that regression if the mount is ever
    // dropped again.
    const toast = page.getByTestId('toast');
    await expect(toast).toHaveText("That code doesn't match an event.");
    // Announced, not merely painted -- a failure a screen reader misses is a
    // failure the guest never learns about.
    await expect(toast).toHaveAttribute('aria-live', 'polite');

    // ...and it genuinely did not navigate. Both halves matter: the URL alone
    // would pass on a screen that had already swapped its content.
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByTestId('chat-feed')).toHaveCount(0);
    await expect(page.getByTestId('join-submit')).toBeVisible();

    // The typed code survives the refusal, so a one-character typo is one
    // character to fix rather than a re-entry.
    await expect(page.getByTestId('join-code')).toHaveValue(BAD_CODE);
  });

  test('a refused code seats nobody: a good join after a bad one, in the same page load, still adds exactly one', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // Two submissions, one page load, one seat. If the counter moved on
    // anything but a real join -- on the tap, or on the throw -- the room would
    // read one too many at the end.
    await page.getByTestId('join-code').fill(BAD_CODE);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('toast')).toHaveText("That code doesn't match an event.");

    await page.getByTestId('join-code').fill(WEDDING.code);
    await page.getByTestId('join-submit').click();

    await expect(page.getByTestId('chat-feed')).toBeVisible();
    expect(await peopleHere(page)).toBe(WEDDING.present + 1);
  });

  test('the correct code and a nickname lands in Chat, and the room reads one more than the seed -- once per join, not once per attempt', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';

    await open(page, scheme);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();

    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await expect(page).toHaveURL(/\/chat$/);
    expect(await peopleHere(page)).toBe(WEDDING.present + 1);

    // Second load, second guest, same room, same number. The seed is rebuilt
    // per page load, so this says the join adds one to the SEED rather than one
    // to whatever the number happened to be -- it is the check that fails if a
    // count ever starts surviving a reload.
    await open(page, scheme);
    await page.getByTestId('join-nickname').fill('Bo');
    await page.getByTestId('join-submit').click();

    await expect(page.getByTestId('chat-feed')).toBeVisible();
    expect(await peopleHere(page)).toBe(WEDDING.present + 1);
  });

  test('the seat belongs to the join: crossing to the host console and back does not take a second one', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();

    const seated = await peopleHere(page);
    expect(seated).toBe(WEDDING.present + 1);

    // RoleSwitch calls session.becomeHost / session.becomeGuest, which write the
    // same session signal that joinAsGuest writes. Putting the increment next to
    // that write instead of next to the join is a live and invisible bug -- the
    // room just drifts upward as the host flips between views. Patching
    // becomeGuest to increment leaves every other test in this file green; only
    // this one fails.
    await switchToHost(page);
    // The pill is the guest header's, so the host console must not show one --
    // otherwise the reading below could be coming from the wrong screen.
    await expect(page.getByText(HERE_PILL)).toHaveCount(0);

    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    expect(await peopleHere(page)).toBe(seated);
  });

  test('the code is read the way a guest types it: lower case and stray spaces still get in', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // A guest reading the code off a table card types it however they type it.
    // joinAsGuest trims and upper-cases before comparing; this is that promise,
    // and it is the counterweight to the strictness proven above -- rejecting a
    // wrong code must not mean rejecting a right one that was typed untidily.
    await page.getByTestId('join-code').fill(`  ${WEDDING.code.toLowerCase()}  `);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();

    await expect(page.getByTestId('chat-feed')).toBeVisible();
    expect(await peopleHere(page)).toBe(WEDDING.present + 1);
  });

  test('the welcome toast greets you by the name you typed, and drops the name when you type none', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // A name that appears nowhere in the wedding fixture, so a passing
    // assertion cannot be a coincidental match against seeded copy.
    await page.getByTestId('join-nickname').fill('Zephyr');
    await page.getByTestId('join-submit').click();

    // Raised on /join and read on /chat: ToastProvider sits above the router,
    // so the message survives the replace() into the guest layout -- and the
    // JoinScreen toast has unmounted by then, so this is the guest layout's.
    await expect(page.getByTestId('toast')).toHaveText("Welcome, Zephyr. You're in.");
    await expect(page.getByTestId('chat-feed')).toBeVisible();

    // Fresh load, no nickname: the greeting drops the name rather than greeting
    // an empty string. This is the half that proves the line above is
    // interpolated from the field instead of being fixed copy.
    await open(page, scheme);
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('toast')).toHaveText("Welcome. You're in.");
    await expect(page.getByTestId('chat-feed')).toBeVisible();
  });

  test('the join button is painted in this scheme’s primary', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // A colour, not a class name: the DOM once reported dark while the screen
    // rendered light, and only the painted value caught it (CLAUDE.md, lane B).
    // TOKENS carries the design's own oklch values converted to rgb, so this
    // fails if the theme resolves to the wrong scheme in this project.
    await expect(page.getByTestId('join-submit')).toHaveCSS(
      'background-color',
      TOKENS[scheme].primary,
    );
  });
});
