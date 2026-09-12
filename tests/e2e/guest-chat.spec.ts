import { expect, test, type Locator, type Page } from '@playwright/test';

import { joinAsGuest, open } from './helpers';

/**
 * Artboard 02 -- the guest Chat tab.
 *
 * Chat is a one-way channel: hosts broadcast, guests read. So the claims worth
 * testing are about what the feed SAYS and in what ORDER, plus the one piece of
 * state the tab actually owns -- whether the run-of-show card is expanded.
 */

/**
 * The seeded broadcasts, in the order MemoryRepository puts them in the feed:
 * pinned first, then oldest-to-newest (MemoryRepository.ts, sigFeed). None of
 * the three is pinned, so this is pure chronology -- 4:10, 5:45, 7:02.
 *
 * The stamps are UTC-formatted on purpose (src/lib/format.ts), so these strings
 * are the same on any machine and this suite needs no timezoneId.
 */
const BROADCASTS = [
  {
    initials: 'J',
    stamp: 'Jordan · Planner · 4:10 PM',
    body: 'Welcome! Ceremony starts at 4:30 on the lawn. Grab a seat on either side, there are no sides today.',
  },
  {
    initials: 'R',
    stamp: 'Riley · Bride · 5:45 PM',
    body: 'We did it!! Cocktails are on the terrace. Photos tab is open, please flood it.',
  },
  {
    // 'DJ Marco' -> 'DJ', not 'D': an all-caps first token is already an
    // initialism and is kept whole (initialsFor in src/lib/format.ts).
    initials: 'DJ',
    stamp: 'DJ Marco · DJ · 7:02 PM',
    body: 'Requests are open in the Music tab. Upvote what you want to hear; top of the queue plays next.',
  },
] as const;

/** The six run-of-show rows, in position order. The cursor sits on 6:45 PM. */
const RUN_OF_SHOW = [
  { time: '4:00 PM', title: 'Doors open', place: 'Barn' },
  { time: '4:30 PM', title: 'Ceremony', place: 'Lawn' },
  { time: '5:30 PM', title: 'Cocktails', place: 'Terrace' },
  { time: '6:45 PM', title: 'Dinner + toasts', place: 'Barn' },
  { time: '8:00 PM', title: 'First dance, then open floor', place: 'Barn' },
  { time: '11:30 PM', title: 'Shuttle to hotel', place: 'Barn doors' },
] as const;

/** The summary line, whichever way the card is folded. */
const SUMMARY = '● Now · Dinner + toasts · Next First dance, then open floor 8:00 PM';

const FOOTER = 'Announcements only · hosts post here';

/** A bare wall clock standing on its own -- only a schedule row's time cell. */
const CLOCK_CELL = /^\d{1,2}:\d{2} [AP]M$/;

/** A broadcast byline: exactly "Name · Role · H:MM AM/PM", nothing more. */
const STAMP = /^[^·\n]+ · [^·\n]+ · \d{1,2}:\d{2} [AP]M$/;

/**
 * Run-of-show rows, counted by their time cells.
 *
 * Nothing else in the feed renders a bare clock as its own label -- a broadcast
 * byline reads "Jordan · Planner · 4:10 PM" and the card summary ends
 * "...open floor 8:00 PM", neither of which the anchored pattern matches. So
 * this counts rows without asserting anything about the DOM shape of a row.
 * Scoped to the feed so a clock appearing in the header or tab bar later
 * cannot quietly inflate the count.
 */
function scheduleRows(page: Page): Locator {
  return page.getByTestId('chat-feed').getByText(CLOCK_CELL);
}

/**
 * How many lines each matched element actually renders its text on.
 *
 * A Range over an element's contents yields a client rect per rendered box;
 * counting DISTINCT top edges collapses those back to lines. This asks a
 * relative question -- "did this wrap?" -- and reads no pixel value, which
 * matters because it is the ONLY evidence a wrap leaves: innerText is
 * byte-identical either way (measured; see the regression guard below).
 *
 * Only meaningful on a leaf label. Run it on a Text with nested Texts inside
 * and the spans give you several rects on a single line.
 */
