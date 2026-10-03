import { onRequestGet } from '../../web/functions/api/music.js';

/**
 * `web/functions/api/music.js` is a Cloudflare Pages Function; this runs it in Node with
 * `fetch` mocked and no edge cache (`caches` is undefined here, which the function guards).
 * What it holds: the term is bounded, only two fields come back, and an upstream failure is
 * a 200 with no results rather than a 5xx -- the shape lane G asserts on the live route.
 */
type Ctx = { request: Request };
const run = async (q: string) => {
  const res = (await onRequestGet({ request: new Request(`https://runit-app.pages.dev/api/music?term=${encodeURIComponent(q)}`) } as Ctx)) as Response;
  return { status: res.status, body: await res.json(), type: res.headers.get('content-type') };
};
const mockFetch = (impl: unknown) => { (global as unknown as { fetch: unknown }).fetch = impl; };

describe('/api/music', () => {
  it('returns only the two fields the app reads, from Apple\'s shape', async () => {
    const seen: string[] = [];
    mockFetch(async (url: string) => { seen.push(url); return { ok: true, json: async () => ({ results: [
      { trackName: 'Alive', artistName: 'Sia', trackId: 1, collectionName: 'noise' },
      { trackName: 7, artistName: 'bad row' },
    ] }) }; });
    const r = await run('alive');
    expect(r.status).toBe(200);
    expect(r.type).toContain('application/json');
    expect(r.body).toEqual({ results: [{ trackName: 'Alive', artistName: 'Sia' }], upstream: 'ok' });
    expect(seen[0]).toMatch(/^https:\/\/itunes\.apple\.com\/search\?term=alive&entity=song&limit=8$/);
  });

  it('answers 200 with no results when Apple is down, so the client sees "no suggestions"', async () => {
    mockFetch(async () => { throw new Error('ECONNRESET'); });
    const r = await run('journey');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ results: [], upstream: 'unreachable' });
  });

  it('refuses to call Apple at all for a one-character term', async () => {
    const seen: string[] = [];
    mockFetch(async (url: string) => { seen.push(url); return { ok: true, json: async () => ({ results: [] }) }; });
    const r = await run('j');
    expect(r.body).toEqual({ results: [] });
    expect(seen).toHaveLength(0);
  });

  it('bounds the term before it reaches Apple', async () => {
    const seen: string[] = [];
    mockFetch(async (url: string) => { seen.push(url); return { ok: true, json: async () => ({ results: [] }) }; });
    await run('x'.repeat(500));
    expect(decodeURIComponent(seen[0]!.split('term=')[1]!.split('&')[0]!)).toHaveLength(80);
  });
});
