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
pnpm audit:keyboard             # Lane A3: keyboard strategy + return-key contract
pnpm audit:rpc                  # do .rpc() argument names exist on the function they are sent to
pnpm export:web && pnpm shots   # Lane B: screenshots at 402x874 + colour gate
pnpm test:e2e                   # Lane B: 270 Playwright journeys, dark + light
pnpm verify:links               # Lane G: is the invitation host OURS, and does it serve JSON
pnpm qr:poster                  # regenerate the scan target from the app's own EventQr
pnpm scan:device                # Lane C: witness expo-camera reading that QR off a real lens
pnpm export:web:live            # Lane H: build the export against SUPABASE, not the fixture
pnpm smoke:live                 # Lane H: drive the SHIPPING adapter against the live project
pnpm feedback:sync              # TestFlight tester feedback -> GitHub issues
pnpm render:canvas              # regenerate design/renders/ from the canvas
pnpm icons                      # regenerate assets/*.png from design/brand/runit-logo.svg
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

**A2 knows about modal backdrops now**, rather than exempting them one file at a time. A
`flex: 1` Pressable inside a `<Modal>` is the largest target in the app and `flex` resolves
at runtime, so there is no number to read; the rule matches the STYLE and the enclosing
`<Modal>`, never the name, because a name is not a measurement. Two exemptions were deleted
when it landed. FIDELITY note AG.

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

**A3 — static keyboard audit** (`pnpm audit:keyboard`). Same band, same doctrine: no
lane that runs in CI can see a soft keyboard. Chromium has none to raise, and
react-native-web renders `KeyboardAvoidingView` as a plain `View` with `behavior`
stripped while its `View` filters `keyboardShouldPersistTaps`, `submitBehavior` and
`automaticallyAdjustKeyboardInsets` out before they reach the DOM — so a Playwright
assertion passes identically on a correct fix and on no fix at all.

It checks that every screen holding a `TextInput` names a strategy, that every
`ScrollView` beside one declares `keyboardShouldPersistTaps` (RN's `'never'` default
eats the first tap on any button while the keyboard is up), and that every single-line
input wiring `onSubmitEditing` also declares `submitBehavior` rather than inheriting
it. It does **not** try to prove a `KeyboardAvoidingView` wraps a given input —
JoinScreen's wraps `Screen`, in another file — for the same reason A2 refuses to
resolve `StyleSheet.create`. FIDELITY note Q.

**Android does not resize for the keyboard here**, measured rather than assumed:
`edgeToEdgeEnabled=true` plus targetSdk 36 makes the manifest's `adjustResize` inert,
so the IME overlays exactly as on iOS. `/android` is gitignored prebuild output, so
that manifest line is Expo's default and not a decision — any real change goes through
`app.json`'s `android.softwareKeyboardLayoutMode`.

**RPC NAME AUDIT** (`pnpm audit:rpc`) -- #20's residue, and credential-free. PostgREST
resolves RPC overloads **by argument name**, so `p_titel` is a runtime 404 against a function
that exists: not a type error, not a crash, just a dead feature. **Nothing else in CI can see
it.** `database.types.ts` is HAND-WRITTEN, so tsc checks the call against whatever a human
last typed; `FakeClient` records what was sent and never evaluates it; lane B boots
`MemoryRepository`, which has no RPCs at all. Only lane H could, and lane H writes to
production and is deliberately not in `run-checks.sh`.

So it asks the same question of two files that are both in the repository: every
`.rpc('name', {...})` in `SupabaseRepository.ts` against the parameters
`create or replace function public.name(...)` declares. **Names only** -- not types, defaults
or order, for the same reason A2 refuses to resolve `StyleSheet.create`. Carries a coverage
floor, and catches the migration side too: dropping a parameter the client still sends fails
it. **The schema fingerprint cannot do this** -- it hashes a function as
`proname(identity_arguments)`, the SIGNATURE, so a body can be replaced wholesale under six
green lines.

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

...and a **gutter gate**, on the same footing and for the same reason. `padding` is not
`hitSlop`: react-native-web renders `paddingHorizontal` as real CSS padding on a real
element, so `getBoundingClientRect()` reports where the pixels actually are. It asserts
one narrow thing — **nothing readable or tappable within 8px of either edge** — not that
every gutter is 20, which would fail the tab bar (12) and the join screen (24) and be
switched off inside a week. `<Screen>` sets VERTICAL insets only, by design, so a content
container that omits `paddingHorizontal` renders flush at x=0; that shipped on both create
screens, including the one that prints the recovery key. FIDELITY note X.

`pnpm test:e2e` runs 326 journey tests (`tests/e2e/`) across both colour
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

