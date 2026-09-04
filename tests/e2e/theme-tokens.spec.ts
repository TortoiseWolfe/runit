import { expect, test, type Locator, type Page } from '@playwright/test';

import { joinAsGuest, open, switchToHost, voteCount, TOKENS } from './helpers';

/**
 * Does the app PAINT the theme it claims to be in?
 *
 * This exists because of a specific failure: the DOM reported dark while the
 * screen was light, and every state-shaped check agreed with the DOM. Only the
 * pixels caught it (CLAUDE.md, Lane B). So nothing here asserts a class name, a
 * style attribute or a React value -- every assertion goes through
 * getComputedStyle in the page and compares a RESOLVED colour against the
 * design's own token table.
 *
 * Two rules this file follows, both learned the hard way:
 *
 * 1. NEVER assert a colour by walking up to an ancestor when the colour you
 *    expect is base-100. base-100 is the page ground: ThemeProvider writes it
 *    onto document.body, the guest and host layouts each fill a full-bleed View
 *    with it, and the tab bar fills itself with it too. Measured on the built
 *    app, a tab button has FOUR independent base-100 paints above it, so
 *    "the nearest painted ancestor is base-100" stays true after you delete the
 *    tab bar's own fill. An earlier draft of this spec asserted exactly that and
 *    passed with the feature removed. base-100 is therefore only ever read
 *    DIRECTLY off the element that is supposed to paint it.
 *
 * 2. Never mirror a positive assertion with `not.toBe(theOtherScheme)`. Once
 *    `toBe(TOKENS[scheme].x)` has passed, `not.toBe(TOKENS[other].x)` can only
 *    fail if the two constants in helpers.ts are equal -- a property of the test
 *    fixture, never of the app. It reads like a safety net and catches nothing.
 *    The claim it was reaching for is real, though, and the flip test below is
 *    the honest form of it: change the OS preference and watch the paint move.
 */

type Scheme = 'dark' | 'light';

const OTHER: Record<Scheme, Scheme> = { dark: 'light', light: 'dark' };

/** What Chrome reports for `transparent`. An unpainted box looks exactly like this. */
const UNPAINTED = 'rgba(0, 0, 0, 0)';

const schemeOf = (testInfo: { project: { name: string } }): Scheme =>
  testInfo.project.name as Scheme;

/** The element's own resolved fill -- no ancestor walking, no inference. */
async function fillOf(target: Locator): Promise<string> {
  await expect(target).toBeVisible();
  return target.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** Resolved text colour -- the glyph, not the box. */
async function inkOf(target: Locator): Promise<string> {
  await expect(target).toBeVisible();
  return target.evaluate((el) => getComputedStyle(el).color);
}

/** The colour ThemeProvider pushes onto the window behind the whole app. */
const groundOf = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/**
 * The colour the APP paints behind `target`: its own fill if it has one, else
 * the nearest ancestor that paints something -- stopping BEFORE document.body,
 * so the window ground can never stand in for a missing fill.
 *
 * Used for exactly one thing in this file: the host role pill, whose fill lives
 * on a wrapper View while the only addressable node is the Text inside it.
 * Pinning down which of the two carries the colour would break on a
 * react-native-web upgrade while the screen still looked right; asking "what is
 * painted under this word" is the user-visible question. It is safe there only
 * because the expected colour is secondary, which nothing else on the screen
 * paints -- see rule 1 above for why the same trick is a lie about base-100.
 */
async function appBackdropOf(target: Locator): Promise<string> {
  await expect(target).toBeVisible();
  return target.evaluate((el) => {
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
      const colour = getComputedStyle(node).backgroundColor;
      const channels = /^rgba?\(([^)]+)\)$/.exec(colour);
      if (!channels) continue;
      const parts = channels[1]!.split(',').map((n) => Number(n.trim()));
      // parts[3] is alpha; absent means fully opaque.
      if ((parts[3] ?? 1) > 0) return colour;
    }
    return 'nothing inside the app paints behind this element';
  });
}

