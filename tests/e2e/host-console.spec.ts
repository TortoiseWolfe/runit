import { expect, test, type Page } from '@playwright/test';

import { WEDDING, joinAsGuest, open, switchToHost } from './helpers';

/**
 * The host console: /host/broadcast, /host/dj, /host/photos behind one
 * segmented control.
 *
 * What these tests are about is the console's NUMBERS. Every count in the
 * header is derived from live state -- incoming.length, pending.length -- and
 * the broadcast composer addresses a different population than the guest header
 * does. Those two facts are where the console has been wrong before, so the
 * assertions here are before/after on a value, never "the heading rendered".
 *
 * State is in-memory and resets on every page load, so each test re-joins and
 * owns its own copy of the seed. joinAsGuest() waits on the scheme probe, so
 * nothing here races hydration.
 */

/** Bodies chosen so they appear nowhere in the seed and can be located by text. */
const PLAIN = 'Sparklers are stacked by the side door.';
const PINNED = 'Last call at the bar is 11 PM sharp.';
const ANNOUNCEMENT = 'Cake is being cut by the oak tree in five minutes.';

/**
 * A broadcast byline exactly as the guest feed renders it -- "Name · Role ·
 * H:MM AM/PM" and nothing else. Anchored, so the run-of-show summary line
 * ("● Now · Dinner + toasts · Next First dance, then open floor 8:00 PM")
 * cannot masquerade as one and inflate the count.
 */
const BYLINE = /^[^·\n]+ · [^·\n]+ · \d{1,2}:\d{2} [AP]M$/;

