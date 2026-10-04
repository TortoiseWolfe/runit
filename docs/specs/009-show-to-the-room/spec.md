# 009 — Show to the room: a full-screen QR (#108, part 1)

Status: BUILDING 2026-10-03. Part 2 of #108 (print: poster and table cards) is a separate spec.

## Problem
Two real events, one result: a host could not put the party in front of a room. S7Y9RX
(2026-09-11) had zero sign-ins; the first wedding beta (2026-10-03) ran all day on the Event
plan and two guests joined besides the host. The planner: *"without a way to publicly
announce it was almost impossible."* The host console's QR is 180px inside the Broadcast
panel, a thing to show one person across a table, and the share sheet reaches one person at
a time.

## User story
- As a host at a venue, I tap **Show QR** and my phone or tablet becomes a sign: the party's
  name, "Scan to join the party", a QR as large as the screen allows, the code in big type,
  and where to type it. I can stand it on a table or hold it up, and the screen does not go
  to sleep.

## Requirements
1. **Show QR** (`host-qr-toggle`, the existing control) opens a full-screen view, `room-qr`,
   instead of the inline 180px QR. One QR control, not two.
2. The QR is sized from the window: the largest square that leaves room for the words,
   between 160 and 640 points, in portrait and landscape. It is the same `EventQr`
   (`event-qr`), so it encodes `joinLink(code)` and Lane F decodes it.
3. The code is large (`event-qr-code`), with the line "or open runit-app.pages.dev and type
   the code" for anybody whose camera will not scan.
4. The screen is kept awake while the view is open (`expo-keep-awake`; on the web the Wake Lock
   API, where a refusal is silent and harmless) and released when it closes.
5. **Done** (`room-qr-close`, 44pt) closes it; so do the system back gesture and Escape.
6. Theme colours, not a forced white page: the QR already sits on its own white plate, and a
   dark screen in a dark room is easier on the guests in front of it.

## Acceptance
- Show QR opens `room-qr`; the QR is at least 70% of the viewport width at 402×874; the code
  and the event name are visible; Done closes it and the QR is gone.
- Lane F (`pnpm verify:qr`) decodes the room QR to `joinLink(code)`.
- `audit:targets` and the gutter gate stay green.

## Not in this spec
Print (poster, table cards), a public-post share variant, AirPlay specifics.