/** A tab bar label, addressed by the word a guest reads rather than by position. */
const tabInk = (page: Page, tab: 'chat' | 'photos' | 'music', label: string): Promise<string> =>
  inkOf(page.getByTestId(`tab-${tab}`).getByText(label));

/** The host role pill: "Riley · Bride", exact. */
const rolePill = (page: Page): Locator => page.getByText('Riley · Bride', { exact: true });

test.describe('painted theme tokens', () => {
  test('the join screen paints this scheme base-100, and the window ground agrees with it', async ({
    page,
  }, testInfo) => {
    const scheme = schemeOf(testInfo);
    await open(page, scheme);

    // Read straight off the code field, which the design fills base-100 inside a
    // base-200 card -- so this is a real token lookup, not the page showing
    // through an unstyled box.
    const field = await fillOf(page.getByTestId('join-code'));
    expect(field).toBe(TOKENS[scheme].base100);

    // The ground is a SECOND, independent resolution of the same token: the
    // component reads tokens.base100 through useTheme, while ThemeProvider
    // pushes it to the window through expo-system-ui's web shim. Comparing the
    // two page-read values (rather than each to the table) is what catches one
    // path going stale -- which on screen is a light halo around a dark app.
    expect(await groundOf(page)).toBe(field);
  });

  test('flipping the OS colour scheme repaints every token, and the scheme the app reports moves with them', async ({
    page,
  }, testInfo) => {
    const scheme = schemeOf(testInfo);
    const other = OTHER[scheme];

    // The host console is the one screen carrying all three tokens the design
    // names: base-100 on the selected segment, primary on Send, secondary on the
    // role pill.
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    const readPaint = async () => ({
      reported: (await page.getByTestId('scheme-probe').innerText()).trim(),
      base100: await fillOf(page.getByTestId('host-segment-broadcast')),
      primary: await fillOf(page.getByTestId('broadcast-send')),
      secondary: await appBackdropOf(rolePill(page)),
      ground: await groundOf(page),
    });

    const before = await readPaint();
    expect(before).toEqual({
      reported: scheme,
      base100: TOKENS[scheme].base100,
      primary: TOKENS[scheme].primary,
      secondary: TOKENS[scheme].secondary,
      ground: TOKENS[scheme].base100,
    });

    // THIS is the automated form of the original bug. A spec that only reads one
    // scheme per run cannot tell a working theme from a hardcoded one -- both
    // look right in the project whose palette they were hardcoded to. Changing
    // the OS preference mid-session and watching all four colours AND the app's
    // own report cross to the other palette together is the check that has to
    // fail if the two ever come apart. No page reload, so this is the live
    // re-resolve, not a fresh boot.
    await page.emulateMedia({ colorScheme: other });
    await expect(page.getByTestId('scheme-probe')).toHaveText(other);

    expect(await readPaint()).toEqual({
      reported: other,
      base100: TOKENS[other].base100,
      primary: TOKENS[other].primary,
      secondary: TOKENS[other].secondary,
      ground: TOKENS[other].base100,
    });
  });

  test('the join CTA is filled with primary, a different token from the field above it', async ({
    page,
  }, testInfo) => {
    const scheme = schemeOf(testInfo);
    await open(page, scheme);

    const cta = await fillOf(page.getByTestId('join-submit'));
    expect(cta).toBe(TOKENS[scheme].primary);

    // The CTA and the code field are the two filled boxes on this screen, and
    // both values here are read from the page. If the token lookup ever
    // degraded to one colour for everything, both would still be "painted" and
    // both would still resolve; only the fact that they must DIFFER catches it.
    expect(cta).not.toBe(await fillOf(page.getByTestId('join-code')));
  });

  test('primary moves to whichever tab you open', async ({ page }, testInfo) => {
    const scheme = schemeOf(testInfo);
    await joinAsGuest(page, scheme);

    // Joining lands on Chat, so Chat holds primary and Music must not.
    expect(await tabInk(page, 'chat', 'Chat')).toBe(TOKENS[scheme].primary);
    const dimmed = await tabInk(page, 'music', 'Music');
    expect(dimmed).not.toBe(TOKENS[scheme].primary);

    await page.getByTestId('tab-music').click();
    await expect(page.getByTestId('music-queue')).toBeVisible();

    // The pair swaps. The claim is that primary FOLLOWS selection, which a
    // single-tab reading could not distinguish from primary being hardcoded on
    // the Chat tab.
    expect(await tabInk(page, 'music', 'Music')).toBe(TOKENS[scheme].primary);
    expect(await tabInk(page, 'chat', 'Chat')).toBe(dimmed);
  });

  test('a vote button wears primary only while your vote is on that song', async ({
    page,
  }, testInfo) => {
    const scheme = schemeOf(testInfo);
    await joinAsGuest(page, scheme);
    await page.getByTestId('tab-music').click();
    await expect(page.getByTestId('music-queue')).toBeVisible();

    // Nothing is seeded as the guest's, so the vote is CAST here rather than
    // assumed. That is a better test than the one it replaces: it walks the whole
    // transition unpainted -> painted -> unpainted instead of starting halfway
    // through it. Neither vote changes a row's rank, so the queue order holds
    // still and the testIDs keep pointing at the same songs.
    expect(await voteCount(page, 'req_4')).toBe(18);
    expect(await fillOf(page.getByTestId('vote-req_4'))).toBe(UNPAINTED);
    expect(await fillOf(page.getByTestId('vote-req_2'))).toBe(UNPAINTED);

    await page.getByTestId('vote-req_4').click();
    await expect.poll(() => voteCount(page, 'req_4')).toBe(19);
    expect(await fillOf(page.getByTestId('vote-req_4'))).toBe(TOKENS[scheme].primary);

    await page.getByTestId('vote-req_4').click();
    await expect.poll(() => voteCount(page, 'req_4')).toBe(18);
    // The count moving is what proves the fill dropped because the vote was
    // withdrawn, rather than because the button stopped painting anything at all.
    expect(await fillOf(page.getByTestId('vote-req_4'))).toBe(UNPAINTED);

    await page.getByTestId('vote-req_2').click();
    await expect.poll(() => voteCount(page, 'req_2')).toBe(38);
    expect(await fillOf(page.getByTestId('vote-req_2'))).toBe(TOKENS[scheme].primary);
  });

  test('the host role pill is filled with secondary and appears only in a host session', async ({
    page,
  }, testInfo) => {
    const scheme = schemeOf(testInfo);
    await joinAsGuest(page, scheme);

    // Exact, because the chat feed carries Riley's byline as
    // "Riley · Bride · 5:45 PM" in a single Text node -- a substring match finds
    // that instead and reports the bubble's surroundings as the pill's fill.
    await expect(rolePill(page)).toHaveCount(0);

    await switchToHost(page);
    await expect(rolePill(page)).toHaveCount(1);

    expect(await appBackdropOf(rolePill(page))).toBe(TOKENS[scheme].secondary);
  });

  test('the selected host segment is lifted onto base-100 and the lift follows navigation', async ({
    page,
  }, testInfo) => {
    const scheme = schemeOf(testInfo);
    await joinAsGuest(page, scheme);
    await switchToHost(page);

    const segment = (name: 'broadcast' | 'dj' | 'photos') =>
      page.getByTestId(`host-segment-${name}`);

    // switchToHost lands on Broadcast, so exactly one of the three is lifted off
    // the base-200 track; the other two paint nothing and let the track show.
    expect(await fillOf(segment('broadcast'))).toBe(TOKENS[scheme].base100);
    expect(await fillOf(segment('dj'))).toBe(UNPAINTED);
    expect(await fillOf(segment('photos'))).toBe(UNPAINTED);

    await segment('dj').click();
    await expect(page.getByTestId('host-dj')).toBeVisible();

    expect(await fillOf(segment('dj'))).toBe(TOKENS[scheme].base100);
    expect(await fillOf(segment('broadcast'))).toBe(UNPAINTED);
    expect(await fillOf(segment('photos'))).toBe(UNPAINTED);
  });
});
