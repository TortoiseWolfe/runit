# 010 — A host who lands as a guest can claim her seat from inside the party (#107)

Status: BUILT 2026-10-04. No wireframe: the surface is one section of an existing sheet,
described below in text (the precedent spec 002 set).

## Problem
Measured at the first wedding beta (2026-10-03). The host made the event in one browser
context and opened her own link in another. That is a second anonymous identity, so she joined
her own party as a guest: *"I'm back in the app but not as a admin idk how to get back in as an
admin"*. The only way back was Chat → Leave → the join screen → code, name, and the recovery key
in "Host key (optional)". Nothing inside the party pointed there; the seat was moved by hand in
production.

## User story
- As a host who finds herself on the guest side of her own party, I tap my name, choose "Running
  this party? Use your host key", paste the key I copied when I made it, and I am the host.

## Requirements
1. The name sheet (opened from the name pill) gains a quiet link, **"Running this party? Use your
   host key →"**, drawn ONLY when the identity holds no host seat. Somebody already staff has
   "Host view →" and does not need it.
2. Tapping it reveals one field (`name-host-key`, capitals, no autocorrect) and, once the field
   is non-empty, **"Become the host"** (`name-host-key-submit`). An empty field draws no button.
3. It calls the existing `session.claimHost({ code: <current event>, key })`. That is the same
   rebind the join screen's key field does (`claim_host`), with no leave and no rejoin. Success:
   toast "You are the host of this event." and go to the host console. A wrong key: the existing
   `bad_host_key` sentence, and she stays a guest with the sheet open.
4. `MemoryRepository.claimHost` sets `holdsHostSeat` as `SupabaseRepository` already does.
   Otherwise the fixture leaves a claimed host without "Host view →", unlike the backend.

## Not in this spec
Detecting that a browser "probably" made the event. It cannot know, and guessing would offer
other people's seats.

## Acceptance
- In a guest-only world (`?guest=1`): a wrong key shows the bad-key sentence and changes nothing.
  The demo key lands on the host console.
- With a host seat already held, the link is not drawn.
