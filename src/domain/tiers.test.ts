import { readFileSync } from 'fs';
import { join } from 'path';

import { TIERS, TIER_ORDER } from './tiers';

/**
 * THE SECOND DESIGN-SOURCE GUARD.
 *
 * `tokens.test.ts` re-parses `design/theme.css` so a colour cannot drift from the design
 * it came from. This does the same job for the numbers a customer pays for: it re-parses
 * the `tier_limits` seed out of the migration and fails if Postgres and TypeScript
 * disagree about what a plan includes.
 *
 * WHY THE NUMBERS ARE IN TWO PLACES AT ALL. They have to be enforced server-side --
 * `src/data/supabase/README.md` says a client-side-only check is not enforcement, and
 * `invite_host` reads `tier_limits` rather than trusting the caller. They also have to be
 * rendered client-side, because the pricing copy is built from `TIERS`. Two consumers,
 * one truth, and no way to share a literal across the boundary. `docs/design-host-accounts.md`
 * predicted this exact drift and named this exact remedy.
 *
 * So the duplication is deliberate and this test is the thing that makes it safe. If it
 * fails, one of the two moved without the other and a host is being sold a number the
 * database will not honour.
 */

const SQL = readFileSync(
  join(__dirname, '../../supabase/migrations/00000000000000_schema.sql'),
  'utf8',
);

/** `Number.POSITIVE_INFINITY` has no integer to be, so the column is nullable. */
const INF = Number.POSITIVE_INFINITY;
const fromSql = (raw: string): number => (raw === 'null' ? INF : Number(raw));

/**
 * Pull the seeded rows out of the `insert into public.tier_limits ... values (...)` block.
 *
 * Deliberately parses the REAL statement rather than a copy: a test that reads a fixture
 * of the migration proves the fixture matches, which is not the claim being made.
 */
function seededLimits(): Record<string, Record<string, number | boolean | null>> {
  const at = SQL.indexOf('insert into public.tier_limits');
  if (at === -1) throw new Error('no tier_limits seed in the migration');
  const block = SQL.slice(at, SQL.indexOf('on conflict', at));

  const rows: Record<string, Record<string, number | boolean | null>> = {};
  const re =
    /\('(\w+)',\s*([\d]+|null),\s*([\d]+|null),\s*([\d]+|null),\s*([\d]+|null),\s*(true|false),\s*(true|false),\s*([\d]+|null),\s*([\d]+|null)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    rows[m[1]!] = {
      maxGuests: fromSql(m[2]!),
      maxHosts: fromSql(m[3]!),
      maxPhotos: fromSql(m[4]!),
      maxFolders: fromSql(m[5]!),
      hostRoles: m[6] === 'true',
      pushNotifications: m[7] === 'true',
      // NOT `fromSql`. That maps SQL null to Infinity, which is the convention the numeric
      // CAPS use (`maxGuests: INF`). `albumRetentionDays` is `number | null` in TypeScript
      // and uses null for unlimited, so the two would never compare equal on the venue
      // tier -- caught by this test on its first run.
      albumRetentionDays: m[8] === 'null' ? null : Number(m[8]),
      // Same rule as the line above and for the same reason: `eventTtlHours` is
      // `number | null` in TypeScript, where null means "never expires". Running it through
      // `fromSql` would turn SQL null into Infinity and the two would never compare equal on
      // any paid tier.
      eventTtlHours: m[9] === 'null' ? null : Number(m[9]),
    };
  }
  return rows;
}

const SEEDED = seededLimits();