/** A scrolling panel's rendered copy, line by line, whitespace trimmed. */
async function lines(page: Page, testId: string): Promise<string[]> {
  const text = await page.getByTestId(testId).innerText();
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * The subtitles of the "Up next · accepted" rows, in render order --
 * "ABBA · ▲41 · Priya". One per accepted request, carrying its vote count, so
 * the returned array IS the ranking.
 *
 * The section boundaries are found case-insensitively on purpose: the eyebrows
 * are uppercased by `text-transform`, which innerText applies but textContent
 * does not, and that difference should not be what decides whether this passes.
 */
async function upNextSubtitles(page: Page): Promise<string[]> {
  const all = await lines(page, 'host-dj');
  const at = (needle: string) => all.findIndex((l) => l.toLowerCase().startsWith(needle));
  const from = at('up next');
  const to = at('incoming');
  expect(from, 'no "Up next" section on the DJ panel').toBeGreaterThan(-1);
  expect(to, 'no "Incoming" section after "Up next"').toBeGreaterThan(from);
  return all.slice(from + 1, to).filter((l) => l.includes('▲'));
}

test.describe('host console', () => {
  test('the segment control counts the work actually waiting: 5 songs, 3 photos, nothing on Broadcast', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // Five of the six seeded requests are still pending (req_1 is already
    // accepted), and three photos await moderation. The badges are those
    // lengths, not constants -- later tests move both numbers.
    await expect(page.getByTestId('host-segment-dj')).toHaveText('DJ queue · 5');
    await expect(page.getByTestId('host-segment-photos')).toHaveText('Photos · 3');
    // Broadcast has no queue behind it, so it must render bare -- a " · 0"
    // here would mean the badge is printing a count it does not have.
    await expect(page.getByTestId('host-segment-broadcast')).toHaveText('Broadcast');

    // Who the console seats you as, which is what later tests rely on when they
    // check the authorship of a sent broadcast. Riley is hosts[0]; Jordan and
    // DJ Marco are equally plausible and would fail this.
    await expect(page.getByText('Riley · Bride')).toBeVisible();
  });

  test('the header names the party you are about to broadcast to, and changes when you switch (#58)', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // BEFORE. The header used to print the literal `Host` here, so two parties open at
    // once looked identical from the one screen where the mistake is unrecoverable --
    // Broadcast is the first segment, `broadcasts` has no delete path, and #27's fan-out
    // pushes a sent announcement to every phone in the room.
    const title = page.getByTestId('host-console-title');
    await expect(title).toHaveText(WEDDING.name);

    // AFTER, and this is the half that has teeth. A header that merely RENDERS a name
    // passes whether or not the name follows the event -- it would pass on a hardcoded
    // string. Switching is what proves it reads `event.current`.
    await page.getByTestId('host-segment-event').click();
    await page.getByTestId('event-switcher-toggle').click();
    await page.getByTestId('my-event-RH2210').click();
    await expect(title).toHaveText('Rehearsal Dinner');
  });

  test('the host can send the date, not just the code and the venue (#61)', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // `icsFor` was written, tested and reachable from ONE screen: the guest's join
    // screen, in the app, after they arrived. The message that reaches everyone else is
    // the one the host sends from this row, and it carried the start time as prose or
    // not at all.
    const calendar = page.getByTestId('host-share-calendar');
    await expect(calendar).toBeVisible();
    await calendar.click();
    // The honest outcome either way: headless Chromium has no share sheet, so `shareIcs`
    // resolves false and the toast must SAY so rather than leave a control that appears to
    // do nothing.
    const toast = page.getByTestId('toast');
    await expect(toast).toContainText(/calendar/i);
    // AND NOT THE OTHER HANDLER'S MESSAGE. `toContainText(/calendar/i)` alone passes if
    // this Pressable is wired to `onShare` by a copy-paste -- both live in one row, both
    // toast on a missing sheet. The share-invite toast names the CODE; this one must not,
    // which is what separates "the calendar control ran" from "a control ran".
    await expect(toast).not.toContainText(WEDDING.code);
  });

  /**
   * WHAT THE TEST ABOVE CANNOT PROVE, said rather than implied. `share.web.ts` is a stub --
   * `shareIcs` returns false without building anything, because a real download is blocked
   * in the harness sandbox. So no lane here has ever seen the BYTES this control hands over.
   * What covers those is `invite.test.ts`, which has eleven assertions on `icsFor` itself:
   * the envelope, CRLF, UTC stamps, the stable UID, escaping, octet folding and an omitted
   * LOCATION. The seam between them -- that this button passes THIS event to THAT function
   * -- is proven by the toast and by nothing else, and only a phone closes it.
   */

  test('the composer addresses all 180 invited, not the 173 standing in the room', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    // Both numbers exist in this one session, which is the whole point: joining
    // pushed the room count to 173 while the invite list stayed at 180.
    // Collapsing the two was a real bug -- the host would have been told they
    // were announcing to however many phones happened to be awake.
    const here = WEDDING.present + 1;
    await expect(page.getByText(`${here} here`)).toBeVisible();

    await switchToHost(page);
    await expect(page.getByTestId('broadcast-draft')).toHaveAttribute(
      'placeholder',
      `Announce something to all ${WEDDING.invited} guests…`,
    );
    await expect(page.getByTestId('broadcast-send')).toHaveText(
      `Send to ${WEDDING.invited} guests`,
    );
    // Belt and braces: if the two counts are ever wired to the same field this
    // still fails, even should the copy above be reworded.
    await expect(page.getByTestId('broadcast-send')).not.toContainText(String(here));
  });

  test('a broadcast sent by the host lands in Sent and reaches the guest feed credited to its author', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    // Absent before, present after -- otherwise "it is in the feed" proves only
    // that the feed renders text. Three seeded broadcasts, three bylines.
    const before = await lines(page, 'chat-feed');
    expect(before.filter((l) => BYLINE.test(l))).toHaveLength(3);
    expect(before).not.toContain(ANNOUNCEMENT);

    await switchToHost(page);
    // Every seeded broadcast has a non-zero seen count (162/171/158), so
    // "seen by 0" in the Sent list can only be a message sent in this session.
    await expect(page.getByTestId('host-broadcast')).not.toContainText('seen by 0');

    await page.getByTestId('broadcast-draft').fill(ANNOUNCEMENT);
    await page.getByTestId('broadcast-send').click();

    // The composer empties on send, so a second tap cannot repost the same body.
    await expect(page.getByTestId('broadcast-draft')).toHaveValue('');
    await expect(page.getByTestId('host-broadcast').getByText(ANNOUNCEMENT)).toHaveCount(1);
    await expect(page.getByTestId('host-broadcast')).toContainText('seen by 0');

    // Back across the role boundary. This is the claim worth making: guest and
    // host are two views onto one store, not two screens with their own copies.
    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed').getByText(ANNOUNCEMENT)).toHaveCount(1);

    const after = await lines(page, 'chat-feed');
    expect(after.filter((l) => BYLINE.test(l))).toHaveLength(4);

    // Authorship has to be pinned to THIS body, not merely present somewhere in
    // the feed: the seed already contains a "Riley · Bride · 5:45 PM" bubble, so
    // a feed-wide search for that byline passes without anything being sent.
    // The bubble renders initials, byline, body -- so the line above the body is
    // its own byline and nobody else's.
    const at = after.indexOf(ANNOUNCEMENT);
    expect(at, 'the announcement is not a line of its own in the feed').toBeGreaterThan(0);
    expect(after[at - 1]).toMatch(/^Riley · Bride · \d{1,2}:\d{2} [AP]M$/);
  });

  test('a pinned broadcast outranks one sent after it in the guest feed', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // Send the unpinned one FIRST, so chronology and pinning disagree. If the
    // pin flag were dropped -- the canvas set pin:false in the same setState
    // that read it, so pinning did nothing there -- these two would come back
    // in send order and the last assertion fails.
    await page.getByTestId('broadcast-draft').fill(PLAIN);
    await page.getByTestId('broadcast-send').click();
    await expect(page.getByTestId('broadcast-draft')).toHaveValue('');

    await page.getByTestId('broadcast-draft').fill(PINNED);
    await page.getByTestId('pin-toggle').click();
    await expect(page.getByTestId('pin-toggle')).toHaveText('Pinned ✓');
    await page.getByTestId('broadcast-send').click();
    // The toggle is per-message, so it resets rather than pinning everything after.
    await expect(page.getByTestId('pin-toggle')).toHaveText('Pin to top');

    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed').getByText(PINNED)).toHaveCount(1);
    await expect(page.getByTestId('chat-feed').getByText(PLAIN)).toHaveCount(1);

    // Read once both are settled. Comparing positions in the rendered copy is
    // an order claim, not a geometry one.
    const feed = await lines(page, 'chat-feed');
    expect(feed.indexOf(PINNED)).toBeLessThan(feed.indexOf(PLAIN));
    // And it outranks the whole seeded backlog, not just its own sibling.
    expect(feed.filter((l) => BYLINE.test(l))).toHaveLength(5);
    expect(feed.indexOf(PINNED)).toBeLessThan(
      feed.indexOf('We did it!! Cocktails are on the terrace. Photos tab is open, please flood it.'),
    );
  });

  /**
   * #26. A pin used to be permanent: `broadcasts` carried a SELECT policy and an INSERT
   * policy and nothing else, so a notice that stopped being true two hours in sat above
   * every guest's feed for the rest of the night.
   *
   * The claim here is an ORDER claim measured twice -- pinned above PLAIN, then below it
   * again -- because "the un-pin control is on screen" and "the row says Pin to top"
   * would both pass against a button that does nothing to the feed. The feed order is
   * the only thing a guest actually experiences.
   */
  test('a host can take a pin back down, and the guest feed reorders', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    await page.getByTestId('broadcast-draft').fill(PLAIN);
    await page.getByTestId('broadcast-send').click();
    await expect(page.getByTestId('broadcast-draft')).toHaveValue('');

    await page.getByTestId('broadcast-draft').fill(PINNED);
    await page.getByTestId('pin-toggle').click();
    await page.getByTestId('broadcast-send').click();
    await expect(page.getByTestId('broadcast-draft')).toHaveValue('');

    // FIRST measurement: the pin is doing something.
    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed').getByText(PINNED)).toHaveCount(1);
    const pinnedFeed = await lines(page, 'chat-feed');
    expect(pinnedFeed.indexOf(PINNED)).toBeLessThan(pinnedFeed.indexOf(PLAIN));

    // Take it down from the Sent list. The row is located by its BODY rather than by an
    // index, so a change in send order cannot silently make this un-pin the wrong one.
    await switchToHost(page);
    const row = page
      .getByTestId('host-broadcast')
      .locator('[data-testid^="sent-"]')
      .filter({ hasText: PINNED });
    await expect(row.getByText('Pinned · tap to un-pin')).toHaveCount(1);
    await row.getByText('Pinned · tap to un-pin').click();
    // The same control, now offering the opposite -- which is what says the write landed
    // rather than the tap being swallowed.
    await expect(row.getByText('Pin to top')).toHaveCount(1);

    // SECOND measurement, and the one that matters: chronology is back in charge, so
    // PLAIN -- sent first, never pinned -- now sits above the message that outranked it
    // a moment ago.
    await page.getByTestId('role-switch').click();
    const unpinnedFeed = await lines(page, 'chat-feed');
    expect(unpinnedFeed.indexOf(PLAIN)).toBeLessThan(unpinnedFeed.indexOf(PINNED));
    // Nothing was lost in the process: both are still in the room.
    expect(unpinnedFeed.filter((l) => BYLINE.test(l))).toHaveLength(5);
  });

  test('accepting a request drops the DJ queue badge and moves the row into Up next, ranked by votes not by when it was accepted', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-dj').click();

    // "Incoming · n" only exists on the DJ panel, so waiting on it is also what
    // proves the segment navigated.
    await expect(page.getByText('Incoming · 5')).toBeVisible();
    await expect(page.getByTestId('host-segment-dj')).toHaveText('DJ queue · 5');
    // "Mark played" only exists on accepted rows, so its absence is proof
    // req_2 is still incoming -- no need to assert on section structure.
    await expect(page.getByTestId('played-req_2')).toHaveCount(0);
    expect(await upNextSubtitles(page)).toEqual(['ABBA · ▲41 · Priya']);

    await page.getByTestId('accept-req_2').click();

    // The header badge is derived from the same list the section counts, so
    // both have to move together or one of them is stale.
    await expect(page.getByTestId('host-segment-dj')).toHaveText('DJ queue · 4');
    await expect(page.getByText('Incoming · 4')).toBeVisible();
    await expect(page.getByTestId('accept-req_2')).toHaveCount(0);
    await expect(page.getByTestId('played-req_2')).toHaveCount(1);

    // Two more, accepted LOWEST votes first, so acceptance order and vote order
    // disagree. Without this the ordering claim is untestable: req_1 (41) and
    // req_2 (37) come out in the same sequence whether the list is ranked by
    // votes or simply left in the order the host worked through it.
    await page.getByTestId('accept-req_5').click(); // Sweet Caroline, 12
    await expect(page.getByTestId('host-segment-dj')).toHaveText('DJ queue · 3');
    await page.getByTestId('accept-req_3').click(); // Levitating, 29
    await expect(page.getByTestId('host-segment-dj')).toHaveText('DJ queue · 2');

    // Accepted in the order 41, 37, 12, 29. Rendered strictly by votes desc.
    expect(await upNextSubtitles(page)).toEqual([
      'ABBA · ▲41 · Priya',
      'The Killers · ▲37 · Tom',
      'Dua Lipa · ▲29 · Aunt Jo',
      'Neil Diamond · ▲12 · Grandpa Lou',
    ]);
  });

  test('approving a photo drops the Photos badge and credits Reception 97 to 98', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-photos').click();

    await expect(page.getByText('Awaiting approval · 3')).toBeVisible();
    await expect(page.getByTestId('host-segment-photos')).toHaveText('Photos · 3');
    await expect(page.getByTestId('host-folder-fld_reception')).toContainText(
      '97 photos · active',
    );

    await page.getByTestId('approve-pho_1').click();

    await expect(page.getByTestId('host-segment-photos')).toHaveText('Photos · 2');
    await expect(page.getByText('Awaiting approval · 2')).toBeVisible();
    await expect(page.getByTestId('approve-pho_1')).toHaveCount(0);
    // The other two are untouched: approving one row must not drain the queue.
    await expect(page.getByTestId('approve-pho_2')).toHaveCount(1);
    await expect(page.getByTestId('approve-pho_3')).toHaveCount(1);
    await expect(page.getByTestId('host-folder-fld_reception')).toContainText(
      '98 photos · active',
    );

    // The credit lands on the photo's own folder and nowhere else. The canvas
    // matched folders by NAME, so an approval could increment more than one.
    await expect(page.getByTestId('host-folder-fld_ceremony')).toContainText('112 photos');
    await expect(page.getByTestId('host-folder-fld_getting_ready')).toContainText('38 photos');
  });

  test('hiding a photo clears the queue without crediting the folder', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-photos').click();

    await expect(page.getByText('Awaiting approval · 3')).toBeVisible();
    await expect(page.getByTestId('host-folder-fld_reception')).toContainText(
      '97 photos · active',
    );

    await page.getByTestId('hide-pho_2').click();

    // Hide and approve both empty a slot in the queue; only approve adds to the
    // album. A hidden photo that still bumped the count would inflate the
    // folder with pictures no guest can see.
    await expect(page.getByTestId('host-segment-photos')).toHaveText('Photos · 2');
    await expect(page.getByText('Awaiting approval · 2')).toBeVisible();
    await expect(page.getByTestId('hide-pho_2')).toHaveCount(0);
    await expect(page.getByTestId('hide-pho_1')).toHaveCount(1);
    await expect(page.getByTestId('hide-pho_3')).toHaveCount(1);
    await expect(page.getByTestId('host-folder-fld_reception')).toContainText(
      '97 photos · active',
    );
  });
});

