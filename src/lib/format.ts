/**
 * Presentation derivations the canvas hardcodes into its seed data.
 */

/**
 * '2026-10-17T16:10:00.000Z' -> '4:10 PM'
 *
 * Formatted in UTC on purpose. The seeds are authored as venue wall-clock
 * ("Doors 4:00 PM"), and an event's schedule is a wall-clock thing -- a guest
 * standing in the barn should read the same time as the sign on the door,
 * regardless of the phone's timezone. When a real backend lands, this reads
 * event.timezone instead.
 */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * 'Jordan' -> 'J', 'Riley' -> 'R', 'DJ Marco' -> 'DJ'
 *
 * The canvas stores these by hand. An all-caps first token is already an
 * initialism and is kept whole; anything else contributes its first letter.
 */
export function initialsFor(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  if (!first) return '?';
  if (first.length <= 3 && first === first.toUpperCase()) return first;
  return first[0]!.toUpperCase();
}

/** '2026-10-17T19:12:00.000Z' relative to now -> 'just now' / '3 min ago' */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  return formatClock(iso);
}