function renderedLines(locator: Locator): Promise<number[]> {
  return locator.evaluateAll((els) =>
    els.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(
        Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)),
      );
      return tops.size;
    }),
  );
}

/** The scrolling feed's visible copy, line by line, whitespace trimmed. */
async function feedLines(page: Page): Promise<string[]> {
  const text = await page.getByTestId('chat-feed').innerText();
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** The summary row: the "Now / Next" line, then "Full schedule" / "Hide". */
async function summaryLines(page: Page): Promise<string[]> {
  const text = await page.getByTestId('now-next-toggle').innerText();
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

test.describe('Guest chat tab', () => {
  test('carries all three seeded broadcasts oldest-first, each body under its own author, role and clock time', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    const lines = await feedLines(page);

    // Three bylines, in feed order. This fails if a broadcast is dropped, if a
    // fourth appears, if the sort flips to newest-first, or if a role label or
    // timestamp is wrong -- not just if "something is on screen".
    expect(lines.filter((line) => STAMP.test(line))).toEqual(
      BROADCASTS.map((b) => b.stamp),
    );

    // ...and each bubble is attached to the right byline. Order alone would
    // pass with the bodies shuffled between authors; this pins the pairing.
    for (const broadcast of BROADCASTS) {
      const at = lines.indexOf(broadcast.stamp);
      expect(at, `no byline "${broadcast.stamp}" in the feed`).toBeGreaterThan(0);
      expect(lines[at - 1]).toBe(broadcast.initials);
      expect(lines[at + 1]).toBe(broadcast.body);
    }
  });

  test('summarises the run of show as the current item plus the one after it, without crushing the affordance', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    const [headline, affordance] = await summaryLines(page);

    // The cursor is on sch_4, the fourth of six. Asserting the whole line at
    // once is what makes this falsifiable: it would fail if "Now" tracked the
    // first row instead of the seeded cursor, if "Next" skipped or repeated a
    // row, or if the next item lost its time label.
    expect(headline).toBe(SUMMARY);
    expect(affordance).toBe('Full schedule');

    // Collapsed by default: the summary is a summary, not the whole board.
    await expect(scheduleRows(page)).toHaveCount(0);

    // FIDELITY note B: in the canvas the summary text runs into the
    // "Full schedule" label at 402pt, and the fix is flex:1 on the text with
    // flex:0 on the label. Measured in this export at the artboard width: with
    // the label allowed to shrink it goes from 78x14 to 54x28 -- two lines --
    // while its innerText stays exactly "Full schedule". So the wrap is the
    // only thing that can carry the claim, and one line IS the claim.
    const label = page.getByTestId('now-next-toggle').getByText('Full schedule', {
      exact: true,
    });
    await expect(label).toHaveCount(1);
    expect(await renderedLines(label)).toEqual([1]);
  });

  test('expands the run of show from no rows to all six and collapses back to none', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    const toggle = page.getByTestId('now-next-toggle');

    await expect(scheduleRows(page)).toHaveCount(0);
    expect(await summaryLines(page)).toContain('Full schedule');

    await toggle.click();

    // 0 -> 6 is the claim. The Pressable sets accessibilityState.expanded, but
    // that does NOT survive the react-native-web export -- the button ships
    // with no aria-expanded attribute at all, in either state (verified
    // against dist/) -- so the rows themselves are the only honest evidence
    // that the card opened.
    await expect(scheduleRows(page)).toHaveCount(6);
    expect(await scheduleRows(page).allInnerTexts()).toEqual(
      RUN_OF_SHOW.map((item) => item.time),
    );
    expect(await summaryLines(page)).toContain('Hide');

    await toggle.click();

    // ...and back. A one-way expand would pass the half of this test above.
    await expect(scheduleRows(page)).toHaveCount(0);
    expect(await summaryLines(page)).toContain('Full schedule');

    // The summary line is unchanged by opening and closing the board.
    expect((await summaryLines(page))[0]).toBe(SUMMARY);
  });

  test('keeps every run-of-show time on a single line, "11:30 PM" included, beside its title and place', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    await page.getByTestId('now-next-toggle').click();
    await expect(scheduleRows(page)).toHaveCount(6);

    // REGRESSION GUARD. FIDELITY note A: "At width: 64 the run-of-show wraps
    // '11:30 PM' onto two lines... We widen the column so times stay on one
    // line" (visible in design/renders/03-host-broadcast.*.png). NowNextCard's
    // time column is 72 for exactly this reason.
    //
    // Copy assertions CANNOT see this regression. Measured in this export at
    // the artboard width: force the column back to 64 and the 11:30 PM cell
    // goes from 16pt tall to 32 while every other cell stays 16 -- and
    // innerText reads "11:30 PM" either way, byte for byte. So the line count
    // is the assertion, and a re-narrowed column fails it.
    //
    // Scope: this is a relative wrap check at the design's own 402x874
    // artboard, which is what playwright.config says this viewport is for. It
    // asserts no pixel value and it is not evidence about native layout --
    // the device wrap is still a `pnpm android` check.
    expect(await renderedLines(scheduleRows(page))).toEqual(RUN_OF_SHOW.map(() => 1));

    // ...and the widest label is still one whole cell with its row intact,
    // which catches the other way this could break: truncating or ellipsising
    // the time instead of wrapping it.
    const last = RUN_OF_SHOW[RUN_OF_SHOW.length - 1]!;
    const cell = page.getByTestId('chat-feed').getByText(last.time, { exact: true });
    await expect(cell).toHaveCount(1);
    await expect(cell).toBeVisible();

    const lines = await feedLines(page);
    const at = lines.indexOf(last.time);
    expect(at, `no "${last.time}" row on the schedule`).toBeGreaterThan(-1);
    expect(lines.slice(at, at + 3)).toEqual([last.time, last.title, last.place]);
  });

  test('marks the channel one-way: a footer under the feed and nowhere for a guest to type', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    await expect(page.getByText(FOOTER, { exact: true })).toHaveCount(1);

    // It is chrome, not a message. If it were rendered into the feed it would
    // scroll away with the broadcasts and stop being a standing rule.
    expect(await feedLines(page)).not.toContain(FOOTER);

    // And the rule holds: no composer reaches the guest. `broadcast-draft` is
    // the host console's, named here because wiring it onto this tab is the
    // specific mistake; the role query is the net that catches any other.
    await expect(page.getByTestId('broadcast-draft')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });
});

