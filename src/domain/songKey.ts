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

/**
 * PUT THE TWO HALVES THE RIGHT WAY ROUND, when the catalogue can say which way that is.
 *
 * IT LIVES HERE, BESIDE `songKey`, AND NOT IN `lib/musicSearch` -- which is where it was
 * written and where it did not work. That module is platform-split, so on web
 * `@/lib/musicSearch` resolves to `musicSearch.web.ts`, which does not export this, and the
 * call was `undefined` at runtime. Re-exporting would have meant the web half importing a
 * VALUE from its own sibling, which is the Metro self-resolution cycle `captureConstants.ts`
 * warns about.
 *
 * It belongs here anyway: this is a statement about song IDENTITY, the same subject as
 * `songKey`, and it has no platform concern at all.
 *
 * `actions.ts` splits a request on ` – ` and assigns the halves POSITIONALLY: first is the
 * title, second is the artist. That is right for "Don't Stop Believin' – Journey" and
 * exactly backwards for "Journey – Don't Stop Believin'", which files a song called Journey
 * by an artist called Don't Stop Believin'. It reaches the DJ queue that way, and `song_key`
 * then treats it as a DIFFERENT SONG from the correctly-ordered one -- so the votes split,
 * which is the precise defect the type-ahead exists to stop.
 *
 * Picking a suggestion has always produced the right order. Typing freehand did not.
 *
 * NO NETWORK CALL AND NO GUESSING. This reads the suggestions the type-ahead has ALREADY
 * fetched for the very text being submitted, and swaps only when one of them says the two
 * halves are a real song the other way round. A song no catalogue has is returned untouched,
 * which keeps the promise that free text still works -- a local band stays exactly as typed.
 *
 * IT IS DELIBERATELY NOT A HEURISTIC. No word lists, no "artists are usually shorter", no
 * guessing from capitalisation. Either a match confirms the swap or nothing happens.
 */
export function orderedForRequest(
  draft: string,
  matches: readonly { title: string; artist: string }[],
): string {
  const text = draft.trim();
  // The same separator `actions.ts` splits on: whitespace both sides, so "Jay-Z" survives.
  const parts = text.split(/\s[–-]\s/);
  if (parts.length !== 2) return draft;

  const [first, second] = parts as [string, string];
  const fold = (v: string) => songKey(v, '').replace('|', '');
  const a = fold(first);
  const b = fold(second);
  if (!a || !b) return draft;

  /*
   * TWO PASSES, NOT ONE LOOP, and a mutation is what proved it has to be.
   *
   * The first version checked both readings inside a single loop and returned on the first
   * hit -- so the answer depended on the ORDER of the suggestion list. Given a catalogue
   * holding both "Africa" by Toto and a band called Africa, a correctly-typed request would
   * be swapped into nonsense whenever the reversed entry happened to rank higher.
   *
   * Already-right wins over any reversed reading, whatever the ranking says: the guest is a
   * better authority on what she meant than a search result is. Leaving it alone is also
   * deliberate -- rewriting a correct request to the catalogue's spelling would be a
   * different change, and one she did not ask for.
   */
  if (matches.some((m) => fold(m.title) === a && fold(m.artist) === b)) return draft;
  const reversed = matches.some((m) => fold(m.title) === b && fold(m.artist) === a);
  return reversed ? `${second.trim()} – ${first.trim()}` : draft;
}
