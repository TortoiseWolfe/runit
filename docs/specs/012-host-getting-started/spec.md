# 012 — Host getting started: a checklist that ticks itself

Status: BUILT 2026-10-05. Live in the browser; banked for the next native build.
Wireframe: `design/wireframes/2026-10-05-host-getting-started.html`.

## Problem
A first-time host taps **I have saved it** on the recovery key screen and lands on a console
with five segments (Broadcast, DJ queue, Photos, Reports, Event) and a composer addressed to
nobody. Nothing says which of those matter tonight. The one nudge that exists,
`empty-room-share` (`src/features/host/BroadcastPanel.tsx`), covers inviting only and vanishes
the moment one person is invited. Show QR, the run of show and the 10-guest cap are each one
tap away and none is named as a step.

The trouble testers had in the week of 2026-10-03 was mostly BEFORE the app (Apple's
invitation email, TestFlight). That half is the help page, `web/help/index.html`, not this.
This spec is the half that happens inside the app: a host who has the app and does not know
what to do first.

## What she is trying to do
Get her people in, tell them something, and have the night's plan on their screens, without
learning the console first.

## User story
- As a host who has just made a party, I see a short card at the top of Broadcast listing the
  three things worth doing first. Each one shows the button that does it. They tick themselves
  off as they happen, wherever I did them from, and the card goes away when all three are done
  or when I hide it.

## Requirements
1. **The card** (`host-start`) renders at the top of the Broadcast segment for a host seat when
   at least one item is open and the card has not been hidden for this event on this device.
2. **Three items, each ticked by real state**, never by a tap on the card:
   - `host-start-invite`, "Invite your guests": done when `invitedCount > 0` or
     `guestCount > 0`. Sharing from the share sheet leaves no record, so a guest arriving is
     what proves it worked.
   - `host-start-announce`, "Post a first announcement": done when the event has at least one
     broadcast.
   - `host-start-plan`, "Add the plan for the night": done when the run of show has at least
     one row.
3. **Only the first open item draws a button.** Done items are text with a tick. The invite
   item's button is the existing `onShare` ("Share the invitation"); the announce item focuses
   `broadcast-draft`; the plan item focuses the run-of-show composer (`schedule-add`'s field).
4. **The card replaces `empty-room-share`.** Its first item is that nudge, so the old block is
   removed rather than shown twice. The testID `empty-room-share` moves to the invite item's
   button so existing journeys keep their handle.
5. **Hide this** (`host-start-hide`, 24pt minimum target) removes the card for this event on
   this device. Remembered per event id, in the same device storage the session already uses.
   No server column: hiding a hint is not a fact about the party.
6. **No drawn control that does nothing.** No item is ever `aria-disabled`; the
   `empty-world.spec.ts` gate holds.
7. A co-host or DJ sees the card too, since every item is something they can do, and hiding it
   is per device.

## Acceptance
- On `?fresh=1` (0 invited, no broadcasts, no schedule) the host sees `host-start` with three
  open items and exactly one button.
- Joining a guest ticks the invite item without a reload, and the button moves to announce.
- Sending a broadcast ticks announce. Adding a schedule row ticks plan, and the card is gone.
- Hide removes it; a reload of the same event does not bring it back; a different event shows
  it again.
- On `weddingSeed` (everything done) the card never renders.
- `audit:targets`, `audit:keyboard` and the gutter gate stay green.

## Not in this spec
An intro carousel (people skip it, and the hard part was before the app); a guest checklist (a
guest's only hard step is the join, before the app); ticking "showed the QR" (opening a sheet
is not an outcome and nothing records it); the 10-guest cap as an item (it matters only to big
parties, and the plan sheet already says it).