/**
 * THE DATE FOLLOWS THE GUEST IN -- #62.
 *
 * `+ Add to calendar` has existed since the invitation work and lives on `JoinScreen`,
 * which is the screen BEFORE the join. `src/app/index.tsx` sends a guest session straight
 * to `/chat`, so every guest after their first open never sees that screen again -- and the
 * three guest tabs carried the event's NAME and nothing else. No date, no venue, no way to
 * keep the evening. The host could send an `.ics` (#61); the guest in the room could not.
 *
 * WHAT THESE TESTS CANNOT PROVE, said plainly rather than implied. Against Supabase
 * `events_read` admits members only, so a guest who typed a code meets the join screen with
 * `event` null and no preview -- which is the second case this issue is about, and no
 * journey can build it, because `weddingSeed` hands `JoinScreen` a full event before anyone
 * has joined anything. `empty-world.spec.ts` holds the one half that IS reachable: with no
 * event, `join-add-calendar` is absent. These cover the other end -- that once a guest is
 * in, the route is on the screen they are standing on.
 */
test.describe('the event line on the chat tab', () => {
  /** date · doors · venue, in that order. The date is DERIVED, so it is matched by shape. */
  const WHEN_WHERE = /^\w{3}, \w{3} \d{1,2} · Doors 4:00 PM · Willow Barn$/;

  test('says which evening and where, on the tab a joined guest lands on', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    // THE WHOLE STRING, not "contains a date". The three parts come from three different
    // fields and the failure this replaces was a `doorsLabel` that carried all of them as
    // prose -- so it could not disagree with `starts_at` out loud, and disagreed silently
    // instead. Matching the composition is what makes that impossible here.
    await expect(page.getByTestId('chat-when-where')).toHaveText(WHEN_WHERE);
  });

  test('draws the day from starts_at, so it is not the doors label wearing a date', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    // `weddingSeed` anchors to YESTERDAY, so the correct day moves with the calendar and
    // no literal can be written here. What can be asserted is that the app agrees with the
    // clock: the rendered weekday/month/day is the one `starts_at` falls on in the VENUE's
    // zone. A line built from `doorsLabel` alone, or dated in the browser's zone, fails.
    const expected = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    }).format(new Date(Date.now() - 24 * 60 * 60_000));

    await expect(page.getByTestId('chat-when-where')).toHaveText(
      new RegExp(`^${expected} · `),
    );
  });

  test('offers the calendar, and says something either way when it is tapped', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    const pill = page.getByTestId('chat-add-calendar');
    await expect(pill).toBeVisible();
    await pill.click();
    // Headless Chromium has no share sheet, so `shareIcs` resolves false and the honest
    // outcome is a message naming why. Asserting the TOAST rather than the button's own
    // label is what proves the handler ran: a Pressable that is merely visible would pass
    // every assertion above this one.
    await expect(page.getByTestId('toast')).toContainText(/calendar/i);
  });

  test('sits above the run of show, because the two answer different questions', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await joinAsGuest(page, scheme);

    // Which evening and where is fixed for the whole party; Now/Next changes hourly. Order
    // is the claim, and a box comparison is the only thing that can carry it -- both
    // elements are visible either way round.
    const line = await page.getByTestId('chat-event-line').boundingBox();
    const card = await page.getByTestId('now-next-toggle').boundingBox();
    expect(line, 'no event line on the chat tab').not.toBeNull();
    expect(card, 'no run-of-show card on the chat tab').not.toBeNull();
    expect(line!.y + line!.height).toBeLessThanOrEqual(card!.y);
  });

  test('prints the whole line on a fixed-date event, separators and all', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    // `?fresh=1` is the only seeded world with a date that does not move, so it is the only
    // one where the exact string can be written down. It is also the world a real party is
    // in: made in the app twenty minutes ago, four people here, no invitation list.
    //
    // JOINED RATHER THAN NAVIGATED TO. `/chat?fresh=1` cold lands on the join screen: the
    // session is anonymous on the first render and `(guest)/_layout` redirects, which is
    // correct and is not this test's subject.
    await open(page, scheme, '/join?fresh=1');

    // DERIVED, NOT WRITTEN DOWN. `freshSeed` anchored to a fixed 2026-09-11 until #41 gave
    // `house_party` a 168-hour window -- a hardcoded past date is a fuse on a fixture whose
    // tier expires, so it anchors to today now. The claim this test carries was never the
    // literal day: it is that the join screen and the chat tab print the IDENTICAL composed
    // string, separators and all.
    const day = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York',
    }).format(new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`));
    const LINE = `${day} · Doors 7:00 PM · The garden`;

    // The invitation says it first. Asserting it HERE and then again after the join is what
    // the shared `whenAndWhere` buys: two surfaces, one composition, so a guest cannot read
    // two descriptions of one evening. These were two hand-built copies of the same
    // `.filter(Boolean).join(' · ')` until this change, each with a comment noting the
    // other existed.
    await expect(page.getByTestId('join-subtitle')).toHaveText(LINE);

    await page.getByTestId('join-nickname').fill('Ada');
    await page.getByTestId('join-submit').click();
    await expect(page.getByTestId('chat-feed')).toBeVisible();

    await expect(page.getByTestId('chat-when-where')).toHaveText(LINE);
  });
});
