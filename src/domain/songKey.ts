/**
 * "The same song", as one definition — issue #44.
 *
 * THE AUTHORITY IS SQL. `public.song_key(title, artist)` sits under a unique index on
 * `song_requests`, and that index is what actually stops two rows existing for one song:
 * a check in a client is bypassed by the second client, and two guests typing in the same
 * second would both pass a lookup and both insert.
 *
 * This exists so `MemoryRepository` can behave the same way, and `songKey.test.ts` pins the
 * two together by re-parsing the migration's own function body — the same shape as
 * `tokens.test.ts` re-parsing `theme.css` and `tiers.test.ts` re-parsing the caps seed. A
 * fixture that merged differently from the backend would put Lane B's green board over a
 * queue the real app fragments.
 *
 * WHAT IT DOES NOT FOLD: diacritics. An index expression must be `IMMUTABLE` and `unaccent`
 * is not, so "Beyonce" and "Beyoncé" remain two songs. That is a limit, not a decision —
 * case, punctuation and spacing are what actually differ when two people type one title.
 */
export function songKey(title: string, artist: string): string {
  const fold = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${fold(title)}|${fold(artist)}`;
}
