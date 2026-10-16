# 004 — The front door: no bare "Enter your code"

Status: DRAFT 2026-10-15, revised the same evening: the sample is DEMO42 itself, shared and
look-only, on the guest side and the host side (the owner's answer; see History). Specs only;
nothing built.
Wireframe: to be drawn in `design/wireframes/` before any screen changes (the design is the spec);
the join screen's current section is in `2026-10-05-host-getting-started.html`.
Number: spec 013 reserved 004 for this: "The first-run join screen with two plain doors, "Got a
code?" and "Hosting?" (#98, spec 004)."
Shared pattern: PlumbPics carries the same spec as `features/core/006-front-door/` in
TortoiseWolfe/AsBuilt-Expo. The two differ only where the apps do.

## History

- 2026-10-15, first draft: the sample let a visitor post (an upload waiting for approval, a song
  request), and D1 recommended a private copy of a party per visitor for "Try hosting".
- 2026-10-15, evening, the owner: "Look around a sample party" opens the shared DEMO42 event
  read-only, not a private copy per visitor. That reverses D1's recommendation and settles it: both
  doors open DEMO42, look-only. This revision adds what a visitor sees on trying to post (18-22),
  the server half that makes look-only a rule rather than a courtesy (23-29), and the S7Y9RX note
  below.

## Problem

The owner, 2026-10-15: "I hate when new apps ask for a code, especially when they are vague about
where to get the code, this effects both RunIt and PlumbPics it's bad UX to start with".
PlumbPics build 7 was rejected under App Store Guideline 2.1(a) for exactly this: the reviewer could
not get past the code screen. RunIt will meet the same wall at its first store review.

What a guest sees on a cold install today (`src/app/index.tsx:8` sends an anonymous session to
`/join`, `src/features/join/JoinScreen.tsx`):

- "Join an event" over "Enter your code". The subtitle under it is empty: nothing says what RunIt
  is for.
- "The host gives you a six-character code — in a text, an email or a QR at the door." and a Scan
  chip. This line is good: it names the sender and the ways it arrives.
- Three fields: "Six-character code, e.g. S7Y9RX", "Your name, as the room will see it" and "Host
  key (optional)" ("Leave empty unless you are running this event."). A second code field, for
  hosts, sits on every guest's first screen.
- The button "Run it", and the links "Running an event? Make one →", "New here? How RunIt works →"
  (013), "Something not right? Tell us →" and "Already running one? Sign in →".
- Nothing to look at without a code. The demo party DEMO42 exists (`supabase/seed-events.sql:68`,
  "for the reviewer only") but no screen in the app offers it; only `web/beta/` names it ("Join the
  demo party with the code DEMO42"), and #130 says it looks five weeks stale.
- A wrong code: "That code doesn't match an event." (`src/data/repository.ts`, `JOIN_COPY`), with no
  next step.
- The placeholder's example, S7Y9RX, is a real party's code (`src/lib/invite.ts:164`), so a guest
  who types the example joins someone else's party. That party is being closed to new joins on
  2026-10-15 by a data change with no build: the event gets a new, unpublished code, and its guests
  keep their seats, because "Your events" reopens a party by its id (`my_events()`), never by its
  code. After it, the example answers "That code doesn't match an event." The placeholder itself
  moves with this spec's build (11), and so does the sample code in
  `design/brand/invite-email.html` and `design/brand/invite-template.html`.
- What works and stays: a guest who has joined reopens in her event, not here (a restored session
  is `kind: 'guest'` and `src/app/index.tsx:10` sends it to `/chat`).

What a link does today:

- `https://runit-app.pages.dev/i/<CODE>` (the QR, and the share text's first line) opens the app at
  `/join?code=<CODE>`: the preview reads "You're invited to" and the event's name, and the hint
  "Scanned the QR? Your code is filled in. Otherwise type it." The code is still a field, and the
  guest still types a name and taps "Run it" (#98).
- iOS has never been shown to route that link into the app (#54: "a misconfigured universal link
  does not error. It opens Safari instead of the app. Silently.").
- Without the app, the link opens the bridge page, "Get RunIt · your code is inside", with "Join in
  your browser →", the TestFlight steps and the code with a Copy button. The code cannot survive the
  install (`JoinScreen.tsx`, the comment at the title: "the code cannot survive an install on this
  distribution"), so the guest lands on "Enter your code" with the code in a page they have left.

## What she is trying to do

A guest: get into the party she was invited to without typing anything she has to go looking for.
A newcomer with no invitation (the owner's mother, 2026-10-05; Apple's reviewer): see what RunIt
does before deciding anything.

## How others do it

- Apple, Guideline 2.1(a): "you may include a built-in demo mode in lieu of a demo account with prior
  approval by Apple"; 5.1.1(v): "If your app doesn't include significant account-based features, let
  people use it without a login." (https://developer.apple.com/app-store/review/guidelines/)
- Apple HIG: "Ideally, people can understand your app or game simply by experiencing it"
  (https://developer.apple.com/design/human-interface-guidelines/onboarding).
- No deferred deep link on iOS: an uninstalled app's universal link opens the browser
  (https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content).
  A Smart App Banner's `app-argument` survives an install only for an App Store app
  (https://developer.apple.com/documentation/webkit/promoting-apps-with-smart-app-banners).
- Partiful: guests need no app to RSVP (https://help.partiful.com/hc/en-us/articles/27354346663963-Do-my-guests-need-to-download-the-app).
  Kahoot: a PIN, a link or a QR, no account (https://support.kahoot.com/hc/articles/360039890713).
  Zoom: the link carries the meeting and its passcode (https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065180).
  Google Classroom names the sender: "ask your teacher directly" (https://support.google.com/edu/classroom/answer/15605102).
- The sibling apps (ScriptHammer-Expo, geoLARP-Expo, Chattanooga-Digital-Expo) open on content, with
  no account and no code.

## Requirements

**A first look with no code**

1. The first open shows, under the title, one line saying what RunIt is for (the owner's words; D3),
   so the empty subtitle never shows.
2. It offers "Look around a sample party" as a full-size choice beside the code, not a link at the
   bottom. One tap seats the visitor in DEMO42, the one sample party everybody shares, with no code
   and no name typed. `join_event` refuses an empty name, so the app sends "Visitor"; nobody sees it,
   because a visitor can post nothing (18). There is no rename in the sample. A "Sample party · look
   only" label stays on its screens, with "Leave the sample" back to the front door.
3. The sample shows every guest feature from content we seed: the announcements and run of show,
   the album, the song queue and its votes. A second choice, "Try hosting a sample party", opens
   DEMO42's own console, look-only: Broadcast, the DJ queue and Photo approvals, with the seeded
   waiting photo and requests in them (D1, settled). The visitor is never given a host seat. A host
   seat passes the closed-party rule for approve and hide, the event's details, deleting an
   announcement, Play next, inviting a co-host and the invitation list, so on a shared party one
   visitor holding one would change what every other visitor sees.
4. DEMO42 always reads as a party under way this evening, never weeks old: its date rolls forward on
   our side (#130), keeping the seed's intent that a visitor lands mid-event with the run of show
   already going (`supabase/seed-events.sql:64-66`).
5. The host key leaves the guest's first screen. A host reaches it by "Running this event? Use your
   host key" or by signing in; a guest sees one code field at most.

**A link that opens the party**

6. `/i/<CODE>` opens the app with the code as a confirmation chip (the event's name, its date, the
   code small beneath), not a field (#98). The only thing asked is a name, focused on arrival, and
   one tap joins. Nobody types the code.
7. Before this ships, the universal link is proven on an iPhone (#54: Settings → Developer →
   Universal Links → Diagnostics, then the link from Messages opens the app on the chip).
8. The bridge page, when the app is not installed, says plainly: "Installing RunIt? After it opens,
   tap this link again, or tap Paste in the app." Its Copy button copies the whole link.
9. On the front door, "Paste my invitation" reads the clipboard on that tap only (iOS asks to allow
   the paste; nothing reads it unasked) and takes a link, a `runit://` link or a bare code, as
   `codeFromScan` already does.
10. A guest who has joined keeps opening straight into her event, as she does today
    (`src/app/index.tsx:10`). The sample never takes that place: leaving the sample, or a restart
    after it, returns to the front door unless she has joined a real party.

**Wherever a code is still asked for**

11. The code field says, on its face: who sends it and how (today's hint stays); what it looks like
    ("6 letters and numbers, like K7M2QP"), with an example that is no party's code and is reserved
    so the generator never issues it; and what to do without one ("No code? Look around a sample
    party, or ask the host to send the invitation again.").
12. A typed code that matches no event and contains 0, O, 1, I or L says so in the refusal: "Codes
    from a host never use 0, O, 1, I or L. Check the invitation again." It comes after the lookup,
    never as a block while typing, because the seeded DEMO42 and HOUSE7 sit outside the generator's
    alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, `supabase/migrations/00000000000000_schema.sql:2316`)
    and still join when typed.
13. "That code doesn't match an event." gains its next step: "Check it against the invitation, or ask
    the host to send it again." Every refusal keeps naming a next step (`JOIN_COPY`).

**Review**

14. The App Review notes are kept in the repo (`docs/app-review-notes.md`, new) and name "Look around
    a sample party" and "Try hosting a sample party" as the built-in demonstration mode (2.1(a)), with
    no code on the review sheet. For every control that writes, they send the reviewer to "Make a
    party": a party of their own, where they hold the host seat and can take a guest seat (#37). The
    DEMO42 host key the review sheet carries today retires (29).

**Accessibility, as the repo already enforces it**

15. Every new target is real padding of 44pt or more, not hitSlop (`audit:targets`); the gutter gate,
    the contrast gate on both colour schemes, `audit:keyboard` and `audit:styles` stay green.
16. The chip, the sample label and every code message are announced (a live region for messages);
    "Look around a sample party" and "Paste my invitation" are buttons whose labels are their words.
17. Nothing goes off screen at 393x852 or 320x568 with the largest text size.

**The sample is look-only, and says what to do instead (the owner's answer, 2026-10-15)**

18. In the sample, every control that would write opens the look-only sheet (19): the photo shutter,
    the song composer and its suggestions, an upvote; on the host side Broadcast, Pin, delete, Play
    next, Decline, Approve, Hide, Approve all, the event's details, Invite, Change plan and Delete.
    Each control is drawn as it is on a real party and answers a tap. None is disabled, so
    `empty-world.spec.ts`'s `[aria-disabled="true"]` count stays 0.
19. The sheet's words (D4). Guest side: "Look only. This is a sample party, so nothing here can be
    changed. To post photos and request songs, join a real party with your host's invitation, or
    make your own." Buttons: "I have an invitation" (leaves the sample for the front door), "Make a
    party" (`/create`), "Keep looking" (closes the sheet). Host side: "Look only. This is a sample
    party, so its announcements, song queue and photo approvals can't be changed here. Make your own
    party to run one for real." Buttons: "Make a party", "Keep looking".
20. The sheet opens before anything else would: before the camera or the photo library is asked
    for, so no permission prompt ever appears in the sample, and before a keyboard opens. No keyboard
    opens anywhere in the sample, and the app does not ask to send notifications there.
21. Report and Block keep working on the seeded content (Guideline 1.2 asks for both wherever people
    see other people's posts, and #41 already keeps them open on an ended party). "Something not
    right? Tell us" keeps working too.
22. The app knows it is in the sample from the event (the flag in 23, sent with the event), never
    from the code typed. So typing DEMO42 into the code field lands in the same look-only sample, and
    no real party is ever look-only by mistake.

**The server half: a migration, no build, shipped after the build that reads it**

23. `events` gains a sample flag that no client can write (outside every column grant, like
    `tier`). On a flagged event `event_is_open()` answers false, so #41's closed-party rule refuses
    every new photo, song request, vote, announcement, run-of-show row and folder, through the
    policies and inside `request_song` and `start_schedule_item`, exactly as on an ended party. The
    sheet is the courtesy; this is the rule. `set_push_token` refuses a flagged event as well.
24. Visitor seats are not guests for counting: on a flagged event `join_event` skips the cap and the
    room count leaves visitors out, so the 201st visitor is never told the party is full
    (`event_full`, 54023). The roll-forward (#130) removes visitor seats more than a day old.
25. The sample never appears in "Your events": `my_events()` leaves flagged events out, so the sample
    cannot stand in for a real party there (10).
26. On a flagged event a guest seat may read what the look-only console shows: the seeded waiting
    photo and the seeded invitation list. Never a report a visitor filed, and never another
    visitor's seat.
27. The reseed writes its announcements without firing `fan_out_push` (DEMO42 is on the Event plan,
    where push is on).
28. Before the flag goes on, everything on DEMO42 the seed did not write is removed, bytes first and
    then the row (the `sweep-photos` order): photos, requests, votes, reports, blocks and guest seats
    left by testers and reviewers since September. Strangers must not be shown them.
29. The order: first the build that reads the flag and draws the sheet; then the review notes (14);
    then one migration with the cleanup (28), the flag, and a rotation of DEMO42's host key with
    nobody given the new one (`rotate_host_key`), so no seat outside ours can change the shared
    party. On a Sunday afternoon. An older build on a flagged DEMO42 sends the write, the server
    refuses it, and the guest reads "That did not go through. Try again." (`ACTION_FAILED`): safe,
    and wrong, which is why the build goes first. Lane E holds both halves: a forged write as a
    visitor is refused for each content table and both functions, and Report, Block and every read
    still work.

## Acceptance

- On `?empty=1` (a cold install), the first screen shows the line from (1), "Look around a sample
  party" and the code field; no host key field; no prompt of any kind.
- One tap on the sample lands in DEMO42's chat under the "Sample party · look only" label, with no
  keyboard shown at any point, and DEMO42's start reads this evening or yesterday evening, never
  older.
- From the sample, tapping the shutter, the song composer or an upvote opens the look-only sheet;
  no permission prompt and no keyboard appear, nothing is written, and "Keep looking" returns to the
  same screen. "I have an invitation" and "Leave the sample" both return to the front door.
- "Try hosting a sample party" opens DEMO42's console with its waiting photo and requests; Approve,
  Broadcast and Play next each open the host sheet, and nothing changes for the next visitor.
- Report and Block work from the sample.
- Lane E: a forged photo, request, vote, announcement or run-of-show write as a visitor on the
  flagged event is refused, `request_song` and `start_schedule_item` refuse it too, and a visitor
  can still read, report and block.
- 250 visitors in a row each get into the sample and none is told the party is full; the room count
  does not move, and the sample is in nobody's "Your events".
- `/i/HOUSE7` (a seeded party) shows the chip and the name field, focused; one tap joins. The code
  field is not on screen.
- Typing DEMO42 into the code field lands in the same look-only sample; typing "HOUSEO" gets the
  refusal from (12).
- S7Y9RX: the code field's example is no longer S7Y9RX, and neither are the brand files' sample
  codes.
- On an iPhone with the build, a `/i/<code>` link from Messages opens the app on the chip (#54's
  diagnostic passes).
- With a copied invitation link, "Paste my invitation" fills the chip in one tap; with nothing
  copied it says "Nothing to paste. Your invitation is in the host's text or email."
- A test reads every code field's text and fails if who, the shape, or what to do without one is
  missing, or if the example is outside the alphabet or is a real party's code.
- A guest who has joined and kills the app still reopens in her event; a visitor who only looked at
  the sample reopens on the front door.
- `docs/app-review-notes.md` names only controls the first screen shows (a test holds the two together).
- `audit:targets`, `audit:keyboard`, `audit:styles`, the gutter gate and the contrast gate stay green.

## What it costs to ship (2026-10-15)

RunIt has no over-the-air updates (no `expo-updates`, no `updates` or `runtimeVersion` in
`app.json`), so **every change inside the app needs a build**.

| Piece | Ships by | Build? |
|---|---|---|
| DEMO42 rolls forward to this evening (#130) | `supabase/` (a scheduled job or reseed) | No |
| The example code reserved, so the generator never issues it | `supabase/` (the code generator) | No |
| The bridge page's "tap this link again" and Copy-the-link | `web/` (direct upload to Cloudflare Pages) | No |
| The browser guest's front door (requirements 1-6, 9, 11-13 on `dist-guest/`) | `web/` deploy of the guest build | No |
| The sample flag, visitor seats, look-only reads, the cleanup and the key rotation (23-29) | `supabase/` (one migration), after the build | No, but only after the build |
| The look-only sheet and the sample's label (18-22) | `src/` | **Yes** |
| S7Y9RX closed to new joins | a data change on production, done as a card for the owner | No |
| Review notes | App Store Connect + `docs/app-review-notes.md` | No |
| Universal link proven on an iPhone (#54) | a device check with the current TestFlight build | No |
| The app's front door: sample, chip, paste, host key moved, words | `src/` | **Yes** |

The web pieces are production, so they wait for the Sunday-afternoon window unless the owner says
otherwise.

## Decisions needed

- **D1, settled 2026-10-15**: both doors open DEMO42, shared and look-only, not a private copy per
  visitor (the owner). What it costs is written in 18-29: a sheet in the app, and one migration
  shipped after the build. A reviewer who wants to approve a photo makes a party of their own (14).
- **D2**: Add `expo-updates` in the same build, so later wording changes ship without one? It is a
  native change, and PlumbPics turns its updates off for the App Store release (unsigned updates must
  not reach a store build). Recommended: not for this; decide with the store release.
- **D3**: The one line under the title. Recommended, from `CLAUDE.md`'s own description: "Your
  event's chat, shared photos and song requests, in one place."
- **D4**: The look-only sheet's words (19). Recommended as written there: they say why nothing
  changes and give the two ways to a party where it does.

## Not in this spec

- The rest of #98 (the "Run it" button that reads as disabled, the clipped nickname placeholder, the
  calendar as a text link). This spec takes only its chip and focused name; the rest can ride the
  same build.
- Code guessing (#89, built) and captcha (#9).
- Host sign-in itself (`docs/host-signin.md`).
- App Clips: native work, and the bridge page plus the browser guest already let a guest in with
  nothing installed.
