import { expect, test, type Page } from '@playwright/test';

import { ready, TOKENS } from './helpers';

/**
 * Artboard 04 -- the pricing ladder.
 *
 * This screen is almost entirely copy, so copy drift is the failure worth
 * catching: a price that says $19 while the code charges $79, a feature line
 * quietly dropped from a card, a tier renamed on the canvas and not here.
 * src/domain/tiers.ts calls `featureLines` "transcribed VERBATIM from the
 * canvas"; these tests are what makes that claim checkable IN THE RENDER --
 * src/domain/entitlements.test.ts already checks the same table at the source.
 *
 * What this file does NOT check, and no browser test can: that the numbers the
 * cards advertise are the numbers `limits` enforces. "up to 3,000" is a string
 * here; `maxGuests: 3000` is behaviour, and it is covered by
 * src/domain/entitlements.test.ts ("the ladder is actually a ladder").
 */

type Scheme = 'dark' | 'light';
type TierId = 'house_party' | 'party' | 'event' | 'venue';

interface ExpectedTier {
  readonly id: TierId;
  readonly name: string;
  readonly scale: string;
  /** Price and period as one rendered line. No " / period" => not billed. */
  readonly priceLine: string;
  readonly audience: string;
  /** A 5-tuple, so "exactly five feature lines" is also a compile-time claim. */
  readonly features: readonly [string, string, string, string, string];
  readonly example: string;
}

/**
 * Cheapest to dearest, exactly as src/domain/tiers.ts TIER_ORDER lists them.
 *
 * Transcribed from the canvas by hand ON PURPOSE. Importing TIERS would make
 * every copy assertion below compare the app against itself and pass through
 * any rename.
 */
const LADDER: readonly ExpectedTier[] = [
  {
    id: 'house_party',
    name: 'House party',
    scale: 'up to 10',
    priceLine: 'Free',
    audience: 'Dinner parties, game night, a living-room DJ.',
    features: [
      '1 host',
      'Chat, Photos, Music',
      '100 photos · 1 folder',
      'Requests + upvotes',
      'Event expires after 48h',
    ],
    example: '3 guests · living room',
  },
  {
    id: 'party',
    name: 'Party',
    scale: 'up to 50',
    priceLine: '$19 / event',
    audience: 'Birthdays, reunions, backyard weddings.',
    features: [
      '2 hosts',
      '1,000 photos · 3 folders',
      'Approve-before-show moderation',
      'DJ queue: accept, decline, mark played',
      'Album kept 90 days',
    ],
    example: '30 guests · birthday, dinner',
  },
  {
    id: 'event',
    name: 'Event',
    scale: 'up to 300',
    priceLine: '$79 / event',
    audience: 'Weddings, corporate parties, one-off shows.',
    features: [
      '5 hosts with roles (host, DJ, planner)',
      'Unlimited photos · 10 folders',
      'Custom event name + cover',
      'Pinned announcements + push',
      'Album kept 1 year, ZIP export',
    ],
    example: '300 guests · wedding, corporate',
  },
  {
    id: 'venue',
    name: 'Venue',
    scale: 'up to 3,000',
    priceLine: '$599 / year',
    audience: 'Venues, planners, DJs, festivals that run events every week.',
    features: [
      'Unlimited hosts + staff seats',
      'Your logo and colors on every event',
      'Request caps + multi-DJ queues',
      'Reusable folder templates',
      'Priority support, bulk QR printing',
    ],
    example: '3,000 guests · festival, venue season',
  },
];

const GENERIC_BLURB =
  'Free covers a house party. Per-event pricing covers weddings and parties. ' +
  'Venues, planners and DJs who run events every week move to an annual plan.';

/**
 * Every denial useGuardedAction can route here, and the headline it must show.
 *
 * `src/state/actions.ts` pushes `/pricing?reason=…&detail=<limit|feature key>`,
 * so these keys are the real ones a blocked guest or host can arrive with. The
 * headline IS the paywall's whole explanation -- if a key falls out of the
 * lookup the screen silently reverts to the generic blurb and the guest never
 * learns what stopped them.
 */
