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
    /\('(\w+)',\s*([\d]+|null),\s*([\d]+|null),\s*([\d]+|null),\s*([\d]+|null),\s*(true|false),\s*(true|false),\s*(true|false),\s*([\d]+|null),\s*(true|false)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    rows[m[1]!] = {
      maxGuests: fromSql(m[2]!),
      maxHosts: fromSql(m[3]!),
      maxPhotos: fromSql(m[4]!),
      maxFolders: fromSql(m[5]!),
      hostRoles: m[6] === 'true',
      pinnedAnnouncements: m[7] === 'true',
      pushNotifications: m[8] === 'true',
      // NOT `fromSql`. That maps SQL null to Infinity, which is the convention the numeric
      // CAPS use (`maxGuests: INF`). `albumRetentionDays` is `number | null` in TypeScript
      // and uses null for unlimited, so the two would never compare equal on the venue
      // tier -- caught by this test on its first run.
      albumRetentionDays: m[9] === 'null' ? null : Number(m[9]),
      // #50. The tenth column, and the reason it is HERE rather than only in tiers.ts: the
      // client used to decide moderation from its own entitlements, so the number that
      // mattered lived where the party being restricted could edit it.
      photoModeration: m[10] === 'true',
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

  it.each(TIER_ORDER)('%s grants push on both sides or neither', (tier) => {
    expect(SEEDED[tier]!.pushNotifications).toBe(TIERS[tier].features.pushNotifications);
  });

  it.each(TIER_ORDER)('%s grants host roles on both sides or neither', (tier) => {
    expect(SEEDED[tier]!.hostRoles).toBe(TIERS[tier].features.hostRoles);
  });

  /**
   * #50, and this is the drift that mattered most: `photoModeration` had NO `tier_limits`
   * column at all, so the only copy of it lived in `tiers.ts` -- which the CLIENT read to
   * decide whether its own upload should wait for a host. A moderation control enforced by
   * the party being moderated. The column exists now because `set_photo_status` reads it.
   */
  it.each(TIER_ORDER)('%s moderates photos on both sides or neither', (tier) => {
    expect(SEEDED[tier]!.photoModeration).toBe(TIERS[tier].features.photoModeration);
  });

  /**
   * Only the flags Postgres can actually enforce are mirrored. `pinnedAnnouncements` is,
   * by a trigger on `broadcasts` that folds a pin the tier cannot carry (#21).
   */
  it.each(TIER_ORDER)('%s allows pinning on both sides or neither', (tier) => {
    expect(SEEDED[tier]!.pinnedAnnouncements).toBe(TIERS[tier].features.pinnedAnnouncements);
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