/**
 * The run of show, and the tap that used to rewind the evening.
 *
 * `schedule.start` moves `nowScheduleItemId`, which is NOT host-private state --
 * `useNowNext` derives every guest's Now/Next card from it. Until the guard landed,
 * `start()` set that cursor unconditionally, so a thumb on a PAST row rewound the
 * run of show for the whole room and posted a second "is starting" broadcast to
 * 180 people. The six rows sat flush inside a card with `overflow:'hidden'` and no
 * gap, which made the past rows the current row's nearest neighbours.
 *
 * This control had no e2e coverage at all before this block -- the most dangerous
 * action in the app was the only one nothing exercised.
 *
 * Note what is deliberately NOT asserted: the long-press restart path. Playwright
 * can dispatch a long press, but `onLongPress` is a React Native gesture that
 * react-native-web maps through its own responder system, and a test that drives
 * it here would be asserting RNW's behaviour rather than the app's. The forward
 * path and the refusal are both real DOM-observable outcomes; the deliberate
 * rewind is pinned at the unit layer instead (MemoryRepository.test.ts).
 */
test.describe('host console · run of show', () => {
  test('starting the next item moves the cursor forward and announces it to the feed', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // sch_5 is the first item after the seeded cursor (sch_4).
    await page.getByTestId('schedule-sch_5').click();

    // The guest feed is where the consequence lands, so that is where it is checked.
    // Navigate IN-APP: `page.goto` reloads the SPA, and the repository is built in
    // the root layout's useMemo, so a reload re-seeds and throws away the very
    // state under test. (Both of these tests failed that way when first written.)
    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await expect(
      page.getByText('First dance, then open floor is starting · Barn', { exact: true }),
    ).toHaveCount(1);
  });

  test('tapping an item that already ran is refused out loud, and rewinds nothing', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    // sch_2 (Ceremony) is behind the seeded cursor at sch_4.
    await page.getByTestId('schedule-sch_2').click();

    const toast = page.getByTestId('toast');
    await expect(toast).toContainText('already ran');
    await expect(toast).toContainText('Hold the row');

    // The consequence that matters is on the guest side: the cursor did not move,
    // so no second "Ceremony is starting" reached the room. In-app navigation for
    // the same reason as above.
    await page.getByTestId('role-switch').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await expect(page.getByText('Ceremony is starting · Lawn', { exact: true })).toHaveCount(0);
  });
});