const DENIALS: readonly (readonly [string, string])[] = [
  ['folders', 'You have used every folder your plan allows.'],
  ['photos', 'Your album is full.'],
  ['hosts', 'Every host seat on your plan is taken.'],
  ['guests', 'This event has reached its guest limit.'],
  ['photoModeration', 'Approving photos before they appear needs a paid plan.'],
  ['djQueue', 'Accepting and declining requests needs a paid plan.'],
  ['hostRoles', 'Host roles need the Event plan.'],
  ['pinnedAnnouncements', 'Pinned announcements need the Event plan.'],
  ['pushNotifications', 'Push notifications need the Event plan.'],
  ['zipExport', 'ZIP export needs the Event plan.'],
];

/** The bullet the card puts in front of every feature line. */
const DASH = '—';

interface RenderedTier {
  name: string;
  scale: string;
  priceLine: string;
  audience: string;
  features: string[];
  /** Anything after the feature rows. Expected to be the example footnote alone. */
  trailing: string[];
}

/**
 * Split one card's rendered text into its fields.
 *
 * innerText, not textContent, for two reasons: it keeps the line breaks between
 * the card's Text elements (textContent runs them together into one string, so
 * a missing feature line would be invisible), and it reflects the
 * `text-transform: uppercase` the reader actually sees on the tier name -- which
 * is why `name` comes back shouting. Soft wrapping does NOT add newlines, so a
 * feature line that wraps on a 402pt screen still parses as one line.
 */
function parseCard(text: string): RenderedTier {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const features: string[] = [];
  const trailing: string[] = [];
  // The head is name / scale / price / audience; everything after it is a dash
  // line followed by its feature line.
  for (let i = 4; i < lines.length; i += 1) {
    if (lines[i] === DASH) {
      features.push(lines[i + 1] ?? '');
      i += 1;
    } else {
      trailing.push(lines[i] ?? '');
    }
  }

  return {
    name: lines[0] ?? '',
    scale: lines[1] ?? '',
    priceLine: lines[2] ?? '',
    audience: lines[3] ?? '',
    features,
    trailing,
  };
}

/**
 * Land on /pricing, hydrated. `query` carries the paywall's deep-link params.
 *
 * The wait on the last card is a readiness gate, not a claim: the scheme probe
 * only proves the root layout mounted, and reading innerText off a route that
 * has not painted yet returns an empty string rather than failing usefully.
 */
async function openPricing(page: Page, scheme: Scheme, query = ''): Promise<void> {
  await page.goto(`/pricing${query}`);
  await ready(page, scheme);
  await expect(page.getByTestId('tier-venue')).toBeVisible();
}

/** Read every card, keyed by the tier it is supposed to be. */
async function readLadder(page: Page): Promise<RenderedTier[]> {
  const cards: RenderedTier[] = [];
  for (const tier of LADDER) {
    cards.push(parseCard(await page.getByTestId(`tier-${tier.id}`).innerText()));
  }
  return cards;
}

/** One computed colour off a card. Painted value, not a class name. */
function cardStyle(
  page: Page,
  id: TierId,
  prop: 'backgroundColor' | 'borderTopColor',
): Promise<string> {
  return page.getByTestId(`tier-${id}`).evaluate((el, name) => getComputedStyle(el)[name], prop);
}

