# 004 — The front door: no bare "Enter your code"

Status: DRAFT 2026-10-15. Specs only; nothing built.
Wireframe: to be drawn in `design/wireframes/` before any screen changes (the design is the spec);
the join screen's current section is in `2026-10-05-host-getting-started.html`.
Number: spec 013 reserved 004 for this: "The first-run join screen with two plain doors, "Got a
code?" and "Hosting?" (#98, spec 004)."
Shared pattern: PlumbPics carries the same spec as `features/core/006-front-door/` in
TortoiseWolfe/AsBuilt-Expo. The two differ only where the apps do.

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
  who types the example joins someone else's party.
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
   bottom. One tap joins DEMO42 with no code and no name typed: the guest is "Visitor" plus a number,
   and can rename later (`set_nickname`). A "Sample party" label stays on its screens, with "Leave the
   sample" back to the front door.
3. The sample shows every guest feature: the chat and run of show, the album with an upload that
   waits for approval, song requests and upvotes. A second choice, "Try hosting a sample party",
   shows the host's console (Broadcast, DJ queue, Photo approvals) on a party with guests, photos and
   requests already in it (D1).
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
    no code on the review sheet.

**Accessibility, as the repo already enforces it**

15. Every new target is real padding of 44pt or more, not hitSlop (`audit:targets`); the gutter gate,
    the contrast gate on both colour schemes, `audit:keyboard` and `audit:styles` stay green.
16. The chip, the sample label and every code message are announced (a live region for messages);
    "Look around a sample party" and "Paste my invitation" are buttons whose labels are their words.
17. Nothing goes off screen at 393x852 or 320x568 with the largest text size.

## Acceptance

- On `?empty=1` (a cold install), the first screen shows the line from (1), "Look around a sample
  party" and the code field; no host key field; no prompt of any kind.
- One tap on the sample lands in DEMO42's chat as "Visitor N", with no keyboard shown at any point,
  and DEMO42's start reads this evening or yesterday evening, never older.
- From the sample, a photo upload shows as waiting for approval, a song request lands in the list,
  and "Leave the sample" returns to the front door.
- "Try hosting a sample party" opens a console with at least one pending photo and one request.
- `/i/HOUSE7` (a seeded party) shows the chip and the name field, focused; one tap joins. The code
  field is not on screen.
- Typing DEMO42 into the code field still joins the sample; typing "HOUSEO" gets the refusal from (12).
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
| A sample host party (D1), if a private copy per visitor | `supabase/` (a function), plus the app's button | Server no; button yes |
| Review notes | App Store Connect + `docs/app-review-notes.md` | No |
| Universal link proven on an iPhone (#54) | a device check with the current TestFlight build | No |
| The app's front door: sample, chip, paste, host key moved, words | `src/` | **Yes** |

The web pieces are production, so they wait for the Sunday-afternoon window unless the owner says
otherwise.

## Decisions needed

- **D1**: "Try hosting a sample party": a private copy per visitor (safe to press every button, a
  server function to write), or DEMO42's own console opened read-only (no server work, and a
  reviewer cannot approve a photo)? Recommended: the private copy.
- **D2**: Add `expo-updates` in the same build, so later wording changes ship without one? It is a
  native change, and PlumbPics turns its updates off for the App Store release (unsigned updates must
  not reach a store build). Recommended: not for this; decide with the store release.
- **D3**: The one line under the title. Recommended, from `CLAUDE.md`'s own description: "Your
  event's chat, shared photos and song requests, in one place."

## Not in this spec

- The rest of #98 (the "Run it" button that reads as disabled, the clipped nickname placeholder, the
  calendar as a text link). This spec takes only its chip and focused name; the rest can ride the
  same build.
- Code guessing (#89, built) and captcha (#9).
- Host sign-in itself (`docs/host-signin.md`).
- App Clips: native work, and the bridge page plus the browser guest already let a guest in with
  nothing installed.
