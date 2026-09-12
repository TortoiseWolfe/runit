import { readFileSync } from 'fs';
import { join } from 'path';

import { orderedForRequest, songKey } from './songKey';

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
  join(__dirname, '../../supabase/migrations/00000000000000_schema.sql'),
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

/**
 * PUTTING THE TWO HALVES THE RIGHT WAY ROUND.
 *
 * The composer splits on ` – ` and assigns positionally, so an artist typed first becomes the
 * title. That is not cosmetic: `song_key(title, artist)` is the identity under a partial
 * unique index, so the reversed spelling is a DIFFERENT SONG and the votes split -- the exact
 * defect the type-ahead exists to stop, reached by the one route the type-ahead does not
 * cover.
 */
describe('orderedForRequest', () => {
  const JOURNEY = { title: "Don't Stop Believin'", artist: 'Journey' };
  const ABBA = { title: 'Dancing Queen', artist: 'ABBA' };

  it('swaps when the catalogue says the artist was typed first', () => {
    expect(orderedForRequest("Journey – Don't Stop Believin'", [JOURNEY])).toBe(
      "Don't Stop Believin' – Journey",
    );
  });

  it('leaves a correctly ordered request exactly as typed', () => {
    // NOT rewritten to the catalogue's spelling. That would be a different change and one
    // the guest did not ask for -- she typed it right.
    expect(orderedForRequest('Dont Stop Believin - Journey', [JOURNEY])).toBe(
      'Dont Stop Believin - Journey',
    );
  });

  it('folds punctuation and case, because song_key does', () => {
    expect(orderedForRequest('journey - dont stop believin', [JOURNEY])).toBe(
      'dont stop believin – journey',
    );
  });

  /**
   * THE PROMISE THAT FREE TEXT STILL WORKS. A local band, a mashup, an inside joke -- no
   * catalogue has them, nothing confirms an order, so nothing is touched.
   */
  it('returns an unknown song untouched, whatever order it is in', () => {
    expect(orderedForRequest("The Bridesmaids' Band – live set", [JOURNEY, ABBA])).toBe(
      "The Bridesmaids' Band – live set",
    );
  });

  it('and does nothing at all with no suggestions to check against', () => {
    expect(orderedForRequest("Journey – Don't Stop Believin'", [])).toBe(
      "Journey – Don't Stop Believin'",
    );
  });

  it('leaves a bare title alone, because there are no halves to order', () => {
    expect(orderedForRequest('Wonderwall', [JOURNEY])).toBe('Wonderwall');
  });

  it('does not tear an artist whose name contains a hyphen', () => {
    // "Jay-Z" has no spaces around its hyphen, so the separator does not match it and the
    // string has one part, not two. Same rule `actions.ts` relies on.
    expect(orderedForRequest('Jay-Z', [JOURNEY])).toBe('Jay-Z');
  });

  /**
   * ALREADY-CORRECT WINS, and this is the only test that can prove the early return earns
   * its line. Mutation found the gap: deleting `if (mt === a && ma === b) return draft` left
   * every other test green, because with a sane catalogue no later entry matches in reverse
   * either, so the loop falls through to the same answer.
   *
   * It stops being redundant the moment the list contains BOTH orderings -- which a real
   * catalogue can absolutely produce, since "Africa" by Toto and a band called Africa are
   * both things that exist. Without the early return the reversed entry would win on a
   * correctly-typed request and swap it into nonsense.
   */
  it('prefers the reading the guest already got right, even if the list also has it reversed', () => {
    const REVERSED = { title: 'Journey', artist: "Don't Stop Believin'" };
    expect(orderedForRequest("Don't Stop Believin' – Journey", [REVERSED, JOURNEY])).toBe(
      "Don't Stop Believin' – Journey",
    );
    // AND THE OTHER DIRECTION TOO, which is the same rule rather than an exception: if the
    // catalogue really holds both, then whatever she typed IS a real song, and there is
    // nothing to correct. Ambiguity resolves to leaving her alone.
    expect(orderedForRequest("Journey – Don't Stop Believin'", [JOURNEY, REVERSED])).toBe(
      "Journey – Don't Stop Believin'",
    );
  });

  it('picks the matching song out of several suggestions', () => {
    expect(orderedForRequest('ABBA – Dancing Queen', [JOURNEY, ABBA])).toBe(
      'Dancing Queen – ABBA',
    );
  });
});
