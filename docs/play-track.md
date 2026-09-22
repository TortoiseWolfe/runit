# The Play closed track, and the twelve testers

**Status: not started.** There is no Google Play developer account for this app. Nothing in
`ACCOUNTS.md` names one, and `eas.json` carries `submit.production.ios` only — no Android
submit block, no service-account key, no track.

## The rule, from Google rather than from a blog

> a minimum of 12 testers who have been opted in continuously for at least 14 days

— [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465)

It was **20 until December 2024**, which is why that number is still everywhere.

**It gates PRODUCTION, not testing.** Google: *"Certain features in Play Console, such as
Production and Pre-registration, remain disabled until developers meet these testing
requirements."* Closed testing starts as soon as setup is done — so this is not a wall in
front of the beta, it is **a 14-day clock that cannot start until the account exists**.

**It applies to personal accounts created after 2023-11-13.** Whenever one is created here it
will be after that date, so it applies. The organization exemption is real and is almost
certainly closed for the same reason Apple's was: it needs a D-U-N-S number, business
documents and Search Console verification, over weeks. `ACCOUNTS.md` records that call for
Apple — Individual membership, *"Decided 2026-09-12: branding only."*

**One widely repeated claim is not Google's.** Several 2026 blogs say Google now checks that
testers genuinely *used* the app. Google's own page says no such thing; it only recommends
encouraging testers to *"use as many features as possible to provide holistic feedback."*
Treat the stronger version as folklore until Google writes it down — the same rule this repo
applies to App Store Connect enums.

## Why this is also the fix for the expiring link

The Android beta today is a sideloaded EAS `internal` APK and **its link dies fourteen days
after it is built** — 2026-10-05 for the current one, then every fortnight. Lane G fails the
day it does, and the invitation page's Install button answers 400 while saying nothing.

Play's closed testing track does not expire. So #82's durable fix and this production gate
are the same piece of work.

## What is already done in the repo

- **`production` already emits an `.aab`.** `eas.json`'s `production` profile sets no
  `distribution`, so it defaults to `store`, which is the bundle Play wants. Only `preview`
  and `development` force an APK via `distribution: internal`. Nothing to change.
- **`app.json` already declares the app link** — `android.intentFilters` with
  `autoVerify: true` on `https://runit-app.pages.dev/i`.
- **The fingerprint trap is guarded.** See below; `src/lib/appConfig.test.ts` fails the moment
  Play is wired without it.

## The one that breaks silently: `assetlinks.json`

`web/.well-known/assetlinks.json` publishes **one** SHA-256 fingerprint — the EAS signing key.
Android matches it against the certificate the installed APK was signed with, **at install
time**.

**Play App Signing re-signs every upload with Google's own certificate.** Its fingerprint is
not the one in that file. The day a tester installs from Play:

- every `/i/CODE` link stops opening the app and opens a browser instead,
- for every Play-installed tester,
- with no error, no crash, and nothing in any log,
- while **lane G stays green** — it checks that the served file matches the local one and
  names our package, and both remain true.

`src/lib/appConfig.test.ts` ties the two facts together: it asserts one fingerprint while no
Android submit target exists, and **two** the moment one does. It cannot check the second is
the *right* one — only an install proves that — but it refuses to let the pair drift apart
unnoticed, which is the whole failure mode.

## The runbook — the parts only a Google login can do

1. **Create the account.** $25, once, at [play.google.com/console](https://play.google.com/console).
   Personal. Identity verification takes a few days.
2. **Create the app**, package `com.turtlewolfe.runit`. It must match `app.json`'s
   `android.package`; the test above asserts `assetlinks.json` agrees.
3. **Build and upload the first bundle:** `eas build -p android --profile production`.
   Read `eas account:usage turtlewolfe --json` first — **the free quota is per platform**,
   15 Android and 15 iOS a cycle, and one is not the other's.
4. **Read the Play app-signing fingerprint back.**
   `https://play.google.com/console/u/0/developers/<developerId>/app/<appId>/keymanagement`
   — copy the **SHA-256 certificate fingerprint** under *App signing key certificate*, not
   the upload key.

   **That URL cannot be written out here yet**, because both ids are minted when the account
   and the app are created and neither exists. Paste the real one into this file at step 2
   so the next person does not have to hunt for it. Until then:
   [play.google.com/console](https://play.google.com/console) → your app → *Test and release*
   → *Setup* → *App signing*.
5. **Put it in `web/.well-known/assetlinks.json`**, alongside the EAS one, and
   `pnpm deploy:web` from `main`. Both fingerprints stay: sideloaded builds and Play builds
   are signed differently and both must verify.
6. **Add `submit.production.android`** to `eas.json` with the track. The fingerprint test is
   what stops step 6 happening before step 5.
7. **Create the closed track**, add the 12 testers by email or Google Group, and send them the
   opt-in link. **The clock starts when they opt in, not when you invite them**, and it resets
   if the count drops below 12.
8. **After 14 days**, apply for production access on the Play Console dashboard.

## What the testers need from us, and what they already have

They need to be able to report a problem from wherever they get stuck. That is built:

- `web/i/index.html` carries a **Didn't work?** block — the bridge page is the one surface
  every arrival passes through and the one where a cohort of forty demonstrably stopped.
- Inside the app the control is on the join screen, both guest tabs, **all five host console
  segments**, `/signin` and `+not-found`. `pnpm audit:feedback` fails the board if a route
  loses it.
- A report becomes a `from-a-customer` GitHub issue within the hour, automatically.

**None of that counts toward Google's 12.** Those must be real Play opt-ins on the closed
track. Two different things share the word "tester"; only one of them is a Play row.
