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
import { songKey } from '@/domain/songKey';

import { MIN_QUERY } from './musicSearchConstants';

export interface SongMatch {
  title: string;
  artist: string;
}

export { MIN_QUERY };

/** Eight fits the composer without covering the queue behind it. */
const LIMIT = 8;

const ENDPOINT = 'https://itunes.apple.com/search';

interface RawTrack {
  trackName?: unknown;
  artistName?: unknown;
}

/**
 * WHAT COMES BACK IS SOMEBODY ELSE'S JSON, so every field is checked rather than cast. A
 * `trackName` that is not a string would otherwise reach `song_key` as `undefined` and file a
 * request nobody can read.
 */
function toMatches(payload: unknown): SongMatch[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];

  const out: SongMatch[] = [];
  // DE-DUPED BY THE PRODUCT'S OWN IDENTITY RULE, not by title. A search for one song comes
  // back as the album cut, the 2024 remaster, the live version and the re-recording -- four
  // rows a guest has no way to choose between. `songKey` is what the database would use to
  // decide they are one song, so it is what decides here too, and the first one wins because
  // iTunes ranks by popularity.
  const seen = new Set<string>();
  for (const r of results as RawTrack[]) {
    if (typeof r?.trackName !== 'string' || typeof r?.artistName !== 'string') continue;
    const title = r.trackName.trim();
    const artist = r.artistName.trim();
    if (!title) continue;
    const k = songKey(title, artist);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, artist });
  }
  return out;
}

/**
 * Matches for what a guest has typed so far. Never throws and never rejects.
 *
 * FAILURE IS AN EMPTY LIST, DELIBERATELY. A party is the wrong place to surface a network
 * error, and the field still works without this: typing and pressing Request has never
 * needed the catalogue and still does not. A red banner over a suggestion list would be a
 * worse outcome than no suggestions.
 *
 * `signal` is how the caller abandons a keystroke that a newer one has overtaken. An abort
 * lands here as a rejection like any other and answers `[]`, which the caller discards.
 */
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
