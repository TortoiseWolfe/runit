/**
 * THE WORLD EVERY REAL PARTY IS IN, and until now no fixture modelled it.
 *
 * A host made this event in the app twenty minutes ago. She has not built an invitation
 * list -- she sent the code by text, like everyone does -- and people have started
 * arriving. So `invitedCount` is 0 while `guestCount` is not, and that combination is
 * reachable in no other seed:
 *
 *   weddingSeed    180 invited / 172 here   -- a world the product cannot create
 *   housePartySeed   8 invited /   3 here   -- ditto, and capped on every axis
 *   emptySeed        no event                -- the cold open
 *   invitedSeed      no event, a code        -- one step after it
 *
 * That gap is why "Send to 0 guests" survived 326 journeys: `BroadcastPanel` reads
 * `invitedCount`, both seeded fixtures hardcode a non-zero one, and `create_event` mints
 * 0 with no code path anywhere that raises it (`fold_invited_count` fires on `invitees`,
 * and `join_event` never writes one). Every assertion about the composer was therefore
 * made in the only worlds where the number happens to be true.
 *
 * Same shape as `?empty=1`, and the same lesson: the failure was never "one control is
 * wrong", it was "no test can reach the state where the control is wrong".
 *
 * DELIBERATELY THIN. No schedule, no album, no queue, one host and no co-host -- because
 * that is what twenty minutes into a first party looks like, and a furnished fixture is
 * exactly what hid this. Add to it only when a test needs the thing you are adding.
 */
import { wallClockToInstant } from '@/lib/format';

import type { Seed } from '../MemoryRepository';
import { previewOf } from './preview';

const DAY = '2026-09-11';
const ZONE = 'America/New_York';

/** Wall clock AT THE VENUE, never UTC wearing its clothes. FIDELITY note M. */
const at = (hhmm: string) => wallClockToInstant(DAY, hhmm, ZONE);

const event = {
  id: 'evt_fresh',
  code: 'FR3SH1',
  name: "Ruth's 40th",
  venue: 'The garden',
  startsAt: at('19:00'),
  timezone: ZONE,
  doorsLabel: 'Doors 7:00 PM',
  // What `create_event` mints, and the only tier it can mint (#30).
  tier: 'house_party' as const,
  activeFolderId: 'fld_fresh',
  nowScheduleItemId: null,
  /**
   * FOUR PEOPLE ARE HERE AND NOBODY WAS "INVITED".
   *
   * These two numbers are the entire reason this seed exists. `guestCount` moves on
   * `join_event`; `invitedCount` moves only on `invitees`, which this host never built.
   * A fixture that set both would be the furnished world that hid the bug.
   *
   * Four, not one: it has to survive a guest joining during a test without colliding with
   * a hardcoded expectation, and it has to be visibly plural so a fallback rendering "1"
   * cannot be mistaken for correct.
   */
  guestCount: 4,
  invitedCount: 0,
  photoModeration: false,
};

export const freshSeed: Seed = {
  event,
  // Derived from the event rather than written out, so a preview and a join can never
  // disagree about the same code.
  preview: previewOf(event),
  hosts: [{ id: 'hst_ruth', displayName: 'Ruth', role: 'host', roleLabel: 'Host' }],
  // She has not announced anything yet. The composer is the first thing she meets.
  broadcasts: [],
  schedule: [],
  requests: [],
  // A GUEST SESSION, because the composer is reached through the role switch and that is
  // the path a host actually walks. `holdsHostSeat` comes from `hosts`, not from here.
  myGuestId: 'gst_fresh',
  myVotes: [],
  nowPlaying: null,
  folders: [{ id: 'fld_fresh', name: 'All photos', position: 0, photoCount: 0 }],
  pendingPhotos: [],
  approvedPhotos: [],
  nextPhotoSeq: 1,
};
