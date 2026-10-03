/**
 * Song type-ahead. Title and artist, from a catalogue, so a guest does not have to spell.
 *
 * WHY THIS EXISTS AT ALL. `song_requests.title` and `.artist` are free text, and identity is
 * `song_key(title, artist)` under a partial unique index -- so "dont stop believin",
 * "Don't Stop Believin'" and "Dont Stop Believing" are three rows with one vote each, and the
 * DJ sees the same song three times while the room's actual favourite sits below a typo.
 * Issue #8 calls that "a real defect today" in its own words.
 *
 * The fix is not a smarter key. `song_key` is already correct -- it folds case and every
 * non-alphanumeric, and `songKey.test.ts` re-parses the migration to keep the two in step. It
 * was only ever being fed bad strings. So: offer the canonical ones.
 *
 * WHY iTUNES AND NOT MUSICBRAINZ, MEASURED RATHER THAN ASSUMED. #8 named MusicBrainz "the
 * cheap win". Queried for `dont stop believin` it returns **Loggy** and **The Nerds** above
 * Journey, all three scored 100 -- it is a metadata database, not a popularity-ranked search,
 * and a guest at a party would be offered a cover band first. The iTunes Search API returns
 * Journey in the top three, needs no key, no account and no stored credential, and answered
 * in 165-350ms, which is inside a type-ahead's budget. #8's recommendation is wrong for this
 * job and should be corrected rather than followed.
 *
 * IT SENDS NO CORS HEADERS, which is why this file has a `.web.ts` sibling. React Native's
 * fetch is not subject to CORS so a device is fine; a browser is not. Same split as
 * `capture`, `contacts`, `push`, `save` and `share`.
 *
 * NO KEY, NO AUTH, NO SECRET. There is nothing here to leak and nothing to put in Vault.
 */
import { MIN_QUERY } from './musicSearchConstants';
import { LIMIT, toMatches, type SongMatch } from './musicSearchMap';

export { MIN_QUERY, type SongMatch };

const ENDPOINT = 'https://itunes.apple.com/search';

export async function searchSongs(q: string, signal?: AbortSignal): Promise<SongMatch[]> {
  const term = q.trim();
  if (term.length < MIN_QUERY) return [];

  try {
    const url = `${ENDPOINT}?term=${encodeURIComponent(term)}&entity=song&limit=${LIMIT}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    return toMatches(await res.json());
  } catch {
    return [];
  }
}
