# Runit

An event companion app for iOS. Guests scan a QR or type a code, pick a
nickname, and they are in — no account, no phone number.

**Guests** get three tabs: **Chat** (host announcements and a live "Now / Next"
run of show), **Photos** (a shared album where uploads appear once a host
approves them), and **Music** (request a song, upvote what you want to hear).

**Hosts** get a console: broadcast to everyone, run the DJ queue, and approve
photos into folders.

Built from a Claude Design canvas, which is committed in `design/` and is the
specification for every screen.

## Shipping

| | |
|---|---|
| Store listing name | **RunIt: Event Companion** — plain "RunIt" is taken on the App Store by `se.runit.app`, so a suffix was needed. The SUFFIX is what makes it unique, not the casing: `RunIt: Event Companion` was accepted by App Store Connect on 2026-09-05, which is the availability check. Home-screen name is `RunIt`; the bundle id, slug and scheme stay lowercase (`com.turtlewolfe.runit`, `runit`) — invisible to users, and the bundle id is permanent. |
| Bundle ID | `com.turtlewolfe.runit` |
| Support URL | <https://tortoisewolfe.github.io/runit-legal/support/> — a required App Store Connect field for release; Apple checks it resolves. |
| Apple Team ID | `Y774K5FF67` |
| Privacy policy | <https://tortoisewolfe.github.io/runit-legal/privacy/> — a required, publicly-accessible field in App Store Connect (Guideline 5.1.1(i)). Source: [`TortoiseWolfe/runit-legal`](https://github.com/TortoiseWolfe/runit-legal), public because Pages on a private repo needs a paid plan. |
| Supabase | project `qwusbxallkbzfladvgfx`, org `ieceljlytbxfhtaxvnyq`, us-east-2 |

## Running it

```bash
nvm use             # .nvmrc pins Node 24.13.0
pnpm install
pnpm start          # then press i / a, or scan with Expo Go
```

`engine-strict` is on, so `pnpm install` **fails** rather than warns if you are on
the wrong Node. That is deliberate: the checks container and the dev server used
to run different Node majors without anyone noticing.

The dev server runs on the host — Metro's file watching and device pairing are
what containers make painful. The checks run in Docker; see below.

## Checks

Everything a CI job would do, in a container:

```bash
pnpm checks:docker
```

That runs install, typecheck, lint, the native style audit, the tests, an iOS
bundle check, and the screenshot harness with its colour gate. Screenshots land
in `design/screenshots/` on the host.

Individually, on the host:

```bash
pnpm test           # unit + component tests
pnpm typecheck
pnpm audit:styles   # catches colours React Native cannot parse
pnpm export:web && pnpm shots   # screenshot every screen at 402x874
```

`pnpm render:canvas` regenerates the design reference renders.

**iOS rendering is not verified in CI** — there is no macOS in this development
environment. See `CLAUDE.md` for what the checks do and do not cover.

## Where things are

| Path | |
|---|---|
| `design/` | the design canvas, its renders, and the fidelity notes |
| `src/app/` | routes only |
| `src/features/` | one folder per screen |
| `src/data/` | domain types, the repository interface, the in-memory adapter |
| `src/domain/` | pricing tiers and entitlement checks |
| `src/theme/` | oklch conversion, tokens, provider |

The app runs entirely on an in-memory repository today. Screens depend on the
`RunitRepository` interface and never on an implementation, so a Supabase
adapter drops in without touching a screen — see `src/data/supabase/README.md`.
