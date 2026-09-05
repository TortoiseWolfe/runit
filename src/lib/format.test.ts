import {
  formatClock,
  formatEventDate,
  initialsFor,
  formatRelative,
  wallClockToInstant,
  instantToWallClock,
} from './format';

describe('formatClock', () => {
  // Pinned in UTC so these stay assertions about the FORMATTER, not about a zone.
  // The zoned behaviour is covered separately below.
  it('reproduces the canvas broadcast times', () => {
    expect(formatClock('2026-10-17T16:10:00.000Z', 'UTC')).toBe('4:10 PM');
    expect(formatClock('2026-10-17T17:45:00.000Z', 'UTC')).toBe('5:45 PM');
    expect(formatClock('2026-10-17T19:02:00.000Z', 'UTC')).toBe('7:02 PM');
  });
  it('handles noon and midnight without a 0 o clock', () => {
    expect(formatClock('2026-10-17T12:00:00.000Z', 'UTC')).toBe('12:00 PM');
    expect(formatClock('2026-10-17T00:05:00.000Z', 'UTC')).toBe('12:05 AM');
  });
});

describe('formatClock · the event zone, not the phone', () => {
  // The bug this replaced: formatClock read getUTCHours(), which is right only
  // for seed data authored as UTC wall-clock. A host in Chattanooga posting at
  // 7:02 PM EDT saw their own broadcast stamped 11:02 PM.
  it('renders an instant in the venue zone', () => {
    // 23:02Z on a summer date is 7:02 PM in New York (EDT, -04:00).
    expect(formatClock('2026-09-03T23:02:00.000Z', 'America/New_York')).toBe('7:02 PM');
  });

  it('follows the zone across DST rather than a fixed offset', () => {
    // Same wall-clock hour, winter: EST is -05:00, so the instant differs by one.
    expect(formatClock('2026-01-15T00:02:00.000Z', 'America/New_York')).toBe('7:02 PM');
  });

  it('is independent of the phone, which is the whole point', () => {
    const iso = '2026-09-03T23:02:00.000Z';
    expect(formatClock(iso, 'America/New_York')).toBe('7:02 PM');
    expect(formatClock(iso, 'Europe/London')).toBe('12:02 AM');
  });
});

describe('initialsFor', () => {
  it('matches every avatar the canvas draws', () => {
    expect(initialsFor('Jordan')).toBe('J');
    expect(initialsFor('Riley')).toBe('R');
    expect(initialsFor('DJ Marco')).toBe('DJ');
  });
  it('copes with an empty name', () => {
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-17T19:12:00.000Z');
  it('reproduces the canvas approval-queue labels', () => {
    expect(formatRelative('2026-10-17T19:12:00.000Z', 'UTC', now)).toBe('just now');
    expect(formatRelative('2026-10-17T19:11:00.000Z', 'UTC', now)).toBe('1 min ago');
    expect(formatRelative('2026-10-17T19:09:00.000Z', 'UTC', now)).toBe('3 min ago');
  });
  it('falls back to a clock time after an hour', () => {
    expect(formatRelative('2026-10-17T16:10:00.000Z', 'UTC', now)).toBe('4:10 PM');
  });
});

describe('formatEventDate', () => {
  it('reproduces the date the canvas hand-wrote into doorsLabel', () => {
    // 'Sat, Oct 17 · Doors 4:00 PM · Willow Barn' was one string because nothing
    // could derive the first third of it. This is that third.
    expect(formatEventDate('2026-10-17T20:00:00.000Z', 'America/New_York')).toBe('Sat, Oct 17');
  });

  it('reads the date in the EVENT zone, so a late night is still that night', () => {
    // 2:00 AM UTC on the 12th is still 10 PM on the 11th at the venue. A guest at
    // the party must not see the invitation flip to tomorrow at 8 in the evening.
    const lateEvening = '2026-09-12T02:00:00.000Z';
    expect(formatEventDate(lateEvening, 'America/New_York')).toBe('Fri, Sep 11');
    expect(formatEventDate(lateEvening, 'Europe/London')).toBe('Sat, Sep 12');
  });
});

describe('wallClockToInstant', () => {
  const NY = 'America/New_York';

  it('reads the time on the door sign in the venue zone, not UTC', () => {
    // Doors 7:00 PM on a summer evening in New York is 23:00Z (EDT, -04:00).
    expect(wallClockToInstant('2026-09-11', '19:00', NY)).toBe('2026-09-11T23:00:00.000Z');
  });

  it('follows the zone across DST rather than a fixed offset', () => {
    // The same wall clock in winter is an hour later in UTC (EST, -05:00), and it
    // crosses midnight into the next day.
    expect(wallClockToInstant('2026-01-15', '19:00', NY)).toBe('2026-01-16T00:00:00.000Z');
  });

  // THE TEST THAT FAILS IF THE SECOND PASS IS EVER "SIMPLIFIED" AWAY.
  //
  // The naive guess treats the wall clock as UTC, which for New York lands about
  // five hours from the true instant -- so when a DST transition falls inside that
  // window, the offset read at the guess is the wrong one. Spring forward 2026 is
  // 2026-03-08 at 07:00Z. Asking for 3:00 AM that morning, a single pass returns
  // 08:00Z, which reads back as 4:00 AM: an hour wrong, silently, once a year.
  it('lands on the right side of a spring-forward transition', () => {
    expect(wallClockToInstant('2026-03-08', '03:00', NY)).toBe('2026-03-08T07:00:00.000Z');
    expect(instantToWallClock('2026-03-08T07:00:00.000Z', NY).time).toBe('03:00');
  });

  it('works east of UTC, where the correction has the opposite sign', () => {
    expect(wallClockToInstant('2026-09-11', '19:00', 'Australia/Sydney')).toBe(
      '2026-09-11T09:00:00.000Z',
    );
    expect(wallClockToInstant('2026-09-11', '19:00', 'Asia/Kolkata')).toBe(
      '2026-09-11T13:30:00.000Z',
    );
  });

  it('rejects something that is not a date and a time', () => {
    expect(() => wallClockToInstant('not-a-date', '19:00', NY)).toThrow(RangeError);
  });

  // Documented rather than pretended away. 2:30 AM does not exist on the morning
  // the clocks go forward, so no instant round-trips to it; this settles on the
  // hour before. The place to refuse an impossible time is the form.
  it('settles on a neighbour for a wall clock that does not exist', () => {
    const t = wallClockToInstant('2026-03-08', '02:30', NY);
    expect(instantToWallClock(t, NY).time).toBe('01:30');
  });
});

describe('instantToWallClock', () => {
  const NY = 'America/New_York';

  it('round-trips a wall clock through an instant and back', () => {
    for (const [date, time] of [
      ['2026-09-11', '19:00'],
      ['2026-01-15', '19:00'],
      ['2026-03-09', '19:00'],
    ] as const) {
      expect(instantToWallClock(wallClockToInstant(date, time, NY), NY)).toEqual({ date, time });
    }
  });

  it('reports midnight as 00:00, which hour12:false does not', () => {
    // formatToParts returns '24' for midnight under hour12:false -- a correct
    // reading of the instant and an invalid value to put in a form field.
    expect(instantToWallClock('2026-09-11T04:00:00.000Z', NY)).toEqual({
      date: '2026-09-11',
      time: '00:00',
    });
  });
});
