/**
 * Session persistence is a CORRECTNESS property here, not a convenience.
 *
 * `join_event` is idempotent on (event_id, auth_user_id), so a guest who reopens
 * Runit with a restored session lands on the SAME seat instead of taking a second
 * one against the event's cap. Lose the session and a room of ten can read as a
 * room of twenty by the end of the night.
 *
 * Expo's SecureStore refuses values over 2048 bytes and a Supabase session is
 * comfortably larger, which is the whole reason this chunks.
 */

// `mock`-prefixed on purpose: jest hoists jest.mock() above the imports, so its
// factory may not close over an ordinary out-of-scope variable. The prefix is the
// documented escape hatch, and it is a guard against reading an uninitialised mock
// rather than a style rule.
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => (mockStore.has(k) ? mockStore.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    // The real limit, enforced here so a regression that stops chunking fails
    // loudly in jest instead of on a phone at a party.
    if (v.length > 2048) throw new Error(`SecureStore value too large: ${v.length}`);
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

import { secureSessionStorage as s } from './secureSessionStorage';

const KEY = 'sb-qwusbxallkbzfladvgfx-auth-token';
const bigSession = JSON.stringify({ access_token: 'a'.repeat(4000), refresh_token: 'r'.repeat(600) });

beforeEach(() => mockStore.clear());

describe('round trip', () => {
  it('stores and returns a session far larger than the 2048-byte limit', async () => {
    expect(bigSession.length).toBeGreaterThan(2048);
    await s.setItem(KEY, bigSession);
    expect(await s.getItem(KEY)).toBe(bigSession);
  });

  it('splits it across several keys rather than one oversized value', async () => {
    await s.setItem(KEY, bigSession);
    expect(mockStore.size).toBeGreaterThan(2);
    for (const v of mockStore.values()) expect(v.length).toBeLessThanOrEqual(2048);
  });

  it('handles a small value, an empty string and unicode', async () => {
    await s.setItem(KEY, 'short');
    expect(await s.getItem(KEY)).toBe('short');
    await s.setItem(KEY, '');
    expect(await s.getItem(KEY)).toBe('');
    await s.setItem(KEY, '🎉 café — naïve');
    expect(await s.getItem(KEY)).toBe('🎉 café — naïve');
  });
});

describe('nothing stored', () => {
  it('reads as null rather than throwing', async () => {
    expect(await s.getItem(KEY)).toBeNull();
  });
});

describe('a torn write', () => {
  it('reads as no session, not as a truncated one', async () => {
    // App killed mid-save, or a partial keychain wipe. A truncated JSON session
    // would throw deep inside supabase-js on parse, where it looks like a library
    // bug rather than missing state.
    await s.setItem(KEY, bigSession);
    const partKeys = [...mockStore.keys()].filter((k) => k !== `${KEY}.n`);
    mockStore.delete(partKeys[1]!);
    expect(await s.getItem(KEY)).toBeNull();
  });

  it('clears the wreckage so the next write starts clean', async () => {
    await s.setItem(KEY, bigSession);
    mockStore.delete([...mockStore.keys()].filter((k) => k !== `${KEY}.n`)[1]!);
    await s.getItem(KEY);
    expect(mockStore.size).toBe(0);
  });
});

describe('a shorter session replacing a longer one', () => {
  it('leaves no orphaned tail fragments in the keychain', async () => {
    // Unreachable -- getItem only reads `n` of them -- but still session material
    // sitting in the keychain.
    await s.setItem(KEY, bigSession);
    await s.setItem(KEY, 'tiny');
    expect(await s.getItem(KEY)).toBe('tiny');
    expect(mockStore.size).toBe(2); // one part + the count
  });
});

describe('removeItem', () => {
  it('leaves nothing behind', async () => {
    await s.setItem(KEY, bigSession);
    await s.removeItem(KEY);
    expect(mockStore.size).toBe(0);
    expect(await s.getItem(KEY)).toBeNull();
  });

  it('is safe on a key that was never written', async () => {
    await expect(s.removeItem(KEY)).resolves.toBeUndefined();
  });
});

describe('key sanitisation', () => {
  it('never hands SecureStore a key it would reject', async () => {
    // SecureStore keys must match /^[A-Za-z0-9._-]+$/, and an invalid one throws
    // rather than returning null.
    await s.setItem('weird key/with:chars', 'v');
    for (const k of mockStore.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(await s.getItem('weird key/with:chars')).toBe('v');
  });
});
