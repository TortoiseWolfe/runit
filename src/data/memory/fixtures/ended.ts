/**
 * THE PARTY THAT IS OVER -- and no fixture could reach it until #41 made "over" mean
 * something.
 *
 * `tier_limits.event_ttl_hours` is 168 on `house_party`, so a free event stops taking new
 * things a week after it starts. Every other seed is deliberately OPEN:
 *
 *   weddingSeed    yesterday, `event` tier    -- no expiry on any paid tier
 *   freshSeed      tonight, `house_party`     -- twenty minutes in
 *   housePartySeed capped but current
 *   emptySeed / invitedSeed                   -- no event at all
 *
 * So without this one, every assertion the suite makes about a write is made in a world
 * where the window happens to be open -- which is precisely the shape that let "Send to 0
 * guests" survive 326 journeys and left `disabled={!event}` shipping three dead controls.
 * The failure is never "the control is wrong", it is "no test can reach the state where
 * the control is wrong".
 *
 * TEN DAYS, NOT EIGHT. The window is 168 hours; a seed sitting just past it would pass
 * today and fail the first time somebody edits the number, and a seed sitting just inside
 * it would silently stop testing anything. Ten is unambiguous at either end.
 *
 * IT IS FURNISHED ON PURPOSE, unlike `freshSeed`. The whole claim of an expired event is
 * that READING NEVER STOPS -- the album is still there to save until #40's retention clock
 * runs out three weeks later. A bare seed could show that writes are refused and could not
 * show that anything survives, which is the half a guest actually cares about.
 */
import { wallClockToInstant } from '@/lib/format';

import type { Seed } from '../MemoryRepository';
import { previewOf } from './preview';

/** Ten days back, anchored to now so it is still ten days back next year. */
const DAY = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString().slice(0, 10);
const ZONE = 'America/New_York';

/** Wall clock AT THE VENUE, never UTC wearing its clothes. FIDELITY note M. */
const at = (hhmm: string) => wallClockToInstant(DAY, hhmm, ZONE);

const event = {
  id: 'evt_ended',
  code: 'OV3R77',
  name: "Dana's leaving do",
  venue: 'The Anchor',
  startsAt: at('19:00'),
  timezone: ZONE,
  doorsLabel: 'Doors 7:00 PM',
  // The only tier `create_event` mints, and the only one with a window (#30, #41).
  tier: 'house_party' as const,
  activeFolderId: 'fld_ended',
  nowScheduleItemId: null,
  guestCount: 6,
  invitedCount: 0,
  photoModeration: false,
};

export const endedSeed: Seed = {
  event,
  preview: previewOf(event),
  hosts: [{ id: 'hst_dana', displayName: 'Dana', role: 'host', roleLabel: 'Host' }],
  broadcasts: [
    {
      id: 'bc_ended_1',
      authorHostId: 'hst_dana',
      authorName: 'Dana',
      authorRoleLabel: 'Host',
      kind: 'announcement' as const,
      body: 'Thanks for coming, everyone. Photos are in the album.',
      pinned: false,
      seenCount: 5,
      createdAt: at('22:40'),
    },
  ],
  schedule: [],
  requests: [
    {
      id: 'req_ended_1',
      title: 'Common People',
      artist: 'Pulp',
      requestedByGuestId: 'gst_ended',
      requestedByName: 'Ada',
      status: 'played' as const,
      voteCount: 4,
      createdAt: at('21:05'),
    },
  ],
  myGuestId: 'gst_ended',
  myVotes: [],
  nowPlaying: null,
  folders: [{ id: 'fld_ended', name: 'All photos', position: 0, photoCount: 1 }],
  pendingPhotos: [],
  approvedPhotos: [
    {
      id: 'pho_ended_1',
      folderId: 'fld_ended',
      uploadedByGuestId: 'gst_ended',
      uploadedByName: 'Ada',
      status: 'approved' as const,
      hue: 212,
      localUri: null,
      storagePath: null,
      thumbPath: null,
      displayUrl: null,
      progress: 1,
      failureReason: null,
      createdAt: at('21:30'),
    },
  ],
  nextPhotoSeq: 2,
};