test.describe('host console · entitlement denials', () => {
  /**
   * MOVED HERE when /pricing was cut from v1, and it is the reason this file
   * grew a third describe block rather than the test being dropped with the
   * screen.
   *
   * The original lived in pricing.spec.ts and proved the folder cap ROUTED to
   * the paywall. Deleting the paywall does not delete the thing that test was
   * really guarding, which is that a refused action is refused OUT LOUD. That
   * control shipped `disabled={atFolderCap}` once: it read "Upgrade", did
   * nothing at all when tapped, and made every denial in the app unreachable.
   * Every other pricing test navigated by URL, so not one of them could see it.
   *
   * The destination changed from a modal to a toast. The property did not.
   */
  test('filling the folder cap and tapping again names the limit out loud, and adds no folder', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-segment-photos').click();
    await expect(page.getByTestId('host-photos')).toBeVisible();

    // The seed sits on the Event tier: 10 folders allowed, 3 already there.
    for (let i = 0; i < 7; i++) await page.getByTestId('add-folder').click();
    await expect(page.getByTestId('add-folder')).toContainText('10 folders max');

    // Clear the toast raised by the 10th successful add, so what is asserted
    // below is the DENIAL and not the success that preceded it.
    await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 10_000 });

    const before = await page.getByTestId('add-folder').textContent();
    await page.getByTestId('add-folder').click();

    // Names the specific limit. A generic "something went wrong" would pass a
    // weaker assertion and would not be worth shipping.
    await expect(page.getByTestId('toast')).toHaveText(
      'You have used every folder this event allows.',
    );

    // And the refusal actually refused: the label still reads the cap, so no
    // eleventh folder was created behind the toast.
    await expect(page.getByTestId('add-folder')).toHaveText(before ?? '');
  });
});

