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

## Running it

```bash
pnpm install
pnpm start          # then press i / a, or scan with Expo Go
```

## Checks

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
