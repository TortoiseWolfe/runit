import { wallClockToInstant } from './format';

/**
 * The logic behind the two screens that edit an event's when and where.
 *
 * `/host/event` corrects an existing event and `/create` makes a new one, and they ask
 * for the same things in the same way. Only the LOGIC is shared, not the markup: the two
 * screens have different chrome, different buttons and different stakes, and a shared
 * component would end up carrying a `mode` prop that neither reads well. What is
 * genuinely identical is the zone list and turning three fields into an instant.
 */

/**
 * Zones a host can pick from, plus wherever this phone thinks it is.
 *
 * NOT `Intl.supportedValuesOf('timeZone')`. It would be the complete answer and its
 * Hermes support is unverified here -- and "works on web, wrong on device" is this
 * repo's recurring failure, with FIDELITY note M as the standing example. A short list
 * plus the device's own zone covers the host standing at their own venue, which is
 * nearly all of them, and it degrades to a visible list rather than an empty picker.
 *
 * A host whose venue is in a zone neither common nor local is a real gap, and the honest
 * way to close it is a searchable list rather than a longer constant.
 */
const COMMON_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'UTC',
];

export function zoneChoices(current: string): string[] {
  let device = 'UTC';
  try {
    device = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // A resolvedOptions() that throws is not a reason to render no picker at all.
  }
  // `current` first, so an event's own zone is always offered even when it is neither
  // common nor this phone's. Without that, opening the form would silently move the
  // event to whichever zone happened to be listed first.
  return [...new Set([current, device, ...COMMON_ZONES])];
}

/** 'America/New_York' -> 'New York'. The prefix is noise on a button this size. */
export const zoneLabel = (z: string) => z.split('/').pop()?.replace(/_/g, ' ') ?? z;

/**
 * Three fields -> an instant, or null while they are still being typed.
 *
 * NULL IS NOT AN ERROR. A half-finished date is the ordinary state of a form, not
 * something to colour red, and the reading rendered beside it says what the fields
 * currently mean. What matters is that a date which does not parse never becomes a
 * SAVED one: coercing '11/09/2026' into some instant is how an event lands on the wrong
 * evening, and the wrong evening is what a guest's calendar then holds.
 */
export function instantFrom(date: string, time: string, zone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  try {
    return wallClockToInstant(date, time, zone);
  } catch {
    return null;
  }
}
