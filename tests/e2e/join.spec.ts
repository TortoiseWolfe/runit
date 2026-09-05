import { expect, test, type Page } from '@playwright/test';

import { TOKENS, WEDDING, joinAsGuest, open, switchToHost } from './helpers';

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
 * THE LIMIT THIS FILE USED TO CARRY, AND HOW IT WAS CLOSED. `guestCount` was
 * rendered in exactly one place -- the "{n} here" pill in the Chat header -- and
 * both guarded layouts redirect an anonymous session to /join. So there was no
 * screen on which the room's count could be read BEFORE joining, and no
 * assertion here could tell "seeded 172, join adds one" apart from "seeded 173,
 * join adds nothing". That was verified rather than assumed: patching the built
 * bundle to seed 173 and delete the increment left this whole file green.
 *
 * The join screen now shows "N already here" (join-guest-count), so the
 * before-reading exists and the increment is provable end-to-end -- see the
 * three-point test below. That was a product change made to close a test gap,
 * which is worth naming: it is defensible here only because an aggregate count
 * is a thing a guest genuinely wants before committing, and it reveals no
 * individual. It is recorded as an intentional divergence in FIDELITY note J.
 *
 * State is per page load, which is what makes the three-point reading work:
 * MemoryRepository is built in the root layout's useMemo, so `open()` re-seeds
 * -- but in-app navigation does not. `/join` is deliberately NOT session-guarded
 * (only src/app/index.tsx gates on session), so a joined guest can navigate back
 * to it and read the count again within one page load.
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

  test('the count is provable, not merely consistent: 172 before the join, 173 after', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);

    // THE READING THAT DID NOT EXIST. Everything else in this file reads the
    // count only AFTER joining, which is satisfied just as well by a seed of 173
    // that never increments. This one fails immediately in that world.
    const before = page.getByTestId('join-guest-count');
    await expect(before).toHaveText(`${WEDDING.present} already here`);

    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    expect(await peopleHere(page)).toBe(WEDDING.present + 1);

    // NO THIRD READING, and the reason is worth recording rather than leaving as
    // an absence. A round trip back to /join would be a nice flourish, but
    // useJoinActions calls router.REPLACE('/chat'), so /join is not on the
    // history stack and page.goBack() leaves the app; and page.goto() would
    // reload the SPA, re-seeding the repository and discarding the state under
    // test. Neither is worth a product change, because two readings is already
    // the whole point: a seed of 173 that never increments fails at the FIRST
    // one. "Once per join, not once per attempt" is covered separately by the
    // host-console round trip below.
  });
});

test.describe('Join · leaving', () => {
  /**
   * The trap this closes: a guest who joined WITHOUT the optional host key had no route
   * out. The tab bar is Chat/Photos/Music, /join is unguarded but nothing navigates to
   * it, and RoleSwitch's becomeHost fails and toasts. Deleting the app was the only exit,
   * and it was found on a real iPhone rather than here.
   *
   * WHAT THIS CANNOT SEE, said plainly: whether leaving preserves the guest's IDENTITY.
   * That is the whole reason the screen calls closeEvent() rather than leave() -- keeping
   * the anonymous session is what makes a re-join land on the same guests row instead of
   * inserting a second one. MemoryRepository, which this suite runs, has no auth to sign
   * out of, so it would pass either way. The assertion that catches a regression there is
   * in SupabaseRepository.test.ts, against the fake that can count sign-ins.
   */
  test('a guest can leave, and lands back on the join screen with the tabs gone', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    await joinAsGuest(page, scheme, 'Ada');
    await expect(page.getByTestId('chat-feed')).toBeVisible();

    await page.getByTestId('leave-event').click();
    await expect(page.getByTestId('leave-sheet')).toBeVisible();
    await page.getByTestId('leave-confirm').click();

    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByTestId('join-submit')).toBeVisible();
    // The tab bar belongs to the guest layout, which an anonymous session must not reach.
    await expect(page.getByTestId('tab-chat')).toHaveCount(0);
  });

  test('the sheet can be dismissed without leaving', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    await joinAsGuest(page, scheme, 'Ada');
    await page.getByTestId('leave-event').click();
    await page.getByTestId('leave-cancel').click();
    await expect(page.getByTestId('leave-sheet')).toHaveCount(0);
    await expect(page.getByTestId('chat-feed')).toBeVisible();
  });
});

