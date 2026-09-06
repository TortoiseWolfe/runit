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
  join(__dirname, '../../supabase/migrations/00000000000000_init.sql'),
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
function seededLimits(): Record<string, Record<string, number | boolean>> {
  const at = SQL.indexOf('insert into public.tier_limits');
  if (at === -1) throw new Error('no tier_limits seed in the migration');
  const block = SQL.slice(at, SQL.indexOf('on conflict', at));

  const rows: Record<string, Record<string, number | boolean>> = {};
  const re =
    /\('(\w+)',\s*([\d]+|null),\s*([\d]+|null),\s*([\d]+|null),\s*([\d]+|null),\s*(true|false),\s*(true|false)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    rows[m[1]!] = {
      maxGuests: fromSql(m[2]!),
      maxHosts: fromSql(m[3]!),
      maxPhotos: fromSql(m[4]!),
      maxFolders: fromSql(m[5]!),
      hostRoles: m[6] === 'true',
      pinnedAnnouncements: m[7] === 'true',
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

  it.each(TIER_ORDER)('%s grants host roles on both sides or neither', (tier) => {
    expect(SEEDED[tier]!.hostRoles).toBe(TIERS[tier].features.hostRoles);
  });

  /**
   * Only the flags Postgres can actually enforce are mirrored. `pinnedAnnouncements` is,
   * by a trigger on `broadcasts` that folds a pin the tier cannot carry (#21).
   */
  it.each(TIER_ORDER)('%s allows pinning on both sides or neither', (tier) => {
    expect(SEEDED[tier]!.pinnedAnnouncements).toBe(TIERS[tier].features.pinnedAnnouncements);
  });

  /**
   * PUSH IS SOLD BY NEITHER SIDE, and this asserts both halves rather than one.
   *
   * It used to check only that `tier_limits` had no push column, which was the weaker
   * claim: the TypeScript ladder still carried `pushNotifications`, still granted it on
   * the $79 and $599 tiers, and still put "Pinned announcements + push" on the Event
   * card. The database was honest and the price list was not.
   *
   * `expo-notifications` is not a dependency. There is no push, so a flag gating it
   * gates nothing and a feature line selling it sells nothing (#27). `audit:tiers` would
   * now catch a re-added flag on its own -- a granted feature with no enforcement is
   * exactly what it fails on -- but it cannot see the marketing copy, and the copy is
   * what a person reads before paying.
   *
   * DELETE THIS TEST on the day push is actually built. Do not weaken it.
   */
  it('sells push on neither side, because push does not exist', () => {
    const block = SQL.slice(SQL.indexOf('create table public.tier_limits'));
    // COLUMN DEFINITIONS ONLY. The first version of this matched the whole block and
    // fired on the COMMENT explaining why push is absent -- a test failing on its own
    // documentation, which is the shape of a check that measures prose instead of code.
    const columns = block
      .slice(0, block.indexOf(');'))
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(columns).not.toMatch(/push/i);
    // The floor: prove the filter did not simply strip everything.
    expect(columns).toMatch(/pinned_announcements\s+boolean/);

    // The half that was missing. Every tier's flags AND every line of pricing copy.
    for (const tier of TIER_ORDER) {
      expect(Object.keys(TIERS[tier].features)).not.toContain('pushNotifications');
      for (const line of TIERS[tier].featureLines) expect(line).not.toMatch(/push/i);
    }
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
