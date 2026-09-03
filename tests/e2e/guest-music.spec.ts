import { expect, test, type Locator, type Page } from '@playwright/test';

import { joinAsGuest, TOKENS } from './helpers';

/**
 * The Music tab, from the guest side.
 *
 * State is in-memory and a page load reseeds it, so every test starts from the
 * fixture and none of them depend on each other. Within a test, actions
 * accumulate.
 */

/** The seeded queue, top to bottom, with the tallies the fixture ships. */
const SEEDED: readonly { title: string; votes: number; voted: boolean }[] = [
  { title: 'Dancing Queen', votes: 41, voted: false },
  { title: 'Mr. Brightside', votes: 37, voted: false },
  { title: 'Levitating', votes: 29, voted: false },
  // The demo guest owns this one AND is seeded as having voted for it.
  { title: 'Yeah!', votes: 18, voted: true },
  { title: 'Sweet Caroline', votes: 12, voted: false },
  { title: 'Espresso', votes: 9, voted: false },
];

const SEEDED_TITLES = SEEDED.map((r) => r.title);
const NICKNAME = 'Ada';

/** How long a toast stays up, from src/theme/layout.ts (`toast.durationMs`). */
const TOAST_MS = 2_200;

interface VoteState {
  votes: number;
  voted: boolean;
}

interface Row extends VoteState {
  title: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every queue row carries exactly one vote button whose accessible name states
 * both the song and the guest's own position on it, so the buttons ARE the
 * rows: reading them through the a11y layer gets the rendered running order
 * and the vote state from the same place a screen reader would, without
 * walking the DOM.
 *
 * It has to come from the label rather than from `aria-selected`, because
 * react-native-web does not surface `accessibilityState={{ selected }}` on a
 * Pressable -- the label and the painted fill are the only two places "I voted
 * for this" is observable.
 */
const ANY_VOTE_BUTTON = /^(?:Vote for|Remove vote from) .+$/;

const voteButton = (page: Page, title: string): Locator =>
  page.getByRole('button', {
    name: new RegExp(`^(?:Vote for|Remove vote from) ${escapeRe(title)}$`),
  });

/** "▲ 41" -> 41, and "Remove vote from X" -> voted. */
async function readButton(button: Locator): Promise<VoteState> {
  const label = (await button.getAttribute('aria-label')) ?? '';
  const text = await button.innerText();
  return { votes: Number(text.replace(/\D/g, '')), voted: label.startsWith('Remove vote from') };
}

async function voteState(page: Page, title: string): Promise<VoteState> {
  return readButton(voteButton(page, title));
}

/** The queue as rendered, top to bottom. */
async function queueRows(page: Page): Promise<Row[]> {
  const buttons = await page.getByRole('button', { name: ANY_VOTE_BUTTON }).all();
  return Promise.all(
    buttons.map(async (button) => {
      const label = (await button.getAttribute('aria-label')) ?? '';
      const { votes, voted } = await readButton(button);
      return { title: label.replace(/^(?:Vote for|Remove vote from) /, ''), votes, voted };
    }),
  );
}

/**
 * The banner reads "Your request is #4 in the queue" across nested <Text>, so
 * pull the number out of the queue's concatenated text rather than matching a
 * string the DOM splits across three nodes.
 */
async function myRequestRank(page: Page): Promise<number | null> {
  const text = (await page.getByTestId('music-queue').textContent()) ?? '';
  const match = /Your request is #(\d+) in the queue/.exec(text);
  return match ? Number(match[1]) : null;
}

async function openMusic(page: Page, scheme: 'dark' | 'light'): Promise<void> {
  await joinAsGuest(page, scheme, NICKNAME);
  await page.getByTestId('tab-music').click();
  await expect(page.getByTestId('music-queue')).toBeVisible();
}

async function submitRequest(page: Page, text: string): Promise<void> {
  await page.getByTestId('request-input').fill(text);
  await page.getByTestId('request-submit').click();
}

test.describe('Guest · Music', () => {
  test('the queue ranks by votes, not by arrival', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    // The whole rendered list, in order -- not a "contains" check, so an extra
    // row, a missing row, a swap or a wrong tally all fail.
    expect(await queueRows(page)).toEqual(SEEDED);

    // The rank numeral in the left gutter is a separate render path from the
    // sort, and must agree with the row's position.
    const queueText = (await page.getByTestId('music-queue').textContent()) ?? '';
    SEEDED_TITLES.forEach((title, index) => {
      expect(queueText).toContain(`${index + 1}${title}`);
    });

    // WHY THE ASSERTIONS ABOVE ARE NOT ENOUGH, AND THIS ONE IS.
    //
    // The fixture was authored in votes order, so votes-descending and arrival
    // order coincide across all six seeded rows: replacing the repository's
    // sort key with `createdAt` leaves that list byte-identical, and an
    // exact-order assertion over the seed alone cannot tell the two apart.
    //
    // One fresh request separates them. It carries a single vote -- lower than
    // every seeded row -- but its `createdAt` comes from the real clock, which
    // is EARLIER than the fixture's (the demo wedding is dated in the future).
    // So under votes-descending it belongs last, while a clock sort puts it
    // first (ascending) or leaves the six above it inverted (descending).
    await submitRequest(page, 'Sandstorm - Darude');
    await expect.poll(() => queueRows(page).then((r) => r.length)).toBe(SEEDED.length + 1);

    const after = await queueRows(page);
    expect(after.map((r) => r.title)).toEqual([...SEEDED_TITLES, 'Sandstorm']);

    // The same claim in fixture-independent form: with tallies and arrival now
    // disagreeing, sorting the rendered tallies must not move anything.
    const tallies = after.map((r) => r.votes);
    expect(tallies).toEqual([...tallies].sort((a, b) => b - a));
  });

  test('one press moves a tally by exactly one, and pressing back and forth never drifts', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    const BASE = 29; // Levitating, which the guest has not voted for.
    const button = voteButton(page, 'Levitating');
    expect(await readButton(button)).toEqual({ votes: BASE, voted: false });

    // NOT AN IDEMPOTENCE TEST, deliberately. The repository guards its setter
    // with `if (had === on) return;`, but that guard is unreachable from this
    // screen: the button always sends the opposite of the state the row it
    // re-rendered from is showing, so the setter is never asked to apply a
    // value it already holds. Deleting the guard outright leaves every test in
    // this file green, so nothing here may claim to prove it -- that claim is
    // already carried, honestly, by MemoryRepository.test.ts:51.
    //
    // What IS provable from the UI, and what the canvas got wrong, is drift:
    // repeated presses kept adding. Five presses must land on exactly two
    // values, alternating, and never a third.
    for (let press = 1; press <= 5; press += 1) {
      const voted = press % 2 === 1;
      await button.click();
      await expect
        .poll(() => readButton(button))
        .toEqual({ votes: BASE + (voted ? 1 : 0), voted });
    }

    // An odd number of presses leaves the vote on, so the neighbours it did
    // not pass must be untouched -- a vote is not a global increment.
    expect(await voteState(page, 'Mr. Brightside')).toEqual({ votes: 37, voted: false });
    expect(await voteState(page, 'Yeah!')).toEqual({ votes: 18, voted: true });
  });

