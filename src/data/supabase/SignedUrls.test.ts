import { SignedUrls } from './SignedUrls';
import { FakeClient } from './fixtures/fakeClient';
import type { RunitClient } from './client';
import type { Photo } from '../types';

/**
 * The signing layer for #10.
 *
 * WHAT THIS CAN AND CANNOT PROVE. `FakeClient` records the call and fabricates URLs; it
 * does NOT evaluate `event_photos_select`, and nothing here could. So these tests cover
 * the PLUMBING — which key is asked for, how often, what happens when signing is refused —
 * and say nothing about whether a pending photo is actually unreadable to the room. That
 * is Lane E's claim, and Lane E now makes it against the live database.
 */

const photo = (over: Partial<Photo> = {}): Photo => ({
  id: 'p1', folderId: 'f1', uploadedByGuestId: 'g1', uploadedByName: 'Ada',
  status: 'approved', hue: 10, localUri: null, progress: null, failureReason: null,
  storagePath: 'e1/p1.jpg', thumbPath: 'e1/p1_t.jpg', displayUrl: null,
  createdAt: '2026-09-06T12:00:00Z', ...over,
});

const make = (now = () => 1_000_000) => {
  const c = new FakeClient();
  return { c, s: new SignedUrls(c as unknown as RunitClient, now) };
};

describe('which key a photo is displayed from', () => {
  it('prefers the thumbnail, because that is the only size anything renders', () => {
    expect(SignedUrls.keyFor(photo())).toBe('e1/p1_t.jpg');
  });

  it('falls back to the full-size for a photo taken before thumbnails existed', () => {
    // Not an error state and not a backfill: the full-size object is a perfectly good
    // thing to display, just larger than it needs to be.
    expect(SignedUrls.keyFor(photo({ thumbPath: null }))).toBe('e1/p1.jpg');
  });

  it('has nothing to show for a seeded row with no bytes anywhere', () => {
    expect(SignedUrls.keyFor(photo({ thumbPath: null, storagePath: null }))).toBeNull();
  });
});

describe('signing', () => {
  it('asks for every unseen key in ONE request, not one per tile', async () => {
    // The album is a grid. Per-tile signing would be one round trip per photo on a
    // screen that renders dozens.
    const { c, s } = make();
    await s.resolve(['a.jpg', 'b.jpg', 'c.jpg']);
    const calls = c.find('sign', 'event-photos');
    expect(calls).toHaveLength(1);
    expect((calls[0]!.payload as { paths: string[] }).paths).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('signs for one hour', async () => {
    const { c, s } = make();
    await s.resolve(['a.jpg']);
    expect((c.find('sign', 'event-photos')[0]!.payload as { expiresIn: number }).expiresIn).toBe(3600);
  });

  it('does not re-ask for a key it already holds', async () => {
    const { c, s } = make();
    await s.resolve(['a.jpg']);
    await s.resolve(['a.jpg']);
    expect(c.find('sign', 'event-photos')).toHaveLength(1);
  });

  it('reports nothing-to-do rather than firing an empty request', async () => {
    // This is what stops recompute -> resolve -> recompute from spinning: the second
    // pass finds nothing new and returns false, so no further recompute is triggered.
    const { c, s } = make();
    await s.resolve(['a.jpg']);
    expect(await s.resolve(['a.jpg'])).toBe(false);
    expect(c.find('sign', 'event-photos')).toHaveLength(1);
  });

  it('re-signs once the URL is close to expiring', async () => {
    let clock = 1_000_000;
    const c = new FakeClient();
    const s = new SignedUrls(c as unknown as RunitClient, () => clock);
    await s.resolve(['a.jpg']);
    // 56 minutes later: inside the hour, but within the refresh margin.
    clock += 56 * 60 * 1000;
    expect(s.get('a.jpg')).toBeNull();
    await s.resolve(['a.jpg']);
    expect(c.find('sign', 'event-photos')).toHaveLength(2);
  });
});

describe('when a key cannot be signed', () => {
  it('leaves it unresolved rather than caching a failure', async () => {
    // A refusal here is what RLS does to a PENDING photo somebody else uploaded. Leaving
    // it uncached means it is retried after the host approves it, which is right.
    const { c, s } = make();
    c.refuseSignFor.add('secret.jpg');
    await s.resolve(['secret.jpg', 'ok.jpg']);
    expect(s.get('secret.jpg')).toBeNull();
    expect(s.get('ok.jpg')).toBeTruthy();
  });

  it('keys the answer by the path the SERVER returned, never by request order', async () => {
    // Supabase maps over its own array; an implementation that zipped the response
    // against the request array by index could hand one photo's URL to another photo's
    // tile the moment the server reorders or omits one.
    const { s } = make();
    await s.resolve(['x/one.jpg', 'x/two.jpg']);
    expect(s.get('x/one.jpg')).toContain('x/one.jpg');
    expect(s.get('x/two.jpg')).toContain('x/two.jpg');
  });

  it('survives the whole call throwing, and retries next time', async () => {
    const c = new FakeClient();
    const s = new SignedUrls(c as unknown as RunitClient, () => 1_000_000);
    const broken = { from: () => ({ createSignedUrls: async () => { throw new Error('offline'); } }) };
    (c as unknown as { storage: unknown }).storage = broken;
    await expect(s.resolve(['a.jpg'])).resolves.toBe(false);
    // Released from in-flight despite the throw, so the next frame tries again rather
    // than the key being stuck forever.
    (c as unknown as { storage: unknown }).storage = new FakeClient().storage;
    expect(s.get('a.jpg')).toBeNull();
  });
});

describe('leaving an event', () => {
  it('drops every URL, because the keys belonged to that event', async () => {
    const { s } = make();
    await s.resolve(['a.jpg']);
    expect(s.get('a.jpg')).toBeTruthy();
    s.clear();
    expect(s.get('a.jpg')).toBeNull();
  });
});
