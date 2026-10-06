# 013 — The join screen links the guide

Status: BUILT 2026-10-05. Live in the browser; ships in build 18.
Wireframe: `design/wireframes/2026-10-05-host-getting-started.html` (the join screen section).

## Problem
The first tester to install RunIt without an invitation in hand (the owner's mother,
2026-10-05) opened it to the join screen: a code field she had no code for, and nothing saying
what the app is for. A guide exists, `runit-app.pages.dev/help/` (four folding sections, lane G
reads it back), and no screen in the app linked to it.

## What she is trying to do
Find out what this app does and how to start, without a person beside her.

## Requirements
1. The join screen carries a quiet link, `join-how-it-works`, reading "New here? How RunIt
   works →", just below "Running an event? Make one →". It is shown to everyone: a person
   with no code needs it most, and a guest with a code loses nothing.
2. It opens `INVITE_ORIGIN + '/help/'` in the browser, not inside the app. It is the same page
   anybody can be sent, and its TestFlight half is for people who do not have the app yet.
3. Its target is real padding (24pt or more), not hitSlop, which react-native-web drops.

## Acceptance
- On `?empty=1` the link is visible and a tap opens a page at exactly `/help/`.
- On the default world (a guest with a code) it is still there.
- `audit:targets`, the gutter gate and the contrast gate stay green.

## Not in this spec
The first-run join screen with two plain doors, "Got a code?" and "Hosting?" (#98, spec 004).
This is the cheap half that ships now.
