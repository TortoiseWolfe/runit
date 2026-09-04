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
pnpm start:go                   # host  — same, but targeting Expo Go (see below)
docker compose run --rm checks  # container — everything a CI job would do
```

**`pnpm start` does not target Expo Go, and the failure is opaque.**
`expo-dev-client` is a dependency, and its presence flips `expo start`'s default
target — the QR encodes `exp+runit://expo-development-client/?url=…`, which a
custom Expo Go **cannot open**. Scanning it produces a generic "problem running
the requested app" that names nothing. That cost an hour once.

Use `pnpm start:go` when pairing with an Expo Go client (including the custom
SDK-57 one on TestFlight), and `pnpm start` when pairing with a dev client built
by `pnpm android` or EAS. `--go` is absent from `expo start --help` in SDK 57 but
still works.

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
  the real RN parser and fails the build on any `null`. It resolves that parser
  **through react-native's own tree**, not by a bare `require` — there are two
  copies installed (`0.86.3` via react-native, `0.74.89` via react-native-web) and
  `node-linker=hoisted` means a bare require gets whichever won the hoist. It also
  asserts the parser version equals the installed react-native version. Do **not**
  "fix" this by declaring the parser as a top-level dependency: hoisting makes an
  explicit dep win, which would freeze the parser while react-native moves on —
  trading a loud failure for a quiet wrong answer in the one gate that exists to
  catch quiet wrong answers.

This is also why NativeWind is not used: react-native-web would parse `oklch`
correctly in a browser while the device dropped it, so the web harness would go
green on a broken app.

## Commands

```
pnpm start                      # host: Expo dev server
pnpm start:go                   # host: Expo dev server targeting EXPO GO, not the dev client

pnpm checks:docker              # container: every gate, in one run
pnpm checks:shell               # container: a bash shell in the same image

pnpm test                       # jest
pnpm typecheck                  # tsc --noEmit
pnpm audit:styles               # Lane A: the RN colour-parser gate
pnpm audit:targets              # Lane A2: touch targets, WCAG 2.2 SC 2.5.8 (AA)
pnpm export:web && pnpm shots   # Lane B: screenshots at 402x874 + colour gate
pnpm test:e2e                   # Lane B: 110 Playwright journeys, dark + light
pnpm render:canvas              # regenerate design/renders/ from the canvas
```

`pnpm checks` runs the same sequence directly, without Docker, when you are
already inside the container or want it on the host.

### How the container is wired

- Base is `mcr.microsoft.com/playwright:v1.55.0-noble`, and `@playwright/test` is
  pinned to **exactly** `1.55.0` — no caret. The image ships exactly one browser
  set and pnpm blocks the post-install download that would heal a mismatch, so the
  two have to agree. `run-checks.sh` asserts it. It used to be `^1.55.0` while this
  paragraph called it "the pin"; a seven-minor range is not a pin, and 1.55.1
  already moves chromium 1187 → 1193. If you bump `@playwright/test`, bump the
  image tag with it — **and its `NODE_VERSION`/`NODE_SHA256`**, because a new base
  ships a new Node.
- The image's own Node is shadowed by an explicitly pinned one installed to
  `/usr/local` (checksum-verified against nodejs.org). The repo picks the
  runtime; the base image does not.
- Runs as **uid 1000**, so `dist/` and `design/screenshots/` come back through
  the bind mount owned by you rather than by root.
- `node_modules` is a **named volume**, not the bind mount, so the container's
  install never fights the host's — which `pnpm start` still needs.
- The pnpm store is a named volume too, so repeat runs don't re-download.

## Verification lanes

**A2 — static touch-target audit** (`pnpm audit:targets`). The only lane that can
see a touch target at all: react-native-web **drops `hitSlop`**, so Lane B keeps
reporting failure after a correct fix, and `uiautomator dump` reports
accessibility-tree bounds rather than touch rects, so Lane C is blind too.

It is a **declaration** check, not a geometry check — resolving `StyleSheet.create`
through spreads and conditionals would be a heuristic wearing a measurement's
clothes. It asks whether every `Pressable` declares a reachable target, and carries
the same coverage floor as Lane A.

**The bar is WCAG 2.2 SC 2.5.8 (Level AA) at 24×24**, not 44×44. 44 is SC 2.5.5
(Enhanced), Level AAA — and Apple's HIG number, which is why it gets quoted as
though it were the standard. An audit run at the wrong level reports two dozen
false failures and gets switched off.

**A — static style audit** (`pnpm audit:styles`). The only check that catches a
colour RN cannot parse. Has a coverage floor: if it audits fewer literals than
expected it fails, because a matcher that stops matching passes having measured
nothing.

**B — web export → Playwright at 402×874.** Two halves over one `dist/`.

`pnpm shots` walks the screens and writes PNGs, ending with a **colour gate**
that reads base-100 back out of every one — added because the DOM once reported
dark while the screen was light, and only the pixels caught it — and a **contrast
gate** that composites every rendered text colour over its painted backdrop and
fails below WCAG AA. Contrast, unlike `hitSlop`, is honestly measurable in this
lane: `alpha()` emits a real `rgba()` over real DOM backgrounds.

`pnpm test:e2e` runs 110 journey tests (`tests/e2e/`) across both colour
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

