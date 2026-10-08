import { songKey } from '@/domain/songKey';

/**
 * Shared by `musicSearch.ts` (native) and `musicSearch.web.ts` (browser). Both ask iTunes
 * directly; the browser falls back to our same-origin proxy at /api/music, which returns the
 * same shape (#117).
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

const ITUNES = 'https://itunes.apple.com/search';

/**
 * ONE CALL TO APPLE, FROM THIS DEVICE'S OWN CONNECTION. `null` means the call FAILED and `[]`
 * means Apple answered and found nothing -- the browser falls back on the first and must not on
 * the second, so the difference is the return type rather than a guess. An abort is a failure
 * here; the caller decides whether it was one.
 */
export async function askItunes(term: string, signal?: AbortSignal): Promise<SongMatch[] | null> {
  try {
    const res = await fetch(`${ITUNES}?term=${encodeURIComponent(term)}&entity=song&limit=${LIMIT}`, { signal });
    if (!res.ok) return null;
    return toMatches(await res.json());
  } catch {
    return null;
  }
}

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
