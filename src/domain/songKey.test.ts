import { readFileSync } from 'fs';
import { join } from 'path';

import { songKey } from './songKey';

/**
 * "The same song" is defined ONCE, in SQL, and mirrored here — issue #44.
 *
 * `public.song_key()` sits under a unique index and is what actually stops two rows
 * existing for one song. `MemoryRepository` mirrors it so Lane B's green board is not over
 * a queue the real app would fragment. Two implementations of one rule drift, so this test
 * re-parses the migration's own function body rather than trusting a comment — the same
 * shape as `tokens.test.ts` re-parsing `theme.css` and `tiers.test.ts` re-parsing the caps
 * seed.
 */
const migration = readFileSync(
  join(__dirname, '../../supabase/migrations/00000000000000_init.sql'),
  'utf8',
);

describe('the song key, against the SQL that enforces it', () => {
  it('is still the function the unique index uses', () => {
    // If the index stops naming this function, the mirroring below is checking nothing.
    expect(migration).toMatch(
      /create unique index song_requests_one_per_song\s+on public\.song_requests \(event_id, public\.song_key\(title, artist\)\)/,
    );
    expect(migration).toMatch(/where status in \('pending', 'accepted'\)/);
  });

  it('folds the same characters SQL folds', () => {
    // Re-parsed rather than restated: `regexp_replace(lower(btrim(...)), '[^a-z0-9]+', '', 'g')`
    // twice, joined by '|'. A change to the SQL character class fails here.
    const body = /create or replace function public\.song_key[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(
      migration,
    )?.[1];
    expect(body).toBeTruthy();
    const classes = [...body!.matchAll(/'\[\^([a-z0-9-]+)\]\+'/g)].map((m) => m[1]);
    expect(classes).toEqual(['a-z0-9', 'a-z0-9']);
    // The separator, whitespace-insensitively: it is the reason a title and an artist
    // cannot collide by concatenation ("ab"+"ba" vs "abb"+"a").
    expect(body!.replace(/\s+/g, ' ')).toContain("|| '|' ||");
    expect(body).toContain('lower(btrim(');
  });

  it('treats casing, punctuation and spacing as the same song', () => {
    const canonical = songKey('Dancing Queen', 'ABBA');
    expect(songKey('  dancing queen!  ', 'abba')).toBe(canonical);
    expect(songKey('DANCING-QUEEN', 'A.B.B.A.')).toBe(canonical);
    expect(songKey('Dancing  Queen', 'ABBA')).toBe(canonical);
  });

  it('keeps different songs apart, including a shared title', () => {
    expect(songKey('Alive', 'Pearl Jam')).not.toBe(songKey('Alive', 'Sia'));
    expect(songKey('Dancing Queen', '')).not.toBe(songKey('Dancing Queen', 'ABBA'));
  });

  it('does not fold ANYTHING SQL does not, which is the direction a mirror fails in', () => {
    // Folding LESS than the index shows up immediately -- two rows appear. Folding MORE is
    // the silent one: the fixture merges two songs the backend keeps apart, Lane B stays
    // green, and the divergence only surfaces on a phone. A leading article is the obvious
    // temptation, so it is pinned; `regexp_replace(..., '[^a-z0-9]+')` does no such thing.
    expect(songKey('The Killers', '')).not.toBe(songKey('Killers', ''));
    expect(songKey('A Little Respect', '')).not.toBe(songKey('Little Respect', ''));
  });

  it('does NOT fold diacritics, which is a limit rather than a decision', () => {
    // An index expression must be IMMUTABLE and `unaccent` is not, so this cannot be done
    // in the place that enforces it -- and doing it only here would make the fixture merge
    // songs the backend keeps apart.
    expect(songKey('Beyonce', '')).not.toBe(songKey('Beyoncé', ''));
  });
});
