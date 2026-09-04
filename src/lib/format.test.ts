import { formatClock, initialsFor, formatRelative } from './format';

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
