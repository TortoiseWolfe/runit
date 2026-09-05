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
import { wallClockToInstant } from '@/lib/format';

import type { Seed } from '../MemoryRepository';
import { previewOf } from './preview';

/**
 * The seeded event happened YESTERDAY, and that is load-bearing.
 *
 * This used to be a hardcoded '2026-10-17' -- a date six weeks in the FUTURE. The
 * feed sorts pinned-first then ascending by `createdAt`, so a host's brand-new
 * broadcast (stamped `now()`) sorted ABOVE all three seeded ones in the guest's
 * Chat, and BELOW them in the host's Sent list, which reverses the same array.
 * Starting a run-of-show item did the same thing with its auto-broadcast.
 *
 * Neither lane could see it. Every unit test injects a fixed `now` of
 * 2026-10-17T20:00Z -- i.e. AFTER the old seed date, the one case where ordering
 * is correct -- and the e2e ordering assertion only checks `indexOf > 0` while the
 * Now/Next card holds index 0.
 *
 * The nastiest part: a fixed future date SELF-HEALS. On 2026-10-17 the bug would
 * have vanished with nothing fixed and no one any wiser. Anchoring to yesterday is
 * correct on every future run instead of on all but one.
 *
 * `doorsLabel` no longer carries the date. It used to read the canvas's whole
 * subtitle -- "Sat, Oct 17 · Doors 4:00 PM · Willow Barn" -- because nothing could
 * derive a day or repeat a venue. `formatEventDate` can, so the label is now just the
 * doors line and the invitation composes the three parts itself. That also means the
 * date it shows finally MOVES with this constant instead of contradicting it.
 */
const DAY = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);

/** The venue's zone. Every seeded clock string below is wall-clock IN THIS ZONE. */
const ZONE = 'America/New_York';

/**
 * '16:10' as a wall-clock time at the venue -> a true UTC instant.
 *
 * These used to be written `${DAY}T${hhmm}:00.000Z` -- i.e. UTC pretending to be
 * venue time, which only rendered correctly because formatClock also read UTC.
 * Two wrongs cancelling. Now the seed says what it means and the formatter does
 * the conversion, so a runtime instant and a seeded one are finally the same kind
 * of value.
 *
 * The conversion itself now lives in `src/lib/format.ts`, because a host setting a
 * date performs exactly the same one and two copies of it would drift. This fixture
 * is where it was written and proven on Hermes; it just is not fixture-only any more.
 */
const at = (hhmm: string) => wallClockToInstant(DAY, hhmm, ZONE);

/**
 * The canvas is internally inconsistent about time: the event is dated in the
 * future ("Sat, Oct 17") while its content is mid-reception ("3 min ago").
 * It gets away with that because every timestamp is a hardcoded string.
 *
 * Broadcast and schedule times stay absolute -- they are wall-clock labels and
 * read the same whenever you look. The approval queue is genuinely relative, so
 * it is anchored to real time; otherwise every row reads "just now".
 */
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export const weddingSeed: Seed = {
  event: {
    id: 'evt_wedding',
    code: 'SR1017',
    name: "Sam & Riley's Wedding",
    venue: 'Willow Barn',
    startsAt: at('16:00'),
    timezone: ZONE,
    doorsLabel: 'Doors 4:00 PM',
    tier: 'event',
    activeFolderId: 'fld_reception',
    nowScheduleItemId: 'sch_4',
    guestCount: 172,
    invitedCount: 180,
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
    { id: 'req_4', title: 'Yeah!', artist: 'Usher', requestedByName: 'Devon', requestedByGuestId: 'gst_devon', status: 'pending', voteCount: 18, createdAt: at('19:08') },
    { id: 'req_5', title: 'Sweet Caroline', artist: 'Neil Diamond', requestedByName: 'Grandpa Lou', requestedByGuestId: 'gst_lou', status: 'pending', voteCount: 12, createdAt: at('19:09') },
    { id: 'req_6', title: 'Espresso', artist: 'Sabrina Carpenter', requestedByName: 'Maya', requestedByGuestId: 'gst_maya', status: 'pending', voteCount: 9, createdAt: at('19:10') },
  ],
  /**
   * The demo guest arrives having done NOTHING, because that is what arriving is.
   *
   * The canvas seeds `mine: true` on Yeah!, and this used to honour that with
   * `requestedByName: 'you'` and a pre-cast vote. The result was that a guest who
   * joined as "Ada" was immediately shown "Your request is #4 in the queue" and a
   * filled vote button for a song by Usher she had never heard of. For a demo that
   * is confusing; for a first impression of a photo-sharing app it reads as
   * "this thing has other people's data in it".
   *
   * Both states are still reachable -- by requesting a song and by voting, which
   * is how a guest reaches them in reality. FIDELITY note O.
   */
  myGuestId: 'gst_me',
  myVotes: [],
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
    localUri: null, progress: null, failureReason: null, storagePath: null,
    createdAt: at('19:0' + ((i % 9) + 0)),
  })),
  pendingPhotos: [
    { id: 'pho_1', folderId: 'fld_reception', uploadedByGuestId: 'gst_priya', uploadedByName: 'Priya', status: 'pending', hue: 30, localUri: null, progress: null, failureReason: null, storagePath: null, createdAt: minutesAgo(0) },
    { id: 'pho_2', folderId: 'fld_reception', uploadedByGuestId: 'gst_tom', uploadedByName: 'Tom', status: 'pending', hue: 200, localUri: null, progress: null, failureReason: null, storagePath: null, createdAt: minutesAgo(1) },
    { id: 'pho_3', folderId: 'fld_reception', uploadedByGuestId: 'gst_lou', uploadedByName: 'Grandpa Lou', status: 'pending', hue: 120, localUri: null, progress: null, failureReason: null, storagePath: null, createdAt: minutesAgo(3) },
  ],
  /** Canvas: nextPending starts at 4, and hue = (nextPending * 67) % 360. */
  preview: null, // filled below -- it derives from the event above.
  nextPhotoSeq: 4,
};

// Derived rather than written out, so a code can never preview as one thing and join
// as another. Assigned after the literal because it reads the event out of it.
weddingSeed.preview = previewOf(weddingSeed.event!);