test.describe('host console · handing out the code', () => {
  /**
   * Until this shipped there was no way for a guest to GET a code except being told it
   * out loud -- no share sheet, no clipboard, no QR anywhere -- while the canvas had said
   * "Scanned the QR? Your code is filled in" since the first artboard.
   *
   * These run on web, where there is no share sheet at all, so what they can prove is the
   * CALLER's behaviour: the controls exist, they are reachable, the QR encodes the right
   * thing, and a browser with no sheet is told the code rather than left with a button
   * that did nothing. Whether the OS sheet opens is a device question.
   */
  test('the QR is hidden until asked for, and shows the code beside it', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    await expect(page.getByTestId('event-qr')).toHaveCount(0);
    await page.getByTestId('host-qr-toggle').click();
    await expect(page.getByTestId('event-qr')).toBeVisible();

    // The human-readable fallback is not decoration: the custom scheme only resolves on a
    // phone that already has Runit, so everyone else needs something to read.
    await expect(page.getByTestId('event-qr-code')).toHaveText(WEDDING.code);
  });

  test('the toggle closes it again, and says which it will do', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    await expect(page.getByTestId('host-qr-toggle')).toHaveText('Show QR');
    await page.getByTestId('host-qr-toggle').click();
    await expect(page.getByTestId('host-qr-toggle')).toHaveText('Hide QR');
    await page.getByTestId('host-qr-toggle').click();
    await expect(page.getByTestId('event-qr')).toHaveCount(0);
  });

  test('sharing with no share sheet tells you the code instead of failing silently', async ({
    page,
  }, testInfo) => {
    // Headless Chromium has no navigator.share. A button that quietly does nothing is
    // exactly what the calendar pill was demoted to a View for months to avoid.
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);
    await switchToHost(page);
    await page.getByTestId('host-share').click();
    await expect(page.getByTestId('toast')).toContainText(WEDDING.code);
  });
});

