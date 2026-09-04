/**
 * The free-tier fixture.
 *
 * The demo wedding is 180 guests, which lands it on the Event plan where
 * nothing is capped -- so the whole entitlements layer is invisible against it.
 * This seed sits right against every free-tier boundary instead:
 *
 *   1 of 1 folders   -> "+ New folder" is disabled
 *   98 of 100 photos -> two more uploads reach the cap
 *   3 of 10 guests   -> joining still works
 *   1 of 1 hosts     -> "+ Add host" is disabled
 *   no moderation    -> uploads auto-approve, host Photos shows an upgrade card
 *   no DJ queue      -> host DJ tab is a read-only ranked list
 */
import type { Seed } from '../MemoryRepository';

const DAY = '2026-11-08';
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

export const housePartySeed: Seed = {
  event: {
    id: 'evt_house',
    code: 'HP0842',
    name: 'Taco night',
    venue: 'The flat',
    startsAt: at('19:00'),
    timezone: 'America/New_York',
    doorsLabel: 'Sat, Nov 8 · 7:00 PM · The flat',
    tier: 'house_party',
    activeFolderId: 'fld_all',
    nowScheduleItemId: 'sch_h2',
    guestCount: 3,
    invitedCount: 8,
  },
  hosts: [{ id: 'hst_sam', displayName: 'Sam', role: 'host', roleLabel: 'Host' }],
  broadcasts: [
    {
      id: 'bch_1', authorHostId: 'hst_sam', authorName: 'Sam', authorRoleLabel: 'Host',
      kind: 'announcement', pinned: false, seenCount: 3, createdAt: at('19:05'),
      body: 'Tacos are out. Salsa is hot, the green one is hotter.',
    },
  ],
  schedule: [
    { id: 'sch_h1', position: 1, timeLabel: '7:00 PM', title: 'Doors', place: 'The flat', startedAt: at('19:00') },
    { id: 'sch_h2', position: 2, timeLabel: '7:30 PM', title: 'Tacos', place: 'Kitchen', startedAt: at('19:30') },
    { id: 'sch_h3', position: 3, timeLabel: '9:00 PM', title: 'Records', place: 'Front room', startedAt: null },
  ],
  requests: [
    { id: 'reqh_1', title: 'Tainted Love', artist: 'Soft Cell', requestedByName: 'Nia', requestedByGuestId: 'gst_nia', status: 'pending', voteCount: 3, createdAt: at('19:40') },
    { id: 'reqh_2', title: 'Just Like Heaven', artist: 'The Cure', requestedByName: 'you', requestedByGuestId: 'gst_me', status: 'pending', voteCount: 2, createdAt: at('19:42') },
  ],
  myGuestId: 'gst_me',
  myVotes: ['reqh_2'],
  nowPlaying: null,
  folders: [{ id: 'fld_all', name: 'Tonight', position: 1, photoCount: 98 }],
  pendingPhotos: [],
  nextPhotoSeq: 1,
};
