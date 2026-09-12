/**
 * The web half of the song type-ahead, and it does not search.
 *
 * TWO SEPARATE REASONS, and each alone would be enough.
 *
 * THE API SENDS NO CORS HEADERS. Verified against the live endpoint: no
 * `access-control-allow-origin` on the response. React Native's fetch is not subject to CORS,
 * so `musicSearch.ts` works on a device; a browser refuses the request before it is sent.
 * There is no header to add from this side -- it is Apple's response, not ours.
 *
 * AND NO TEST MAY TOUCH A THIRD-PARTY API. Lane B runs 300-plus journeys many times an hour.
 * Pointing any of them at a live catalogue would make the suite depend on somebody else's
 * uptime, ranking and rate limit -- so a green board would stop being a statement about this
 * app, and a red one would usually mean nothing. The fixture below is what makes the
 * type-ahead assertable at all.
 *
 * Same shape and the same reasoning as `capture.web.ts`, which returns a synthetic pixel under
 * the same flag so the harness is not left waiting on an OS file chooser.
 */
import { songKey } from '@/domain/songKey';

// TYPE-ONLY from the sibling -- erased at compile time, so it cannot become the cycle
// `captureConstants.ts` warns about. The VALUE comes from the shared module.
import type { SongMatch } from './musicSearch';
import { MIN_QUERY } from './musicSearchConstants';

export { MIN_QUERY, type SongMatch };

/**
 * A CATALOGUE OF FOUR, chosen to make the real assertions possible rather than to look real.
 *
 * - "Don't Stop Believin'" carries an apostrophe, so picking it proves the field receives the
 *   CANONICAL string rather than what was typed -- a test typing "dont stop believin" and
 *   asserting the apostrophe cannot pass by accident.
 * - "Dancing Queen" is already in `weddingSeed` as `req_1`, so picking it exercises the merge
 *   branch of `request_song` and the "Already in the queue" toast.
 * - Two Alives by different artists mirror `songKey.test.ts`'s own case and prove the list is
 *   de-duped by identity rather than by title.
 */
const CATALOGUE: SongMatch[] = [
  { title: "Don't Stop Believin'", artist: 'Journey' },
  { title: 'Dancing Queen', artist: 'ABBA' },
  { title: 'Alive', artist: 'Pearl Jam' },
  { title: 'Alive', artist: 'Sia' },
];

/**
 * EVERY WORD HAS TO LAND SOMEWHERE IN THE TITLE OR THE ARTIST, in any order.
 *
 * THE FIRST VERSION COULD NOT DO ARTIST-FIRST AT ALL, and that made this fixture actively
 * misleading. It folded the query with `songKey` and asked whether `title+artist` STARTED
 * with it -- so "dont stop believ" matched and "journey" matched nothing, because the
 * artist is at the END of that concatenation. The real endpoint has no such limit: measured,
 * `journey dont stop believin` and `abba dancing queen` both return the right song first.
 *
 * A fixture that cannot do what the real thing does is worse than no fixture. Every journey
 * would have gone green on a type-ahead that had quietly lost half its usefulness, and the
 * `Artist – Title` ordering fix below it would have been untestable.
 *
 * Still deliberately crude -- no ranking, no fuzziness, no scoring. Prefix-per-token is
 * enough to be honest about word order without this file growing an algorithm nobody asked
 * for and nobody would trust.
 */
export async function searchSongs(q: string, _signal?: AbortSignal): Promise<SongMatch[]> {
  const term = q.trim();
  if (term.length < MIN_QUERY) return [];
  if (process.env.EXPO_PUBLIC_FIDELITY !== '1') return [];

  // `songKey`'s folding, applied per word rather than to the whole string, so punctuation
  // still does not matter: "dont" reaches "Don't".
  const words = (v: string) => songKey(v, '').replace('|', '') && v.trim().split(/\s+/)
    .map((w) => songKey(w, '').replace('|', ''))
    .filter(Boolean);

  const needles = words(term) || [];
  if (needles.length === 0) return [];

  return CATALOGUE.filter((c) => {
    const hay = [...(words(c.title) || []), ...(words(c.artist) || [])];
    return needles.every((n) => hay.some((h) => h.startsWith(n)));
  });
}