/**
 * AUTHORING THE RUN OF SHOW -- #64, and written BEFORE the code.
 *
 * The app sells a run of show and had no way to write one. `+ Add` inserted a row whose
 * title was the literal string "New item", with no rename, no time, no place and no delete --
 * and the helper text under it says "Tap a row when it starts", which broadcasts
 * "New item is starting" to every guest, into a feed with no delete path.
 *
 * WHY 304 JOURNEYS WERE BLIND TO IT: `weddingSeed` seeds six fully-formed schedule rows, so
 * every screenshot renders a run of show no host could have produced. The authoring path was
 * exercised by nothing. Same shape as the now-playing loop in 6c7ef33 -- the fixture is
 * richer than anything the product can create, so the gap is invisible.
 *
 * So this runs against a FRESHLY CREATED event, where the schedule is empty, which is the
 * state every real host starts in.
 */
test.describe('writing the run of show (#64)', () => {
  const freshEvent = async (page: Page, scheme: 'dark' | 'light') => {
    await open(page, scheme, '/create', 'create-event');
    await page.getByTestId('create-host-name').fill('Ruth');
    await page.getByTestId('create-name').fill("Ruth's 40th");
    await page.getByTestId('create-date').fill('2027-01-09');
    await page.getByTestId('create-time').fill('19:00');
    await page.getByTestId('create-submit').click();
    await page.getByTestId('created-continue').click();
  };

  test('an item is given a real title, and a guest sees that title', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await freshEvent(page, scheme);

    // A new event has no run of show at all.
    await expect(page.getByTestId('schedule-row')).toHaveCount(0);

    await page.getByTestId('schedule-title').fill('Cake');
    await page.getByTestId('schedule-time').fill('8:30 PM');
    await page.getByTestId('schedule-add').click();

    // THE ASSERTION THAT MATTERS: what the host typed, not "New item".
    const row = page.getByTestId('schedule-row').first();
    await expect(row).toContainText('Cake');
    await expect(row).toContainText('8:30 PM');
    await expect(page.getByText('New item')).toHaveCount(0);

    // The composer clears, so the second item does not inherit the first.
    await expect(page.getByTestId('schedule-title')).toHaveValue('');

    // AND THE ROOM SEES IT. The run of show is a guest-facing feature; a title the host
    // can read and a guest cannot would be half a fix.
    //
    // Behind the fold, which is real behaviour rather than a bug: `NowNextCard` collapses
    // by default and the full list is one tap in. Worth pinning that the tap REACHES the
    // item -- an authored row that a guest cannot get to would be the same gap moved.
    await page.getByTestId('role-switch').click();
    await page.getByTestId('now-next-toggle').click();
    await expect(page.getByText('Cake')).toBeVisible();
  });

  test('an untitled item is refused rather than inserted as a placeholder', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await freshEvent(page, scheme);

    // The whole defect in one assertion: tapping Add with nothing typed used to insert
    // "New item", which the host could then neither rename nor delete.
    await page.getByTestId('schedule-add').click();
    await expect(page.getByTestId('schedule-row')).toHaveCount(0);
    await expect(page.getByTestId('toast')).toContainText(/name/i);
  });

  test('a row can be removed, because the wrong one is otherwise permanent', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await freshEvent(page, scheme);

    await page.getByTestId('schedule-title').fill('Speeches');
    await page.getByTestId('schedule-add').click();
    await expect(page.getByTestId('schedule-row')).toHaveCount(1);

    await page.getByTestId('schedule-row').first().getByTestId(/^schedule-remove-/).click();
    await expect(page.getByTestId('schedule-row')).toHaveCount(0);
  });

  test('the time is optional, because a host often does not know it yet', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await freshEvent(page, scheme);

    await page.getByTestId('schedule-title').fill('Dancing');
    await page.getByTestId('schedule-add').click();

    // TBD is the canvas's own word for an item with no time, and it is a real state --
    // not a reason to refuse the row.
    const row = page.getByTestId('schedule-row').first();
    await expect(row).toContainText('Dancing');
    await expect(row).toContainText('TBD');
  });
});

