import { icsFilename, icsFor, joinLink, shareMessage } from './invite';

/**
 * The iCalendar half of this is where the real risk lives. A malformed .ics does NOT
 * error -- the calendar app silently declines to import it, and you find out when a guest
 * says the invite never showed up. None of the other verification lanes can see that:
 * the web harness has no calendar and the emulator would only prove one parser's opinion.
 */

const EVENT = {
  id: 'e1',
  name: "Sam & Riley's Wedding",
  code: 'sr1017',
  venue: 'Willow Barn',
  startsAt: '2026-10-17T20:00:00.000Z',
  doorsLabel: 'Doors 4:00 PM',
};
const FIXED = () => '2026-09-04T12:00:00.000Z';

describe('the join link', () => {
  it('upper-cases and trims the code, matching what join_event does server-side', () => {
    expect(joinLink('  sr1017 ')).toBe('runit://join?code=SR1017');
  });

  it('percent-encodes, so a code can never break the query string', () => {
    expect(joinLink('a b&c')).toBe('runit://join?code=A%20B%26C');
  });
});

describe('the share message', () => {
  it('leads with the CODE, because the link only resolves if Runit is installed', () => {
    const m = shareMessage(EVENT);
    expect(m).toContain('code SR1017');
    expect(m.indexOf('SR1017')).toBeLessThan(m.indexOf('runit://'));
  });

  it('omits the venue line entirely when there is no venue', () => {
    // "at ." reads as a bug rather than as an absence.
    const m = shareMessage({ ...EVENT, venue: '  ', doorsLabel: '' });
    expect(m).not.toMatch(/^\s*·/m);
    expect(m).toContain("You're invited to Sam & Riley's Wedding.");
  });
});

describe('the .ics', () => {
  const ics = () => icsFor(EVENT, FIXED);

  it('has the envelope a calendar app looks for', () => {
    const s = ics();
    for (const k of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'END:VEVENT', 'END:VCALENDAR']) {
      expect(s).toContain(k);
    }
  });

  it('uses CRLF, which the spec requires and some parsers enforce', () => {
    const s = ics();
    expect(s).toContain('\r\n');
    // No bare LF anywhere: every newline must be preceded by a CR.
    expect(/[^\r]\n/.test(s)).toBe(false);
  });

  it('writes times in UTC basic format', () => {
    expect(ics()).toContain('DTSTART:20261017T200000Z');
    expect(ics()).toContain('DTSTAMP:20260904T120000Z');
  });

  it('gives the event a stable UID, so importing twice updates one entry', () => {
    expect(ics()).toContain('UID:e1@runit.app');
    expect(icsFor(EVENT, () => '2027-01-01T00:00:00.000Z')).toContain('UID:e1@runit.app');
  });

  it('ESCAPES commas, semicolons and backslashes in text', () => {
    // Unescaped, a venue called "Smith, Hall" truncates LOCATION at "Smith" -- the
    // property separator swallows the rest of the line.
    const s = icsFor({ ...EVENT, venue: 'Smith, Hall; Rear\\Wing' }, FIXED);
    expect(s).toContain('LOCATION:Smith\\, Hall\; Rear\\\\Wing');
  });

  it('turns a real newline into an escaped one', () => {
    const s = icsFor({ ...EVENT, name: 'Line one\nLine two' }, FIXED);
    expect(s).toContain('SUMMARY:Line one\\nLine two');
    // And it must NOT have introduced a real break inside the property.
    expect(s).not.toContain('SUMMARY:Line one\r\nLine two');
  });

  it('folds lines over 75 OCTETS, continuing with a leading space', () => {
    const s = icsFor({ ...EVENT, name: 'W'.repeat(200) }, FIXED);
    for (const line of s.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(s).toMatch(/\r\n W/);
  });

  it('measures octets rather than characters, so accents and emoji fold correctly', () => {
    // A naive character count produces a file some parsers accept and others reject,
    // which is the worst kind of bug to chase.
    const s = icsFor({ ...EVENT, name: '🎉'.repeat(40) }, FIXED);
    for (const line of s.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('never splits a surrogate pair across a fold', () => {
    const s = icsFor({ ...EVENT, name: '🎉'.repeat(40) }, FIXED);
    // A lone surrogate would survive a round trip as U+FFFD.
    expect(s).not.toContain('�');
    expect((s.match(/🎉/g) ?? []).length).toBe(40);
  });

  it('omits LOCATION rather than emitting an empty one', () => {
    expect(icsFor({ ...EVENT, venue: '   ' }, FIXED)).not.toContain('LOCATION:');
  });

  it('puts the code in the description, since that is what a guest needs later', () => {
    expect(ics()).toContain('SR1017');
  });
});

describe('the filename', () => {
  it('slugs the event name', () => {
    expect(icsFilename(EVENT)).toBe('sam-rileys-wedding.ics');
  });

  it('falls back rather than producing a dotfile', () => {
    // '.ics' with no stem is a hidden file on every unix-ish system.
    expect(icsFilename({ name: '🎉🎉🎉' })).toBe('event.ics');
  });
});
