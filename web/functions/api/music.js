/**
 * /api/music?term=... -- the song type-ahead, for the browser.
 *
 * IT IS THE FALLBACK NOW, NOT THE ROUTE (#117). It was built on the belief that Apple sends
 * no CORS headers on the iTunes Search API. Apple sends `Access-Control-Allow-Origin: *`, and
 * from Cloudflare's SHARED egress it answers 429 to every term -- so while every browser came
 * through here, the type-ahead was empty for all of them. The browser asks Apple from its own
 * connection first; this answers when that call fails (a network or blocker that stops
 * `itunes.apple.com`). Two guests spelling one song differently make two rows and split the
 * vote, which is why the type-ahead is worth a second route at all.
 *
 * SAME ORIGIN, SO NO CORS AT ALL. This runs as a Cloudflare Pages Function on
 * runit-app.pages.dev, the host the web app is served from. It is deliberately NOT an open
 * proxy: it accepts one parameter, bounds it, hits one fixed endpoint, returns only the two
 * fields the app reads, and caches at the edge so a room full of phones typing "journey"
 * costs Apple one request.
 *
 * A FAILURE IS NEVER CACHED, BY US OR BY ANYONE ELSE. The edge cache only ever stored a
 * success, but the RESPONSE carried `max-age=3600` either way, so a browser that saw one 429
 * kept serving itself the empty answer for an hour after Apple recovered. `no-store` unless
 * the upstream answered.
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

  const out = new Response(JSON.stringify({ results, upstream }), {
    headers: upstream === 'ok' ? headers : { ...headers, 'Cache-Control': 'no-store' },
  });
  if (cache && upstream === 'ok') await cache.put(key, out.clone());
  return out;
}
