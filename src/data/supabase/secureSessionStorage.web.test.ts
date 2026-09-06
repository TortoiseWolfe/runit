/**
 * The WEB session store (#12).
 *
 * Imported by explicit path. The jest-expo preset's `defaultPlatform` is `ios`, so a bare
 * `./secureSessionStorage` keeps resolving to the native file and its own suite keeps
 * testing the chunking. This one has to name the sibling.
 *
 * WHAT THIS IS GUARDING AGAINST. `expo-secure-store`'s web build is `export default {}` --
 * every method undefined, so a shared implementation throws on the first call, supabase-js
 * swallows it, and every page load mints a NEW anonymous auth user. The invitation preview
 * then never appears, because a fresh identity has joined nothing.
 *
 * The second failure mode is subtler and is what most of these tests are about: a web
 * store that THROWS takes sign-in down entirely. Not persisting is a degraded app; raising
 * is a broken one. Every path here has to survive a hostile `localStorage`.
 */
/**
 * RE-IMPORTED PER TEST. The module memoises whether `localStorage` is usable, and keeps an
 * in-memory fallback map at module scope -- both correct at runtime (one browser, one
 * answer, one tab) and both leaks between tests. Without `resetModules` a hostile-browser
 * case inherits a `true` memo and a populated map from the test above it, and passes for
 * the wrong reason.
 */
type Store = typeof import('./secureSessionStorage.web').secureSessionStorage;

let s: Store;

function load(): Store {
  let mod!: { secureSessionStorage: Store };
  jest.isolateModules(() => {
    mod = require('./secureSessionStorage.web') as { secureSessionStorage: Store };
  });
  return mod.secureSessionStorage;
}

const KEY = 'sb-qwusbxallkbzfladvgfx-auth-token';
const SESSION = JSON.stringify({ access_token: 'a'.repeat(4000), refresh_token: 'r'.repeat(600) });

/** Replace the real accessor for one test, and put it back afterwards. */
function withLocalStorage(impl: unknown) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: impl,
    configurable: true,
    writable: true,
  });
}

const workingStore = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
};

beforeEach(() => {
  s = load();
});

describe('a browser that behaves', () => {
  it('round-trips a session far larger than SecureStore would take', async () => {
    // 4600 bytes. The native file chunks at 1800 because the KEYCHAIN refuses 2048;
    // localStorage has no such limit, so reproducing the chunking here would carry the
    // scar without the wound.
    withLocalStorage(workingStore());
    await s.setItem(KEY, SESSION);
    expect(await s.getItem(KEY)).toBe(SESSION);
  });

  it('stores it in ONE key, not in fragments', async () => {
    const store = workingStore();
    withLocalStorage(store);
    await s.setItem(KEY, SESSION);
    // The claim is about the shape on disk, not just the round trip: a chunked write
    // would round-trip identically while leaving `.n` and `.0` keys behind.
    expect([...store._map.keys()]).toEqual([KEY]);
  });

  it('reports a missing session as null rather than undefined', async () => {
    withLocalStorage(workingStore());
    expect(await s.getItem('nothing-here')).toBeNull();
  });

  it('removes it', async () => {
    withLocalStorage(workingStore());
    await s.setItem(KEY, SESSION);
    await s.removeItem(KEY);
    expect(await s.getItem(KEY)).toBeNull();
  });
});

/**
 * THE HOSTILE CASES, which are the reason this file is guarded rather than direct.
 *
 * `localStorage` is not always reachable: "block all cookies" makes the ACCESSOR throw,
 * Safari private mode has historically thrown on write, and a full quota throws on set.
 * A store that propagates any of those takes sign-in down, which is strictly worse than
 * failing to persist.
 */
describe('a browser that refuses', () => {
  it('survives an accessor that throws on every touch, and still works within the tab', async () => {
    withLocalStorage(
      new Proxy(
        {},
        {
          get() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
          },
        },
      ),
    );
    await expect(s.setItem(KEY, SESSION)).resolves.toBeUndefined();
    // Falls back to memory rather than to nothing: within one page view supabase-js
    // writes a refreshed session and reads it straight back.
    expect(await s.getItem(KEY)).toBe(SESSION);
    await expect(s.removeItem(KEY)).resolves.toBeUndefined();
    expect(await s.getItem(KEY)).toBeNull();
  });

  /**
   * THE CASE THAT ONLY LOOKS LIKE THE ONE ABOVE. Here `localStorage` is genuinely usable
   * -- the probe succeeds -- and only the REAL write fails, because quota is about size.
   *
   * The first version of this test threw on every setItem, so the probe failed too and the
   * store took its "unusable" branch: it passed while never executing the line it claimed
   * to cover. Mutation-testing caught that (removing the fallback changed nothing), which
   * is the entire argument for mutation-testing an assertion before trusting it.
   */
  it('survives a quota failure on the real write, having passed the probe', async () => {
    const map = new Map<string, string>();
    withLocalStorage({
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      removeItem: (k: string) => void map.delete(k),
      setItem: (k: string, v: string) => {
        // A one-byte probe fits; a 4.6KB session does not.
        if (v.length > 16) throw new DOMException('QuotaExceededError');
        map.set(k, v);
      },
    });
    await expect(s.setItem(KEY, SESSION)).resolves.toBeUndefined();
    // localStorage answers null here and is READABLE, so the store must prefer its own
    // copy rather than that null -- otherwise the guest is signed out mid-party.
    expect(await s.getItem(KEY)).toBe(SESSION);
  });

  it('never throws out of getItem when reading blows up', async () => {
    withLocalStorage({
      setItem: () => undefined,
      removeItem: () => undefined,
      getItem: () => {
        throw new Error('nope');
      },
    });
    await expect(s.getItem(KEY)).resolves.toBeNull();
  });
});
