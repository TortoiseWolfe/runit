/**
 * The web half. Under the harness flag it searches a four-song fixture, because no test in
 * this repo may depend on a third-party API's uptime, ranking or rate limit -- the fixture is
 * what makes the type-ahead assertable in Lane B at all. Without the flag it asks iTunes from
 * the browser, falling back to our own proxy; every `fetch` below is mocked.
 */
import { searchSongs } from './musicSearch.web';

describe('searchSongs on web', () => {
  const withFidelity = async (on: boolean, fn: () => Promise<void>) => {
    const prev = process.env.EXPO_PUBLIC_FIDELITY;
    process.env.EXPO_PUBLIC_FIDELITY = on ? '1' : '';
    try {
      await fn();
    } finally {
      process.env.EXPO_PUBLIC_FIDELITY = prev;
    }
  };

  it('answers nothing without the harness flag when every route is unreachable', async () => {
    // Mocked, never the real network: without the flag the first call goes to Apple.
    (global as unknown as { fetch: unknown }).fetch = async () => { throw new TypeError('Failed to fetch'); };
    await withFidelity(false, async () => {
      await expect(searchSongs('dont stop')).resolves.toEqual([]);
    });
  });

  /**
   * THE ASSERTION THE E2E SUITE RESTS ON. A guest types without the apostrophe and is offered
   * the canonical spelling -- which is the entire point of the feature, and is what makes the
   * journey's "the field now reads Don't Stop Believin' – Journey" provable rather than a
   * restatement of what was typed.
   */
  it('finds the apostrophed title from an unapostrophed query', async () => {
    await withFidelity(true, async () => {
      await expect(searchSongs('dont stop believ')).resolves.toEqual([
        { title: "Don't Stop Believin'", artist: 'Journey' },
      ]);
    });
  });

  it('offers two songs that share a title but not an artist', async () => {
    await withFidelity(true, async () => {
      const out = await searchSongs('alive');
      expect(out).toEqual([
        { title: 'Alive', artist: 'Pearl Jam' },
        { title: 'Alive', artist: 'Sia' },
      ]);
    });
  });

  it('offers a song the wedding fixture already has, so the merge branch is reachable', async () => {
    await withFidelity(true, async () => {
      await expect(searchSongs('dancing q')).resolves.toEqual([
        { title: 'Dancing Queen', artist: 'ABBA' },
      ]);
    });
  });

  /**
   * ARTIST FIRST, WHICH THE FIRST VERSION OF THIS FIXTURE COULD NOT DO. It prefix-matched
   * `title+artist` concatenated, so the artist sat at the end and "journey" matched nothing
   * -- while the real endpoint returns the right song first for exactly that query,
   * measured. A fixture that cannot do what the real thing does sends every journey green
   * over a type-ahead that has lost half its use.
   */
  it('finds a song by its artist alone', async () => {
    await withFidelity(true, async () => {
      await expect(searchSongs('journey')).resolves.toEqual([
        { title: "Don't Stop Believin'", artist: 'Journey' },
      ]);
    });
  });

  it('and by artist then title, in that order', async () => {
    await withFidelity(true, async () => {
      await expect(searchSongs('abba dancing')).resolves.toEqual([
        { title: 'Dancing Queen', artist: 'ABBA' },
      ]);
    });
  });

  it('and still by title then artist, which must not regress', async () => {
    await withFidelity(true, async () => {
      await expect(searchSongs('dancing abba')).resolves.toEqual([
        { title: 'Dancing Queen', artist: 'ABBA' },
      ]);
    });
  });

  it('requires every word to land, so two unrelated words match nothing', async () => {
    await withFidelity(true, async () => {
      await expect(searchSongs('journey dancing')).resolves.toEqual([]);
    });
  });

  it('stays silent below the minimum query', async () => {
    await withFidelity(true, async () => {
      await expect(searchSongs('d')).resolves.toEqual([]);
    });
  });

  it('and answers nothing for a song no catalogue has, which must still be requestable', async () => {
    await withFidelity(true, async () => {
      await expect(searchSongs("the bridesmaids' band")).resolves.toEqual([]);
    });
  });
});