**C — Android emulator** (`pnpm android`). Wired up and **load-bearing**. It has
now also witnessed a real camera capture end to end — permission prompt, system
camera, resized JPEG written to the app's own cache, and the image rendering in
the host approval queue beside seeded rows that still show their hue tile
(`design/device/android-host-photos-capture.dark.png`). No other lane can do
that: react-native-web has no camera. This is
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

**E — policy verification** (`pnpm verify:policies`). The only lane that can
see row-level security behave. It runs `supabase/verify-policies.sql`, which seeds an
event, a guest and a host inside a `DO` block, switches
role with `set local role authenticated` and a forged `request.jwt.claims`, asserts
sixteen behaviours, and RAISES at the end so nothing commits -- the "error" it
prints IS the report.

**It skips LOUDLY without `SUPABASE_DB_URL`**, and that is deliberate. Running it
needs a database password, and CI here is one public-repo job with no secret store; a
gate that failed closed would be switched off within a week. So it prints a yellow
SKIPPED block naming what went unchecked. Set the URL and re-run before trusting a
green board after any migration change:

```
export SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres'
pnpm verify:policies
```

It used to be a paragraph telling you to paste SQL into a web editor. A harness
nobody runs measures something once and guards nothing.

It exists because reading a policy tells you what it says, not what Postgres does
with it. The load-bearing result is that **a guest's UPDATE on `events` returns zero
rows and raises nothing** -- the silent shape `SupabaseRepository.assertWrote()`
exists to catch, and one no amount of reading the policy would have settled.

Two traps it already fell into, both of which make a *passing* statement look like a
failing one: `text[] || 'a literal'` parses the literal as an ARRAY LITERAL and
raises 22P02 inside whatever exception handler you are standing in; and several
assertions in one `UNION` share a single statement snapshot, so a `STABLE` function
cannot see a row a sibling branch just inserted. `join_event` looked broken twice and
was fine both times.

**Compare within ONE environment.** The same source renders differently on the
host than in the checks container — 5.53% of pixels on the join screen — because
the app pins no fonts and the two machines have different ones. `renders/` is
committed and was generated **on the host, in DejaVu**; `screenshots/` belongs to
whichever ran `pnpm shots` last. `design/screenshots/.provenance.json` records
which. Regenerate on the host before a Lane D read, or you will read a wrap
difference as a fidelity regression that no code caused. See FIDELITY note 6 and
issue #6.

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
- `fade` (`src/theme/typography.ts`) is **per-scheme and comes from `useTheme()`**,
  not from the module import. The canvas's single ramp fails WCAG AA — the two
  schemes need different numbers because `#1F2937` on `#F5F0EB` has less headroom
  than `#E2E8F0` on `#1A1A2E`. Never multiply two levels together; a product cannot
  be fixed by raising the ramp. FIDELITY note H.
- `schedule.start()` refuses to move the run-of-show cursor **backwards** unless
  passed `{ rewind: true }`. `nowScheduleItemId` drives every guest's Now/Next card,
  so a mis-tap on a past row rewound the evening for the whole room. FIDELITY note I.
- **Capture lives in `src/lib/`, not behind the repository.** A camera is a device
  concern; putting `ImagePicker` behind `RunitRepository` would make a Supabase
  adapter carry one. `upload()` takes a URI, which is also the right currency —
  an adapter can `fetch(uri).blob()`, and the cap check runs before any bytes are
  materialised.
- **`capture.web.ts` returns a synthetic 1×1 PNG under `EXPO_PUBLIC_FIDELITY=1`.**
  Without it the harness hangs: a real `<input type=file>` opens an OS chooser
  that nothing in `shoot-app.mjs` answers, and headless Chromium refuses
  `getUserMedia`. `guest-photos.spec.ts` asserts that exact data URI, which is
  what proves the value came from the capture path and not from a literal.
- **`photos.pending` is the host's queue and selects `'pending'` ONLY.** In-flight
  and failed uploads go to `photos.mine`, scoped to the uploading guest. Putting
  `'uploading'` back into `pending` gives the host Approve/Hide over a photo with
  no bytes — it was that way once, and a test now fails if it returns.
- `Photo.localUri` (device path) and `Photo.storagePath` (remote key) are
  **separate fields on purpose**. Conflating them hands a `file://` to a
  signed-URL resolver the day an adapter exists.
- The join screen shows "N already here" (`join-guest-count`). It is **not** in the
  canvas — it exists so the e2e suite can prove joining *increments* the room
  rather than merely that the room reads 173 afterwards. FIDELITY note J.
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

- **A real backend to upload to.** Capture, progress, retry and the `failed`
  state all work (FIDELITY notes K and L), but the in-memory adapter's transfer
  completes instantly because nothing is being sent anywhere. The states exist
  for the Supabase adapter to drive; until it lands they are reachable only via
  the injectable transfer (`fixtures/flakyTransfer.ts`, or `?flaky=1` in the
  harness).
- Supabase adapter (`src/data/supabase/README.md` holds the contract).
- Push notifications, host invites, calendar export.
- **QR scanning** — intended (the README says so, and the canvas's "Scanned the QR?"
  copy sits over a pre-filled field standing in for it). Not built. Tracked as a
  named item on issue #1 rather than buried here, because it is a product promise,
  not a nice-to-have. `expo-camera` is bundled in Expo Go 57.0.9 (verified by dex
  grep) and `CameraView` has `barcodeScannerSettings`, so it needs no extra library
  — but a scanner is only useful once a code identifies a real event, so it belongs
  after the backend.
