import * as SecureStore from 'expo-secure-store';

/**
 * A `supabase-js` auth storage adapter backed entirely by the OS keychain.
 *
 * THE PROBLEM. Expo's SecureStore refuses values over **2048 bytes**, and a
 * Supabase session is comfortably larger than that -- it carries an access JWT, a
 * refresh token and the decoded user object. Handing SecureStore the session
 * directly fails, and it fails at the moment a guest reopens the app rather than
 * when they first join, which is the worst possible time to discover it.
 *
 * WHY NOT THE PATTERN SUPABASE DOCUMENTS. Their example generates an AES-256 key,
 * keeps that key in SecureStore, and writes the CIPHERTEXT to AsyncStorage. It
 * works, and it costs three more dependencies -- `@react-native-async-storage/
 * async-storage`, `aes-js` and `react-native-get-random-values` -- to end up with
 * the session sitting in unencrypted app storage under a layer of hand-rolled
 * crypto.
 *
 * Chunking needs none of them and never leaves the keychain. Every fragment is
 * stored by iOS Keychain / Android Keystore with the platform's own protections,
 * which is a stronger position than the documented one, not a weaker one.
 *
 * WHY THIS MATTERS BEYOND CONVENIENCE. `join_event(code, nickname)` is idempotent
 * on `(event_id, auth_user_id)`. A guest who reopens Runit with a restored session
 * lands on the SAME guest row rather than taking a second seat against the event's
 * cap. Persistence is a correctness property here, not a nicety.
 */

/** SecureStore rejects a value at 2048; leave room for the count key's own bytes. */
const CHUNK = 1800;

/**
 * SecureStore keys must match /^[A-Za-z0-9._-]+$/. Supabase's own key contains a
 * `-` and `.` and is already safe, but a caller is not obliged to be, and an
 * invalid key throws rather than returning null.
 */
function safe(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

const countKey = (key: string) => `${safe(key)}.n`;
const partKey = (key: string, i: number) => `${safe(key)}.${i}`;

async function clear(key: string, upTo: number): Promise<void> {
  const deletes: Promise<void>[] = [SecureStore.deleteItemAsync(countKey(key))];
  for (let i = 0; i < upTo; i++) deletes.push(SecureStore.deleteItemAsync(partKey(key, i)));
  await Promise.all(deletes);
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const raw = await SecureStore.getItemAsync(countKey(key));
    if (raw === null) return null;

    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return null;

    const parts = await Promise.all(
      Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(partKey(key, i))),
    );
    // A torn write -- app killed mid-save, or a partial keychain wipe -- must read
    // as "no session" rather than as a truncated one. A truncated JSON session
    // would throw deep inside supabase-js on parse, where it looks like a library
    // bug rather than missing state.
    if (parts.some((p) => p === null)) {
      await clear(key, n);
      return null;
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK) parts.push(value.slice(i, i + CHUNK));
    // An empty value chunks to ZERO parts, which would write n=0 -- and getItem
    // treats n<1 as "nothing stored" and returns null. So '' would round-trip as
    // absent rather than as empty. One empty part keeps the invariant the read
    // side relies on: n is always at least 1 when a value exists.
    if (parts.length === 0) parts.push('');

    // Write the parts BEFORE the count. The count is what getItem trusts, so
    // until it lands the old session stays readable and a crash mid-write leaves
    // the previous session intact rather than a half-written new one.
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(partKey(key, i), p)));
    await SecureStore.setItemAsync(countKey(key), String(parts.length));

    // A shorter session than last time leaves orphaned tail fragments. They are
    // unreachable (getItem reads only `n` of them) but they are still session
    // material sitting in the keychain, so remove them.
    await Promise.all(
      Array.from({ length: 8 }, (_, k) => SecureStore.deleteItemAsync(partKey(key, parts.length + k))),
    );
  },

  async removeItem(key: string): Promise<void> {
    const raw = await SecureStore.getItemAsync(countKey(key));
    await clear(key, raw === null ? 16 : Number(raw) || 16);
  },
};