/**
 * WITHOUT THE HARNESS FLAG THE BROWSER ASKS APPLE ITSELF, and our proxy is the fallback (#117).
 *
 * iTunes sends `Access-Control-Allow-Origin: *` -- measured 2026-10-07 with and without an
 * Origin header, and read back from a real Chromium page on runit-app.pages.dev. The proxy
 * existed on the belief that it did not, and from Cloudflare's SHARED egress Apple answers 429
 * to every term, so the proxy alone left the type-ahead empty for every browser guest. From the
 * guest's own connection it answers like it does for the phone app. The proxy stays for a
 * network or blocker that stops `itunes.apple.com`. The fetch is mocked here; lane G asserts
 * the proxy's shape on every board, and a journey never depends on Apple.
 */
describe('the browser asks iTunes directly, and falls back to our proxy', () => {
  const withFlag = async (on: boolean, fn: () => Promise<void>) => {
    const prev = process.env.EXPO_PUBLIC_FIDELITY;
    process.env.EXPO_PUBLIC_FIDELITY = on ? '1' : '';
    try { await fn(); } finally { process.env.EXPO_PUBLIC_FIDELITY = prev; }
  };
  const mockFetch = (impl: unknown) => {
    (global as unknown as { fetch: unknown }).fetch = impl;
  };
  const answer = (results: unknown[]) => ({ ok: true, json: async () => ({ results }) });
  const journey = { trackName: "Don't Stop Believin'", artistName: 'Journey' };

  it('asks iTunes first, from the browser, and maps what comes back', async () => {
    const calls: string[] = [];
    mockFetch(async (url: string) => {
      calls.push(url);
      return answer([
        journey,
        // The same song under the product's own identity rule (punctuation and case folded),
        // so the mapper must return ONE row -- a remaster with a different title is not.
        { trackName: 'DONT STOP BELIEVIN', artistName: 'journey' },
      ]);
    });
    await withFlag(false, async () => {
      const out = await searchSongs('journey');
      expect(calls).toEqual(['https://itunes.apple.com/search?term=journey&entity=song&limit=8']);
      expect(out).toEqual([{ title: "Don't Stop Believin'", artist: 'Journey' }]);
    });
  });

  it('falls back to /api/music on the page origin when the direct call fails', async () => {
    const calls: string[] = [];
    mockFetch(async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://itunes.apple.com/')) return { ok: false, status: 403, json: async () => ({}) };
      return answer([journey]);
    });
    await withFlag(false, async () => {
      const out = await searchSongs('journey');
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatch(/\/api\/music\?term=journey$/);
      expect(out).toEqual([{ title: "Don't Stop Believin'", artist: 'Journey' }]);
    });
  });

  it('and when the direct call is refused outright, the way a blocked request rejects', async () => {
    const calls: string[] = [];
    mockFetch(async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://itunes.apple.com/')) throw new TypeError('Failed to fetch');
      return answer([journey]);
    });
    await withFlag(false, async () => {
      await expect(searchSongs('journey')).resolves.toEqual([{ title: "Don't Stop Believin'", artist: 'Journey' }]);
      expect(calls).toHaveLength(2);
    });
  });

  /**
   * AN EMPTY ANSWER IS AN ANSWER. A local band is in no catalogue, and asking the proxy the
   * same question again would double every such keystroke for nothing.
   */
  it('does not fall back when Apple answered and simply found nothing', async () => {
    const calls: string[] = [];
    mockFetch(async (url: string) => { calls.push(url); return answer([]); });
    await withFlag(false, async () => {
      await expect(searchSongs('the bridesmaids band')).resolves.toEqual([]);
      expect(calls).toHaveLength(1);
    });
  });

  /**
   * AN ABORT IS THE COMPOSER MOVING ON, not a failure. The screen aborts the previous search on
   * every keystroke; falling back after one would fire a stale proxy request per letter typed.
   */
  it('does not fall back after the search was aborted', async () => {
    const calls: string[] = [];
    const ac = new AbortController();
    mockFetch(async (url: string) => {
      calls.push(url);
      ac.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    await withFlag(false, async () => {
      await expect(searchSongs('journey', ac.signal)).resolves.toEqual([]);
      expect(calls).toHaveLength(1);
    });
  });

  it('answers nothing, never an error, when both routes fail', async () => {
    mockFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await withFlag(false, async () => {
      await expect(searchSongs('journey')).resolves.toEqual([]);
    });
  });

  it('does not ask at all below the minimum query', async () => {
    const calls: string[] = [];
    mockFetch(async (url: string) => { calls.push(url); return answer([]); });
    await withFlag(false, async () => {
      await searchSongs('j');
      expect(calls).toHaveLength(0);
    });
  });
});
