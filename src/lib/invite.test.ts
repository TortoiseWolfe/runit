import { readFileSync } from 'fs';
import { join } from 'path';

import {
  INVITE_ORIGIN, appSchemeLink, codeFromScan, icsFilename, icsFor, joinLink, shareMessage,
} from './invite';

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
  timezone: 'America/New_York',
  doorsLabel: 'Doors 4:00 PM',
};
const FIXED = () => '2026-09-04T12:00:00.000Z';

describe('the join link', () => {
  it('upper-cases and trims the code, matching what join_event does server-side', () => {
    expect(joinLink('  sr1017 ')).toBe(`${INVITE_ORIGIN}/i/SR1017`);
  });

  it('percent-encodes, so a code can never break the path', () => {
    // It was the query string until #33; the reason survives the move. A code is data in
    // a URL either way, and `&` or a space would truncate or split it.
    expect(joinLink('a b&c')).toBe(`${INVITE_ORIGIN}/i/A%20B%26C`);
  });
});

describe('the share message', () => {
  /**
   * THE ORDER CHANGED, AND THE OLD ASSERTION WAS RIGHT UNTIL IT WASN'T. It used to require
   * the code to appear BEFORE the link, on the reasoning that channels mangle URLs while
   * leaving six characters intact. That reasoning still holds for a code being READ; it does
   * not hold for the sequence a person follows. The link is step 1 because you cannot use a
   * code before you have the app, and the code is step 3 because that is when it is asked
   * for. Both are still in the message and neither depends on the other surviving.
   */
  it('names the party first, since that is what makes anyone act', () => {
    const m = shareMessage(EVENT);
    expect(m.startsWith("You're invited to Sam & Riley's Wedding.")).toBe(true);
  });

  it('gives the steps in the order a person walks them: get it, open it, then the code', () => {
    // The failure this exists to prevent: a guest installs, opens the app cold, and meets an
    // empty field having never been told what a code is. There is no deferred deep link on
    // this distribution -- the code cannot survive the install, so the message has to carry
    // it somewhere a person can still read afterwards.
    const m = shareMessage(EVENT);
    expect(m.indexOf('1. Get RunIt')).toBeLessThan(m.indexOf('2. Open it'));
    expect(m.indexOf('2. Open it')).toBeLessThan(m.indexOf('3. Your code is'));
    expect(m).toContain(`1. Get RunIt:  ${INVITE_ORIGIN}/i/SR1017`);
    expect(m).toContain('3. Your code is  SR1017');
  });

  it('composes the date in the EVENT\'s zone, not the reader\'s', () => {
    // 20:00Z on Saturday 17 October is 4:00 PM in New York -- still the 17th. A message
    // formatted in the READER's zone would tell a guest in Sydney to come on Sunday.
    expect(shareMessage(EVENT)).toContain('Sat, Oct 17 · Doors 4:00 PM · Willow Barn');
  });

  it('omits what the event does not have, rather than printing empty separators', () => {
    // " ·  · " reads as a bug rather than as an absence.
    const m = shareMessage({ ...EVENT, venue: '  ', doorsLabel: '' });
    expect(m).not.toMatch(/·\s*$/m);
    expect(m).not.toMatch(/^\s*·/m);
    expect(m).toContain('Sat, Oct 17');
    expect(m).toContain("You're invited to Sam & Riley's Wedding.");
  });

  it('stays plain text, because the channel is whatever the host picked', () => {
    // It goes through Share.share({ message }) into SMS, a group chat or mail. Markdown and
    // HTML both arrive as literal characters somewhere.
    const m = shareMessage(EVENT);
    expect(m).not.toMatch(/[<>*_`]/);
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

/* ------------------------------------------------ the universal link (#33) */

/**
 * FOUR FILES HAVE TO AGREE, AND NOTHING ELSE CHECKS THEM.
 *
 * A universal link that is misconfigured does not error. It silently opens Safari instead
 * of the app, forever, and the only way to notice is to hold an iPhone. A wrong team id,
 * a bundle id that drifted, a path prefix that stopped matching, a Content-Type the host
 * guesses -- every one of those fails exactly that way.
 *
 * So the association file lives in this repo rather than on the web host's, and these
 * assertions read the real files off disk. They cannot prove iOS accepts the result -- no
 * Mac here, and Apple's CDN caches -- but they can prove the four artefacts describe the
 * same app at the same address, which is the half that rots silently.
 */
const REPO = join(__dirname, '../..');
const AASA = JSON.parse(
  readFileSync(join(REPO, 'web/.well-known/apple-app-site-association'), 'utf8'),
) as { applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] } };
const APP_JSON = JSON.parse(readFileSync(join(REPO, 'app.json'), 'utf8')) as {
  expo: { scheme: string; ios: { bundleIdentifier: string; associatedDomains: string[] } };
};
const EAS = JSON.parse(readFileSync(join(REPO, 'eas.json'), 'utf8')) as {
  submit: { production: { ios: { appleTeamId: string } } };
};

describe('the invitation link', () => {
  it('is an https URL a stranger can open, not a custom scheme', () => {
    // The whole point of #33. `runit://` was, in this file's own former words, "a dead
    // string" to anyone without the app -- which is precisely who a printed QR is for.
    expect(joinLink('house7')).toBe(`${INVITE_ORIGIN}/i/HOUSE7`);
    expect(joinLink('  sr1017 ')).toBe(`${INVITE_ORIGIN}/i/SR1017`);
  });

  it('still offers the custom scheme, for the app that is already installed', () => {
    expect(appSchemeLink('house7')).toBe('runit://join?code=HOUSE7');
    expect(APP_JSON.expo.scheme).toBe('runit');
  });
});

describe('the app and the association file describe the same app', () => {
  it('claims the host the links actually point at', () => {
    // `applinks:` + the bare host, no scheme and no path. A mismatch here means iOS never
    // fetches the file at all, and nothing anywhere says so.
    const host = new URL(INVITE_ORIGIN).host;
    expect(APP_JSON.expo.ios.associatedDomains).toEqual([`applinks:${host}`]);
  });

  it('names this app: the team id from eas.json and the bundle id from app.json', () => {
    const expected = `${EAS.submit.production.ios.appleTeamId}.${APP_JSON.expo.ios.bundleIdentifier}`;
    expect(AASA.applinks.details[0]!.appIDs).toEqual([expected]);
  });

  it('matches the path joinLink actually produces', () => {
    // A pattern that stopped matching would send every invitation to Safari. Checked
    // against a real generated link rather than against a copy of the prefix.
    const patterns = AASA.applinks.details[0]!.components.map((c) => c['/']);
    expect(patterns).toContain('/i/*');
    const path = new URL(joinLink('HOUSE7')).pathname;
    expect(patterns.some((p) => path.startsWith(p.replace(/\*$/, '')))).toBe(true);
  });

  it('is served as application/json, which the host does not guess', () => {
    // Apple documents application/json; a static host guesses from the extension, and
    // this file deliberately has none. GitHub Pages answers application/octet-stream --
    // measured, not assumed -- which is why the site moved to a host that can be told.
    const headers = readFileSync(join(REPO, 'web/_headers'), 'utf8');
    expect(headers).toContain('/.well-known/apple-app-site-association');
    expect(headers).toMatch(/Content-Type:\s*application\/json/);
  });

  it('rewrites /i/<code> to the one page, without changing the URL', () => {
    // 200 not 301: Apple matches the URL as SENT, and a redirect would also lose the code
    // out of the address bar before the page could read it.
    //
    // THE DESTINATION IS `/i/`, AND THIS TEST USED TO DEMAND `/i/index.html`. It was wrong,
    // and only the live host could say so: Cloudflare Pages canonicalises the explicit
    // filename -- `/i/index.html` answers 308 to `/i/` -- and a rewrite whose destination
    // redirects does not serve. The first deploy shipped the spelled-out form and every
    // `/i/CODE` returned 404 while the association file beside it was perfect. Measured on
    // runit-app.pages.dev, not reasoned about. Do not "fix" this back.
    const redirects = readFileSync(join(REPO, 'web/_redirects'), 'utf8');
    expect(redirects).toMatch(/\/i\/\*\s+\/i\/\s+200/);
    expect(redirects).not.toMatch(/\/i\/index\.html\s+200/);
  });
});

describe('reading a scanned code back (#28)', () => {
  it('reads the code out of our own QR, which is the round trip that matters', () => {
    // Not a hand-written string: the QR encodes exactly what joinLink() returns, so this
    // is the only assertion that cannot drift from the thing being scanned.
    expect(codeFromScan(joinLink('house7'))).toBe('HOUSE7');
  });

  it('takes the custom scheme too, since it is still registered', () => {
    expect(codeFromScan(appSchemeLink('house7'))).toBe('HOUSE7');
  });

  it('takes a bare code off a printed card', () => {
    expect(codeFromScan('  house7 ')).toBe('HOUSE7');
  });

  it('survives a trailing slash, and a link someone typed in lower case', () => {
    expect(codeFromScan(`${INVITE_ORIGIN}/i/HOUSE7/`)).toBe('HOUSE7');
    // The round-trip test above cannot see this: `joinLink` uppercases on the way out, so
    // scanning its own output never exercises the way back. A link that was typed, or
    // built by anything other than joinLink, can carry any case -- and `join_event`
    // compares `upper(code) = upper(btrim(p_code))`, so what goes in the field must be
    // what a host would read off her own console.
    expect(codeFromScan(`${INVITE_ORIGIN}/i/house7`)).toBe('HOUSE7');
  });

  it('REFUSES an /i/ link on somebody else host', () => {
    // The half worth having. A sticker on a lamppost could otherwise put a code into the
    // field of an app that is about to send a nickname somewhere -- and INVITE_ORIGIN
    // pointed at a stranger's site for one commit, so this is not hypothetical.
    expect(codeFromScan('https://evil.example/i/HOUSE7')).toBeNull();
    expect(codeFromScan(INVITE_ORIGIN.replace('https:', 'http:') + '/i/HOUSE7')).toBeNull();
  });

  it('refuses a QR that is simply not ours', () => {
    expect(codeFromScan('https://example.com/some/page')).toBeNull();
    expect(codeFromScan('WIFI:S=Barn;T=WPA;P=hunter2;;')).toBeNull();
    expect(codeFromScan('')).toBeNull();
    expect(codeFromScan('   ')).toBeNull();
  });

  it('refuses a code that is not the shape of a code', () => {
    expect(codeFromScan('AB')).toBeNull();
    expect(codeFromScan('THISISWAYTOOLONGFORACODE')).toBeNull();
    expect(codeFromScan(`${INVITE_ORIGIN}/i/`)).toBeNull();
    expect(codeFromScan(`${INVITE_ORIGIN}/i/HOUSE7/extra`)).toBeNull();
  });
});