test.describe('Join · claiming a host seat', () => {
  /**
   * The claim flow exists because a host is whoever matches hosts.auth_user_id, and
   * Runit has no sign-in -- so `becomeHost` cannot make anyone a host against a real
   * backend. These run on MemoryRepository, whose key is a FIXTURE (DEMO_HOST_KEY);
   * the real keys are bcrypt hashes in Postgres and appear in no file here.
   *
   * What they pin is the FLOW, which is the part both adapters share: the field is
   * optional, a wrong key does not cost you your seat, and a right one lands you in
   * the console.
   */
  test('the host key field is optional -- an empty one joins as a guest', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    await page.getByTestId('join-code').fill(WEDDING.code);
    await page.getByTestId('join-nickname').fill('Ada');
    await expect(page.getByTestId('join-host-key')).toHaveValue('');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
  });

  test('a wrong key says so and still seats you as a guest', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    await page.getByTestId('join-code').fill(WEDDING.code);
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-host-key').fill('NOPE-NOPE-NOPE');
    await page.getByTestId('join-submit').click();
    // Named, not swallowed -- and the join is NOT undone. Throwing someone back to
    // retype a nickname because of a typo in an optional field is a punishment.
    await expect(page.getByTestId('toast')).toHaveText(/host key isn't right/i);
    await expect(page.getByTestId('chat-feed')).toBeVisible();
  });

  test('the right key lands in the host console, dashes and case ignored', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    await page.getByTestId('join-code').fill(WEDDING.code);
    await page.getByTestId('join-nickname').fill('Riley');
    // Typed the way a person actually would, off a note, in the wrong case and
    // without the grouping. claim_host canonicalises; the dashes are presentation.
    await page.getByTestId('join-host-key').fill('demohostkey0');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('host-broadcast')).toBeVisible();
  });
});

test.describe('Join · arriving from a link', () => {
  /**
   * The route read NO params before this: `runit://join?code=SR1017` opened the join
   * screen and discarded the code. That was survivable only because the in-memory
   * adapter seeds an event to pre-fill from.
   *
   * Against Supabase it is not. `events_read` admits members only, so `event` is null
   * until you have already joined -- a first-time guest would see an empty field and no
   * event name, and the canvas's "Scanned the QR? Your code is filled in" would be a
   * plain lie. The link is what carries the code now, so it is what is tested.
   */
  test('a code in the query string fills the field', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?code=LINKED1');
    await expect(page.getByTestId('join-code')).toHaveValue('LINKED1');
  });

  test('the link WINS over the seeded event, because the seed will not exist', async ({
    page,
  }, testInfo) => {
    // The in-memory seed is SR1017. A link naming a different event must not be
    // overridden by it, or a guest who taps the right invite joins the wrong party.
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join?code=OTHER9');
    await expect(page.getByTestId('join-code')).not.toHaveValue(WEDDING.code);
    await expect(page.getByTestId('join-code')).toHaveValue('OTHER9');
  });

  test('no code in the link falls back to the seeded event', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme, '/join');
    await expect(page.getByTestId('join-code')).toHaveValue(WEDDING.code);
  });
});

test.describe('Join · add to calendar', () => {
  /**
   * This pill was a `View` with no onPress for months, deliberately -- the canvas draws
   * the affordance and the code could not honour it, so it was demoted rather than left
   * lying. It is a Pressable again because an .ics needs no calendar permission, which
   * `expo-calendar` would have.
   */
  test('the pill is a real button now, and says something either way', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await open(page, scheme);
    const pill = page.getByTestId('join-add-calendar');
    await expect(pill).toBeVisible();
    await pill.click();
    // On web there is no share sheet, so the honest outcome is a message naming why --
    // not silence, and not a claim that something was added.
    await expect(page.getByTestId('toast')).toContainText(/calendar/i);
  });
});
