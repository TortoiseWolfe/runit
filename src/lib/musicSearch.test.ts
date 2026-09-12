/**
 * The catalogue lookup behind the song type-ahead.
 *
 * Every test here drives a FAKE `fetch`. Pointing a unit test at the real endpoint would
 * make this suite depend on Apple's uptime, ranking and rate limit, so a green run would
 * stop being a statement about this code -- and the ranking is precisely the thing that
 * would drift under us without warning.
 */
import { searchSongs, MIN_QUERY } from './musicSearch';

const payload = (tracks: unknown[]) => ({
  ok: true,
  json: async () => ({ resultCount: tracks.length, results: tracks }),
});

const track = (trackName: string, artistName: string) => ({ trackName, artistName });

describe('searchSongs', () => {
  afterEach(() => {
    // @ts-expect-error -- restoring the environment's own fetch, which jsdom may not define
    delete global.fetch;
  });

  const stub = (impl: unknown) => {
    (global as unknown as { fetch: unknown }).fetch = impl;
  };

  it('maps the catalogue payload to title and artist', async () => {
    stub(async () => payload([track("Don't Stop Believin'", 'Journey')]));
    await expect(searchSongs('dont stop')).resolves.toEqual([
      { title: "Don't Stop Believin'", artist: 'Journey' },
    ]);
  });

  /**
   * THE REASON THE WHOLE FEATURE EXISTS, in one assertion. A real search for one song comes
   * back as the album cut, a remaster, a live take and a re-recording. `song_key` folds case
   * and every non-alphanumeric, so the database would call all four the same song -- and a
   * list offering a guest four rows she cannot tell apart is worse than one.
   */
  it('collapses rows the database would call one song, keeping the most popular', async () => {
    stub(async () =>
      payload([
        track("Don't Stop Believin'", 'Journey'),
        track('Dont Stop Believin', 'Journey'),
        track("DON'T STOP BELIEVIN' (2024 Remaster)", 'Journey'),
      ]),
    );
    const out = await searchSongs('dont stop');
    // The remaster survives: `song_key` does not fold the parenthetical, so it IS a different
    // song by the product's own rule, and pretending otherwise here would disagree with the
    // unique index. Two rows, not one and not three.
    expect(out).toEqual([
      { title: "Don't Stop Believin'", artist: 'Journey' },
      { title: "DON'T STOP BELIEVIN' (2024 Remaster)", artist: 'Journey' },
    ]);
  });

  it('keeps two songs that share a title but not an artist', async () => {
    stub(async () => payload([track('Alive', 'Pearl Jam'), track('Alive', 'Sia')]));
    await expect(searchSongs('alive')).resolves.toHaveLength(2);
  });

  it('asks for nothing below the minimum query, so a single keystroke costs no request', async () => {
    let calls = 0;
    stub(async () => {
      calls += 1;
      return payload([]);
    });
    await expect(searchSongs('a')).resolves.toEqual([]);
    expect(calls).toBe(0);
    expect(MIN_QUERY).toBe(2);
  });

  /**
   * FAILURE IS AN EMPTY LIST, NOT AN EXCEPTION. A party is the wrong place to surface a
   * network error, and the field works without the catalogue -- typing and pressing Request
   * never needed it. A rejection here would reach an unhandled promise in the screen's
   * effect instead.
   */
  it('answers with an empty list when the network fails, rather than throwing', async () => {
    stub(async () => {
      throw new Error('Network request failed');
    });
    await expect(searchSongs('dont stop')).resolves.toEqual([]);
  });

  it('and when the endpoint answers non-OK', async () => {
    stub(async () => ({ ok: false, json: async () => ({}) }));
    await expect(searchSongs('dont stop')).resolves.toEqual([]);
  });

  /**
   * SOMEBODY ELSE'S JSON. A `trackName` that is not a string would otherwise reach `song_key`
   * as `undefined` and file a request nobody can read.
   */
  it('skips rows whose fields are not strings instead of trusting the shape', async () => {
    stub(async () =>
      payload([{ trackName: 42, artistName: 'Journey' }, { artistName: 'Nobody' }, track('Real', 'Band')]),
    );
    await expect(searchSongs('real')).resolves.toEqual([{ title: 'Real', artist: 'Band' }]);
  });

  it('passes the abort signal through, so an overtaken keystroke can be abandoned', async () => {
    let seen: AbortSignal | undefined;
    stub(async (_url: string, init: { signal?: AbortSignal }) => {
      seen = init?.signal;
      return payload([]);
    });
    const ac = new AbortController();
    await searchSongs('dont stop', ac.signal);
    expect(seen).toBe(ac.signal);
  });

  it('encodes the query, so an ampersand does not truncate the search', async () => {
    let url = '';
    stub(async (u: string) => {
      url = u;
      return payload([]);
    });
    await searchSongs('earth wind & fire');
    expect(url).toContain('earth%20wind%20%26%20fire');
    expect(url).not.toContain('& fire');
  });
});
