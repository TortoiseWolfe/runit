import type { Seed } from '../MemoryRepository';

/**
 * The world before anyone joins, which the harness could not previously build.
 *
 * WHY THIS EXISTS. `events_read` admits members only, so against Supabase
 * `event.current` is null until `joinAsGuest` returns -- SupabaseRepository starts its
 * signal at null and says so. Every e2e journey, though, booted `weddingSeed`, so the
 * screens were only ever rendered with an event present. `disabled={!event}` on the
 * calendar pill, Show QR and Share invite was the dead half of a boolean the suite could
 * only evaluate one way, and join.spec.ts CLICKS that pill and passes.
 *
 * Three device reports found what this fixture finds in one assertion: a guest opening
 * the app cold sees the title fall back to "An event", no date, no venue, and a calendar
 * button that cannot do anything.
 *
 * It is deliberately EMPTY rather than sparse. A seed with an event but no photos tests
 * a different thing; the state that shipped broken is the one with no event at all.
 */
export const emptySeed: Seed = {
  event: null,
  // No event AND no code. `invitedSeed` is the neighbouring world -- no event, but a
  // code from a link that resolves to one.
  preview: null,
  hosts: [],
  broadcasts: [],
  schedule: [],
  requests: [],
  myGuestId: 'g_none',
  myVotes: [],
  nowPlaying: null,
  folders: [],
  pendingPhotos: [],
  approvedPhotos: [],
  nextPhotoSeq: 1,
};