/**
 * THE COMPOSER NAMES SOMEBODY, ON THE EVENT A HOST ACTUALLY MADE -- #70.
 *
 * Every assertion above is made against `weddingSeed`, whose `invitedCount` is a
 * hardcoded 180. `housePartySeed` hardcodes 8. So the suite has only ever read the
 * composer in worlds where the number happens to be true, and "Send to 0 guests" -- on
 * every event this product can create -- survived 326 journeys underneath that.
 *
 * `?fresh=1` is the missing world: `invitedCount` 0, `guestCount` 4, which is what twenty
 * minutes into a first party looks like. `create_event` mints 0 and nothing raises it --
 * `fold_invited_count` fires on `invitees`, and `join_event` writes none.
 *
 * IT JOINS FIRST, so the number under test is LIVE rather than a seeded constant: the
 * room goes 4 -> 5 in the same session, and the composer has to move with it. A fallback
 * wired to a literal passes the seeded reading and fails this one.
 *
 * THE TEST ABOVE STILL STANDS AND MUST. This is a fallback, not a replacement: with a
 * real invitation list the composer still addresses the list, and 'the composer addresses
 * all 180 invited, not the 173 standing in the room' is what proves it. Both halves, or
 * the fix is a collapse of two numbers wearing a bug fix's clothes.
 */
