import { expect, test, type Page } from '@playwright/test';

import { WEDDING, joinAsGuest, switchToHost } from './helpers';

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
