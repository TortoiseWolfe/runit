# CLAUDE.md — Runit

Guidance for Claude Code working in this repository.

## What this is

An event companion iOS app, built from a Claude Design canvas. Guests join with
a code and a nickname — no account, no phone number — and get three tabs: Chat
(host announcements plus a run-of-show), Photos (a shared album where uploads
wait for host approval), Music (song requests ranked by guest upvotes). Hosts
get a console: Broadcast, DJ queue, Photo approvals. There is a four-tier
pricing ladder with working entitlement gates.

**The design is the spec, and it lives in `design/`.** Read `design/README.md`
before changing any screen.

## Stack

Expo SDK 57 · React Native 0.86.3 · React 19.2.3 · expo-router 57 · pnpm.
No NativeWind (see below).

**Docker runs the checks; the host runs the app.** The workspace Docker-first
rule targets the web projects, and ScanDo is already marked as an exception —
but that exception only needs to cover the parts a container genuinely makes
worse. Metro's file watching, device pairing and hot reload are those parts.
Everything else (tsc, eslint, jest, the style audit, expo export, the Playwright
harness) is pure Node and runs containerised.

```
pnpm start                      # host  — Metro, devices, hot reload
docker compose run --rm checks  # container — everything a CI job would do
```

## The constraint everything is shaped by

**React Native cannot parse `oklch()`.** Its colour parser takes hex, named
colours, rgb/rgba, hsl/hsla and hwb. Anything else normalises to `null`, which
renders transparent — silently, with no error.

Every colour in the design is `oklch()`. So:

- `src/theme/oklch.ts` converts, and the canvas's runtime-generated hues
  (album tiles, photo placeholders) go through it at render time.
- `src/theme/tokens.ts` holds converted hex, each carrying its oklch source.
- `src/theme/tokens.test.ts` re-parses `design/theme.css`, re-runs the
  conversion, and fails on any drift. **Never hand-edit a token.**
- `tools/audit-native-styles.mjs` runs every colour literal in `src/` through
  the real RN parser and fails the build on any `null`.

This is also why NativeWind is not used: react-native-web would parse `oklch`
correctly in a browser while the device dropped it, so the web harness would go
green on a broken app.

## Commands

```
pnpm start                      # host: Expo dev server

pnpm checks:docker              # container: every gate, in one run
pnpm checks:shell               # container: a bash shell in the same image

pnpm test                       # jest
pnpm typecheck                  # tsc --noEmit
pnpm audit:styles               # Lane A: the RN colour-parser gate
pnpm export:web && pnpm shots   # Lane B: screenshots at 402x874 + colour gate
pnpm render:canvas              # regenerate design/renders/ from the canvas
```

`pnpm checks` runs the same sequence directly, without Docker, when you are
already inside the container or want it on the host.

### How the container is wired

- Base is `mcr.microsoft.com/playwright:v1.55.0-noble` — **the same version as
  the repo's `@playwright/test` pin**, so its bundled chromium is the one the
  harness expects and no browser is downloaded at run time. If you ever bump
  `@playwright/test`, bump the image tag in `docker/checks.Dockerfile` with it.
- Runs as **uid 1000**, so `dist/` and `design/screenshots/` come back through
  the bind mount owned by you rather than by root.
- `node_modules` is a **named volume**, not the bind mount, so the container's
  install never fights the host's — which `pnpm start` still needs.
- The pnpm store is a named volume too, so repeat runs don't re-download.

## Verification lanes

**A — static style audit** (`pnpm audit:styles`). The only check that catches a
colour RN cannot parse. Has a coverage floor: if it audits fewer literals than
expected it fails, because a matcher that stops matching passes having measured
nothing.

**B — web export → Playwright at 402×874** (`pnpm shots`). Validates layout,
colour, copy and the state machine. Ends with a **colour gate** that reads
base-100 back out of every PNG — added because the DOM once reported dark while
the screen was light, and only the pixels caught it.

**C — Android emulator.** `/dev/kvm` is available and the `consemble` AVD
exists. Not wired up yet.

**D — the eye.** Read `design/renders/<screen>.png` and
`design/screenshots/<screen>.png` in the same message and walk the regions in
order. Programmatic probes catch a different class of thing; neither substitutes
for the other.

### iOS is not verified here — say so plainly

There is no Mac in this environment (`xcrun` absent, WSL2). **iOS pixels cannot
be produced on this machine.** Lanes A and B run through react-native-web, not
native. A green run does **not** mean iOS is fine. Real iOS verification needs
EAS Build onto a physical device. Do not let anyone read a green check as iOS
coverage.

## Architecture

```
src/app/        routes ONLY. Root layout is the one place a repository
                implementation is named.
src/features/   one folder per screen
src/components/ ui/ and icons/ — only what genuinely crosses features
src/data/       types, the RunitRepository interface, the in-memory adapter
src/state/      providers, read hooks, write actions
src/domain/     tiers and entitlements
src/theme/      the converter, tokens, provider, layout, typography
```

**The seam.** Screens depend on `RunitRepository`, never an implementation. An
ESLint `no-restricted-imports` rule enforces it. That is what makes swapping in
Supabase a checked property rather than an intention. Reads are observables from
day one because the eventual backend is realtime.

**Entitlements are enforced in repository methods, not in `onPress`.** A check
that lives in a button handler is bypassed by the second caller.

## Things that will bite you

- `@testing-library/react-native` v14 made `render` **async**. Un-awaited,
  `screen` stays empty and every query fails with "`render` function has not
  been called", which points nowhere near the cause.
- `web.output` is `"single"`, not `"static"`, and that is load-bearing. See
  `design/FIDELITY.md` note F.
- The React Compiler lint rules reject reading a ref during render and
  `setState` inside an effect. Both rejections were correct.
- TypeScript is pinned to 5.9 (typescript-eslint does not support TS 7) and
  ESLint to 9 (10 breaks eslint-plugin-react).
- The demo wedding sits on the Event tier where nothing is capped, so the
  gating layer is invisible against it. Use the `housePartySeed` fixture to see
  it work.

## Working from the design

1. **Look at the render first.** `design/renders/*.png`. Always.
2. The inline `style=` attributes in `Runit.dc.html` **are** the spec. There is
   not a single CSS class in the document.
3. Never extract copy with a tag-stripping regex — it deletes every style
   attribute and every SVG.
4. `design/ios-frame.jsx` is **canvas chrome**, not app code. Its 62px status
   bar and 34px home indicator are why the artboards pad 66/70/28. Those become
   real safe-area insets; copying them verbatim double-counts.
5. Record any deliberate divergence in `design/FIDELITY.md` so it is decided
   once, not re-litigated.

## Not built yet

- Real photo capture. `upload()` creates a record with no bytes behind it —
  permissions, capture, resize, progress, retry and a `failed` state are all
  absent. This is the largest remaining chunk of real work.
- Supabase adapter (`src/data/supabase/README.md` holds the contract).
- Push notifications, host invites, QR scanning, calendar export.