test.describe('Pricing — the four-tier ladder', () => {
  test('lists exactly four tiers, cheapest to dearest, once each', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    await openPricing(page, scheme);

    // Read the ORDER off the page rather than by tier id. Every other test in
    // this file looks each card up by `tier-${id}`, so a reordered or
    // duplicated ladder would sail past them; this is the only assertion that
    // catches it. The cards are a single vertical column, so document order is
    // reading order.
    const ids = await page
      .getByTestId('pricing')
      .locator('[data-testid^="tier-"]')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-testid')));

    expect(ids).toEqual(['tier-house_party', 'tier-party', 'tier-event', 'tier-venue']);
  });

  test('prices read Free / $19 per event / $79 per event / $599 per year, and only the free tier carries no period', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    await openPricing(page, scheme);

    // Whole rendered line per card, so this covers the amount, the period, the
    // space between them, and the free card having no period at all. Deriving
    // numbers back out of these strings and re-asserting them would only be
    // re-checking the regex: whatever it computed came from this same line.
    expect((await readLadder(page)).map((card) => card.priceLine)).toEqual([
      'Free',
      '$19 / event',
      '$79 / event',
      '$599 / year',
    ]);
  });

  test('the scale labels climb up to 10 / 50 / 300 / 3,000', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    await openPricing(page, scheme);

    // The comma in "3,000" is the point of asserting the whole string: it is
    // the one number on this screen a careless edit reformats. That these
    // ceilings ascend, and that the code enforces them, are claims about
    // tiers.ts, not about the render -- entitlements.test.ts owns both.
    expect((await readLadder(page)).map((card) => card.scale)).toEqual([
      'up to 10',
      'up to 50',
      'up to 300',
      'up to 3,000',
    ]);
  });

  test('every tier lists exactly five feature lines, none of them blank', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    await openPricing(page, scheme);
    const cards = await readLadder(page);

    expect(cards.map((card) => card.features.length)).toEqual([5, 5, 5, 5]);

    // A dash rendered with nothing after it parses as a feature line of '', so
    // count alone is not enough.
    expect(cards.flatMap((card) => card.features).filter((line) => line.length === 0)).toEqual([]);

    // Each card ends with its example footnote and nothing else -- a sixth
    // feature added without a dash would land here instead of in `features`.
    expect(cards.map((card) => card.trailing)).toEqual(LADDER.map((tier) => [tier.example]));
  });

  test('the whole ladder reads verbatim from the canvas', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    await openPricing(page, scheme);
    const cards = await readLadder(page);

    // One assertion over the entire table, so any copy drift -- a reworded
    // feature, a renamed tier, an audience line edited on the canvas and not
    // here -- prints as a single readable diff instead of failing on whichever
    // field happened to be checked first.
    const rendered = cards.map((card) => ({
      name: card.name,
      scale: card.scale,
      priceLine: card.priceLine,
      audience: card.audience,
      features: card.features,
      example: card.trailing.join(' '),
    }));

    expect(rendered).toEqual(
      LADDER.map((tier) => ({
        // The eyebrow style uppercases the name, and innerText reports what is
        // painted, so compare against the shouted form. Drop the eyebrow and
        // this fails, which is correct: the canvas draws these shouting.
        name: tier.name.toUpperCase(),
        scale: tier.scale,
        priceLine: tier.priceLine,
        audience: tier.audience,
        features: [...tier.features],
        example: tier.example,
      })),
    );
  });

  test('distinctive feature copy appears once, on the tier that sells it', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    await openPricing(page, scheme);
    const pricing = page.getByTestId('pricing');

    // Moderation is what you buy by leaving Free; host roles are what you buy
    // by leaving Party. If either line gets copy-pasted onto a cheaper card the
    // screen is advertising a feature entitlements.ts will refuse.
    const claims: readonly (readonly [TierId, string])[] = [
      ['party', 'Approve-before-show moderation'],
      ['party', 'DJ queue: accept, decline, mark played'],
      ['event', '5 hosts with roles (host, DJ, planner)'],
      ['event', 'Album kept 1 year, ZIP export'],
      ['venue', 'Request caps + multi-DJ queues'],
      ['house_party', 'Event expires after 48h'],
    ];

    for (const [id, line] of claims) {
      // Once on the whole screen, and that once inside the card that sells it.
      await expect(pricing.getByText(line, { exact: true })).toHaveCount(1);
      await expect(page.getByTestId(`tier-${id}`).getByText(line, { exact: true })).toHaveCount(1);
    }

    // The page headline, which sets up the same ladder in prose. Matched
    // against the DOM text, which is why these are not shouted here even though
    // the kicker paints uppercase.
    await expect(pricing.getByText('Business model', { exact: true })).toHaveCount(1);
    await expect(pricing.getByText('Runit, from 3 guests to 3,000', { exact: true })).toHaveCount(1);
  });

  test('Event is the one tier the design fills', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    await openPricing(page, scheme);

    // FEATURED_TIER in tiers.ts paints the Event card with the neutral token
    // instead of base-100. Assert the painted colour rather than a class name,
    // and assert it relatively: the other three sit on the page background, and
    // Event does not. Works unchanged in both schemes.
    const page100 = TOKENS[scheme].base100;
    const backgrounds = await Promise.all(
      LADDER.map(async (tier) => ({
        id: tier.id,
        background: await cardStyle(page, tier.id, 'backgroundColor'),
      })),
    );

    const filled = backgrounds.filter((card) => card.background !== page100).map((card) => card.id);
    expect(filled).toEqual(['event']);
  });
});

