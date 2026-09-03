/**
 * The canvas's seed state, transcribed.
 *
 * "Sam & Riley's Wedding · 180 guests". Every number here comes from the
 * `state = {...}` block in design/Runit.dc.html -- 3 broadcasts, 6 song
 * requests, 3 folders (38/112/97, Reception active), 3 pending photo
 * approvals, 6 run-of-show items with the cursor on index 3, code SR1017.
 *
 * The canvas's bare clock strings ('4:10 PM') become instants on the event
 * date, so the feed can actually sort. Run-of-show keeps wall-clock labels,
 * because that is genuinely what a schedule board shows.
 */
import type { Seed } from '../MemoryRepository';

/** Sat, Oct 17. The canvas gives a weekday and a date but no year. */
const DAY = '2026-10-17';
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

export const weddingSeed: Seed = {
  event: {
    id: 'evt_wedding',
    code: 'SR1017',
    name: "Sam & Riley's Wedding",
    venue: 'Willow Barn',
    startsAt: at('16:00'),
    doorsLabel: 'Sat, Oct 17 · Doors 4:00 PM · Willow Barn',
    tier: 'event',
    activeFolderId: 'fld_reception',
    nowScheduleItemId: 'sch_4',
    guestCount: 172,
  },
  hosts: [
    { id: 'hst_riley', displayName: 'Riley', role: 'host', roleLabel: 'Bride' },
    { id: 'hst_jordan', displayName: 'Jordan', role: 'planner', roleLabel: 'Planner' },
    { id: 'hst_marco', displayName: 'DJ Marco', role: 'dj', roleLabel: 'DJ' },
  ],
  broadcasts: [
    {
      id: 'bc_1', authorHostId: 'hst_jordan', authorName: 'Jordan', authorRoleLabel: 'Planner',
      kind: 'announcement', pinned: false, seenCount: 162, createdAt: at('16:10'),
      body: 'Welcome! Ceremony starts at 4:30 on the lawn. Grab a seat on either side, there are no sides today.',
    },
    {
      id: 'bc_2', authorHostId: 'hst_riley', authorName: 'Riley', authorRoleLabel: 'Bride',
      kind: 'announcement', pinned: false, seenCount: 171, createdAt: at('17:45'),
      body: 'We did it!! Cocktails are on the terrace. Photos tab is open, please flood it.',
    },
    {
      id: 'bc_3', authorHostId: 'hst_marco', authorName: 'DJ Marco', authorRoleLabel: 'DJ',
      kind: 'announcement', pinned: false, seenCount: 158, createdAt: at('19:02'),
      body: 'Requests are open in the Music tab. Upvote what you want to hear; top of the queue plays next.',
    },
  ],
  schedule: [
    { id: 'sch_1', position: 1, timeLabel: '4:00 PM', title: 'Doors open', place: 'Barn', startedAt: at('16:00') },
    { id: 'sch_2', position: 2, timeLabel: '4:30 PM', title: 'Ceremony', place: 'Lawn', startedAt: at('16:30') },
    { id: 'sch_3', position: 3, timeLabel: '5:30 PM', title: 'Cocktails', place: 'Terrace', startedAt: at('17:30') },
    { id: 'sch_4', position: 4, timeLabel: '6:45 PM', title: 'Dinner + toasts', place: 'Barn', startedAt: at('18:45') },
    { id: 'sch_5', position: 5, timeLabel: '8:00 PM', title: 'First dance, then open floor', place: 'Barn', startedAt: null },
    { id: 'sch_6', position: 6, timeLabel: '11:30 PM', title: 'Shuttle to hotel', place: 'Barn doors', startedAt: null },
  ],
  requests: [
    { id: 'req_1', title: 'Dancing Queen', artist: 'ABBA', requestedByName: 'Priya', requestedByGuestId: 'gst_priya', status: 'accepted', voteCount: 41, createdAt: at('19:05') },
    { id: 'req_2', title: 'Mr. Brightside', artist: 'The Killers', requestedByName: 'Tom', requestedByGuestId: 'gst_tom', status: 'pending', voteCount: 37, createdAt: at('19:06') },
    { id: 'req_3', title: 'Levitating', artist: 'Dua Lipa', requestedByName: 'Aunt Jo', requestedByGuestId: 'gst_jo', status: 'pending', voteCount: 29, createdAt: at('19:07') },
    { id: 'req_4', title: 'Yeah!', artist: 'Usher', requestedByName: 'you', requestedByGuestId: 'gst_me', status: 'pending', voteCount: 18, createdAt: at('19:08') },
    { id: 'req_5', title: 'Sweet Caroline', artist: 'Neil Diamond', requestedByName: 'Grandpa Lou', requestedByGuestId: 'gst_lou', status: 'pending', voteCount: 12, createdAt: at('19:09') },
    { id: 'req_6', title: 'Espresso', artist: 'Sabrina Carpenter', requestedByName: 'Maya', requestedByGuestId: 'gst_maya', status: 'pending', voteCount: 9, createdAt: at('19:10') },
  ],
  /** The canvas seeds `mine: true` on Yeah! -- so the demo guest owns req_4. */
  myGuestId: 'gst_me',
  myVotes: ['req_4'],
  nowPlaying: { title: 'September', artist: 'Earth, Wind & Fire', fromRequestId: null, startedAt: at('19:00') },
  folders: [
    { id: 'fld_getting_ready', name: 'Getting ready', position: 1, photoCount: 38 },
    { id: 'fld_ceremony', name: 'Ceremony', position: 2, photoCount: 112 },
    { id: 'fld_reception', name: 'Reception', position: 3, photoCount: 97 },
  ],
  /**
   * The canvas draws nine album tiles from `Array.from({length: 9})` -- they are
   * not photos, just coloured squares, and its state holds no approved photo
   * records at all. Nine real approved rows are seeded here so the album grid
   * has something true to render. Reception's 97 includes them.
   */
  approvedPhotos: [30, 200, 120, 280, 60, 340, 170, 20, 240].map((hue, i) => ({
    id: `phoa_${i + 1}`,
    folderId: 'fld_reception',
    uploadedByGuestId: null,
    uploadedByName: ['Priya', 'Tom', 'Maya', 'Aunt Jo', 'Grandpa Lou', 'Nia', 'Sam', 'Riley', 'Jordan'][i]!,
    status: 'approved' as const,
    hue,
    storagePath: null,
    createdAt: at('19:0' + ((i % 9) + 0)),
  })),
  pendingPhotos: [
    { id: 'pho_1', folderId: 'fld_reception', uploadedByGuestId: 'gst_priya', uploadedByName: 'Priya', status: 'pending', hue: 30, storagePath: null, createdAt: at('19:12') },
    { id: 'pho_2', folderId: 'fld_reception', uploadedByGuestId: 'gst_tom', uploadedByName: 'Tom', status: 'pending', hue: 200, storagePath: null, createdAt: at('19:11') },
    { id: 'pho_3', folderId: 'fld_reception', uploadedByGuestId: 'gst_lou', uploadedByName: 'Grandpa Lou', status: 'pending', hue: 120, storagePath: null, createdAt: at('19:09') },
  ],
  /** Canvas: nextPending starts at 4, and hue = (nextPending * 67) % 360. */
  nextPhotoSeq: 4,
};
