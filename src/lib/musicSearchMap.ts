import { songKey } from '@/domain/songKey';

/**
 * Shared by `musicSearch.ts` (native, calls iTunes directly) and `musicSearch.web.ts`
 * (browser, calls our same-origin proxy at /api/music, which returns the same shape).
 *
 * A SEPARATE FILE for the reason `captureConstants.ts` and `musicSearchConstants.ts` state
 * outright: inside a web bundle Metro resolves `./musicSearch` to `musicSearch.web.ts`
 * itself, so a VALUE import from the sibling is a cycle. Both halves import from here.
 */
export interface SongMatch {
  title: string;
  artist: string;
}

export const LIMIT = 8;

interface RawTrack {
  trackName?: unknown;
  artistName?: unknown;
}

export function toMatches(payload: unknown): SongMatch[] {
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