  test('a fast double-press settles back where it started and moves no other row', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    const BASE = 9; // Espresso.
    const button = voteButton(page, 'Espresso');
    await button.dblclick();

    // A fixed settle beat and then ONE read. The repository is in-memory and
    // synchronous, so there is no request to wait on, only a React flush; and
    // polling would happily accept an intermediate state as the answer.
    await page.waitForTimeout(400);
    const after = await readButton(button);

    // Two presses can land either side of a re-render, so a settled state of
    // voted or not-voted is legitimate. What is never legitimate is a tally
    // that disagrees with the button's own state: strip the guest's own vote
    // and the seeded tally must come back. That is the invariant a bug that
    // counts the press rather than the vote breaks.
    expect(after.votes - (after.voted ? 1 : 0)).toBe(BASE);

    expect(await voteState(page, 'Sweet Caroline')).toEqual({ votes: 12, voted: false });
    expect(await voteState(page, 'Dancing Queen')).toEqual({ votes: 41, voted: false });
  });

  test('the row the guest already voted for starts filled, and un-voting gives the tally back', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    const button = voteButton(page, 'Yeah!');
    expect(await readButton(button)).toEqual({ votes: 18, voted: true });

    // The seeded vote must be visible, not merely announced: a voted button is
    // filled with the primary token, an unvoted one is not filled at all.
    // Asserting the painted colour keeps this out of class-name territory, and
    // is the one claim here that differs between the dark and light projects.
    await expect(button).toHaveCSS('background-color', TOKENS[scheme].primary);

    await button.click();
    await expect.poll(() => readButton(button)).toEqual({ votes: 17, voted: false });
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await button.click();
    await expect.poll(() => readButton(button)).toEqual({ votes: 18, voted: true });
    await expect(button).toHaveCSS('background-color', TOKENS[scheme].primary);
  });

  test("the banner names the rank of the guest's own request, and keeps naming the best-placed one", async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    const rows = await queueRows(page);
    // Not a hardcoded 4 alone: the banner's number has to agree with where the
    // guest's song actually sits, so a stale or off-by-one rank fails.
    expect(await myRequestRank(page)).toBe(4);
    expect(rows.findIndex((r) => r.title === 'Yeah!') + 1).toBe(4);
    // Yeah! is pending, so the DJ has not accepted it yet.
    await expect(page.getByText('Waiting for DJ', { exact: true })).toBeVisible();

    // A newer request from the same guest sits at the bottom on one vote. The
    // banner must keep pointing at the guest's best-placed request rather than
    // following the newest one down the list.
    await submitRequest(page, 'Dreams – Fleetwood Mac');
    await expect.poll(() => queueRows(page).then((r) => r.length)).toBe(SEEDED.length + 1);
    expect(await myRequestRank(page)).toBe(4);
  });

  test('submitting "Song – Artist" adds a row credited to the guest and clears the composer', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    await expect(page.getByText(`${SEEDED.length} requests`, { exact: true })).toBeVisible();

    await submitRequest(page, 'Dreams – Fleetwood Mac');

    // The count the screen advertises and the number of rows it actually draws
    // both have to move, and agree.
    await expect(page.getByText(`${SEEDED.length + 1} requests`, { exact: true })).toBeVisible();
    const rows = await queueRows(page);
    expect(rows).toHaveLength(SEEDED.length + 1);

    // The en dash splits title from artist, and a new request starts on the
    // requester's own single vote -- so it lands last, below Espresso's 9.
    expect(rows[rows.length - 1]).toEqual({ title: 'Dreams', votes: 1, voted: true });
    // Credited to this guest's nickname, not to the fixture's stand-in "you".
    await expect(page.getByText(`Fleetwood Mac · ${NICKNAME}`, { exact: true })).toBeVisible();

    await expect(page.getByTestId('toast')).toHaveText('Request sent to the DJ');
    await expect(page.getByTestId('request-input')).toHaveValue('');
  });

  test('the composer accepts a hyphen as well as an en dash, and files a bare title under Unknown artist', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    await submitRequest(page, 'Clocks - Coldplay');
    await expect(page.getByText(`Coldplay · ${NICKNAME}`, { exact: true })).toBeVisible();

    await submitRequest(page, 'Wonderwall');
    await expect(page.getByText(`Unknown artist · ${NICKNAME}`, { exact: true })).toBeVisible();

    // Both new rows hold one vote, so the tie falls to arrival order and the
    // pair must read in the order they were sent.
    const titles = (await queueRows(page)).map((r) => r.title);
    expect(titles).toEqual([...SEEDED_TITLES, 'Clocks', 'Wonderwall']);
  });

  test('an empty composer adds no row and raises no toast', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    // Clean slate: joining raises "Welcome, Ada. You're in.", and every toast
    // self-destructs. Waiting that one out here is setup, not the assertion.
    await expect(page.getByTestId('toast')).toHaveCount(0);

    await page.getByTestId('request-input').fill('   ');
    await page.getByTestId('request-submit').click();

    // The composer clears whether or not the request went anywhere, so an empty
    // field is proof the press was handled -- and therefore that a toast, had
    // there been one, has already rendered.
    await expect(page.getByTestId('request-input')).toHaveValue('');

    // A retrying `await expect(toast).toHaveCount(0)` would be no assertion at
    // all: it is satisfied by merely outliving the toast, so it passes even
    // when the empty press shouts "Request sent to the DJ". Read the count ONCE
    // instead, well inside a toast's lifetime, so a false reassurance is still
    // on screen when we look.
    await page.waitForTimeout(TOAST_MS / 4);
    expect(await page.getByTestId('toast').count()).toBe(0);

    // And no blank row was filed.
    await expect(page.getByText(`${SEEDED.length} requests`, { exact: true })).toBeVisible();
    expect(await queueRows(page)).toHaveLength(SEEDED.length);
  });

  test('now playing is the deck, not the top of the queue', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    await expect(page.getByText('September', { exact: true })).toBeVisible();
    await expect(page.getByText('Earth, Wind & Fire', { exact: true })).toBeVisible();

    // Asserting the card and the queue head together is what catches a card
    // wired to `queue[0]` instead of to the deck: the top of the queue is a
    // different song entirely.
    const rows = await queueRows(page);
    expect(rows[0]?.title).toBe('Dancing Queen');
    expect(rows).toHaveLength(SEEDED.length);
  });

  test("a new request does not borrow a seeded song's identity", async ({ page }, testInfo) => {
    // Regression test for a fixed bug, kept because the failure was silent.
    //
    // MemoryRepository.id() counted from zero, so the first request a guest
    // submitted was minted "req_1" -- already Dancing Queen in
    // fixtures/wedding.ts. Two `vote-req_1` testIDs rendered at once, request()
    // did votes.add(id) and lit Dancing Queen up as voted by a guest who never
    // touched it, and patchRequest() -- which matches by id -- patched BOTH
    // rows, so removing a vote from the new song dragged the seeded one down
    // with it (Dancing Queen 41 -> 40 while Dreams rose 1 -> 40).
    //
    // Fixed by seeding the counter past every number in the seed:
    // highestSeedSeq() in src/data/memory/MemoryRepository.ts. This test was
    // written as a test.fail() marker and went red the moment that landed,
    // which is how the fix was confirmed rather than assumed.

    const scheme = testInfo.project.name as 'dark' | 'light';
    await openMusic(page, scheme);

    const before = await voteState(page, 'Dancing Queen');
    await submitRequest(page, 'Dreams – Fleetwood Mac');
    await expect.poll(() => queueRows(page).then((r) => r.length)).toBe(SEEDED.length + 1);

    // Adding a song of my own must not change anyone else's row.
    expect(await voteState(page, 'Dancing Queen')).toEqual(before);
  });
});
