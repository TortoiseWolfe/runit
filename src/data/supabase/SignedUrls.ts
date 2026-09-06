import type { Photo } from '../types';
import type { RunitClient } from './client';

/**
 * Resolves bucket keys to signed, expiring URLs — the mirror image of `UploadOverlay`.
 *
 * That overlay merges DEVICE state (`localUri`, `progress`, `failureReason`) over mapped
 * rows for photos still in flight. This merges REMOTE state over settled ones, so it gets
 * the mirror structure rather than a new pattern.
 *
 * WHY ANYTHING NEEDS SIGNING. The bucket is private, deliberately: a public one serves
 * every photo — including ones still waiting on host approval — to anyone holding the URL.
 * `event_photos_select` re-checks the same rule `photos_read` applies to rows, so a pending
 * photo stays unsignable by the room. Signing is not a formality here; it is the access
 * control being applied.
 *
 * IT NEVER SIGNS DURING `recompute()`. That fires on every realtime frame across eight
 * tables, so signing there would re-sign the whole album every time anyone approved a photo
 * or a song was voted on. Resolution is asked for once per batch of unseen keys and cached.
 */

/**
 * One hour.
 *
 * Guests never lose access — a stale URL is silently re-signed — so this is not about how
 * long anyone can look at their photos. It is about how long a link that ESCAPES the app
 * keeps working for whoever holds it: an hour means a copied address is dead by the end of
 * the night.
 *
 * It is also an egress number. React Native's <Image> caches by URI, so a re-signed URL is
 * a cache MISS and a fresh download. At ~15KB a thumbnail that is nearly free; it would not
 * be if the app ever renders full-size photos.
 */
const TTL_SECONDS = 60 * 60;

/**
 * Re-sign this long before expiry, so a URL handed to <Image> is never about to die while
 * it is being fetched over a slow connection at a party.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const BUCKET = 'event-photos';

export class SignedUrls {
  /** key -> { url, when it stops being worth reusing } */
  private cache = new Map<string, { url: string; expiresAt: number }>();
  /**
   * Keys currently being signed.
   *
   * `recompute()` can fire again while a batch is still in the air -- a song vote, a
   * broadcast, any of eight realtime tables -- and without this the same keys would be
   * requested a second time before the first answer landed. Not a correctness bug, just
   * a room full of phones each paying for the same request twice.
   */
  private inFlight = new Set<string>();

  constructor(
    private readonly db: RunitClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Which key a photo should be displayed from: the thumbnail when there is one, the
   * full-size when there is not.
   *
   * A photo taken before thumbnails existed has `thumbPath` null and falls back — which is
   * also what happens when a thumbnail could not be produced at capture. Neither is an
   * error state, and neither needs a backfill.
   */
  static keyFor(p: Photo): string | null {
    return p.thumbPath ?? p.storagePath;
  }

  /** The cached URL for a key, if one is still worth reusing. */
  get(key: string): string | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    return hit.expiresAt - REFRESH_MARGIN_MS > this.now() ? hit.url : null;
  }

  /**
   * Sign every key that is not already cached, in ONE request.
   *
   * `createSignedUrls` plural, because the album is a grid: signing per tile would be one
   * round trip per photo on a screen that renders dozens.
   *
   * A key that cannot be signed is simply left unresolved — the hue tile is the layer
   * underneath and stays visible. That is the correct outcome for a pending photo somebody
   * else uploaded, which RLS refuses on purpose; it is indistinguishable here from a
   * network failure, and both should render the same way.
   */
  async resolve(keys: readonly string[]): Promise<boolean> {
    const wanted = [
      ...new Set(keys.filter((k) => this.get(k) === null && !this.inFlight.has(k))),
    ];
    if (wanted.length === 0) return false;

    wanted.forEach((k) => this.inFlight.add(k));
    let data: { path: string | null; signedUrl: string | null; error: string | null }[] | null = null;
    let error: unknown = null;
    try {
      const res = await this.db.storage.from(BUCKET).createSignedUrls(wanted, TTL_SECONDS);
      data = res.data;
      error = res.error;
    } catch (e) {
      error = e;
    } finally {
      // Released whatever happened, so a failed batch is retried on the next frame rather
      // than being stuck in-flight forever.
      wanted.forEach((k) => this.inFlight.delete(k));
    }

    if (error || !data) {
      // Not thrown. An album that cannot sign is an album of hue tiles, which is exactly
      // what it was before this existed -- degraded, not broken.
      console.warn('photos: could not sign', error);
      return false;
    }

    const expiresAt = this.now() + TTL_SECONDS * 1000;
    let changed = false;
    for (const row of data) {
      // Supabase reports per-path failures inside a 200. A row with an error is a refusal
      // (RLS) or a missing object; leaving it uncached means it is retried, which is right
      // for a photo that is merely awaiting approval.
      if (!row.signedUrl || row.error || !row.path) continue;
      this.cache.set(row.path, { url: row.signedUrl, expiresAt });
      changed = true;
    }
    return changed;
  }

  /**
   * Resolve ONE key and hand the URL back (#38).
   *
   * For the full-size original, which is signed only when somebody opens a photo. It goes
   * through the same cache as the grid, so opening the same photo twice in an hour is one
   * request -- and closing the event drops it with everything else.
   */
  async resolveOne(key: string): Promise<string | null> {
    const hit = this.get(key);
    if (hit !== null) return hit;
    await this.resolve([key]);
    return this.get(key);
  }

  /** Drop everything. Called when the event closes: the keys belonged to that event. */
  clear(): void {
    this.cache.clear();
  }
}
