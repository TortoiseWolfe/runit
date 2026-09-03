import { expect, test, type Locator, type Page } from '@playwright/test';

import { joinAsGuest } from './helpers';

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
