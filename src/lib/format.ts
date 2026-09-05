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
 * An instant -> 'Fri, Sep 11', in the EVENT's timezone.
 *
 * The date half of formatClock, and it exists because nothing in this app could
 * render a DAY. "Sat, Oct 17" lived only inside `doorsLabel` as a hand-written
 * string, which is why an invitation carried no date the moment the event was
 * not seeded by hand.
 */
export function formatEventDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

/**
 * How far ahead of UTC `timeZone` is at this instant, in milliseconds.
 *
 * formatToParts, NOT `new Date(d.toLocaleString(...))`. The string round-trip is
 * the usual recipe and works fine under Node -- which is why 144 jest tests once
 * passed over it -- but Hermes produces a locale string `Date` cannot parse, and
 * the app died on launch with "Date value out of bounds". Reading numeric parts
 * never round-trips through a parser at all. FIDELITY note M.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  // `hour` can come back as 24 for midnight under hour12:false; % 24 normalises it.
  const wallAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour') % 24,
    part('minute'),
    part('second'),
  );
  return wallAsUtc - instant.getTime();
}

/**
 * '2026-09-11' + '19:00' as wall clock AT THE VENUE -> a true UTC instant.
 *
 * This is the conversion a host performs every time they set a date: they type
 * the time on the door sign, and the event's zone -- never the phone's -- decides
 * what instant that is. Promoted here from `fixtures/wedding.ts`, where it was
 * already proven on Hermes; the fixture now imports it back rather than keeping a
 * second copy that could drift.
 *
 * TWO PASSES, because one is wrong across a DST boundary. We want the instant `t`
 * where `t + offset(t)` equals the wall clock asked for. The first pass uses the
 * offset at the naive guess; if that guess landed on the other side of a
 * transition, the second pass corrects it. Away from a boundary the second pass
 * changes nothing.
 *
 * A wall-clock time that does not exist -- 2:30 AM on a spring-forward day --
 * settles on one of the two neighbouring instants rather than raising. That is a
 * real limit, and the right place to catch it is the form, not here.
 */
export function wallClockToInstant(date: string, time: string, timeZone: string): string {
  const asUtc = new Date(`${date}T${time}:00.000Z`).getTime();
  if (Number.isNaN(asUtc)) throw new RangeError(`not a date and time: ${date} ${time}`);

  let t = asUtc - zoneOffsetMs(new Date(asUtc), timeZone);
  t = asUtc - zoneOffsetMs(new Date(t), timeZone);
  return new Date(t).toISOString();
}

/** The inverse, to fill a form's fields: an instant -> { '2026-09-11', '19:00' }. */
export function instantToWallClock(
  iso: string,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  // `hour` comes back as '24' for midnight under hour12:false, which is a valid
  // reading of the same instant and an invalid value in a form.
  const hour = String(Number(part('hour')) % 24).padStart(2, '0');
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${hour}:${part('minute')}`,
  };
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
