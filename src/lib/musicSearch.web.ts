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
 * A DELIBERATELY CRUDE MATCH, and crude is the point: it folds with the product's own
 * `songKey` and asks for a prefix. That means "dont stop believ" finds the apostrophe'd title,
 * which is the whole behaviour under test, without this fixture growing a ranking algorithm
 * nobody asked for and nobody would trust.
 */
export async function searchSongs(q: string, _signal?: AbortSignal): Promise<SongMatch[]> {
  const term = q.trim();
  if (term.length < MIN_QUERY) return [];
  if (process.env.EXPO_PUBLIC_FIDELITY !== '1') return [];

  const needle = songKey(term, '').replace('|', '');
  return CATALOGUE.filter((c) => songKey(c.title, c.artist).replace('|', '').startsWith(needle));
}
