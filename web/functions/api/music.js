/**
 * /api/music?term=... -- the song type-ahead, for the browser.
 *
 * WHY THIS EXISTS. The native app calls the iTunes Search API directly (no key, no account,
 * the only third party the app talks to). Apple sends no CORS headers on it, so a browser
 * cannot make that call, and until this existed the web build's search returned nothing --
 * honest, documented, and the one thing a guest in Safari was missing that mattered: two
 * guests spelling the same song differently make two rows, and the votes split.
 *
 * SAME ORIGIN, SO NO CORS AT ALL. This runs as a Cloudflare Pages Function on
 * runit-app.pages.dev, the host the web app is served from. It is deliberately NOT an open
 * proxy: it accepts one parameter, bounds it, hits one fixed endpoint, returns only the two
 * fields the app reads, and caches at the edge so a room full of phones typing "journey"
 * costs Apple one request.
 *
 * AN UPSTREAM FAILURE IS A 200 WITH NO RESULTS, not a 5xx. The client treats "no
 * suggestions" as exactly that, and lane G asserts this route's SHAPE on every board -- a
 * gate that went red whenever Apple hiccupped would be switched off inside a week.
 */
const UPSTREAM = 'https://itunes.apple.com/search';
const LIMIT = 8;
const MAX_TERM = 80;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const term = (url.searchParams.get('term') ?? '').trim().slice(0, MAX_TERM);
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (term.length < 2) return new Response(JSON.stringify({ results: [] }), { headers });

  const key = new Request(`${url.origin}/api/music?term=${encodeURIComponent(term.toLowerCase())}`);
  const cache = globalThis.caches?.default;
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let results = [];
  let upstream = 'ok';
  try {
    const res = await fetch(`${UPSTREAM}?term=${encodeURIComponent(term)}&entity=song&limit=${LIMIT}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const body = await res.json();
      results = (Array.isArray(body?.results) ? body.results : [])
        .filter((r) => typeof r?.trackName === 'string' && typeof r?.artistName === 'string')
        .map((r) => ({ trackName: r.trackName, artistName: r.artistName }));
    } else {
      upstream = `http ${res.status}`;
    }
  } catch {
    upstream = 'unreachable';
  }

  const out = new Response(JSON.stringify({ results, upstream }), { headers });
  if (cache && upstream === 'ok') await cache.put(key, out.clone());
  return out;
}