test.describe('Pricing — arriving from a paywall', () => {
  test('a denial replaces the generic blurb, and an unrecognised one falls back to it', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;

    await openPricing(page, scheme);
    const pricing = page.getByTestId('pricing');
    await expect(pricing.getByText(GENERIC_BLURB, { exact: true })).toHaveCount(1);

    // Arriving blocked swaps the blurb out entirely -- both halves matter, so
    // assert the disappearance as well as the replacement.
    await openPricing(page, scheme, '?reason=feature&detail=hostRoles&highlight=event');
    await expect(pricing.getByText(GENERIC_BLURB, { exact: true })).toHaveCount(0);
    await expect(pricing.getByText('Host roles need the Event plan.', { exact: true })).toHaveCount(
      1,
    );

    // A detail the screen has no copy for must fall back to the generic blurb
    // rather than render an empty headline -- REASON_COPY is a lookup and a
    // future entitlement key will miss it.
    await openPricing(page, scheme, '?reason=feature&detail=notAReason');
    await expect(pricing.getByText(GENERIC_BLURB, { exact: true })).toHaveCount(1);

    // The ladder itself is unchanged by any of this.
    expect((await readLadder(page)).map((card) => card.priceLine)).toEqual([
      'Free',
      '$19 / event',
      '$79 / event',
      '$599 / year',
    ]);
  });

  test('every denial the app can raise names its own limit or feature', async ({
    page,
  }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;
    const pricing = page.getByTestId('pricing');

    // The whole REASON_COPY table, because a paywall that cannot say what it is
    // refusing is the failure mode this screen exists to prevent -- and a
    // missing key does not throw, it quietly shows the marketing blurb.
    for (const [detail, headline] of DENIALS) {
      await openPricing(page, scheme, `?detail=${detail}`);
      await expect(pricing.getByText(headline, { exact: true })).toHaveCount(1);
      await expect(pricing.getByText(GENERIC_BLURB, { exact: true })).toHaveCount(0);
    }
  });

  test('?highlight= rings the tier it names, and only that one', async ({ page }, testInfo) => {
    const scheme = testInfo.project.name as Scheme;

    const borders = async (): Promise<readonly { id: TierId; color: string }[]> =>
      Promise.all(
        LADDER.map(async (tier) => ({
          id: tier.id,
          color: await cardStyle(page, tier.id, 'borderTopColor'),
        })),
      );

    await openPricing(page, scheme);
    const atRest = await borders();
    const restingColors = new Set(atRest.map((card) => card.color));
    expect(restingColors.size).toBe(1); // nobody is singled out until asked
    const resting = atRest[0]?.color ?? '';

    await openPricing(page, scheme, '?highlight=venue&detail=guests');
    const ringed = (await borders()).filter((card) => card.color !== resting).map((card) => card.id);
    expect(ringed).toEqual(['venue']);

    // A different target moves the ring rather than adding a second one.
    await openPricing(page, scheme, '?highlight=party');
    const moved = (await borders()).filter((card) => card.color !== resting).map((card) => card.id);
    expect(moved).toEqual(['party']);

    // The top of the ladder has nowhere to upgrade to, so actions.ts sends
    // `highlight=` empty. That is the real no-target case, not a hypothetical.
    await openPricing(page, scheme, '?reason=limit&detail=guests&highlight=');
    const empty = (await borders()).filter((card) => card.color !== resting).map((card) => card.id);
    expect(empty).toEqual([]);

    // An unknown tier id rings nothing either.
    await openPricing(page, scheme, '?highlight=enterprise');
    const none = (await borders()).filter((card) => card.color !== resting).map((card) => card.id);
    expect(none).toEqual([]);
  });
});
