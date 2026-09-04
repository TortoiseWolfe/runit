# Apple Developer Support ticket — MusicKit for event playback

**Status:** drafted, not sent. One free technical support incident (TSI) or a
Developer Support contact. Send before any MusicKit work starts; the answer to
Q1 decides whether the feature exists at all.

**Why the order changed.** The original question was "can an Individual account
ship MusicKit playback?" That is the *smaller* question and it is downstream of a
licensing one. Apple Music is licensed for personal, non-commercial use; a
designated phone driving a PA at an event is at least arguably a public
performance. If the answer to Q1 is no, Q2 and Q3 never matter.

---

## Subject

MusicKit playback in an event-companion app: permitted use, and account type

## Body

I am building an iOS app (bundle id `com.turtlewolfe.runit`, Apple ID 6808766120)
for private events — weddings, birthdays, parties. Guests join with a short code
and can request songs; a host accepts requests into a queue.

Today the app only *displays* what is playing. The host plays the music by hand on
whatever they already use. I want to check three things before integrating MusicKit
so that one designated device could play the accepted queue automatically.

**1. Permitted use.** In the intended setup, ONE designated device — the host's or
DJ's, signed in to their own Apple Music subscription — is connected to a PA or
speaker system, and the room hears it. Other guests' devices only show the track
title; they play nothing. Is playback in that configuration within the terms of an
individual Apple Music subscription, or does it require a different licence,
agreement, or product? If it is not permitted, is there an Apple offering that
covers it?

**2. Account type.** My membership is an Individual (sole proprietor) account, not
an Organization. Can an Individual membership create a MusicKit identifier and
private key under Certificates, Identifiers & Profiles → Keys, and ship an app that
uses `ApplicationMusicPlayer` for full-track playback to a subscriber?

**3. Entitlements.** Beyond the MusicKit key and `NSAppleMusicUsageDescription`, is
any additional entitlement, capability, or review step required for full-track
playback (as distinct from 30-second previews or catalog metadata only)?

I would rather not build this and find out at review. Thank you.

---

## What to do with each answer

| Answer to Q1 | What it means |
|---|---|
| Permitted as described | Proceed to Q2/Q3. The DJ-phone plan in the strategy plan is live. |
| Not permitted | The feature is dead as designed. The app keeps DISPLAYING now-playing, which needs no MusicKit at all and is already shipped. Consider local-library or host-supplied audio instead. |
| "Depends on the venue's licence" | Runit must not decide this for its users. The honest shape is a host-facing note that they are responsible for their event's music licensing, and no automation that implies otherwise. |

## What this does NOT affect

Nothing currently in the build. `now_playing` is written by `play_next()` and
rendered on every phone; Runit is not the audio source and integrates no music
service. This ticket gates only the proposed MusicKit addition.

## Sources behind the reframing

- Apple Music personal subscriptions are licensed for private, non-commercial use;
  playing to a venue is a public performance requiring separate licensing.
- In the US, public performance normally means ASCAP / BMI / SESAC / GMR licences,
  usually held by the venue rather than by an app or a guest.
- A private wedding may fall inside the "normal circle of a family and its social
  acquaintances" exemption; a 300-person corporate event plainly does not. The
  distinction is the event's, not the app's — which is exactly why Runit should not
  automate past it without an answer.