**`initialMetrics` ALONE DID NOT DO THAT, AND THIS FILE SAID OTHERWISE FOR MONTHS.**
`react-native-safe-area-context`'s web provider measures `env(safe-area-inset-*)` on mount
and reports zero, overwriting whatever was injected — so every screenshot was taken with
the insets collapsed while `design/renders/` was drawn from artboards that pad 66/70/28
*because* of the device frame. Lane D was comparing a ~70pt offset and reading it as close
enough. The metrics now go straight into `SafeAreaInsetsContext` and `SafeAreaFrameContext`
inside the provider, and a hidden `inset-probe` renders what `useSafeAreaInsets()` actually
returns so `pnpm shots` fails loudly if it is ever discarded again. #7, FIDELITY note AN.

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
pnpm scan:device       # Lane C, scripted: the QR scanner, witnessed
ADB_LIBUSB=0           # REQUIRED on WSL2 -- see below
```

**Lane C is a SCRIPT now, not a hand-driven session** (`pnpm scan:device`, #42,
`docs/qr-scan-lane.md`). It hangs a QR generated by the app's own `EventQr` on the virtual
scene's wall, walks the virtual device to it, and asserts the code arrives in `join-code` —
which nothing but the camera can put there. It also **measures that the preview paints**,
because `CameraView` mounts long before it produces a frame and a black SurfaceView passes
every check short of reading pixels.

**IT RUNS IN CI NOW, AND THE PREVIEW PAINTS THERE (#46).** `.github/workflows/lane-c.yml`,
dispatch-only, `gh workflow run lane-c.yml`. The doubt recorded in its own header — that the
virtual-scene camera under swiftshader "may simply not work on a hosted runner" — is
answered: the emulator boots in ~40s under `-camera-back virtualscene -gpu
swiftshader_indirect`, Gradle builds the dev client in ~11m, and the lane reads **SR1017 off
the wall with `the preview is painting (mean 86.6, spread 32.5)`**. A dead surface is
near-zero on both numbers, so that line is the measurement, not a hope.

**It took six runs and every failure was the HARNESS, never the app.** Two of them are worth
knowing because both make a working app look broken:

**`android-emulator-runner` splits `script:` on newlines and runs EACH LINE in its own
`sh -c`.** A multi-line block is therefore not a script; it is a list of one-liners that
share nothing. `set -eu` applied to a shell that exited immediately, `export ADB_LIBUSB=0`
never reached `scan:device`, `pnpm start &` was backgrounded into a shell that then exited,
and a `for` loop was torn from its `done` — and only the loop said anything out loud. That
is why the whole thing lives in `tools/lane-c-ci.sh` and the workflow's `script:` is ONE
LINE. Anything added there goes in the file instead.

**expo-dev-client shows a one-time developer-menu sheet on the first launch of a freshly
installed build, and it covers the join screen.** It is a WINDOW, and `uiautomator dump`
reports the topmost one only — so `join-code` is genuinely absent from the hierarchy while
the join screen sits fully rendered behind it. Invisible on this machine, because the dev
client here was onboarded long ago and the flag persists; CI installs a new APK every run,
so it appears every run. Three CI failures read `the app never reached the join screen`
while the screenshot beside them showed the event name and the headcount. `scan:device`
dismisses it now, from the same dump the `join-code` lookup just missed.

**AND IT LEAVES STATE WHEN IT FAILS**, which it did not for the first five runs. `fail()`
printed a sentence and exited, so the one process that could see the device threw away
everything it knew — three consecutive failures could be diagnosed only by running a
fourth. It writes `test-results/lane-c/` now: `screen.png`, `hierarchy.xml` and
`logcat.txt`, the siblings of `test-results/lane-b` and `lane-h`. Deliberately NOT
`design/device/`, which holds COMMITTED evidence: the CI artifact was pointed there and
uploaded five PNGs straight out of the checkout, presenting files already in git as frames
from the run.

Three traps it paid for earlier, all of which make a BROKEN run look fine or a FINE run look broken:
`virtualscene-image` answers OK whether or not it did anything, so the poster must be hung
**before** the scanner opens or the lane silently reads whatever `-virtualscene-poster` put
there at launch; `adb reverse tcp:8081 tcp:8081` is installed by `expo run:android` as a side
effect, so the lane worked only until the emulator was restarted; and `am force-stop` returns
before the process is gone, so the launch intent after it is swallowed exactly as if there
had been no force-stop.

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

**It is a COMPARISON, so it does not run at all on a screen with no render** -- and it
does not fail either, it silently measures nothing. **`pnpm shots` now says which**, in a
pairing gate beside the colour, contrast and gutter ones (#35). Do not read "all gates
green" as "every screen was looked at"; read the gate's own lines.

Measured, and it was worse than #35 recorded: **8 of 11 walked screens pair, and the five
that did not were two different problems.** THREE have no render at all --
`00-create-event` and `00-create-key` came from `docs/design-host-accounts.md` rather than
the canvas, and `03-host-event` is a fourth host segment the canvas never drew, recorded
nowhere until the gate counted it. TWO had a render under a different NAME: the canvas
draws two states of the music and photos tabs and the walk shoots one, so following the
instruction above literally found nothing and lane D had never run on either.

**The variant mappings were READ, not guessed, and the obvious guess is wrong.**
`02-guest-music` pairs with `-nowplaying`, NOT `-list`: both draw the queue, only one draws
the Now Playing card, and the walk's music tab has it. A mapping to the wrong render is an
absent check replaced by a WRONG one, which is worse than the gap.

**The gate does not fail on the three.** It fails on a screen in neither the manifest nor
`renders/`, so a new screen costs one line and a sentence -- and the manifest must be a
bijection with the walk, so a stale entry fails too. A gate that reds the normal path is a
gate that gets switched off.

**F — QR decode** (`pnpm verify:qr`). The only check that reads what the QR actually
ENCODES. It drives the web export to the host console, opens the QR, screenshots that
element and decodes the pixels with jsQR.

An e2e assertion on `[data-testid="event-qr"]` proves a box is on screen and nothing about
what is in it — and a QR encoding the wrong string renders perfectly, scans perfectly, and
takes the guest nowhere. Chromium's `BarcodeDetector` is unavailable on this platform
(checked), so decoding is the only route. It also fails when the code is merely
undecodable, which is the contrast/quiet-zone/resolution class a camera in a dim room
would hit.

**H — the adapter that ships, against the database that ships** (`pnpm export:web:live &&
pnpm smoke:live`). Forty checks driving `SupabaseRepository` through a real browser against
the live project: `create_event`, the founding host seat, a broadcast round-tripping through
realtime, a founder taking a guest seat (#37), her seat NOT counted in the room,
`request_song` both inserting and merging (#44), and **the whole photo chain** — two objects
uploaded, the album rendering a SIGNED THUMBNAIL that has actually decoded, and the viewer
signing the full-size object by a different path.

**The photo assertions have three clauses and all three are load-bearing.** An `<img>` whose
src 403s renders nothing while every DOM assertion still passes; and decoding alone is
satisfied by the `data:` URI of the guest's own bytes, which would prove only that
`capture.web.ts` works. So: decoded, AND a signed storage URL, AND naming `_t.jpg`.
Mutation-checked by deleting `displayUrl` from `photoCache`'s comparator — the exact failure
its own comment warns about — which turns the album red and leaves the viewer green, because
the viewer resolves on demand rather than through the comparator.

**A SECOND BROWSER CONTEXT is what unlocks the rest.** Reports refuse a self-report,
blocking needs somebody to block, and "seen by" needs a reader who is not the author — none
of it reachable with one identity. It is also the only test of realtime BETWEEN clients
rather than a client hearing its own echo, and it makes two numbers real that Memory cannot
model: the room reading 1 while `guests` holds 2 (`guest_seats` excluding the host's seat),
and `seen_count` moving off zero.

**Exactly ONE assertion there is about realtime delivery** — the broadcast, which reports
its own latency. Every host segment refetches on navigation, so "the row reached the queue"
and "a websocket pushed it in N seconds" are different claims, and blurring them is how a
lane earns a reputation for flakiness. Measured: realtime usually lands in 240ms–1.2s, and
twice in ~15 runs a row never arrived (#45). Folded counters need the same care —
`fold_invited_count` reaching the composer read "Send to 0 guests" once in four runs when
read immediately instead of waited for.

**PHOTO MODERATION IS COVERED NOW, and the reason it was not has gone rather than the
risk.** This paragraph said the approval queue "has no reachable state in any event the app
can currently create", which was true and was the defect: `create_event` mints
`house_party`, which auto-approved, and no client can set `events.tier` (#30). Approval is a
switch on the EVENT now — any tier, default off — so the lane creates a free event, turns it
on, uploads as a guest, and asserts the photo is ABSENT from the album, PRESENT in the host
queue, and in front of the room once approved. Only this lane can see that chain: the column
has to be in the UPDATE grant or PostgREST fails the whole statement with 42501, the write
has to match `events_host_update` or it affects zero rows silently, and `set_photo_status`
is a SECURITY DEFINER trigger reading a column the client cannot name on INSERT. Lane B
proves none of it — it boots `MemoryRepository`, where the flag is a field on an object.

**The assertion it turns on is the TOAST, not the toggle's own label**, which the first
draft got wrong: it failed on its first run with `photo_moderation = true` already in
Postgres and the button still reading Off. The label repaints from the `events` observable,
fed by a realtime channel, so waiting on it asserts WEBSOCKET DELIVERY while claiming to
assert a write. Exactly one assertion in this lane is about realtime, deliberately.

**Push is still NOT covered, and it is not a matter of effort.** `push.web.ts` returns null
by design — a fake token would be stored as a routable address that routes nowhere. It is
printed at the end of every run so a green board is not read as "the backend works".

**It sweeps its own bytes, and the ORDER is the lesson.** `event_photos_delete` requires the
EVENT to still exist (`is_host(foldername(name)[1])`), so deleting rows first strands the
objects where nothing but a service role can reach them — `storage.protect_delete()` refuses
direct SQL. `init.sql` has said "BYTES FIRST, ROW SECOND" since the first migration and it
was still got wrong here, stranding 840 bytes. `docs/smoke-live.md`.

**It is the only lane that can see four things.** RPC ARGUMENT NAMES — PostgREST resolves
overloads by name, so `p_titel` is a runtime 404 against a function that exists, and
`database.types.ts` is hand-written. COLUMN NAMES AND FILTERS — `FakeClient` records what
was sent and never evaluates it. RLS ADMITTING what the app needs — Lane E proves refusals
by forging claims, which bypasses GoTrue entirely. And ANONYMOUS SIGN-IN, a dashboard toggle
no token can flip, which was off while build #3 shipped.

**It runs against the LIVE project, deliberately.** The org is on the free plan, which counts
PAUSED projects toward its limit of two, so a dedicated test project costs $0 and is
unavailable; branching is Pro-only. So the suite is non-destructive by construction: it
creates its own event, works only inside it, never touches a row it did not create, and
prints the code it leaves behind. Each run costs one anonymous `auth.users` row that
Supabase never collects, plus one event. `docs/smoke-live.md` has the sweep.

**WHEN A LANE FAILS IT LEAVES STATE NOW.** `test-results/lane-h/` and `test-results/lane-b/`
get a screenshot, the DOM, the page URL, the whole error and every console line; lane H adds
a Playwright `trace.zip` you open with `pnpm exec playwright show-trace`. The journeys always
had this (`trace: 'retain-on-failure'`) and CI threw it away, uploading only screenshots —
`checks.yml` uploads `test-results/` and `playwright-report/` on failure now. **`playwright
test` wipes its `outputDir` at the start of every run**, which is why the journeys were moved
to `test-results/journeys` and the lanes keep siblings.

**Lane B refuses to run its gates on a partial walk.** `shots` accumulates as the walk goes,
so a colour gate over 4 of 22 entries would print a green line having measured almost nothing.
It exits instead, and `.provenance.json` carries `complete: false` — `design/screenshots/` is
never cleared, so an aborted run otherwise leaves a mix of two runs' PNGs with no way to tell.

**Two of the 22 screenshots differ run to run** — `00-create-key` in both schemes, because the
recovery key is randomly minted. A byte-comparison baseline can never be clean for those; the
other 20 are stable and are what a dedupe should be checked against.

**NOT in `run-checks.sh`, on purpose.** Checks run many times an hour; each lane-H run
writes to production. It is a deliberate command with the standing of `pnpm android` — a
measurement with a cost, run before a build rather than on every save. It skips loudly
without credentials, in the same shape as lane E.

**E — policy verification** (`pnpm verify:policies`). The only lane that can
see row-level security behave. It runs `supabase/verify-policies.sql`, which seeds an
event, a guest and a host inside a `DO` block, switches
role with `set local role authenticated` and a forged `request.jwt.claims`, asserts
**a hundred and eighty-one** behaviours, and RAISES at the end so nothing commits -- the
"error" it prints IS the report.

**`supabase db push` AND `db reset` WERE A SILENT NO-OP, and #48 fixed it.** The CLI
reserves the migration name `init` and skips the file -- *"replace \"init\" with a different
file name to apply this migration"* -- and the migration was `00000000000000_init.sql`,
exactly that name. Not the all-zero version: the word. Both canonical commands exited 0
having applied nothing.

It is **`00000000000000_schema.sql`** now and the CLI says `Applying migration`. `npx supabase
db reset` is the local recipe, and it is better than the psql dance it replaces: it rebuilds
the DATABASE rather than dropping a schema, so Supabase's `ALTER DEFAULT PRIVILEGES` survive
and the client grants come back intact -- which is the trap `supabase/reset-local.sql` exists
to work around on the psql route. `policies.yml` still applies by psql with `ON_ERROR_STOP=1`,
deliberately: that makes the apply itself the from-scratch gate.

**IT RAN COMPLETELY FOR THE FIRST TIME ON 2026-09-06, and it needed no production password
to do it.** `npx supabase start` gives a local stack, the migration applies to it with psql,
and `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` runs the lane
against it -- **142 assertions, 0 failures**. `docs/lane-e.md` has the recipe. That route is
the durable fix for "nobody runs it": the credential was always the reason, and the local
stack does not need one. A live run additionally proves production has not DRIFTED from the
committed migration, which is the one thing local cannot see, so the success line names which
target it ran against.

**Three defects were hiding in that silence, and all three were invisible for the same
reason** -- the lane skipped, and a skip and a pass look identical on a board. A duplicate
`pho uuid` (42601) had stopped the file compiling since `aed8fb1`. The migration could not be
applied to an empty database at all, because `photos_past_retention` is `language sql` -- whose
body Postgres name-resolves at CREATE time -- and selected from `tier_limits` ~1100 lines
before that table was created. And the #44 assertions called `request_song` as `buid2`, the
guest the tier cap deliberately REFUSES, so everything below them aborted.

**`EXPECTED_ASSERTIONS` was 143 and the truth is 142.** The 143 was arithmetic over six sets
counted in separate in-context runs -- sets which, it turns out, had never executed. Lowering
that number is normally wrong and was right exactly once: when the previous value had never
been measured. Get the next one from a real complete run rather than by adding to this one.

**It did not run at all until 2026-09-05, and nothing said so.** A setup line inserted
a photo as the host with no `uploaded_by_guest_id`; `photos_insert` refused it with
42501 outside any exception handler, which aborted the whole `DO` block -- so every
moderation and invitee assertion below it had never executed, and one held a stale
expected value that proved it. Issue #31. **Anything added here must be RUN, not merely
written** -- that rule earned itself again the same week, twice in one sitting: two new
assertions looked a host row up by `where auth_user_id = ...` while standing in
`authenticated`, which #34 had just revoked, and each aborted the block exactly as the
photo insert had.

`verify-policies.mjs` now has two teeth it lacked. An **abort cannot pass**: the closing
RAISE never runs, so there is no report to parse, and the unparseable case is a red gate
that says so. And a **coverage floor** (`EXPECTED_ASSERTIONS`, the same doctrine as lanes
A and A2) fails a run that measures less than the last one -- because "0 FAILURE(S)" over
forty assertions and over a hundred and eighty are the same sentence. Raise the number when you
add assertions; that friction is the feature.

**"Nothing re-runs it in CI" was true, and the REASON given for it was false.** This file
said twice, and `verify-policies.mjs` said once, that CI here is "one public-repo job with
no secret store". The repository is **private**, and private repositories have encrypted
Actions secrets like any other. `checks.yml` passes `secrets.SUPABASE_DB_URL` through to
the container now, so the moment that secret exists lane E runs on every push. Until then
it expands to an empty string and the lane skips loudly, exactly as it does locally --
so the wiring is a no-op rather than a red gate. A wrong premise had kept the only lane
that can see row-level security out of CI for the life of the repo.

**AND THE SUMMARY SAYS SO NOW.** `run-checks.sh` used to print "All checks passed" whether
or not a lane had skipped -- so lane E skipped on every run for the life of this repo while
the last line on screen said everything passed, and a duplicate variable declaration sat
under that green line for a day. A skipped run now ends with **"Every check that RAN
passed -- N lane(s) skipped and measured nothing"**, naming each one and how to run it. A
lane that FAILS is still a failure and still stops the run; it is not reclassified.

**It skips LOUDLY without `SUPABASE_DB_URL`**, and that is deliberate. Running it needs a
database password, and a gate that failed closed for want of a credential would be switched
off within a week. So it prints a yellow SKIPPED block naming what went unchecked. A
malformed URL is a different thing and fails NAMED rather than as a stack trace, because
that path only became reachable when the secret was wired into CI. Set the URL and re-run
before trusting a green board after any migration change:

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

## The tester channel

Testers have no terminal. TestFlight already collects their screenshots and crashes;
what was missing is that **collected feedback never became a tracked issue**.
`tools/feedback-to-issues.mjs` closes that, and `pnpm feedback:sync` runs it.

**It is NOT a gate and must never enter `run-checks.sh`.** Exiting non-zero because a
tester found a bug would make a green board a claim about tester silence.

- **Screenshots are committed** to `design/feedback/`, because eas-cli's own type says
  `TestFlightScreenshot` URLs "expire after a short while". Same side of the
  `.gitignore` rule as `design/device/`: irreproducible device evidence is committed.
- **`design/feedback/**` is in `paths-ignore`** in `.github/workflows/checks.yml`.
  Without it every tester screenshot burns a five-minute Docker run over untouched source.
- **Dedupe reads the ISSUES LIST, never `search/issues`.** Search is an index and is
  eventually consistent, so a workflow and a manual run firing on the same item would
  both decide it was new. The list endpoint reads the database.
- **`testerEmail` is deliberately dropped.** The name is enough; git history is forever.
- The EAS workflow trigger is `beta_feedback: { types: [...] }` — a bare list is what the
  prose docs imply and `eas workflow:validate` rejects it. Validate before believing.
- `eas testflight:feedback` needs **eas-cli >= 21.3.0**; `eas.json` declares a floor of
  `>= 16.28.0`, so the script asserts the real one.

See `docs/tester-feedback.md`.

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

supabase/functions/   Deno Edge Functions. NOT in the app's tsconfig -- they have their
                      own globals and module specifiers, so compiling them with the React
                      Native program reports errors about the wrong runtime. Deployed via
                      the Supabase MCP, and `run-checks.sh` never executes one, so NO LANE
                      HERE PROVES ONE WORKS.
```

**The seam.** Screens depend on `RunitRepository`, never an implementation. An
ESLint `no-restricted-imports` rule enforces it. That is what makes swapping in
Supabase a checked property rather than an intention. Reads are observables from
day one because the eventual backend is realtime.

**Entitlements are enforced in repository methods, not in `onPress`.** A check
that lives in a button handler is bypassed by the second caller.

## Things that will bite you

- **EVERY ICON COMES FROM ONE SVG, and `pnpm icons` both writes and CHECKS them.**
  `design/brand/runit-logo.svg` is the source; `assets/*.png` is output and must never be
  hand-edited. Three things there are not obvious. **The artwork ANIMATES** -- a 6.4s SMIL
  beam-swing with `fill="freeze"` -- so a screenshot at t=0 captures a mid-swing beam and a
  dim lens, which is a wrong icon that looks entirely plausible; `SETTLE_MS` is 7500 and
  lowering it silently ruins every asset. **iOS REJECTS an icon with an alpha channel**, so
  `icon.png` is asserted to be PNG colour type 2 -- that one fails at App Store Connect, not
  in any lane here. And **Android silhouettes a notification icon to flat white by its
  alpha**, so the full-colour wordmark arrives there as a smear: `notification-icon.png` is a
  separate two-shape mark, and `app.json` pointed at `adaptive-icon.png` until this was
  noticed.
- **The wordmark DOES survive as an icon, and the commit that set the old one said
  otherwise.** `8f97859` rejected a wordmark as unable to "survive being 40px on a home
  screen". A home-screen icon is 60 **points** -- 180px on a 3x device. Measured at the sizes
  iOS actually renders: crisp at 180 and 120, readable at 80 and 60, gone at 40, which is
  notification scale and is exactly why that icon is a different mark.
  `design/brand/README.md`.
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
- **Gboard on the AVD can come up FLOATING**, and a floating IME never resizes or
  overlays anything — so a keyboard measurement taken against it silently "confirms"
  whatever you expected. `adb shell pm clear com.google.android.inputmethod.latin`
  resets it to docked. This is the same trap as `hw.keyboard = no`, one layer down.
- **`expo-secure-store` HAS NO WEB IMPLEMENTATION.** Its web build is `export default {}`,
  so every method is `undefined` and calling one THROWS rather than returning null.
  `secureSessionStorage.web.ts` exists for that reason; without it a browser visitor is a
  brand-new anonymous auth user on every reload. Any other Expo native module reached from
  shared code needs the same check — the web build being a stub is the default, not the
  exception. FIDELITY note AB.
- **`storage.protect_delete()` REFUSES EVERY DIRECT SQL DELETE** on `storage.objects`,
  before RLS is consulted, for the owner as much as for a guest. So `event_photos_delete`
  cannot be exercised from SQL and the retention sweep cannot be built with it — that has
  to go through the Storage API with a service role. Asserted in Lane E so the constraint
  is discovered by a test rather than by a half-written sweep.
- **A CLIENT `UPDATE` ON `guests` MATCHES NOTHING, SILENTLY.** The table has no SELECT
  policy, and Postgres applies SELECT policies to the rows an `UPDATE ... WHERE` must read
  to evaluate its WHERE. PostgREST always emits a WHERE, so `from('guests').update(...)`
  affects **zero rows and raises nothing** — on every device, forever. `assertWrote()`
  cannot catch it either: `.select()` after the update is subject to the same missing
  policy, so a SUCCESSFUL write also comes back empty. The guard fires on the good path and
  is silent on the bad one. Every write to `guests` goes through a SECURITY DEFINER RPC
  (`join_event`, `set_push_token`). Measured in #36.
- **A REALTIME CHANNEL CAN DIE AFTER IT JOINS, and the callback that hears about it is the
  same one that resolved the join.** `RealtimeTable`'s status callback stays live for the
  channel's lifetime now; before, it was a one-shot promise settler and a channel that
  joined and then died produced no observable effect at all (#45). Three rules fell out and
  all three have tests: **`CLOSED` must have a branch** (arriving first, it left the promise
  unsettled and hung the whole join with no message); **the identity guard
  `if (ch !== this.channel) return` is load-bearing**, because `teardownChannel` nulls the
  field before awaiting `removeChannel`, so our OWN `pause()` produces a `CLOSED` that would
  otherwise report eight faults and retry channels we deliberately closed; and **health is
  reported after the SELECT, never from `SUBSCRIBED`**, or you announce a live table with no
  rows. FIDELITY note AP.
- **The reconnect supervisor is ONE timer in `SupabaseRepository`, not one per table**, with a
  bounded budget (2s/5s/15s/30s) that then reports `stale` and stops. Eight timers would be a
  hand-built version of the vendor storm the teardown exists to prevent. It **cancels on
  `suspend()`** — a pocketed phone that keeps re-subscribing re-opens the cost
  `appStateBridge` closed. A retry is `start()` and nothing smaller: a rejoined channel has a
  gap, and `start()` is subscribe → buffer → select → replay.
- **`?stale=1` boots a world where the connection is already broken.** `MemoryRepository` has
  no socket, so it is `live` by definition and the connection pill is otherwise unreachable in
  the only lane that can screenshot it — the same gap `?empty=1` was added to close.
- **`useRef<TextInput>(null)` contains the literal `<TextInput`.** Any source-scanning
  tool that matches `/<TextInput\b/` counts a type argument as a control. `tools/audit-keyboard.mjs`
  requires the `<` to follow start-of-line, whitespace or a bracket for that reason.
- `fade` (`src/theme/typography.ts`) is **per-scheme and comes from `useTheme()`**,
  not from the module import. The canvas's single ramp fails WCAG AA — the two
  schemes need different numbers because `#1F2937` on `#F5F0EB` has less headroom
  than `#E2E8F0` on `#1A1A2E`. Never multiply two levels together; a product cannot
  be fixed by raising the ramp. FIDELITY note H.
- **`wallClockToInstant` makes TWO passes and both are load-bearing.** The naive guess
  reads the zone offset several hours from the true instant, so a DST transition inside
  that window gives the wrong one: asking for 3:00 AM on a spring-forward morning, one
  pass returns an instant that reads back as 4:00. `format.test.ts` fails if the second
  pass is removed. And never `new Date(d.toLocaleString(...))` -- FIDELITY note M.
- **A GUEST NEEDS A NAME, AND THE DATABASE IS WHERE THAT IS DECIDED (#66).** `guests.nickname`
  is `text not null` and `''` SATISFIES THAT, so `join_event` seated a guest with a blank
  space where their name goes -- denormalised onto every song request and photo they sent --
  and the one control that could fix it, the name pill, was drawn only when the nickname was
  NON-EMPTY, so it was missing for exactly those people. `join_event` raises 22023 on an empty
  name and on one over 40, the same two rules and the same errcode as `set_nickname`, whose
  comment had claimed since it was written that "join_event would have refused it too".
  **`MemoryRepository` substituted `nickname.trim() || 'you'`**, which is why 304 journeys saw
  a healthy name pill for a case that had none against Supabase -- the fixture was kinder than
  the backend, the one thing that adapter exists not to be.
- **A HOST HAS NO `guests` ROW.** `create_event` binds her seat and deliberately does not
  seat her as a guest -- a brand-new party reading "1 already here" before anyone arrives
  is worse than the gap. So anything reading `requireGuest()` on a path a host can reach
  will throw: `loadFetchOnce` did, and only creating an event exposed it. `loadBlocks` is
  the pattern to copy -- a null guest id is a real state with an empty answer, not a
  fallback.
- **PHOTO APPROVAL IS NOT A TIER FEATURE, and asking "which tier gets it" is the mistake.**
  It was `tier_limits.photo_moderation`, read by `set_photo_status`. `create_event` mints
  `house_party`, where that was false — so on every event this app can actually create, a
  guest's photo went onto every screen in the room the instant it landed, and the only route
  to a gate was a purchase path that does not exist (#30). The host could not buy it if she
  wanted to. It is `events.photo_moderation` now: her switch, any tier, default off, written
  through a named column grant under `events_host_update`, still decided inside the database
  so the party being moderated does not get a vote (#50's finding, preserved by the move).
  #65 had already made the same call one step later when it ungated `hide` — taking reported
  content down is a review obligation rather than a feature — and stopping it being shown at
  all is that obligation, earlier. `photos.approve` is ungated in both adapters for the same
  reason: a tier gate there could only ever refuse the host who turned approval on.
- **THE TIER CAPS LIVE IN TWO PLACES ON PURPOSE**, and `src/domain/tiers.test.ts` is what
  makes that safe. `public.tier_limits` is what `invite_host` enforces against, because a
  check in a client is bypassed by the second client; `src/domain/tiers.ts` is what the
  pricing copy renders. No literal crosses that boundary, so the test re-parses the
  migration's own seed and fails on drift -- same shape as `tokens.test.ts` re-parsing
  `theme.css`. NULL in SQL and `Infinity` in TypeScript both mean unlimited; `0` would
  mean the opposite and read as plausible.
- **A co-host has no `guests` row AND no account.** `invite_host` mints a seat with
  `auth_user_id` NULL; `claim_host` binds it when they present the key. `claim_host` also
  refuses a second seat to someone who already holds one at that event -- not an
  escalation, but it would strand the seat it was minted for.
- **A 200 IS NOT OWNERSHIP.** `INVITE_ORIGIN` was `runit.pages.dev` for one commit; that
  name belongs to a stranger whose project answers 200 on EVERY path. Every QR pointed at
  their site. The unit tests passed and were right to -- they assert `INVITE_ORIGIN`,
  `app.json` and the association file AGREE, and they did. Agreement is not ownership.
  `pnpm verify:links` (lane G) is the one that can tell, because it reads the BODY back and
  looks for our own appID and App Store id in it. `pages.dev` names are global and
  first-come; an unclaimed one does not resolve at all, so probe before choosing.
- **THE INVITATION HOST IS DEPLOYED (#52).** `runit-app.pages.dev` went up on 2026-09-07 by
DIRECT UPLOAD -- `wrangler pages deploy web --project-name=runit-app` -- not git integration,
so **a push to `main` does not redeploy it**; re-run that command when `web/` changes. Lane G
asserts it now instead of skipping, which it had done on every run since the repo began.

**`_redirects` MUST TARGET `/i/`, NOT `/i/index.html`.** Pages canonicalises the explicit
filename (`/i/index.html` answers 308 to `/i/`), and a rewrite whose destination redirects
does not serve. The first deploy had the filename spelled out and every `/i/CODE` returned
404 -- while the association file was already perfect, so the half that Lane G checks hardest
was green and the half a guest actually walks was dead.

**THE UNIVERSAL LINK IS UNVERIFIED, and no lane here can change that.** A misconfigured
  one fails SILENTLY -- it opens Safari instead of the app, forever. `src/lib/invite.test.ts`
  proves `INVITE_ORIGIN`, `app.json`'s `associatedDomains`, `web/.well-known/apple-app-site-association`
  and `web/_headers` describe the same app at the same address; Lane F proves the QR
  encodes it. Only an iPhone proves iOS accepts it -- Settings -> Developer -> Universal
  Links -> Diagnostics. `web/README.md` has the deploy steps and what to curl.
- **The host lives in ONE constant**, `INVITE_ORIGIN` in `src/lib/invite.ts`. If the
  Cloudflare project name changes, that plus `app.json` plus `web/README.md` move together
  or the test fails.
- **Credentials are minted by `mint_token`, never by `random()`.** Postgres's `random()`
  is a per-session PRNG and explicitly not cryptographic, and `create_event` is callable
  by anyone who can sign in anonymously -- so minting keys with it hands an attacker an
  oracle on the generator behind every host key in the project. `mint_token` draws from
  `gen_random_bytes` with rejection sampling (256 is not a multiple of 31) and is revoked
  from every client role; Lane E asserts that revoke, because `revoke ... from anon` alone
  is a silent no-op. `MemoryRepository` uses `expo-crypto` for the same reason of parity,
  even though its fixture key gates nothing.
- **The recovery key exists exactly once, in `create_event`'s return value.** Only the
  bcrypt hash is stored. A screen that drops that string has destroyed it, and no support
  route, backup or service-role dump gets it back. `rotate_host_key` is the only way to
  issue another, and it retires the old one.
- **`doorsLabel` is the doors line ONLY.** It used to be the canvas's whole subtitle,
  date and venue included, because nothing could derive a day. `JoinScreen` composes
  `formatEventDate · doorsLabel · venue` now. A date stored as prose cannot disagree
  with `starts_at` out loud -- it disagrees silently, which is how HOUSE7 came to hold
  an 11:13 AM start under a "Doors 7:00 PM" label.
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
- **`weddingSeed` HAS 180 INVITED AND NO `invitees` ROWS**, and that trips anything keyed on
  the LIST rather than the COUNT. `invitedCount` is a number on the event; `invitees` is a
  table, and the fixture writes the first without the second on purpose
  (`MemoryRepository.ts:922`). Against Supabase the two agree, because `fold_invited_count`
  derives one from the other -- so a fixture-only divergence looks exactly like the non-empty
  case and is the empty one. It cost a round of red when "Who is invited" gained
  `defaultOpen={invitees.length === 0}`: the wedding opened, and eight tests' toggle clicks
  then CLOSED the section they meant to open. Reach a real non-empty list by adding an
  invitee, not by picking a seed.
- **"WHO IS INVITED" IS OPEN WHILE THE LIST IS EMPTY, folded once it is not.** `Disclosure`
  exists because five permanently-open sections made that screen 1309px against an 874px
  viewport, and folding away the MEANS of changing a state is right for a section a host fills
  once before doors. It is wrong for the one section she has not filled at all: there is no
  state to read, and the contacts picker and the only send control in the product are both
  behind it. Measured on a real party -- S7Y9RX ran with `invitees` at 0 behind a row reading
  "Nobody yet", nobody opened it, nobody joined. The summary still LEADS with the state,
  because `Disclosure`'s own docblock forbids a summary that restates the title; what follows
  names what is behind the fold, which the title does not.
- **A HOST WITH AN EMPTY ROOM IS SHOWN THE INVITATION, NOT A COMPOSER.** Measured on a real
  party rather than imagined: S7Y9RX ran on 2026-09-11 with 40 seats provisioned, a build
  deployed 90 minutes before doors and a live install page, and **zero people opened the app**
  -- not zero joins, zero anonymous sign-ins, which happen before anything else a person can
  do. Every row in that event is the host's own. `invitees` was 0 and had been since the event
  was created two days earlier. **The capability was never missing**: `host-share` is one tap
  from where a host lands and `shareMessage` writes a complete invitation with the link, three
  numbered steps and the code. What was missing is that nothing ever said to use it -- the
  largest control on screen was a send button addressed to an empty room. `empty-room-share`
  draws only while `guestCount` and `invitedCount` are BOTH 0, and both clauses are
  mutation-pinned; it calls the same `onShare` as the quiet link rather than being a second
  implementation.
- **`music.mine` IS A SEPARATE OBSERVABLE FROM `music.queue`, and it has to be.** `queue` drops
  `played` and `declined` -- correctly, a room should not vote on songs that are over -- so it
  is the one list that cannot answer "what happened to MY request". `useMyRequest` read it
  anyway, so the moment a host declined, `findIndex` returned -1 and the guest's strip
  unmounted: the one person entitled to be told was the one the filter hid it from.
  `MusicScreen`'s STATUS_TEXT has carried 'Not this time' and 'Played' since it was written and
  neither could ever render. `mine` comes off the UNFILTERED list in both adapters, one line
  above that filter. **Rank is null once the song leaves the queue** rather than stale -- "#3
  in the queue" beside "Not this time" is two sentences arguing on one strip. #70 · 5 of 5.
- **THE SONG TYPE-AHEAD CALLS A THIRD PARTY, AND IT IS THE ONLY THING IN THE APP THAT DOES.**
  `src/lib/musicSearch.ts` hits the iTunes Search API -- no key, no account, nothing to leak.
  Everything else goes through supabase-js. **It sends no CORS headers**, so it works on a
  device and never in a browser, which is why there is a `.web.ts` half serving a four-song
  fixture under `EXPO_PUBLIC_FIDELITY=1`; no test here may depend on a third party's uptime,
  ranking or rate limit. `musicSearchConstants.ts` exists for the reason `captureConstants.ts`
  states outright -- Metro resolves `./musicSearch` from inside `musicSearch.web.ts` back to
  itself, so a value import there is a cycle; the type is `import type` and erased.
  **#8 named MusicBrainz "the cheap win" and that is wrong for this job**, measured: queried
  for `dont stop believin` it ranks two cover bands above Journey, all scored 100.
- **`orderedForRequest` LIVES IN `src/domain/songKey.ts`, NOT in `lib/musicSearch`**, and the
  move was forced. `musicSearch` is platform-split, so on web `@/lib/musicSearch` resolves to
  the `.web.ts` half, which did not export it -- the call was `undefined` at runtime and six
  journeys went red. Re-exporting would mean the web half importing a VALUE from its own
  sibling, which is the Metro self-resolution cycle `captureConstants.ts` warns about. It is
  a statement about song IDENTITY anyway, which is what that module is.
- **Typing `Artist – Title` used to file the song backwards.** `actions.ts` splits on ` – `
  and assigns POSITIONALLY, so "Journey – Don't Stop Believin'" became a song called Journey
  by an artist called Don't Stop Believin' -- a different `song_key`, so the votes split,
  which is the exact defect the type-ahead exists to stop. `orderedForRequest` swaps only when
  a suggestion confirms the reversal, in TWO PASSES rather than one loop: already-right wins
  over any reversed reading whatever the ranking says, because a single loop made the answer
  depend on list order. A song no catalogue has is returned untouched.
- **The fixture in `musicSearch.web.ts` matches every word against title OR artist**, in any
  order. It prefix-matched `title+artist` concatenated once, so "journey" found nothing while
  the real endpoint returns the right song first for exactly that query -- measured. A fixture
  that cannot do what the real thing does sends every journey green over a half-dead feature.
- **A suggestion writes `Title – Artist` into the same field a guest could have typed**, with
  an EN DASH and spaces, because `actions.ts` splits on `/\s[–-]\s/` and "Jay-Z" must not be
  torn in half. Nothing downstream changed -- no new repository method, no column, no SQL --
  and the dedup win is a consequence rather than a mechanism. **Suggestions are not a gate**:
  a local band must stay requestable, and `guest-music.spec.ts` has a test whose only job is
  to fail if that is reversed.
- **THE PHOTO VIEWER TAKES A LIST AND AN INDEX, NOT A PHOTO.** It took `photo: Photo | null`
  and nothing else, so opening a photo was a dead end -- the only way to the next one was to
  close and tap again, nine times. `visible` in `PhotosScreen` is already the exact list on
  screen in the exact order on screen, so the index the grid renders IS the index the carousel
  navigates. Arrows are **hidden at the ends rather than disabled** (a drawn control that does
  nothing is what `aria-disabled` is this repo's gate for), sit INSIDE the stage rather than
  beside the backdrop (a sibling laid over `viewer-backdrop` fights it for the same tap and
  the later sibling wins), and carry a **measured 44x44 rather than `hitSlop`**, which is what
  `audit:targets`' own warning asks for where controls overlap.
- **`viewer-prev` and `viewer-next` must never be named `tile-something`.** `photo-viewer.spec.ts`
  counts `/^tile-/` to assert the album is nine, and a second node per tile matching that prefix
  silently doubled it once already. Mutation-checked: renaming them to `tile-prev`/`tile-next`
  turns five tests red.
- **The viewer prefetches index ±1 and no test asserts it.** Thumbnails are signed in bulk but
  the full size is resolved one at a time on demand, so every carousel step would otherwise be
  a cold round trip. It changes latency, not behaviour -- deliberately unasserted, and removing
  it breaks nothing, which was checked rather than assumed.
- **Swipe is real and no lane here can prove it.** `Gesture.Pan()` with a 60pt threshold;
  `react-native-gesture-handler` and `reanimated` were already dependencies and
  `GestureHandlerRootView` was already mounted, so it added nothing to the bundle -- but it is
  the first hand-written gesture in this codebase. Chromium cannot swipe, so the BUTTONS carry
  every assertion. That is why both exist.
- **`photos.pending` is the host's queue and selects `'pending'` ONLY.** In-flight
  and failed uploads go to `photos.mine`, scoped to the uploading guest. Putting
  `'uploading'` back into `pending` gives the host Approve/Hide over a photo with
  no bytes — it was that way once, and a test now fails if it returns.
- **THE PHOTOS SCREEN BRANCHES ON `visible.length === 0 && mine.length === 0`, and the second
  clause is load-bearing.** `visible` is APPROVED photos in the active folder; `mine` is this
  guest's own uploading and failed transfers. The shutter pane references `mine` nowhere, and
  the Retry control exists in exactly ONE place in the app -- inside `mine.map` in the grid
  branch. With the first clause alone, a guest whose upload failed on an empty album was told
  "tap Retry" by `actions.ts:277` on a screen with no Retry on it; on a moderated event that is
  the whole night, because uploads land `pending` and `pending` is never `approved`, so
  `visible` never fills from her own photos (#70). Do not simplify it back: three mutations
  pin it, including forcing the grid branch always, which breaks #67's empty-album copy tests.
- `Photo.localUri` (device path) and `Photo.storagePath` (remote key) are
  **separate fields on purpose**. Conflating them hands a `file://` to a
  signed-URL resolver the day an adapter exists.
- The join screen shows "N already here" (`join-guest-count`). It is **not** in the
  canvas — it exists so the e2e suite can prove joining *increments* the room
  rather than merely that the room reads 173 afterwards. FIDELITY note J.
- The demo wedding sits on the Event tier where nothing is capped, so the
  gating layer is invisible against it. `housePartySeed` is the fixture that shows
  it working -- but **only `MemoryRepository.test.ts` can reach it.** No Playwright
  journey can boot it (`tests/e2e/co-host.spec.ts` says so in as many words), so no
  lane that renders a screen has ever seen a capped event. Use it to see
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

**This section is now a pointer, not a list.** Every gap below is a filed issue with
file:line evidence in it, because a roadmap living in prose is how six missing
capabilities came to hide inside one line. `gh issue list --repo TortoiseWolfe/runit`
is the scope; issue #1 is the ordering.

**A host can now make her own event, staff it, and FIND IT AGAIN.** #17's list and switcher
shipped: `my_events()` is a definer function because #34 revoked `hosts.auth_user_id` from
every client role, so the identity filter cannot live in a client. It returns every seat, not
only `role = 'host'` -- a DJ needs the way back too. What is still missing: #18 (host sign-in
+ custom SMTP) · #19 (account deletion, mandatory the day #18 ships).

**#17's TITLE WAS WRONG and reading it as the spec would have built the wrong thing.**
`create_event` has allowed TEN events per identity since it shipped; the cap is in the
function. The schema was never the blocker -- nothing could LIST them, and the anonymous
session persists, so a host who closed the app kept her identity, lost `event.current`, and
had only the six-character code to get back in. FIDELITY note AU.



**Closed:** #15 (`event_preview`) · #14 (event details at `/host/event`) · #13
(`create_event`) · #32 (the recovery key) · #16 (`invite_host` -- a co-host gets a seat
and a key, never an account) · #33 (the QR encodes a universal link, so a scan works for
someone without the app) · #22 (`join_event` counts against `tier_limits.max_guests` and
raises 54023) · #34 (`auth_user_id` revoked from every client role) · #26 (a host can
un-pin, and only `pinned` is writable) · #21 (every granted feature is enforced, or is no
longer granted). FIDELITY notes S, T, U, V, W, X, Y and Z.

**#26 nearly undid #21, and the interaction is the thing to remember.** The pin-folding
trigger was `before insert`; an UPDATE policy on top of that leaves a free-tier host one
statement from the pin she was refused. It is `before insert or update` now. When you add
a write path to a table, check what triggers guard the paths that already exist.

**Advertised and unenforced — #21 is CLOSED**, and it ended in the two different ways
this kind of issue can end. `pinnedAnnouncements` got real enforcement (a trigger folding
a pin the tier cannot carry). `pushNotifications` was ALSO un-granted and un-sold at that
point — the remedy `audit-tier-claims.mjs` prints, and how its eight unenforced siblings
still live. **That is no longer the state and this paragraph used to claim it was**: #27
built the fan-out, so `pushNotifications` is `true` on the top two tiers and "+ push" is
back in the $79 copy. See PUSH IS BUILT below, which is the current word.
`pnpm audit:tiers` reports 11 features, 3 granted, every one enforced, no yellow line. It
was 12 until `photoModeration` left the ladder entirely — see PHOTO APPROVAL IS NOT A TIER
FEATURE under "Things that will bite you".
Still open: #30 (every paid tier is unreachable — the pricing screen is cut and no
purchase path exists) · #41 (`eventTtlHours` still has zero readers: a free event never
goes read-only).

**THE RETENTION SWEEP EXISTS AND IS ARMED (#40).** `supabase/functions/sweep-photos`, called
by `run_photo_sweep()` through pg_net on a `pg_cron` schedule at 04:17 daily. It could not be
SQL: `storage.protect_delete()` refuses every direct delete on `storage.objects`, so bytes go
through the Storage API with a service role, which only an Edge Function holds. **Bytes first,
row second, idempotent** — the row is deliberately left when the Storage API fails, because
`storage_path` is the only thing that can name the object. `photos_past_retention()` decides
what expired, in SQL beside `tier_limits`, and the clock runs from `starts_at` because the
album already says "after the event". `verify_jwt` is not enough for a destructive endpoint —
the anon key is public — so it also requires `x-sweep-key`, compared inside the database by
`sweep_authorised()` so the secret never crosses the wire. **No lane here executes an Edge
Function**, so lane E asserts the rule and the deleting was verified by hand against the live
project. `docs/retention-sweep.md`, FIDELITY note AQ.

**`albumRetentionDays` HAS a reader (#23), and now an enforcer (#40).** The
album says how long photos are kept and the number comes from `tier_limits`, but nothing
deletes anything — retention is stated, not enforced. That order is deliberate: the
warning landed only after a viewer and a save control existed, because a deadline nobody
can act on is a threat rather than a warning. The sweep shipped in #40.

**The caps are a table.** `public.tier_limits` holds the numbers; `create_event`,
`invite_host` and `join_event` read them and no client can write them. A cap that lives
only in `src/domain/tiers.ts` is enforced by whichever client happens to be asking, and
`src/domain/tiers.test.ts` re-parses the migration's seed to fail on drift between the two
— the same shape as `tokens.test.ts` re-parsing `theme.css`.

**`session.holdsHostSeat` is not `session.current.kind`.** The first says which SEAT you
hold, the second says which VIEW you are looking at. A host who switched to the guest side
reads `kind: 'guest'` and still holds her seat. Gate a control on the wrong one and you
either show a door to people who cannot open it (#29) or take the way back from a host.

**`invitedCount` IS NOT `guestCount`, and the difference is tested.** The composer
addresses everyone INVITED; the guest header counts everyone PRESENT. They never appear on
the same screen, which is why collapsing them is invisible by inspection --
`host-console.spec.ts` switches roles mid-test to catch it. "Send to 180 guests" was never
a fiction; the gap was that no screen could set the number, which #25 closed.

**Dead ends a host reaches by using the app as designed — all three closed.** #29
(`RoleSwitch` was shown to every guest and, against Supabase, only ever refused) · #37 (a
founder could not leave the host console: `becomeGuest` opened with `requireGuest()` and
`create_event` mints her no `guests` row — she takes a seat on demand now) · #24 (`seen by
0` forever: `broadcast_reads` had a policy and a fold and no writer).

**STAFF ARE NOT GUESTS, and it is now one rule asked in three places.**
`public.guest_seats()` excludes a seat held by a host of that event, and it is what
`fold_guest_count` and `join_event`'s cap check both read; `fold_seen_count` applies the
same exclusion one level down. So a host looking at her own party does not appear in "N
already here", does not eat one of the ten seats a free tier sells, and does not make her
own announcement read "seen by 1" before anyone has seen it. `hosts` folds on
`update of auth_user_id` too, because `claim_host` promotes a guest without touching
`guests` at all. FIDELITY notes AJ and AK.

**One song, one row (#44).** `music.request` inserted unconditionally and the queue is ranked
by votes, so two people asking for the same song made two rows with one vote each.
`public.song_key(title, artist)` under a PARTIAL unique index (`pending`/`accepted` only, so
a played song can come round again) is what decides two requests are the same song, and
`request_song` inserts-or-votes in one statement. It reports which branch ran via `xmax = 0`,
because otherwise the toast claims to have added a row that did not appear.
`src/domain/songKey.ts` mirrors it for `MemoryRepository` and `songKey.test.ts` re-parses the
migration — folding LESS than the index shows up at once, folding MORE is silent.

**A guest can see and change their own name (#43/#36).** No screen ever showed a guest their
own nickname, so a typo lasted all night; and `guests_update_self` — which looked like the
route — could never fire, because `guests` has no SELECT policy and PostgREST always sends a
WHERE. That policy is deleted rather than kept as documentation for an implementation that
fails silently. `set_nickname` rewrites the denormalised copies on that guest's own requests
and photos, and deliberately not `blocked_name` or a report's subject label.

**Promised, built, and now WITNESSED.** #28 shipped the scanner — `expo-camera`,
`codeFromScan` living beside `joinLink` because every interesting failure of a scanner is a
string failure, and typing still the primary path with the field never hidden. #42 closed the
caveat under it: `pnpm scan:device` runs `CameraView` against the emulator's virtual scene and
reads a QR the app's own `EventQr` generated. What that still does not cover is **iOS**, and
**`NSCameraUsageDescription`** — Android composes its permission dialog from the permission
group, so no Android run can read an iOS plist key. FIDELITY notes AL and AR.

**`app.json` has two plugins writing `NSCameraUsageDescription`.** `expo-image-picker` and
`expo-camera` both declare it, config plugins apply in order, and the later one silently
wins — so a guest at the door would be asked to allow the camera "to add photos to the
album". One sentence covers both uses and `src/lib/appConfig.test.ts` fails if they ever
disagree. It is the only place that can catch it: the plist is prebuild output and `/ios`
is gitignored.

**PUSH IS BUILT** (#27). `set_push_token` stores a token on the caller's own `guests` row;
`fan_out_push` (a trigger on `broadcasts`) and `fan_out_song_push` (on `song_requests`
UPDATE) call the `send-push` Edge Function through `pg_net`, which reads tokens as the
service role and posts to Expo. `tier_limits.push_notifications` is the gate and
`fan_out_push` is what reads it, so `audit:tiers` reports `pushNotifications — SQL`. The
"+ push" line is back on the $79 card because it is now true. FIDELITY notes Z and AA.

**IT IS ARMED, AND IT IS GUARDED -- and the second half had to come first (#51).**
`send-push` reads every guest's push token with the SERVICE ROLE and posts to Expo, and the
functions gateway's `verify_jwt` proves only that a caller holds *a* project JWT -- the anon
key is PUBLIC, compiled into the bundle. So the endpoint had no authorisation of its own:
anyone with the app's own key could have POSTed an event id and a body and buzzed every phone
at somebody else's party. Nothing had gone wrong only because the fan-out was never armed --
its Vault secrets did not exist, so `fan_out_push` returned early every time. **Adding the
secrets without adding the check would have been the regression, not the fix.**

`push_authorised()` is the same shape as `sweep_authorised()`: an `x-push-key` header
compared INSIDE the database so the secret never crosses the wire, failing closed, with a
missing secret and a wrong one answering identically so a prober cannot learn whether the
endpoint is live. THREE Vault secrets now, not two -- `push_fanout_url`, `push_gateway_key`
(the public key, to get past the gateway, authorising nothing) and `push_key` (the one that
does). Measured against the live project: a caller holding only the publishable key gets
**403** with or without a guess, no JWT gets **401**, and the trigger's own path gets
**200 `{"sent":0,"reason":"no registered devices"}`**. FIDELITY note AV.

**What no lane here can prove about it, and this must not be glossed:** that a phone
buzzes. Lane B has no push API and boots `MemoryRepository`; Lane C could witness an
Android notification only once FCM credentials are wired; iOS is unprovable in this
environment at all. And `pg_net` is fire-and-forget — a failed push lands in
`net._http_response`, outside the transaction, so it is **silent**.

**Two credentials only a human can supply**, both one-time, both behind an interactive
login: an **APNs auth key** (`eas credentials`, Apple ID + 2FA) and an **FCM service
account** (Firebase console, Google login). Plus two Vault secrets on the project,
`push_fanout_url` and `push_fanout_key`. Until those exist the fan-out returns early and
sends nothing — deliberately, and without failing any insert.

**Do not assert that an unenforced flag is ABSENT.** Eight of them are meant to be present
and `false`; a test demanding absence contradicts the remedy `audit:tiers` prints, and
removes the flag from the ladder-monotonicity test that was already covering it. FIDELITY
note Z.

**The reason the rest kept arriving by phone.** #20 — all ~294 journeys boot
`MemoryRepository`.

Still true and not an issue: the in-memory transfer completes instantly because nothing
is being sent anywhere, so `uploading` and `failed` are reachable only through the
injectable transfer (`fixtures/flakyTransfer.ts`, `EXPO_PUBLIC_FLAKY=1`, or `?flaky=1`
in the web harness).

## How to work here

Three rules, and they exist because of what one day cost. Eighteen commits, three
merges and **four TestFlight builds** produced a keyboard that trapped every guest, a
guest with no way out of an event, three inert controls and a blank host console —
every one of them found by holding a phone, one device session at a time, and not one
of them written down anywhere a fresh session could read.

**1. A gap found is an issue filed, in the same turn.** Not a paragraph in a commit
message. The commit messages in this repo are good writing and bad tracking: nobody can
read a roadmap out of `git log`, and the next session starts cold.

**2. Code before builds.** Four builds in a day is the symptom. The cause is shipping to
a device to find out what a test could have said. Land a batch, prove it in the lanes
that exist, then build once. A build is not progress; it is a measurement, and an
expensive one.

**3. Scope forward, not backward.** Before starting an arc, write down the journey it
completes and mark every step exists / partial / missing. `?empty=1` is the worked
example: the failure was never "one button is dead", it was "the harness cannot render
the state where three buttons are dead", and only a journey-level look sees that.

### Operational facts that cost a session each

- **`?empty=1` boots `emptySeed`** — a world where `event.current` is null, which is what
  a real guest sees before joining and what the Supabase adapter returns
  (`SupabaseRepository.ts:39-43`). Before it existed, `Seed.event` was non-nullable while
  every sibling was nullable, so no test could reach the state, and `disabled={!event}`
  shipped three dead controls off one boolean.
- **`?invited=1` boots `invitedSeed`** -- no event, but a code from a link that
  resolves to one. It is the middle of three worlds (`?empty=1` is the cold open,
  `weddingSeed` is joined), and it exists because `weddingSeed` already has
  `event.current`, so the whole `event.preview` path could be deleted with every other
  journey still green. It proves the invitation SCREEN only: an `EventPreview` carries
  seven of `RunitEvent`'s twelve fields, so Memory cannot honestly model the join that
  follows, and `tests/e2e/invitation.spec.ts` says so rather than faking it.
- **`?fresh=1` boots `freshSeed`** -- the event a host MADE IN THE APP, twenty minutes in:
  `invitedCount` 0, `guestCount` 4, no schedule, no album, one host. That pairing exists in
  no other seed, and its absence is why "Send to 0 guests" survived 326 journeys (#70).
  `weddingSeed` hardcodes 180 invited and `housePartySeed` 8, so every assertion the suite
  had ever made about the composer was made in a world where the number happens to be
  true -- while `create_event` mints 0 and nothing in the product raises it
  (`fold_invited_count` fires on `invitees`; `join_event` writes none). The journeys JOIN
  first, so the number under test is live rather than seeded: the room goes 4 -> 5 and the
  composer has to move with it.
- **The composer's number is a FALLBACK, not a replacement, and both halves are tested.**
  `invitedCount` when there is an invitation list, `guestCount` when there is not. Collapsing
  the two is its own bug (#25) and `host-console.spec.ts:140` catches it -- mutation-checked:
  wiring the composer to `guestCount` unconditionally turns that test red. The third surface,
  the run-of-show `accessibilityHint`, is NOT asserted and cannot be: react-native-web does
  not forward `accessibilityHint` at all, so it never reaches the DOM. Same class as
  `hitSlop`; stated in the spec rather than faked.
- **`aria-disabled` is the gate.** react-native-web renders a disabled `Pressable` that
  way, so `expect(page.locator('[aria-disabled="true"]')).toHaveCount(0)` is a DOM fact
  about a whole screen rather than an assertion per control
  (`tests/e2e/empty-world.spec.ts`). It is the one check that scales with the class of
  bug instead of with the instances of it.
- **`closeEvent()` is not `leave()`.** `closeEvent` tears down the event context and
  keeps the identity; `leave()` does that *and* signs out. A host switching events must
  never take the second one. FIDELITY note R.
- **The emulator's input pipeline can wedge mid-session** — the app keeps rendering,
  keystrokes stop arriving, and nothing in the log says so. Re-check `hw.keyboard` and
  `adb shell dumpsys input | grep -i keyboard` before believing a field is broken; that
  is separate from the AVD shipping `hw.keyboard = no` in the first place.
- **Gboard's floating mode gives a false measurement.** Reset it with
  `adb shell pm clear com.google.android.inputmethod.latin` before measuring anything
  keyboard-shaped, or the number you write down describes the IME, not the app.
