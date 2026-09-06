/**
 * The web session store. Metro picks this over `secureSessionStorage.ts` for the web
 * bundle, which is the point: **it imports `expo-secure-store` not at all.**
 *
 * WHY IT HAS TO EXIST. `expo-secure-store`'s web build is, verbatim:
 *
 *     export default {};
 *     //# sourceMappingURL=ExpoSecureStore.web.js.map
 *
 * Every method is `undefined`. So on web, `SecureStore.getItemAsync(...)` is not a
 * function that returns null -- it throws. supabase-js swallows the failure, the session
 * never persists, and **every page load mints a brand-new anonymous auth user**. The
 * invitation preview never appears (a fresh identity has joined nothing), and the project
 * accumulates a permanent `auth.users` row per reload. Issue #12.
 *
 * NO CHUNKING, and that is not an oversight. The native file splits at 1800 bytes because
 * SecureStore refuses values over 2048 -- a constraint of the keychain, not of storage in
 * general. `localStorage` has no such limit (megabytes, not kilobytes), so reproducing the
 * chunking here would carry the scar without the wound and add a torn-write failure mode
 * that cannot happen.
 *
 * THE AT-REST GUARANTEE IS GENUINELY WEAKER, and this is the honest place to say so. The
 * native store hands every fragment to the iOS Keychain / Android Keystore. `localStorage`
 * is plain text, readable by any script running on the origin. That is the standard
 * position for a browser session -- it is what every web app on this stack does, and the
 * token is a short-lived anonymous JWT scoped by RLS to one event -- but it is not
 * equivalent, and a reader should not have to infer that from silence.
 *
 * IT MUST NEVER THROW. `localStorage` is not always reachable: Safari private mode has
 * historically thrown on write, embedded webviews and "block all cookies" make the
 * accessor itself throw on READ, and a full quota throws on set. A store that propagates
 * any of those takes down sign-in entirely, which is worse than not persisting. So every
 * operation is guarded and falls back to an in-memory map for the life of the tab: the
 * session then behaves exactly as it did before this file existed -- lost on reload -- and
 * nothing else breaks.
 */

/**
 * The fallback, and the reason it is module-scoped rather than per-call: within one page
 * view supabase-js reads back what it wrote (refresh, then re-read). An in-memory map
 * keeps that coherent even where the browser refuses to store anything.
 */
const memory = new Map<string, string>();

/**
 * Probed once, lazily, and never assumed. Feature-detecting by `'localStorage' in window`
 * is not enough -- the property exists in the blocked case and throws on ACCESS, so the
 * only honest test is to touch it inside a try.
 */
let available: boolean | null = null;

function usable(): boolean {
  if (available !== null) return available;
  try {
    const probe = '__runit_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!usable()) return memory.get(key) ?? null;
    try {
      // FALL BACK TO MEMORY ON A NULL, not only on a throw. A browser can permit the
      // probe and still refuse the real write -- a full quota is the ordinary way -- and
      // then localStorage answers `null` for a session this tab is genuinely holding.
      // Preferring its answer there would sign the guest out mid-party. Caught by a test
      // rather than reasoned: the quota case failed on the first version of this file.
      return globalThis.localStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    // Written to BOTH when localStorage works. The cost is a few kilobytes of duplication;
    // the benefit is that a quota failure part-way through a session's life degrades to
    // "this tab still works" rather than to a half-stored session.
    memory.set(key, value);
    if (!usable()) return;
    try {
      globalThis.localStorage.setItem(key, value);
    } catch {
      // Quota, or a browser that permits the probe and refuses the real write. The
      // in-memory copy above is already correct, so there is nothing to repair.
    }
  },

  async removeItem(key: string): Promise<void> {
    memory.delete(key);
    if (!usable()) return;
    try {
      globalThis.localStorage.removeItem(key);
    } catch {
      // Nothing to do: the caller wants it gone, and it is gone from the copy we read.
    }
  },
};