test.describe('the composer on an event the host made herself', () => {
  /** Join the fresh world, then cross to the console the way a host does. */
  const asHost = async (page: import('@playwright/test').Page, scheme: 'dark' | 'light') => {
    await open(page, scheme, '/join?fresh=1');
    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();
    await switchToHost(page);
  };

  test('names the room rather than saying nobody is there', async ({ page }, testInfo) => {
    await asHost(page, testInfo.project.name as 'dark' | 'light');

    // Four were here, Ada makes five, and the invitation list is empty. Five, not zero.
    await expect(page.getByTestId('broadcast-send')).toHaveText('Send to 5 guests');
    await expect(page.getByTestId('broadcast-draft')).toHaveAttribute(
      'placeholder',
      'Announce something to all 5 guests…',
    );
  });

  test('and never says zero while there is somebody to announce to', async ({ page }, testInfo) => {
    await asHost(page, testInfo.project.name as 'dark' | 'light');
    // The class of bug rather than the instance: any future wiring that reaches 0 here
    // fails, whatever the copy around it is reworded to.
    await expect(page.getByTestId('broadcast-send')).not.toContainText('0 guests');
  });

  /**
   * THE THIRD SURFACE IS NOT ASSERTED HERE, AND THIS LANE CANNOT ASSERT IT.
   *
   * `BroadcastPanel.tsx:297-300` carries the same number in a run-of-show
   * `accessibilityHint` -- "Announces to all N guests. This cannot be undone." -- and
   * react-native-web DOES NOT FORWARD `accessibilityHint` at all. It is absent from the
   * forwarded-props table, so the rendered row has no `aria-describedby` and the string
   * never reaches the DOM. Measured: an assertion on it received `""`.
   *
   * Same class as `hitSlop` and `keyboardShouldPersistTaps` -- a check written here would
   * pass identically on a correct fix and on no fix at all, which is worse than the gap.
   * So it is stated rather than faked, in the shape `join.spec.ts` set.
   *
   * WHAT STILL COVERS IT: all three surfaces read one variable, `invited`, and the two
   * above pin that variable in this exact world. A regression in the fallback fails here.
   * What would escape is somebody rewriting the HINT's own interpolation specifically --
   * a narrow gap, and a real one.
   */
});
