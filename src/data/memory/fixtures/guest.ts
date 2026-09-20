import type { Seed } from '../MemoryRepository';
import { weddingSeed } from './wedding';

/**
 * THE WEDDING, SEEN BY SOMEBODY WHO IS ONLY A GUEST -- `?guest=1`, #76.
 *
 * Every other seed in this adapter answers `holdsHostSeat: true`, deliberately: the fixtures
 * are a host and a guest in one process, which is what lets the harness reach the host
 * artboards through `RoleSwitch`. The cost stayed invisible until the supply side needed a
 * control drawn for people who are NOT staff. **No journey could render a plain guest**, so
 * "Want your own? →" was unreachable in the only lane that can screenshot a screen, and
 * deleting it left the whole board green.
 *
 * Same shape as `?empty=1` and `?stale=1` before it. The failure is never "the control is
 * broken", it is "the harness cannot reach the world where the control matters" -- and the
 * fix is a world, not an exemption.
 *
 * IT IS THE WEDDING, not a new party, so nothing else in the suite has to learn a second set
 * of names, a second code or a second headcount. The one difference is the one under test:
 * this person is a guest at it and nothing more.
 */
export const guestSeed: Seed = {
  ...weddingSeed,
  holdsHostSeat: false,
  /**
   * AND SHE RUNS NOTHING. `hosted` carries the wedding's own host seats in `weddingSeed`,
   * and a person who holds none of them must not be shown the list of them -- that is the
   * same claim `MyEventsList` makes by drawing nothing for a guest who hosts nothing.
   */
  hosted: [],
  /**
   * AND SHE IS A GUEST AT ANOTHER PARTY, which is the state #76 creates and the only one
   * lane B can render a guest ROW in. `closeEvent` in this adapter keeps `event.current`
   * set -- the join screen still draws the invitation after you leave -- and that screen's
   * list passes `hideCurrent`, so the party you just stepped out of is the one row it will
   * never show. A second seat is not a workaround for that: it is what "every party you are
   * in" means the moment somebody goes to two.
   */
  joined: [
    {
      id: 'evt_sat',
      code: 'BD4417',
      name: "Marco's birthday",
      venue: 'The Lighthouse',
      startsAt: '2026-10-24T23:00:00.000Z',
      timezone: 'America/New_York',
      doorsLabel: 'Doors 7:00 PM',
      seat: 'guest',
      // Null, never an invented title: she holds no grade and no printed label there.
      role: null,
      roleLabel: null,
      guestCount: 38,
    },
  ],
};
