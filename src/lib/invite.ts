import type { RunitEvent } from '@/data/types';

/**
 * Turning an event into something you can hand to a person: a link, a message, and a
 * calendar file.
 *
 * PURE ON PURPOSE. No React, no Expo, no platform. Everything here is a string in and a
 * string out, because the parts that are easy to get subtly wrong -- iCalendar escaping
 * and line folding -- are exactly the parts a device test cannot see. A malformed .ics
 * does not error; the calendar app simply declines to import it, and you find out when a
 * guest says nothing arrived.
 */

/**
 * The deep link. `src/app/join.tsx` reads `code` from the query string.
 *
 * A CUSTOM SCHEME, WITH A KNOWN LIMIT: it only resolves on a phone that already has Runit
 * installed. To anyone else it is a dead string, which is why every share below leads with
 * the CODE and treats the link as a convenience rather than the payload. A universal
 * https link needs an apple-app-site-association file, and `runit-legal` is already
 * positioned to serve one -- that is the upgrade, not a rewrite of this.
 */
export function joinLink(code: string): string {
  return `runit://join?code=${encodeURIComponent(code.trim().toUpperCase())}`;
}

/** What goes in the message body when a host shares an event. */
export function shareMessage(event: Pick<RunitEvent, 'name' | 'code' | 'venue' | 'doorsLabel'>): string {
  const lines = [
    `You're invited to ${event.name}.`,
    '',
    `Join in Runit with code ${event.code.toUpperCase()}`,
  ];
  // Only include what the event actually has. An empty "at ." reads as a bug.
  if (event.venue.trim()) lines.push(`${event.venue}${event.doorsLabel.trim() ? ` · ${event.doorsLabel}` : ''}`);
  lines.push('', joinLink(event.code));
  return lines.join('\n');
}

/* ------------------------------------------------------------------ iCalendar */

/**
 * RFC 5545 §3.3.11: backslash, semicolon and comma are escaped, and a literal newline
 * becomes `\n`. Miss any one and the property silently swallows the rest of the line --
 * a venue called "Smith, Hall" would truncate the location at "Smith".
 */
function escapeText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: no line may exceed 75 OCTETS, and a continuation begins with one space.
 *
 * Octets, not characters -- so this measures UTF-8 bytes. An event named with emoji or
 * accents folds sooner than its length suggests, and a naive character count produces a
 * file that some parsers accept and others reject, which is the worst kind of bug to
 * chase.
 */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  // Iterating by code point, not by UTF-16 unit, so a surrogate pair is never split in
  // half -- half a pair is not a character and breaks the file.
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    // 74 leaves room for the leading space every continuation line carries.
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + chBytes > limit) {
      out.push(cur);
      cur = ch;
      curBytes = chBytes;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  if (cur) out.push(cur);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join('\r\n');
}

/** iCalendar UTC form: 20261017T200000Z. */
function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * A single-event calendar file.
 *
 * WHY A FILE RATHER THAN expo-calendar. Writing to the user's calendar needs a calendar
 * PERMISSION, and Runit does not otherwise want one. Handing over an .ics asks for
 * nothing, works with whatever calendar app they actually use, and is a string plus a
 * temp file. FIDELITY note K already argues Runit should not request a permission it does
 * not need; this is the same reasoning applied again.
 *
 * `now` is injectable because DTSTAMP is "when this file was made" and a test that cannot
 * fix it cannot assert the output.
 */
export function icsFor(
  event: Pick<RunitEvent, 'id' | 'name' | 'code' | 'venue' | 'startsAt' | 'doorsLabel'>,
  now: () => string = () => new Date().toISOString(),
): string {
  const description = [
    `Join in Runit with code ${event.code.toUpperCase()}`,
    event.doorsLabel.trim(),
    joinLink(event.code),
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Runit//Event Companion//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable per event, so importing twice updates one entry rather than making two.
    `UID:${event.id}@runit.app`,
    `DTSTAMP:${stamp(now())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `SUMMARY:${escapeText(event.name)}`,
    ...(event.venue.trim() ? [`LOCATION:${escapeText(event.venue)}`] : []),
    `DESCRIPTION:${escapeText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF is required by the spec, not a Windows habit. Some parsers tolerate bare LF;
  // enough do not that it is worth being correct.
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** A filesystem-safe name for the .ics, derived from the event. */
export function icsFilename(event: Pick<RunitEvent, 'name'>): string {
  const slug = event.name
    .toLowerCase()
    // Apostrophes are DROPPED rather than treated as separators: "Riley's" should slug
    // to "rileys", not "riley-s".
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'event'}.ics`;
}
