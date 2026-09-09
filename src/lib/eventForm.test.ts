import { deviceZone, zoneChoices } from './eventForm';

/**
 * THE ZONE A NEW EVENT STARTS IN.
 *
 * These assertions have to MOCK the phone's zone rather than read the machine's, and that
 * is the whole reason the file exists. CI and the checks container both run in UTC, so a
 * test that simply called `deviceZone()` and compared it to something would agree with a
 * broken implementation and a correct one equally -- the exact shape of gate this repo
 * keeps finding switched on and measuring nothing.
 */
const asZone = (zone: string) =>
  jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ timeZone: zone } as Intl.ResolvedDateTimeFormatOptions);

afterEach(() => jest.restoreAllMocks());

describe('deviceZone', () => {
  it('is what the phone says, not what the machine running the tests says', () => {
    asZone('America/Chicago');
    expect(deviceZone()).toBe('America/Chicago');
  });

  it('falls back to UTC when resolvedOptions throws rather than having no zone', () => {
    jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('no ICU');
    });
    expect(deviceZone()).toBe('UTC');
  });
});

describe('zoneChoices', () => {
  it('still opens an existing event on its OWN zone, which is why it cannot seed a new one', () => {
    asZone('America/Chicago');
    // The contract that must not break: `current` first, so opening the form never moves
    // an event to whichever zone happened to be listed first.
    expect(zoneChoices('Europe/Berlin')[0]).toBe('Europe/Berlin');
  });

  it('offers this phone right after the event, then the common list', () => {
    asZone('America/Chicago');
    expect(zoneChoices('Europe/Berlin').slice(0, 2)).toEqual(['Europe/Berlin', 'America/Chicago']);
  });

  it('lists a zone once when the event is already on this phone', () => {
    asZone('America/Chicago');
    const zones = zoneChoices('America/Chicago');
    expect(zones.filter((z) => z === 'America/Chicago')).toHaveLength(1);
  });

  /**
   * THE REGRESSION, pinned. `CreateEventScreen` seeded a new event from
   * `zoneChoices('UTC')[0]`, which is the literal 'UTC' no matter where the phone is --
   * because `current` comes first by design. Every event created without touching the
   * picker was therefore stored as UTC, and `formatClock` renders the EVENT's zone rather
   * than the reader's, so a 6pm party read 10:00 PM to everyone at it.
   */
  it('zoneChoices("UTC") starts with UTC even in Chicago, so it can never be the seed', () => {
    asZone('America/Chicago');
    expect(zoneChoices('UTC')[0]).toBe('UTC');
    expect(deviceZone()).toBe('America/Chicago');
  });
});