describe('tier_limits in Postgres matches src/domain/tiers.ts', () => {
  // A coverage floor, same doctrine as the static audits: a regex that stops matching
  // passes having compared nothing at all.
  it('found every tier in the migration', () => {
    expect(Object.keys(SEEDED).sort()).toEqual([...TIER_ORDER].sort());
  });

  it.each(TIER_ORDER)('%s has the same caps on both sides', (tier) => {
    const sql = SEEDED[tier];
    expect(sql).toBeDefined();
    const ts = TIERS[tier].limits;
    expect({
      maxGuests: sql!.maxGuests,
      maxHosts: sql!.maxHosts,
      maxPhotos: sql!.maxPhotos,
      maxFolders: sql!.maxFolders,
    }).toEqual({
      maxGuests: ts.maxGuests,
      maxHosts: ts.maxHosts,
      maxPhotos: ts.maxPhotos,
      maxFolders: ts.maxFolders,
    });
  });

  /**
   * #23. These numbers were transcribed marketing copy with NO reader anywhere -- and
   * because they had no `tier_limits` counterpart, this drift guard structurally could not
   * cover them. They were the only `TierLimits` members outside it.
   */
  it.each(TIER_ORDER)('%s keeps the album for the same time on both sides', (tier) => {
    expect(SEEDED[tier]!.albumRetentionDays).toBe(TIERS[tier].limits.albumRetentionDays);
  });

  it('no longer keeps the free tier forever by omission', () => {
    // It was `null` -- unlimited -- which was never a decision. Nothing swept, so photos
    // stayed forever because nobody had written the code to remove them.
    expect(TIERS.house_party.limits.albumRetentionDays).toBe(30);
  });

  /**
   * #41. The last `TierLimits` member with no `tier_limits` counterpart, so it was outside
   * this guard exactly as `albumRetentionDays` was before #23 -- and it was worse off than
   * that one, because it had no reader ANYWHERE. `src/domain/tiers.ts` claimed free events
   * went read-only after 48 hours and a free event opened on Friday still took photos the
   * following Wednesday.
   */
  it.each(TIER_ORDER)('%s closes after the same window on both sides', (tier) => {
    expect(SEEDED[tier]!.eventTtlHours).toBe(TIERS[tier].limits.eventTtlHours);
  });

  it('gives the free tier a week, and every paid tier no expiry at all', () => {
    // The number moved from 48 when it stopped being decoration: two days cuts off the
    // guests who upload days later. Pinned on both sides, because the whole point of this
    // file is that a number a customer is sold has to be the number Postgres enforces.
    expect(TIERS.house_party.limits.eventTtlHours).toBe(168);
    expect(SEEDED.house_party!.eventTtlHours).toBe(168);
    for (const tier of TIER_ORDER.filter((t) => t !== 'house_party')) {
      expect(TIERS[tier].limits.eventTtlHours).toBeNull();
      expect(SEEDED[tier]!.eventTtlHours).toBeNull();
    }
  });

  it.each(TIER_ORDER)('%s grants push on both sides or neither', (tier) => {
    expect(SEEDED[tier]!.pushNotifications).toBe(TIERS[tier].features.pushNotifications);
  });

  it.each(TIER_ORDER)('%s grants host roles on both sides or neither', (tier) => {
    expect(SEEDED[tier]!.hostRoles).toBe(TIERS[tier].features.hostRoles);
  });

  /**
   * PHOTO MODERATION IS NOT ON EITHER SIDE ANY MORE, and this is where its absence is
   * asserted rather than merely true. #50 put a `photo_moderation` column on `tier_limits`
   * and this file mirrored it; it is a column on `events` now, because it is the host's
   * choice about one party rather than something she buys. If either side grows it back
   * they will be a feature nothing enforces -- the exact #21 shape -- so both are checked.
   *
   * THE ROW COUNT IS CHECKED FIRST, and that assertion is the load-bearing one. `SEEDED`
   * is parsed by a regex with ten capture groups against the real INSERT; an eleventh
   * seeded column stops it matching entirely, and every `it.each` above would then read
   * `SEEDED[tier]!.x` off `undefined`... which throws, so those are safe -- but this
   * absence test would pass having measured nothing at all. Same doctrine as the coverage
   * floors in lanes A and A2.
   */
  it('parsed every seeded tier, so the absence below measures something', () => {
    expect(Object.keys(SEEDED).sort()).toEqual([...TIER_ORDER].sort());
  });

  it('no longer carries photo moderation on either side', () => {
    for (const tier of TIER_ORDER) {
      expect(SEEDED[tier]).not.toHaveProperty('photoModeration');
      expect(TIERS[tier].features).not.toHaveProperty('photoModeration');
    }
    const table = SQL.slice(
      SQL.indexOf('create table public.tier_limits'),
      SQL.indexOf('insert into public.tier_limits'),
    );
    expect(table).not.toMatch(/photo_moderation\s+boolean/);
  });

  /**
   * PINNING IS NOT ON EITHER SIDE ANY MORE (#70), and its absence is asserted rather than
   * merely true. It was mirrored here because Postgres genuinely enforced it, by
   * `fold_pin_to_plan` folding a pin the tier could not carry (#21). It is free on every
   * tier now, so the column, the flag and the trigger are all gone -- a flag true on all
   * four tiers is not a tier feature, and a trigger that can never fire is the dead
   * enforcement #21 exists to prevent. Same surgery `photoModeration` had.
   *
   * If either side grows it back they will be a feature nothing enforces, so both are
   * checked, and the trigger is checked too -- the seed and the ladder could agree while
   * a live trigger still folded pins nobody asked it to.
   */
  it('no longer carries pinned announcements on either side', () => {
    for (const tier of TIER_ORDER) {
      expect(SEEDED[tier]).not.toHaveProperty('pinnedAnnouncements');
      expect(TIERS[tier].features).not.toHaveProperty('pinnedAnnouncements');
    }
    const table = SQL.slice(
      SQL.indexOf('create table public.tier_limits'),
      SQL.indexOf('insert into public.tier_limits'),
    );
    expect(table).not.toMatch(/pinned_announcements\s+boolean/);
    expect(SQL).not.toMatch(/create trigger broadcasts_pin_to_plan/);
  });


  /**
   * The one a reader is most likely to get wrong by hand.
   *
   * `null` in SQL and `Number.POSITIVE_INFINITY` in TypeScript both mean unlimited, and
   * they look nothing alike. A `0` on either side would mean the opposite of what was
   * intended and would read as a plausible number.
   */
  it('spells unlimited as null in SQL and Infinity in TypeScript, never zero', () => {
    expect(SEEDED.venue!.maxHosts).toBe(INF);
    expect(TIERS.venue.limits.maxHosts).toBe(INF);
    for (const tier of TIER_ORDER) {
      for (const key of ['maxGuests', 'maxHosts', 'maxPhotos', 'maxFolders'] as const) {
        expect(SEEDED[tier]![key]).not.toBe(0);
      }
    }
  });
});
