// MUST come before `@supabase/supabase-js`. supabase-js builds every request URL
// with the global `URL`, and React Native's own implementation is incomplete --
// notably `searchParams`. The vendor's typings recommend this import by name in
// both of their React Native examples. It is a side-effecting import; the lint
// rule about import order is not worth trading a runtime break on device for.
import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

import { secureSessionStorage } from './secureSessionStorage';

/**
 * The one Supabase client.
 *
 * Configuration is read from `EXPO_PUBLIC_*`, which are compiled INTO the bundle
 * -- correct for both of these. The publishable key's entire job is to be shipped
 * and it grants nothing on its own: RLS and the function grants in
 * `supabase/migrations/` decide everything. Nothing that must stay secret may
 * ever wear an `EXPO_PUBLIC_` prefix.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Fail loudly at construction rather than at the first request.
 *
 * This is not defensive noise: `.env.local` is gitignored and EAS does not upload
 * it, so a cloud build with no `env` block in eas.json compiles `undefined` here
 * and dies on the first network call with a URL parse error naming nothing. That
 * is a real failure mode this repo has to configure around, so it gets a real
 * message.
 */
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local for local runs, and check ` +
        `the "env" block of the build profile in eas.json for EAS builds -- .env.local ` +
        `is gitignored and is NOT uploaded to EAS.`,
    );
  }
  return value;
}

export type RunitClient = SupabaseClient<Database>;

export function createRunitClient(): RunitClient {
  return createClient<Database>(
    requireEnv('EXPO_PUBLIC_SUPABASE_URL', url),
    requireEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', key),
    {
      auth: {
        storage: secureSessionStorage,
        // Persistence is a correctness property, not a convenience: join_event is
        // idempotent on (event_id, auth_user_id), so a restored session lands a
        // returning guest on the SAME row instead of taking a second seat against
        // the event's guest cap.
        persistSession: true,
        autoRefreshToken: true,
        // There is no OAuth redirect to parse. Leaving this on makes supabase-js
        // read window.location, which does not exist on a device.
        detectSessionInUrl: false,
      },
      realtime: {
        // The ceiling is per DELIVERED message, and the schema is already shaped
        // around that -- song_votes is deliberately unpublished so sixty guests
        // voting on six songs costs six messages each rather than sixty. This is
        // the client-side half of the same budget.
        params: { eventsPerSecond: 10 },
      },
    },
  );
}

/**
 * `null` until the app names an implementation in src/app/_layout.tsx. Nothing
 * outside `src/data/supabase/` may import this -- the ESLint no-restricted-imports
 * rule that guards the seam is what makes swapping adapters a checked property.
 */
let client: RunitClient | null = null;

export function supabase(): RunitClient {
  client ??= createRunitClient();
  return client;
}
