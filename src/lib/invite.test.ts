import { readFileSync } from 'fs';
import { join } from 'path';

import {
  INVITE_ORIGIN, appSchemeLink, codeFromScan, icsFilename, icsFor, joinLink, shareMessage, RETIRED_ORIGINS, acceptedOrigins,
  inviteEmail, inviteMailto, MAILTO_BUDGET, outcomeFromMailStatus, addressFromInput,
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

  it('gives the steps in the order a person walks them, and step one is no longer an install', () => {
    // The failure this exists to prevent: a guest arrives at the app cold and meets an empty
    // field having never been told what a code is. There is no deferred deep link on this
    // distribution -- the code cannot survive an install -- so the message carries it
    // somewhere a person can still read afterwards, whichever route they took.
    //
    // #78 CHANGED WHAT STEP ONE PROMISES. "Get RunIt" asked for an install, and an install
    // is where S7Y9RX's forty guests stopped: that party produced ZERO anonymous sign-ins.
    // The same link now opens the party in a browser. The URL did not change; what it is
    // worth to somebody who will not install anything did.
    const m = shareMessage(EVENT);
    expect(m.indexOf('1. Open the party')).toBeLessThan(m.indexOf('2. Pick a nickname'));
    expect(m.indexOf('2. Pick a nickname')).toBeLessThan(m.indexOf('3. Your code is'));
    expect(m).toContain(`1. Open the party:  ${INVITE_ORIGIN}/i/SR1017`);
    // The sentence that cost a party. It must not come back.
    expect(m).not.toContain('Get RunIt');
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

  /**
   * MOVING THE HOST USED TO BE A ONE-WAY DOOR, and this is what stops it being one.
   *
   * `codeFromScan` compared against the single current `INVITE_ORIGIN`, so the day that
   * constant moved every card already printed, the committed poster and every invitation
   * minted by `design/brand/invite-template.html` became unreadable -- presenting as a
   * scanner that hangs rather than as an error.
   *
   * `RETIRED_ORIGINS` IS EMPTY TODAY, so the interesting case cannot be demonstrated by
   * example and this block does not pretend otherwise. It proves the CHAIN instead, one
   * link at a time: that `acceptedOrigins()` is built from both constants, and that
   * `codeFromScan` accepts everything `acceptedOrigins()` returns. Together those imply the
   * property; separately, each is checkable now. The loop below covers a real retired
   * origin the day one is added, with no edit to this file.
   */
  it('accepts every origin it says it accepts', () => {
    // A COVERAGE FLOOR, and it is the load-bearing half. Without it, emptying
    // `acceptedOrigins()` would make the loop iterate zero times and pass having measured
    // nothing -- the same doctrine as the static audits' minimum counts.
    expect(acceptedOrigins().length).toBeGreaterThanOrEqual(1);
    expect(acceptedOrigins()).toContain(INVITE_ORIGIN);

    for (const origin of acceptedOrigins()) {
      expect(codeFromScan(`${origin}/i/HOUSE7`)).toBe('HOUSE7');
    }
  });

  /**
   * THE FIRST VERSION OF THIS ASSERTION COULD NOT FAIL, and a mutation is what said so.
   *
   * It read `expect(acceptedOrigins()).toEqual([INVITE_ORIGIN, ...RETIRED_ORIGINS])`, which
   * while the list is empty is `[INVITE_ORIGIN]` compared against `[INVITE_ORIGIN]`. Deleting
   * the spread from `acceptedOrigins` -- i.e. breaking retirement completely -- left it
   * green. A test written to protect the mechanism proved nothing about it.
   *
   * So both functions take the list as a parameter now, the way `icsFor` takes a clock, and
   * these pass a SYNTHETIC retired origin. That exercises the two-element path today rather
   * than waiting for a real retirement to find out whether it works.
   */
  const RETIRED = 'https://runit-app-old.example';

  it('puts a retired origin in the accepted list, beside the current one', () => {
    expect(acceptedOrigins([RETIRED])).toEqual([INVITE_ORIGIN, RETIRED]);
  });

  it('reads a card printed before the move, which is the whole point', () => {
    // The case that does not exist yet and will one day be every card in a drawer.
    expect(codeFromScan(`${RETIRED}/i/HOUSE7`, [INVITE_ORIGIN, RETIRED])).toBe('HOUSE7');
    expect(codeFromScan(`${RETIRED}/i/house7/`, [INVITE_ORIGIN, RETIRED])).toBe('HOUSE7');
  });

  it('but does not accept it by DEFAULT, because it is not retired yet', () => {
    // The seam must not widen the shipped behaviour. With no argument, only the real list
    // applies -- so an origin nobody has retired is still somebody else's server.
    expect(codeFromScan(`${RETIRED}/i/HOUSE7`)).toBeNull();
    expect(acceptedOrigins()).not.toContain(RETIRED);
  });

  it('mints only the CURRENT host, whatever it accepts', () => {
    // Widening what is ACCEPTED must never widen what is PRODUCED, or a retired host would
    // start appearing on new cards and the retirement would never finish.
    expect(new URL(joinLink('HOUSE7')).origin).toBe(INVITE_ORIGIN);
  });

  it('and a near-miss of our own name is still somebody else server', () => {
    // `runit.pages.dev` was in INVITE_ORIGIN for one commit and belongs to a stranger whose
    // site answers 200 on every path. An allowlist is exactly the mechanism that could
    // readmit it by accident, so the case is pinned here rather than assumed.
    expect(codeFromScan('https://runit.pages.dev/i/HOUSE7')).toBeNull();
    expect(acceptedOrigins()).not.toContain('https://runit.pages.dev');
  });

  it('refuses a code that is not the shape of a code', () => {
    expect(codeFromScan('AB')).toBeNull();
    expect(codeFromScan('THISISWAYTOOLONGFORACODE')).toBeNull();
    expect(codeFromScan(`${INVITE_ORIGIN}/i/`)).toBeNull();
    expect(codeFromScan(`${INVITE_ORIGIN}/i/HOUSE7/extra`)).toBeNull();
  });
});

/*
 * SEND ADDRESSES THE GUEST LIST NOW, AND ONLY IN BCC.
 *
 * `invitees.send` promised to open Mail "pre-addressed" and opened a blank share sheet, so a
 * host built a list, tapped Send, and typed everybody again. These are the pure half: which
 * addresses go where, and what the message says.
 *
 * BCC IS THE WHOLE POINT, not a detail. The join screen promises "guests can't see each other",
 * and a To line of forty addresses breaks that in the first email anybody receives.
 */
describe('the email a host sends her guest list', () => {
  it('puts every address in BCC, lowercased and without duplicates', () => {
    const m = inviteEmail(EVENT, ['Ruth@Example.com', 'ruth@example.com', 'sam@example.com']);
    expect(m.bcc).toEqual(['ruth@example.com', 'sam@example.com']);
  });

  it('leaves out the people who only have a phone number', () => {
    // A phone is not an email address, and a group text is not private -- see the screen.
    expect(inviteEmail(EVENT, [null, undefined, '', 'sam@example.com']).bcc).toEqual(['sam@example.com']);
  });

  it('says what it is in the subject and carries the same invitation Share writes', () => {
    const m = inviteEmail(EVENT, ['sam@example.com']);
    expect(m.subject).toBe("You're invited to Sam & Riley's Wedding");
    // ONE invitation, composed once. A second hand-built copy is how two versions drift.
    expect(m.body).toBe(shareMessage(EVENT));
  });
});

describe('the mailto link that opens it', () => {
  it('addresses nobody in To -- the recipients are all BCC', () => {
    const url = inviteMailto(EVENT, ['sam@example.com', 'ruth@example.com'])!;
    // Nothing between `mailto:` and `?` is the To line, and it must be empty.
    expect(url.startsWith('mailto:?')).toBe(true);
    const params = new URLSearchParams(url.slice('mailto:?'.length));
    expect(params.get('bcc')).toBe('sam@example.com,ruth@example.com');
    expect(params.has('to')).toBe(false);
    expect(params.has('cc')).toBe(false);
  });

  it("encodes the party's name, so an ampersand cannot start a new parameter", () => {
    // Unencoded, "Sam & Riley's" splits the subject at the ampersand and the mail app
    // shows "You're invited to Sam " with the rest discarded.
    const url = inviteMailto(EVENT, ['sam@example.com'])!;
    const params = new URLSearchParams(url.slice('mailto:?'.length));
    expect(params.get('subject')).toBe("You're invited to Sam & Riley's Wedding");
    expect(params.get('body')).toBe(shareMessage(EVENT));
  });

  it('gives up rather than dropping people when the list is too long for one link', () => {
    // Some mail clients refuse a URL past roughly 2,000 characters. Truncating the BCC line
    // would invite some guests and silently not others; null sends the host to Copy addresses.
    const many = Array.from({ length: 200 }, (_, i) => `guest${i}@example.com`);
    expect(inviteMailto(EVENT, many)).toBeNull();
  });

  it('stays inside the budget whenever it does return a link', () => {
    const some = Array.from({ length: 12 }, (_, i) => `guest${i}@example.com`);
    const url = inviteMailto(EVENT, some)!;
    expect(url).not.toBeNull();
    expect(url.length).toBeLessThanOrEqual(MAILTO_BUDGET);
  });

  it('has nothing to open when nobody on the list has an email', () => {
    expect(inviteMailto(EVENT, [null, ''])).toBeNull();
  });
});

/*
 * AND WHAT THE COMPOSER'S ANSWER IS ALLOWED TO MEAN. Only `sent` stamps `invitedAt`, because
 * only `sent` was confirmed by anything.
 */
describe('what a closed mail composer lets a host conclude', () => {
  it('counts a confirmed send as sent', () => {
    expect(outcomeFromMailStatus('sent')).toBe('sent');
  });

  it('does not count a draft as a send', () => {
    // "Saved" is sitting in Drafts. Nobody was invited.
    expect(outcomeFromMailStatus('saved')).toBe('cancelled');
  });

  it("does not count Android's undetermined as a send", () => {
    // Android reports this whether the host sent the email or backed out of it. Reading it as
    // sent would stamp every dismissed composer on every Android phone.
    expect(outcomeFromMailStatus('undetermined')).toBe('unconfirmed');
  });
});

/*
 * ONE FIELD FOR AN EMAIL OR A PHONE NUMBER. It was email-only, so a host on a desktop -- where
 * there is no contacts picker -- could not put a phone number on the list at all.
 */
describe('telling an email from a phone number in one field', () => {
  it('reads an address with an @ as an email', () => {
    expect(addressFromInput('  Ruth@Example.com ')).toEqual({ email: 'Ruth@Example.com' });
  });

  it('reads digits, however they are punctuated, as a phone number', () => {
    // Kept as typed. The database folds formats through `phone_key`, so three spellings of one
    // number are one row -- this must not pretend to normalise what it does not own.
    expect(addressFromInput('(555) 555-0100')).toEqual({ phone: '(555) 555-0100' });
    expect(addressFromInput('+44 20 7946 0958')).toEqual({ phone: '+44 20 7946 0958' });
  });

  it('refuses what is neither, rather than filing it as an email', () => {
    // The field used to send anything at all to `add({ email })`.
    expect(addressFromInput('ruth')).toBeNull();
    expect(addressFromInput('ruth@')).toBeNull();
    expect(addressFromInput('12345')).toBeNull(); // too short to be anybody's number
    expect(addressFromInput('   ')).toBeNull();
  });
});
