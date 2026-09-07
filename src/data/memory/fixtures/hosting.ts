import type { Seed } from '../MemoryRepository';

import { emptySeed } from './empty';

/**
 * A HOST WHO CAME BACK -- the state #17 exists for, and the one no world could reach.
 *
 * She has made two parties and is standing in neither. That is not a contrived corner: the
 * anonymous session persists across restarts, so every host who closes the app is here the
 * next time she opens it. `event.current` is null exactly as `emptySeed` has it, because
 * `events_read` admits members and she has not opened one yet.
 *
 * `weddingSeed` cannot stand in for this. It has an event, so its join screen is an
 * INVITATION and the list is a secondary control there; here the list is the only thing on
 * the screen that leads anywhere, which is the whole point of the issue.
 */
export const hostingSeed: Seed = {
  ...emptySeed,
  hosted: [
    {
      id: 'evt_wedding',
      code: 'SR1017',
      name: "Sam & Riley's Wedding",
      venue: 'Willow Barn',
      startsAt: '2026-10-17T20:00:00.000Z',
      timezone: 'America/New_York',
      doorsLabel: 'Doors 4:00 PM',
      role: 'host',
      roleLabel: 'Bride',
      guestCount: 172,
    },
    {
      id: 'evt_rehearsal',
      code: 'RH2210',
      name: 'Rehearsal Dinner',
      venue: 'The Old Mill',
      startsAt: '2026-10-16T22:30:00.000Z',
      timezone: 'America/New_York',
      doorsLabel: 'Doors 6:30 PM',
      role: 'host',
      roleLabel: 'Bride',
      guestCount: 24,
    },
  ],
};
