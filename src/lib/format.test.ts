import { formatClock, initialsFor, formatRelative } from './format';

describe('formatClock', () => {
  it('reproduces the canvas broadcast times', () => {
    expect(formatClock('2026-10-17T16:10:00.000Z')).toBe('4:10 PM');
    expect(formatClock('2026-10-17T17:45:00.000Z')).toBe('5:45 PM');
    expect(formatClock('2026-10-17T19:02:00.000Z')).toBe('7:02 PM');
  });
  it('handles noon and midnight without a 0 o clock', () => {
    expect(formatClock('2026-10-17T12:00:00.000Z')).toBe('12:00 PM');
    expect(formatClock('2026-10-17T00:05:00.000Z')).toBe('12:05 AM');
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
    expect(formatRelative('2026-10-17T19:12:00.000Z', now)).toBe('just now');
    expect(formatRelative('2026-10-17T19:11:00.000Z', now)).toBe('1 min ago');
    expect(formatRelative('2026-10-17T19:09:00.000Z', now)).toBe('3 min ago');
  });
  it('falls back to a clock time after an hour', () => {
    expect(formatRelative('2026-10-17T16:10:00.000Z', now)).toBe('4:10 PM');
  });
});
