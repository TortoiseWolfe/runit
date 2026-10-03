/**
 * The web half, which deliberately does not search.
 *
 * Two independent reasons, either sufficient: the endpoint sends no CORS headers, so a
 * browser refuses the request before it leaves; and no test in this repo may depend on a
 * third-party API's uptime, ranking or rate limit. The fixture is what makes the type-ahead
 * assertable in Lane B at all.
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

  it('answers nothing without the harness flag when the proxy is unreachable, because CORS blocks the direct call', async () => {
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
 * WITHOUT THE HARNESS FLAG the web half asks OUR origin, `/api/music`, which is the Pages
 * Function in `web/functions/api/music.js` -- the same shape iTunes returns, through a host
 * that sends CORS headers because it IS the host. The fetch is mocked here; the live route is
 * asserted by lane G on every board, and a journey never depends on Apple.
 */
describe('the browser search goes through our own proxy', () => {
  const withFlag = async (on: boolean, fn: () => Promise<void>) => {
    const prev = process.env.EXPO_PUBLIC_FIDELITY;
    process.env.EXPO_PUBLIC_FIDELITY = on ? '1' : '';
    try { await fn(); } finally { process.env.EXPO_PUBLIC_FIDELITY = prev; }
  };
  const mockFetch = (impl: unknown) => {
    (global as unknown as { fetch: unknown }).fetch = impl;
  };

  it('asks /api/music on the page origin and maps what comes back', async () => {
    const calls: string[] = [];
    mockFetch(async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ results: [
        { trackName: "Don't Stop Believin'", artistName: 'Journey' },
        // The same song under the product's own identity rule (punctuation and case folded),
        // so the mapper must return ONE row -- a remaster with a different title is not.
        { trackName: 'DONT STOP BELIEVIN', artistName: 'journey' },
      ] }) };
    });
    await withFlag(false, async () => {
      const out = await searchSongs('journey');
      expect(calls[0]).toMatch(/\/api\/music\?term=journey$/);
      expect(out).toEqual([{ title: "Don't Stop Believin'", artist: 'Journey' }]);
    });
  });

  it('answers nothing, never an error, when the proxy fails', async () => {
    mockFetch(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    await withFlag(false, async () => {
      await expect(searchSongs('journey')).resolves.toEqual([]);
    });
  });

  it('does not ask at all below the minimum query', async () => {
    const calls: string[] = [];
    mockFetch(async (url: string) => { calls.push(url); return { ok: true, json: async () => ({ results: [] }) }; });
    await withFlag(false, async () => {
      await searchSongs('j');
      expect(calls).toHaveLength(0);
    });
  });
});
