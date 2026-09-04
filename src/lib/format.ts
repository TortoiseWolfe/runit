/**
 * Presentation derivations the canvas hardcodes into its seed data.
 */

/**
 * An instant -> '4:10 PM', in the EVENT's timezone.
 *
 * Not the phone's, and no longer UTC. A guest standing in the barn should read
 * the same time as the sign on the door whatever timezone their phone is in --
 * that part was always the intent. What was wrong is that it was implemented as
 * `getUTCHours()`, which is only correct for the seed, whose times were authored
 * as UTC wall-clock. Any instant created at RUNTIME was mis-stamped: a host in
 * Chattanooga posting at 7:02 PM EDT saw their own broadcast dated 11:02 PM.
 *
 * `Intl.DateTimeFormat` with an explicit `timeZone` is the first use of Intl in
 * this app. Hermes has shipped full ICU since RN 0.73 so it resolves on both
 * platforms -- verified on the Android emulator, not assumed, because "works on
 * web, wrong on device" is this repo's recurring failure.
 */
export function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(iso));
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

/** An instant relative to now -> 'just now' / '3 min ago', falling back to the clock. */
export function formatRelative(iso: string, timeZone: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  return formatClock(iso, timeZone);
}
