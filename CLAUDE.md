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

Expo SDK 57 · React Native 0.86.3 · **Node 24.13.0** · pnpm 10.33.0 · expo-router 57.
No NativeWind (see below).

**One Node version, declared by the repo and obeyed by everything.**
`.nvmrc` is the source of truth. `engines.node` is `24.x` — a single major, not a
range — and `.npmrc` sets `engine-strict=true`, so a wrong Node fails
`pnpm install` instead of warning. `docker/checks.Dockerfile` installs that exact
Node over the base image's own, and `run-checks.sh` asserts the two match before
running anything.

This is deliberate and it is the second attempt. The first arrangement let the
Playwright base image choose: checks ran on **v22.18.0** while development ran on
**v24.13.0**, and nothing said a word. Copying the sibling repos' `engines: ">=22"`
would not have caught it either — that range accepts both. If you bump
`@playwright/test`, bump `NODE_VERSION` + `NODE_SHA256` with it, or the assertion
fails loudly. That is the intended behaviour.

**Docker runs the checks; the host runs the app** — because native device
pairing and EAS live outside a container, not because a container cannot serve
Metro here. Measured on this machine: `.wslconfig` sets `networkingMode=mirrored`
and `eth0` is a real LAN address, so a published container port *is* reachable
from a phone; and the bind mount is native ext4 on a block device, so inotify
works and no polling watcher is needed. Do not repeat the folklore — if you ever
want Metro in a container here, the only real obstacle is that it advertises its
container-internal IP in the QR payload, which `REACT_NATIVE_PACKAGER_HOSTNAME`
fixes.

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
pnpm test:e2e                   # Lane B: 106 Playwright journeys, dark + light
pnpm render:canvas              # regenerate design/renders/ from the canvas
```

`pnpm checks` runs the same sequence directly, without Docker, when you are
already inside the container or want it on the host.

### How the container is wired

- Base is `mcr.microsoft.com/playwright:v1.55.0-noble` — **the same version as
  the repo's `@playwright/test` pin**, so its bundled chromium is the one the
  harness expects and no browser is downloaded at run time. If you ever bump
  `@playwright/test`, bump the image tag in `docker/checks.Dockerfile` with it —
  **and its `NODE_VERSION`/`NODE_SHA256`**, because a new base ships a new Node.
- The image's own Node is shadowed by an explicitly pinned one installed to
  `/usr/local` (checksum-verified against nodejs.org). The repo picks the
  runtime; the base image does not.
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

**B — web export → Playwright at 402×874.** Two halves over one `dist/`.

`pnpm shots` walks the screens and writes PNGs, ending with a **colour gate**
that reads base-100 back out of every one — added because the DOM once reported
dark while the screen was light, and only the pixels caught it.

`pnpm test:e2e` runs 106 journey tests (`tests/e2e/`) across both colour
schemes: join and its rejection path, the three guest tabs, the host console,
the pricing ladder and every denial it can render, and the painted theme
tokens. Each spec was written against the canvas and then attacked by a critic
whose only brief was to find assertions that would pass on a broken app; 35
were cut for exactly that. Where an assertion cannot prove what it looks like
it proves, the file says so in its docblock rather than implying coverage it
does not have — `join.spec.ts` is the worked example.

**Both halves need a `dist/` built with `EXPO_PUBLIC_FIDELITY=1`** (`pnpm
export:web` sets it). It injects the iPhone safe-area insets a browser reports
as zero, and renders the `scheme-probe` element every test waits on. Export
without it and the whole suite times out without naming the reason.

**C — Android emulator** (`pnpm android`). Wired up and **load-bearing**. This is
the only *native* rendering evidence obtainable without a Mac, and it earned its
place immediately: it caught an album grid that renders nine tiles on the web and
nothing at all on a device (see `design/FIDELITY.md` note G). Lane A could not see
it because it is not a colour; Lane B could not see it because Lane B runs
through the renderer that gets it right.

```
pnpm android           # builds the dev client and installs to a running emulator
ADB_LIBUSB=0           # REQUIRED on WSL2 -- see below
```

**The AVD ships with `hw.keyboard = no`.** Host keystrokes are silently dropped:
you click into a field, type, and nothing happens — the app looks broken and is
not. Gboard also comes up in floating mode, which makes it look like the field
itself is dead. Fix it in `~/.android/avd/<name>.avd/config.ini`:

```
hw.keyboard = yes        # then restart the emulator; `dumpsys input` should
                         # list "AT Translated Set 2 keyboard"
```

**Driving the emulator from a script — two traps.** `adb shell am start` with a
dev-client URL is **swallowed if the app is already foregrounded**; always
`am force-stop` first or the launch silently no-ops and you debug the wrong
thing. And `adb exec-out screencap` frequently returns a **stale frame** just
after navigation, so a screenshot can show the previous screen while the app has
already moved on. Confirm state with `uiautomator dump` — it reads the live
hierarchy — and treat a screenshot as illustration, not proof.

**`adb` hangs on WSL2 without `ADB_LIBUSB=0`.** `adb start-server` and even
`adb nodaemon server` produce no output at all and never return, because adb
blocks enumerating USB. Export `ADB_LIBUSB=0` and it starts instantly. This costs
an hour if you do not know it.

Device screenshots live in `design/device/`, including the pre-fix broken album
kept deliberately as evidence.

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
- `engine-strict=true` means a wrong Node **fails** `pnpm install`. Run
  `nvm use` first; `.nvmrc` has the version.
- The Playwright image has no `xz`, so the pinned Node is fetched as `.tar.gz`.
- `MemoryRepository.id()` shares one counter across every prefix, and it is
  seeded past the highest number in the fixture (`highestSeedSeq`). It counted
  from zero until an e2e critic caught it: the first guest-submitted song was
  minted `req_1`, which is already Dancing Queen, so two rows rendered the same
  testID and `patchRequest` — which matches by id — patched both. Removing a
  vote from the new song pulled the seeded one down with it. If you add a seed,
  you inherit the fix; if you replace the id scheme, keep the property.
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
