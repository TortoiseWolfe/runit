# Fidelity: permanent deviations

Places where React Native cannot match the web canvas, decided once so they are
not re-litigated every session. If you find yourself about to "fix" one of
these, read the entry first.

## 1. No device chrome
The canvas wraps every artboard in `<IOSDevice>` from `ios-frame.jsx`, drawing a
bezel, Dynamic Island, status bar and home indicator. None of it ships — the OS
provides all of it.

**Consequence:** the artboards' `padding-top: 66px` (guest/host headers),
`padding-top: 70px` (join) and `padding-bottom: 28px` (tab bar) are inflated by
chrome we do not render. Measured from `ios-frame.jsx`: the fake status bar is
`21 + 22 + 19 = 62px` and the home-indicator zone is `34px` — exactly the
iPhone 16 Pro insets. So the real values are `insets.top + 4`, `insets.top + 8`,
and `max(insets.bottom, 12)`. See `src/theme/layout.ts`.
**Copying 66/70/28 verbatim is a bug, not fidelity.**

## 2. iOS pixels are unverified locally
There is no Mac in this environment (`xcrun` absent, WSL2). iOS is verified by
Lane A + Lane B + review, or by EAS Build onto a physical device. A green
Android check does **not** mean iOS is fine.

## 3. Pricing re-lays out
The canvas draws pricing as `grid-template-columns: repeat(4, minmax(0,1fr))` at
~1240px. That cannot survive 402pt. Vertical stack; every internal card metric
(radius 24, padding 24, gap 14, the 34px price, the 40px min-height `who` line)
is preserved exactly.

## 4. Canvas sections 00 and 05 are not screens
The sheet header with its anchor pills, and the six open-source evaluation
cards, are notes to the reader *inside* the canvas. Porting them as app screens
would be misreading the document. The research is summarised in `OSS-NOTES.md`.

## 5. `align-items: baseline` becomes `flex-end`
Yoga treats a `View`'s baseline as its bottom edge, so the canvas's five
baseline rows (each pairing a large number with a small label) need
`alignItems: 'flex-end'` plus matched `lineHeight`.

## 6. System font per platform — and geometry is NOT a safe harbour
The canvas asks for `ui-sans-serif, system-ui, -apple-system`. That resolves to
SF Pro on iOS, Roboto on Android, and DejaVu Sans in the Linux Chromium that
generates `renders/`. **The three are not glyph-identical.**

This note used to say that was "exactly why Lane B gates on geometry (bounding
boxes) rather than on glyph pixels." **That reasoning was wrong, and it is the
thing that made the divergence in issue #6 invisible.** Geometry is precisely what
glyph metrics move: the suite's two geometric assertions
(`tests/e2e/guest-chat.spec.ts:167` and `:228`) count rendered line boxes, and a
line box wraps when the glyphs get wider. Gating on geometry does not escape the
font problem; it *is* the font problem, one level up.

Nothing in the app pins a font. `grep fontFamily src/` is empty, `dist/` ships no
font files, and this host has 8 fonts, all DejaVu. Typography is entirely
machine-supplied.

Measured with `tools/measure-text-margin.mjs` against one `dist/`:

| | host (DejaVu) | container (Liberation) | column |
|---|---|---|---|
| `11:30 PM` | **65.33px** | 58.89px | 72px |
| `Full schedule` | 78.13px | 70.72px | one line in both |

**The host is the tighter environment**, clearing the 72px column by 6.67px
(9.3%). A font ~10% wider than DejaVu wraps `11:30 PM` and fails `:228`.

Note `renders/` is committed and was generated on this host in DejaVu, so making
the container authoritative for `screenshots/` would guarantee a divergence on
every Lane D read rather than fixing one.

## 7. Letter-spacing is frozen
The canvas uses `em`; RN's `letterSpacing` is absolute points. `tracking(em, px)`
converts at the design's font size, so tracking will not scale with Dynamic
Type. Under `EXPO_PUBLIC_FIDELITY=1` set `allowFontScaling={false}` so
screenshots stay stable.

## 8. `boxShadow` requires the New Architecture
Pinned on in `app.json`. There is no `elevation` fallback because `elevation`
cannot express `0 20px 40px rgba(0,0,0,.25)` — the shutter button's shadow.

## 9. Text opacity is baked into colour alpha
The canvas leans on CSS `opacity` for its whole type hierarchy (.85/.7/.6/.55/
.5/.45). RN's `opacity` composites the entire node, so nested opacities multiply
and a parent's fade drags its children along. We use `alpha(token, n)` instead.
Where the canvas nests them (schedule past rows: a `.45` row inside a `.7`
label) the product is pre-multiplied. Same result, explicit arithmetic.

## 10. Dashed borders
`borderStyle: 'dashed'` renders with a platform-chosen dash pattern that is not
configurable and differs from the browser's. Accepted on the one empty state
("All caught up.").

## 11. Glyphs stay glyphs
`▲ ✕ ✓ ▶ —` are text in the design and stay text. Revisit only if `▲` breaks the
vote button's `minWidth: 56`.

## 12. `hint-placeholder-count` is scaffolding
Those attributes tell the canvas editor how many placeholder rows to draw. The
real counts come from the `state` block: 3 broadcasts, 6 song requests,
6 schedule items, 3 folders, 3 pending photos.

---

# Intentional improvements

Not deviations forced by the platform — places where the canvas has a genuine
defect that we fix rather than reproduce.

## A. The schedule time column wraps
At `width: 64` the host run-of-show wraps "11:30 PM" onto two lines. Visible in
`renders/03-host-broadcast.*.png`. We widen the column so times stay on one line.

## B. The run-of-show header crowds its label
In the guest Chat "Now / Next" card the summary text runs into the
"Full schedule" affordance at 402pt. Visible in `renders/02-guest-chat.*.png`.
The left text gets `flex: 1` with the label `flex: 0`.

## C. Declined requests currently vanish
The canvas's `statusText` map has no `declined` key, so a declined request
renders `undefined`; and its `live` filter drops declined rows from the guest
queue, so a guest's request silently disappears with no explanation. We add a
`declined` status label and keep the row visible to its requester.

## D. Two real bugs not to reproduce
- `capture()` reads `activeFolder` from a stale closure for its toast while its
  `setState` reads fresh state — the toast can name the wrong folder.
- `sendBroadcast` drops the `pin` flag (`pin: false` in the same `setState`), so
  pinning an announcement does nothing.

## E. The web export flashes light before hydrating
Static rendering pre-renders in Node, where there is no `matchMedia`, so the
served HTML is always light-themed; hydration corrects it a beat later. A
dark-mode viewer of the **web export** sees one light frame. This does not
affect native, which has no pre-render step.

Consequence for Lane B: never screenshot on a fixed sleep. `tools/shoot-app.mjs`
waits until the app's own resolved scheme (exposed as `scheme-probe`, only in
`EXPO_PUBLIC_FIDELITY=1` builds) matches the scheme the browser context asked
for. A 350ms sleep silently produced light screenshots for dark runs, and the
pixel probe is what caught it.

## F. The web export is a SPA, not a static render
`app.json` sets `web.output: "single"` deliberately.

With `"static"`, Expo pre-renders each route in Node — where there is no
`matchMedia`, so the HTML is always light-themed. React hydration **does not
patch style mismatches**, so on a hard load every element kept its light styles
permanently, even though the provider's own state said `dark`. The DOM reported
dark (an effect had painted `<body>`), individual elements were light, and
nothing ever corrected it.

It hid behind a second bug for a while. An un-gated debug probe was writing the
scheme into the static HTML, which produced a hydration *text* mismatch (React
#418) — and that error made React discard the server markup and re-render the
whole tree on the client, accidentally repainting the theme correctly. Silencing
the warning removed the accidental fix and exposed the real one.

Two lessons, both encoded in the tooling:
- **The pixels are the source of truth.** `tools/shoot-app.mjs` ends with a
  colour gate that reads base-100 back out of every PNG. The DOM said dark while
  the screen was light; only sampling the image caught it.
- **A console warning can be load-bearing.** Silencing one changed rendering
  behaviour. Verify what a warning is doing before you quiet it.

Native never had this problem: there is no pre-render step, so no mismatch.

## G. A percentage width that works on the web and renders nothing on device
`design/device/android-photos-album.BROKEN-before-fix.png` is the album grid on
Android with `width: '32.4%'` on the tiles. It is empty. The identical screen in
`design/screenshots/02-guest-photos.dark.png` shows nine tiles.

In Yoga, a percentage width inside a `flexWrap` row that also sets `gap` has no
determinate basis; the browser resolves it anyway. Tile size is now computed
from `useWindowDimensions()` — see `src/features/photos/PhotosScreen.tsx`.

**This is the case for Lane C.** Neither of the automated gates could see it:
- Lane A checks colours through the RN parser. This was a layout bug.
- Lane B runs through react-native-web — the very renderer that gets it right.

Nine months of green CI would not have caught an empty album. Only running it on
a device did. Treat "it passes Lane B" as evidence about layout *logic*, never
about native layout.

## H. The canvas's text-opacity ramp does not pass WCAG AA
The canvas uses one `fade` table for both schemes — 0.85 / 0.7 / 0.6 / 0.55 / 0.5 /
0.45 — and `alpha()` emits a real `rgba()`, so each level composites against the
ground rather than being pre-flattened. Measured against the built export, that
ramp fails 4.5:1 from `muted` down in light and from `faint` down in dark.

`fade` is now **per-scheme**, on `useTheme()`. The two schemes genuinely need
different numbers: `#1F2937` on `#F5F0EB` has less headroom than `#E2E8F0` on
`#1A1A2E`, so the minimum alpha reaching 4.5:1 is **0.666 light against 0.508
dark**. One shared table cannot serve both without flattening dark's hierarchy.
Each ramp keeps the canvas's ordering and relative spacing, lifted so its lowest
level clears that scheme's floor. Worst measured ratio is now 4.65:1 light,
4.66:1 dark.

This is app code, not a token — `tokens.ts` stays locked to `design/theme.css` by
`tokens.test.ts`.

**Two things the ramp alone could not fix:**

`NowNextCard` multiplied two levels for past rows — `fade.past * fade.body` and
`fade.past * fade.muted`, i.e. 0.315 and 0.27, rendering at **1.69:1** and
1.84:1. A product cannot be fixed by raising the ramp, because both factors rise
together. Past rows now use a single level; ordering and the Now highlight carry
the rest.

The featured pricing card paints `neutralContent` on `neutral`, a different pair
from the one the floors were computed against, and `faint` lands at 4.07:1 there
in dark. That one site uses `soft`.

A **contrast gate** now runs in `pnpm shots` beside the base-100 colour gate,
compositing every rendered text colour over its painted backdrop across all 20
screenshots. Unlike touch targets — where react-native-web drops `hitSlop` and
this lane is structurally blind — contrast is honestly measurable here.

## I. Run-of-show rows are separated, and starting one asks before rewinding
The canvas draws the host's run of show as flush rows in a clipped card. Shipped
with a 6pt gap and a 4pt card padding instead, because the rows are not inert:
each fires an unretractable broadcast to every invited guest, and
`nowScheduleItemId` drives **every guest's** Now/Next card. Flush rows put the
past ones immediately adjacent to the current one, so a thumb slip rewound the
evening for the whole room.

`hitSlop` is not an alternative here. React Native's own documentation
(`ViewPropTypes.d.ts`) states the touch area "never extends past the parent view
bounds and the Z-index of sibling views always takes precedence if a touch hits
two overlapping views" — so slop between flush siblings buys ambiguity, not
safety.

`schedule.start()` additionally refuses to move the cursor backwards unless told
to (`ScheduleError('would_rewind')`); the host restarts a past item by holding
it.

## J. The join screen shows "N already here"
The canvas's join artboard shows the event name, the doors line and a calendar
pill. It does not show a guest count; that lives only in the Chat header's
"{n} here" pill.

Added here, and the reason is a test gap rather than a design note. `guestCount`
was rendered in exactly one place, and both guarded layouts redirect an anonymous
session to `/join` — so there was **no screen on which the room's count could be
read before joining**, and no end-to-end assertion could distinguish "seeded 172,
join adds one" from "seeded 173, join adds nothing". That was verified, not
assumed: patching the bundle to seed 173 and delete the increment left the whole
join spec green.

It is a product change made to close a test gap, which deserves naming rather than
burying. It is defensible on its own terms — an aggregate count is something a
guest genuinely wants before committing, and it is the same social proof a queue
outside a venue provides — and it reveals no individual, so the privacy promise
three lines below it ("guests can't see each other") stays true.

Proof it works: with the seed at 173 and the increment deleted, the new
two-reading test fails while the pre-existing "one more than the seed" assertion
still passes. That is the gap, demonstrated.

`src/features/join/JoinScreen.tsx` (`join-guest-count`), asserted in
`tests/e2e/join.spec.ts`. Moves the `01-join.{dark,light}` baselines.

## K. Permission copy, and the microphone Runit does not want
`expo-image-picker`'s config plugin defaults its usage strings to
"Allow $(PRODUCT_NAME) to access your camera" — accurate, and it renders as
"Allow Runit to…", so the often-repeated worry that Expo Go would make the prompt
say someone else's name does not apply to a produced build.

Two deliberate divergences from those defaults, both in `app.json`:

**The copy says why.** A guest deciding in a dark room with a drink in one hand is
better served by "Runit uses the camera so you can add a photo to this event's
shared album" than by a bare permission name.

**`microphonePermission: false`.** The plugin defaults it to *true* and also mints
`android.permission.RECORD_AUDIO`. Runit takes still photos and has no audio
feature; asking a wedding guest for a microphone it never uses is a privacy smell
and an App Review flag. Setting it false both omits the iOS string and emits
`tools:node="remove"` for RECORD_AUDIO in the merged Android manifest.

All of this was verified on WSL2 with **no Mac, no EAS build and no device**, via
`npx expo config --type introspect`, which prints the fully plugin-applied
`ios.infoPlist`. Worth remembering: the question of what a permission dialog will
say is answerable for free, long before anything is built.

**One correction that only a device could supply.** The custom `cameraPermission`
string is **iOS-only**. Android does not let an app supply the text for a
runtime-permission dialog; the real prompt on device reads *"Allow Runit to take
pictures and record video?"* — Android's own wording for the CAMERA group,
including the words "record video" for an app that records none. So the copy above
is an iOS improvement, not a cross-platform one. `design/device/`
`android-host-photos-capture.dark.png` is the run that established it.

## L. Upload progress and retry, which the canvas does not draw
The canvas has no in-flight or failed photo state — a tap on the shutter simply
produces a pending row. Real uploads fail, so the app has states the design does
not: a progress bar over the tile while bytes move, and a **Retry** button when
they do not arrive.

**They live in the guest's own album, not the host's queue.** `photos.pending`
now selects `'pending'` only; `photos.mine` carries this guest's `'uploading'`
and `'failed'` rows. The audiences are different — a photo whose bytes never
arrived is not work a host can moderate, and putting it in the queue gives them
live Approve/Hide over nothing while inflating the console badge. The selector
previously included `'uploading'` in `pending`, so this is a fixed bug rather
than a preference.

**The in-memory adapter's transfer is instantaneous, and that is the truth rather
than a stub.** Nothing is being sent anywhere; the bytes are already on the
device. A fabricated progress bar over a local file would show a guest work that
is not happening. The transfer is therefore *injectable* — the states are real
for the adapter that will send bytes, and they must be buildable and testable
before it exists. `fixtures/flakyTransfer.ts` drives them in tests, and
`?flaky=1` does in the harness, double-gated on `EXPO_PUBLIC_FIDELITY` so it
cannot be reached in a real build.

Consequences worth knowing:
- An in-flight upload **holds a tier slot** — otherwise a guest could start a
  hundred transfers past a cap only checked at the start of each. A **failed**
  one releases it, so a flaky connection cannot permanently consume an allowance.
- `upload()` **never throws on a transfer failure.** It is reached through
  `useGuardedAction`, which routes throws to the paywall — a dropped connection
  is not a billing problem.
- `progress` is `null` when settled, not `0`. Null means "not transferring";
  zero means "transferring, nothing moved yet". A bar that cannot tell them apart
  shows stuck at 0% on every finished photo.
- `upload()` returns an **`UploadOutcome`** rather than resolving void, and the
  toast reads it. Because a transfer failure is not an exception, `useGuardedAction`
  returns true either way — so a caller announcing success off that boolean will
  announce it over a failure. That is not hypothetical: the toast read *"Uploaded
  to Reception · awaiting host approval"* over a tile that was simultaneously
  offering Retry. **A device found it; the e2e suite had the same test and did not
  assert the toast, so it did not.** The outcome also separates `pending` from
  `approved`, because the free tier has no approval queue and promising a review
  that will never happen is a smaller lie but still one.

Verified on device: `design/device/android-upload-failed-retry.dark.png` (the
failed tile, photo dimmed under a Retry pill, first in the grid) and
`android-upload-retried-delivered.dark.png` (after Retry: `AWAITING APPROVAL · 4`
with the photograph in the host queue). The host queue stayed at 3 while the
upload was failed — it never saw it.

## M. Time is the event's, not the phone's — and not UTC
The canvas is internally inconsistent about time: the event is dated in the future
("Sat, Oct 17") while its content is mid-reception ("3 min ago"). It gets away with
that because every canvas timestamp is a hardcoded string. A running app cannot.

Three things changed, all found by asking what a beta tester would hit.

**The seed is anchored to yesterday, not to a fixed future date.** It used to be a
hardcoded `2026-10-17`. The feed sorts pinned-first then ascending by `createdAt`,
so a host's new broadcast — stamped `now()` — sorted **above** all three seeded ones
in guest Chat and **below** them in the host's Sent list, which reverses the same
array. Neither lane could see it: every unit test injected a fixed `now` *after* the
seed date, the one case where ordering is correct, and the e2e assertion only checked
`indexOf > 0` while the Now/Next card holds index 0. Worst of all, a fixed future
date **self-heals** — on 2026-10-17 the bug would have vanished with nothing fixed.
Two tests now use the real clock deliberately.

**`RunitEvent` carries a `timezone`, and `formatClock` takes it.** It previously read
`getUTCHours()`, which is correct only for seed values authored as UTC wall-clock. A
host in Chattanooga posting at 7:02 PM EDT saw their own broadcast stamped 11:02 PM.
Rendering in the *event's* zone — never the phone's — is what the original docblock
already intended; it just was not implemented. Seeded times are now authored as venue
wall-clock and converted to true instants, so a seeded timestamp and a runtime one are
finally the same kind of value.

**The conversion uses `formatToParts`, not `new Date(d.toLocaleString(...))`.** The
string round-trip is the usual recipe and it works under Node — which is why 144 jest
tests passed over it — but Hermes emits a locale string `Date` cannot parse, and the
app died on launch with *"Date value out of bounds"*. Only Lane C saw it. Verified on
the emulator afterwards: 4:10 / 5:45 / 7:02 PM render correctly through `Intl` on
Hermes, which is this app's first use of `Intl` at all.

## N. The empty-folder trap
Selecting a folder with no approved photos used to unmount the folder chips along
with the grid — they lived only in the grid branch — leaving no way back. Two of the
three seeded folders are empty, so it was one tap away, and an upload lands `pending`
so the pane never flips back on its own. The only escape was a force-quit, which
loses the session, the nickname and every vote.

The chips now render in **both** branches. The e2e that recorded this as expected
behaviour (*"that is also why there is no way back via a chip"*) has been inverted to
assert the escape exists, and fails if the chips are removed again.

## O. The UI stops claiming what the code cannot do
Four places where the app asserted something untrue. A beta-readiness audit found
them by asking what a tester actually meets, which is a different question from
what the tests cover — all four were green.

**"Push notification · on" is removed.** The canvas draws the pill; the repository
discards the argument (`void canPush`) and `expo-notifications` is not a
dependency. A badge telling a host their announcement will buzz 180 phones, over a
code path that does nothing, is the most expensive lie here — they would rely on
it. Restore the pill when push exists, not before.

**Nothing is seeded as the guest's own.** `requestedByName: 'you'` with
`myVotes: ['req_4']` meant a guest who had just typed their nickname was shown
*"Your request is #4 in the queue"* and a filled vote button for a song by Usher
they had never heard of. For a demo that is confusing; as a first impression of a
photo-sharing app it reads as "this has other people's data in it". req_4 belongs
to Devon now, and `myVotes` is empty. **Both states are still reachable — by
voting and by requesting**, which is how a guest reaches them in reality, and the
tests now do exactly that rather than asserting a seeded shortcut.

**The capped folder control is no longer `disabled`.** It reads "10 of 10 ·
Upgrade" and did nothing when tapped, because `disabled` means `onPress` never
fires. It was also the *only* route to `/pricing` in the entire UI, so the whole
paywall was unreachable outside a deep link. It now routes through
`useGuardedAction` to the pricing screen carrying the denial that caused it.

**~~The README no longer claims QR scanning.~~ Reverted — this one was a mistake.**
The other three above are the *running app* asserting something false to a user
mid-event. The README is a statement of what Runit is meant to be, and it was
correct: QR scanning is intended, and the code is what is behind. Resolving that
mismatch by editing the doc made the gap quieter instead of louder, which is the
opposite of every other entry in this file. The claim is restored and QR scanning
is a named item on the roadmap instead.

Useful thing that came out of it: `expo-camera` **is** bundled in Expo Go 57.0.9
(239 refs in the shipped APK, verified by dex grep), so a scanner works in both
clients, and `CameraView` carries `barcodeScannerSettings` — no extra library.

## P. The pricing screen is designed, rendered, and not shipped

`design/renders/04-pricing.{dark,light}.png` stay in the repo. `design/screenshots/`
no longer has a matching pair, and `tools/shoot-app.mjs` no longer walks there.

**That asymmetry is the note.** The canvas specifies a pricing ladder and the canvas is
the spec, so the render is still the truth about what Runit is meant to be. What changed
is that v1 does not ship the route.

The reason is not aesthetic. `PricingScreen.tsx` listed `$19 / $79 / $599` and contained
**no `Pressable` anywhere on the screen** — four tiers, four prices, and nothing to tap.
Shipping that invites App Review Guideline 3.1.1 (unlocking features must use in-app
purchase) and 2.1 (completeness), and a rejection round-trip costs more days than the
screen was buying.

What survives:

- **`src/domain/tiers.ts` is untouched.** The ladder still drives every entitlement gate.
- **The denial copy survives**, moved to `src/domain/denials.ts`. `useGuardedAction` raises
  it as a toast instead of navigating. A refused action still names the specific limit that
  refused it, which was always the property that mattered — the paywall was the delivery
  mechanism, not the point.
- **The folder-cap control stays pressable.** It reads `N folders max` instead of
  `N · Upgrade`, and tapping it toasts the reason. It was `disabled` once, which made the
  denial unreachable and looked exactly like a broken button; that fix holds, only its
  destination changed.

Restoring the screen is a route file, a `Stack.Screen`, and pointing `useGuardedAction`
back at it — **but it should not come back without a purchase path**, because a paywall
that cannot take money is the thing that got it cut.

## Q. The keyboard, which the canvas never had to draw

A design canvas has no soft keyboard, so nothing in `Runit.dc.html` says what should
happen when one appears. The app shipped with **no keyboard handling at all** — no
`KeyboardAvoidingView`, no `keyboardShouldPersistTaps`, no `returnKeyType`, one
`onSubmitEditing` in the whole codebase — and build #3 reached TestFlight unable to
complete a join, because "Run it" sits under the keyboard with no way to scroll to it.

### Android does NOT resize. This was measured, not assumed.

The reflex belief is that `android:windowSoftInputMode="adjustResize"` (present at
`android/app/src/main/AndroidManifest.xml`) makes Android shrink its window, so only
iOS needs help. **That is false here, and two facts make it false:**

- `android/gradle.properties` sets `edgeToEdgeEnabled=true`, and the app targets SDK
  36. Under edge-to-edge on API 35+, `SOFT_INPUT_ADJUST_RESIZE` is ignored — the IME
  overlays the window exactly as on iOS.
- **`/android` is gitignored.** It is `expo prebuild` output, so that manifest line is
  Expo's template default rather than a decision this repo made, and
  `expo prebuild --clean` would discard any hand edit. If a manifest value is ever
  wanted it has to go through `app.json`'s `android.softwareKeyboardLayoutMode`.

Measured on the emulator (1080×2400 @420dpi, Android 36) with `mInputShown=true` and a
**docked** Gboard:

```
app-root  before (0,0,1080,2400)   after (0,0,1080,2400)   -- unchanged
"Run it"  before (481,1566,598,1627)  after (481,1566,598,1627)  -- unchanged
IME top edge ~1494   =>  the CTA is painted UNDERNEATH it and is unreachable
```

`design/device/android-join-keyboard.BROKEN-before-fix.png` is that state.

**A trap worth naming:** the first capture caught Gboard in **floating** mode (a small
vertical pill), which never resizes anything by design and would have "confirmed" the
finding for the wrong reason. `adb shell pm clear com.google.android.inputmethod.latin`
resets it to docked. CLAUDE.md already warns that floating Gboard makes a field look
dead; it also makes a measurement look sound.

So `behavior="padding"` is set on **both** platforms, not iOS-only.

### One mechanism per subtree, never two

Stacking a `KeyboardAvoidingView` on a ScrollView that already insets itself makes iOS
compensate twice and pushes content off the top. The rule:

| screen | shape | mechanism |
|---|---|---|
| Join | content pinned to the visible bottom (`footer` `marginTop:'auto'`) | `KeyboardAvoidingView` |
| Music | composer is a flex sibling *after* the ScrollView | `KeyboardAvoidingView` |
| Host broadcast | a plain scrolling document, chrome above it | `automaticallyAdjustKeyboardInsets` |

Broadcast gets the scroll insets because a KAV must be **outermost** for its offset to
be zero, and `HostConsoleChrome` sits above the `<Slot/>` — a KAV there would need a
hand-measured header height that drifts the first time the chrome changes.

### The KAV goes OUTSIDE `<Screen>`, and that is arithmetic

RN computes `padding = frame.y + frame.height − keyboardTop`, where `frame` comes from
its own `onLayout` — **parent-relative** — while `keyboardTop` is screen-absolute.

- Inside `<Screen>`: the frame starts below the safe-area padding, so it under-pads by
  exactly `insets.top + insetDelta.page` and `keyboardVerticalOffset` would have to
  become a live expression of the top inset.
- Outermost: the parent is the router's screen container, which starts at window y=0
  because `headerShown: false` is global. The arithmetic lands on the keyboard height
  and **the offset is 0 and is omitted.**

If a header is ever added to `/join`, that stops being true.

### `flexGrow: 1` is load-bearing

`s.footer` pins "Runit · Event plan" with `marginTop: 'auto'`, which only has free
space to absorb if the scroll content container fills the frame the way `Screen`'s
`flex: 1` filled it before. **If the footer creeps up under the CTA, that is what is
missing.** Verified by shooting the pre-change screen in the same environment and
diffing: 394 of 3.1M pixels differ (0.0125%), **max channel delta 7/255**, 296 of them
by 1–2 — sub-pixel antialiasing from rasterising text inside a scroll container, not a
shift. A real move would be contiguous bands with deltas of 100+.

`paddingHorizontal` stays on `<Screen>` rather than moving to the content container: it
is the containing block `<Toast>`'s `left/right: 20` resolves against, and moving it
would widen the toast by 48pt.

### `keyboardShouldPersistTaps` is part of the same edit, not a nicety

Introducing a ScrollView **imports RN's `'never'` default**, under which the first tap
on a button while the keyboard is up is swallowed dismissing it. Without
`"handled"` this change would have made the reported symptom worse. On
`BroadcastPanel` it fixes a live bug rather than a hypothetical one: Send sits in the
same ScrollView as the textarea, so a host currently taps Send twice.

### The toast was rendering behind the keyboard

`Toast.tsx` computes `bottom = tabBar.contentHeight + max(insets.bottom, 12) + 29` ≈
126pt on **every** screen, including `/join`, which has no tab bar. A keyboard is
~291pt. Measured on device, the failure toast sits at y 2013–2064 against an IME top
edge of ~1494 — entirely hidden. Since the CTA is now pressable *with the keyboard up*,
this became reachable rather than theoretical, so `onJoin` calls `Keyboard.dismiss()`
first. Confirmed: `mInputShown=false`, and the dump contains
`That code doesn't match an event.`

**Deferred deliberately:** `Toast` deriving a tab-bar offset on a tab-bar-less screen
is still wrong — it sits 63pt higher than the design intends on `/join`. It is not
fixed here because it touches a component every screen mounts, and because no lane can
prove it either way: `join.spec.ts` reads the toast by testID and `aria-live` only,
never position, and `shoot-app.mjs` waits for toasts to disappear before every shot.

### `react-native-keyboard-controller` was rejected

Its native code does not exist in the custom SDK-57 Expo Go the project pairs with
(`pnpm start:go`), so every Expo Go session would render a different app from the one
on TestFlight. Lane B also boots the same `dist/` the journeys run over, making an
unproven web path a whole-suite risk for no web benefit. RN built-ins only.

### What proved this, and what could not

**Lane B proves nothing about keyboards, and that is structural rather than
approximate.** `react-native-web`'s `KeyboardAvoidingView` destructures `behavior` and
`keyboardVerticalOffset` away and renders a plain `<View {...rest}/>`; its `View`
filters props through an allowlist that excludes `keyboardShouldPersistTaps`,
`submitBehavior` and `automaticallyAdjustKeyboardInsets`, so none of them reaches the
DOM; and Chromium has no soft keyboard to raise. A Playwright assertion would pass
identically on a correct fix and on no fix at all. Lane B's job here was the opposite
one — proving **nothing moved** — and it did that.

`tools/audit-keyboard.mjs` (lane A3) exists for the same reason `audit-touch-targets`
does: static is the only automatable option. It refuses to prove that a KAV *wraps* a
given `TextInput` — JoinScreen's KAV wraps `Screen`, in another file — because
resolving JSX ancestry across component boundaries would be a heuristic wearing a
parser's clothes.

**The load-bearing evidence is Lane C**, and the strongest single assertion is that a
join completes **without ever touching the CTA**: `input text` plus three
`keyevent 66`s walked code → nickname → host key → submit and landed in Chat reading
**"173 here"**, up from 172. That holds even if keyboard avoidance misbehaves, which is
why the return-key chain is treated as load-bearing rather than as polish.

**Every iOS claim here is derived from RN's `KeyboardAvoidingView` source arithmetic,
not measured.** There is no Mac in this environment (deviation 2). iOS is unverified
until a TestFlight build runs on a physical phone.

## R. Leaving an event, which the canvas never drew

The canvas has no way out of an event, because a prototype for one reader never needs
one. The app inherited that, and it stopped being a design choice the moment a real
person joined `HOUSE7` on an iPhone without the optional host key: the tab bar offers
Chat, Photos and Music; `/join` is unguarded but nothing navigates to it; and the one
session control on screen, `RoleSwitch`, calls `becomeHost`, fails `is_host`, and
toasts. **Deleting the app was the only exit.** Found on a device, by a person, not by
any lane here.

### `closeEvent()` and `leave()` are different operations

The affordance calls **`closeEvent()`**, and the distinction is load-bearing rather
than stylistic.

`join_event` is idempotent on `(event_id, auth_user_id)`. Keep the anonymous session and
a re-join lands on the **same** `guests` row — votes, photo attribution and blocks
intact. Sign out first and `signInAnonymously()` mints a new `auth.uid()`, which does not
conflict, which **inserts**: the same person twice in the guest list, the first identity
orphaned, a second seat against the cap, and an abandoned anonymous user Supabase never
collects. On a visible button that is one permanent `auth.users` row per tap.

So `closeEvent()` tears down the eight channels, the socket and the six row caches, sets
the session anonymous — and keeps the token. `leave()` is that plus `signOut()`, and
keeps its zero callers until something genuinely needs to forget a person.

It also unpicks a conflation: `leave()` used to answer *am I in an event* and *do I hold
a token* on one line. `closeEvent()` answers only the first, which is what the route
guards actually read.

**No lane here could have caught the wrong choice.** `MemoryRepository` has no auth to
sign out of, so the e2e suite — which runs Memory — would have shown "leave, re-join,
same guest" while production doubled the row. A green board asserting the opposite of the
truth. The guard is in `SupabaseRepository.test.ts`, against the fake that can count
sign-ins: *join → closeEvent → join returns the same guestId*, plus an explicit assertion
that a session still exists afterwards. Both fail if `signOut()` is ever reintroduced —
verified by reintroducing it.

### The race stopped being theoretical, and the blast radius was the real bug

A host on build 6 left, re-entered with the key, and reported: zero guests, a broadcast
they had just sent and could not see, and **Show QR and Share invite doing nothing**.
The database said otherwise — the broadcast was written, the seat was claimed by the
right auth user, `guest_count` was 2, and replaying the policies as that user returned
`events readable: 1, broadcasts readable: 1`. Every write worked. Every read was
permitted. The device showed nothing.

One cause, four symptoms. `RealtimeTable.start()` awaited SUBSCRIBED **before** its
select, so a channel that could not join produced a table with **no rows** rather than
rows that merely stopped updating — and `event` comes from such a table, so
`disabled={!event}` made both invite affordances inert. They were not broken handlers.
They were disabled buttons.

**Live updates are an enhancement over a snapshot, not a precondition for one.** The
select now runs either way; a failed channel is torn down and recorded in `liveError`,
and `started` stays false so a later start retries. The subscribe-then-select ordering
is kept for the happy path, because the gap it closes is real.

The trigger is the race below, and removing `disconnect()` from `closeEvent()` removes
it by construction. But the trigger is arguable and the blast radius was not: a
transport failure should never cost the data.

Fixing it exposed a second, older bug. `startTables()` replaces its eight fields without
stopping what was there, and a replaced `RealtimeTable` takes its still-registered
channel with it. That leaked eight channels per call, masked because the only route to a
second call was a failed join whose teardown ran first. Two joins now left fifteen live
channels. `startTables()` stops before it starts.

### The race that caused it

`RealtimeClient.connect()` early-returns while `isDisconnecting()`
(`RealtimeClient.js:197`), and `disconnect()` is async. A re-join landing in that window
would subscribe against a socket that never opens — no error, nothing arrives, the screen
simply stays empty. **Leaving and immediately re-entering with a host key is exactly that
flow**, so this path is the one most likely to hit it.

A Node probe against the live project subscribed immediately after `disconnect()` and got
`SUBSCRIBED`. That is **not** an all-clear: instrumenting the client showed
`disconnecting=false` and `connected=true` at the moment of subscribe, so the probe never
entered the window. It measured the wrong thing and the finding is that it measured the
wrong thing.

What would settle it is a device run — close the event, re-enter within a second, then
wait two minutes foregrounded and have a second device change something, because **the
first screen being correct proves nothing**: the initial load is plain PostgREST and does
not need the socket at all. That run is blocked on the emulator's input pipeline, which
stopped delivering `input text` and `keyevent` to a demonstrably focused field with the
IME up and no overlay stealing focus.

Also corrected while here: `removeChannel()` does **not** leave the socket open forever.
`RealtimeClient` schedules a deferred disconnect once channels reach zero, and
`disconnectOnEmptyChannelsAfterMs` defaults to `2 * HEARTBEAT_INTERVAL`; `client.ts`
passes only `eventsPerSecond`, so we inherit it. The explicit `disconnect()` buys
*immediate* rather than *deferred*, which is worth having across a room of phones — a
smaller claim than the one originally written down.

## S. The invitation carries a date, and the event's details became editable
The canvas draws the join screen as a poster. Line 44 of `Runit.dc.html` is one string —
`Sat, Oct 17 · Doors 4:00 PM · Willow Barn` — sitting under the event name, above a
`+ Add to calendar` pill. It is a prototype for one reader, so those are literals in a
`state` block and there is nothing anywhere that edits them.

The app inherited both halves of that, and both stopped being design choices the moment a
real person opened a link on an iPhone: *"first button doesn't even work, I can't add the
invite to my calendar, who set the date and where."* Three complaints, one sentence, two
issues — #15 and #14.

**`doorsLabel` was carrying a date and a venue, and now carries neither.** It was the
canvas's whole subtitle, transcribed. It held the date because nothing could derive one —
`formatClock` rendered a time and there was no formatter anywhere in the app that could
render a *day*. `formatEventDate` is that formatter, so JoinScreen now composes
`date · doors · venue` from three fields and `doorsLabel` means what its name says.

That is not cosmetics. **A date stored as prose cannot disagree with `starts_at` out loud
— it disagrees silently.** `HOUSE7` on the live project held a start time of **11:13 AM**
under a label reading "Doors 7:00 PM", because `seed-events.sql` wrote `now() + interval
'7 days'` and nothing ever rendered the result. The moment the invitation derives its date
and the calendar pill exports it, that becomes a wrong entry in a guest's calendar. The
seed is now anchored to the next Friday at 19:00 *venue-local*, and a host can correct it.

**The preview is poorer than the event, deliberately.** `event_preview` returns id, code,
name, venue, `starts_at`, timezone and `doors_label` — and withholds `tier` and every
count. The fine print three lines down the same screen promises *"guests can't see each
other"*, and a headcount for a room you have not entered is the first crack in it. So an
invitation names the event and does not say how many people are already inside. The pill
returns the instant you join. `EventPreview` is a `Pick<RunitEvent, …>` rather than its own
interface so it cannot drift, and `previewOf` in the fixtures exists because assigning a
whole `RunitEvent` to it typechecks — TypeScript only runs excess-property checks on
literals — and would hand the fake a tier the RPC never sent.

**A fifth host segment, where the canvas drew three.** `Runit.dc.html:215` is a three-up
grid: Broadcast, DJ queue, Photos. Reports was the first divergence (Guideline 1.2 asks for
timely responses, and a queue you have to go looking for is not one you answer). `/host/event`
is the second, and it is where event-level settings will keep accumulating — tier, invitees,
co-hosts. It is a scrolling document rather than a sheet, because note Q's decision table
already settled that: anything under `/host/*` sits below `HostConsoleChrome`, so it takes
`automaticallyAdjustKeyboardInsets`, not a `KeyboardAvoidingView` that would need a
hand-measured header height.

**Typed date and time, not a picker.** `@react-native-community/datetimepicker` is a native
module with no web support, so Lane B, the screenshot lane and the contrast gate would all
go blind on exactly the one screen where a wrong value is expensive. A text field is worse
to use and honestly measurable, and the reading under the fields — `Fri, Sep 11 · 7:00 PM` —
is what a host actually checks. `wallClockToInstant` was promoted out of `wedding.ts`
rather than rewritten, because that converter was already proven on Hermes; note M records
what the string round-trip did there. It gained a **second pass**, which is not decoration:
across a spring-forward boundary one pass puts 3:00 AM an hour out, and a test fails if
anybody removes it.

**What proved this, and what could not.** Lane B runs `MemoryRepository`, so all 170
journeys say nothing about whether the column grant was widened or whether `event_preview`
is reachable by a non-member — against Supabase a non-host's UPDATE affects zero rows and
raises nothing, which no assertion in `tests/e2e/` can see. **Lane E is what proves it**,
and it now does: 45 assertions, 0 failures, run live. Including that a non-member gets one
row from `event_preview`, that it leaks no counts, that all five columns write, and that a
host still gets 42501 on `tier`, on `code`, and on the run-of-show cursor.

Lane E also turned out not to have been running at all — see issue #31. A setup line raised
42501 outside an exception handler and aborted the `DO` block, so every assertion past the
folders section had never executed once, and the lane skips silently without a database URL.
The three new tests here were mutation-checked instead of trusted: deleting the lookup,
reverting the composed subtitle, and no-oping the save each fail the tests that name them.

## T. Making an event, and the key that gets you back to it
The canvas has no way to make an event, because a prototype for one reader never needs
one — the same shape as the keyboard (note Q), leaving an event (note R) and editing the
details (note S). What made this one different is that the gap was total: **every event,
host seat, folder and host key in existence came from a human running
`supabase/seed-events.sql` with the database password.** A host could operate an event
somebody else conjured. She could not have one.

The question that named it, from the user: *"where is the hostess supposed to get a key to
her own party, feels like we're missing something obvious at the beginning."* The answer
was that she got it from a developer, by email, after that developer ran SQL.

**She needs no key to get in, and that reframed the work.** `create_event` binds her seat
to `auth.uid()` in the same transaction that makes the event — she is the host because she
made it. The key was built for the *second* person: a DJ, a planner, the bride's sister.
So the ordering had been backwards. We shipped the mechanism for *delegating* host access
(`claim_host`, `host_claims`) before the mechanism for *having* it, and the seed script
stood in for the missing half.

**But the key is still mandatory, for a different reason.** That `auth.uid()` is an
anonymous session in a keystore on one phone. An Android reinstall wipes it. Without a key
she loses her own event permanently — while it keeps running, with her guests in it and
nobody able to broadcast, approve a photo or answer a report. `claim_host` already
*rebound* rather than refused, with a comment naming exactly this; it simply had no way to
be given a key. So `create_event` mints one, and it is shown once, on a panel that replaces
the form. Not a toast — gone in four seconds. Not a modal — dismissed by a stray tap on the
backdrop. Only the bcrypt hash is stored, so that panel is the one moment the string exists.

**One transaction, because an event is not one row.** It is a row, a folder, an
`active_folder_id` pointing at that folder, a host seat bound to a person, and a
credential. Four of those five are refused to `authenticated` on purpose, and the folder is
the one that would bite silently: an event without one refuses every upload, so a party
created in pieces would have a camera that quietly does nothing. `folders_insert` also
requires `is_host`, which is not true until one statement later — so it *has* to happen
inside the function.

**New events are `house_party`, and the screen says so.** There is no purchase path (#30),
so any other default would be giving the ladder away and leaving the entitlement layer
permanently unexercised in production. *"New events run on House party — up to 10 guests"*
is better than discovering the cap at the tenth guest.

**A cap of ten events per identity**, because this is an INSERT reachable by anyone who can
sign in anonymously, and that is one HTTP call. The rate limit bounds how fast identities
appear; nothing else bounded how many events one identity makes.

**What the tests found that review did not.** `loadFetchOnce` read `this.requireGuest()`
inline to fetch song votes — correct while every path into it arrived through
`joinAsGuest`, and wrong the moment a founder did not. She made the event; she never joined
it, and `create_event` deliberately does not seat her (a brand-new party reading *"1
already here"* before anyone arrives is worse than the gap it closes). `loadBlocks`
immediately below had already reasoned this way and handled it; the other half simply had
no caller to force it. A host with no guest row now gets an empty vote set, which is the
right answer rather than a fallback.

The keyboard audit caught the other one, on the worst possible button: the key panel's
ScrollView had no `keyboardShouldPersistTaps`, so with the keyboard still up the first tap
on *"I have written it down"* would be swallowed. A host who reads that as broken and
navigates away has lost the only copy of her key.

**`random()` was minting the keys, and an automated security review caught it.** Postgres's
`random()` is a fast per-session PRNG, not a CSPRNG — fine for shuffling rows, wrong for
both values here, because both gate access: the key rebinds a host seat through
`claim_host`, and the code is what `join_event` admits a guest on. The specific danger was
worse than the general one: `create_event` is callable by anyone who can sign in
anonymously, which is a single HTTP call, so an attacker could ask for keys in a loop and
read the generator's output stream directly — and against a pooled connection that is
somebody else's session state. I had built the oracle myself.

Both now come from `mint_token`, which draws `gen_random_bytes` and uses **rejection
sampling** rather than a bare modulo: 256 is not a multiple of 31, so `byte % 31` would
make the first eight characters about 3% likelier than the rest. It is revoked from every
client role, and Lane E asserts that revoke — because this schema's own GRANTS section
documents the trap that `revoke ... from anon` alone is a silent no-op.

`MemoryRepository` moved to `expo-crypto` too. Nothing there is a real credential — one
process, one device, no attacker — but a fake with weaker properties than production is how
a harness goes green on a broken app, and `Math.random()` two lines from a value named
`key` is a pattern somebody lifts into a place where it does matter. Which is precisely
what had happened in the migration.

**What proved it.** Lane B runs `MemoryRepository`, so its 186 journeys prove the screens
and nothing about the grant. **Lane E proves the rest, and it is the only lane that can**:
59 assertions, 0 failures, run live — a founder is host immediately with no key changing
hands; the event arrives with an active folder; only the hash is stored; **a different
identity presenting the key gets back in**, which is what "new phone" means; and rotation
issues a new key while the old one stops working, which is the half that makes rotation
mean anything.

## U. A DJ gets a seat, and the caps stopped living only in TypeScript
"Add a DJ" was advertised and unbuilt. `src/domain/tiers.ts` puts *"5 hosts with roles
(host, DJ, planner)"* on the featured $79 tier, and `hosts.invite` threw unconditionally
against Supabase while having **no UI caller anywhere in `src/`**. So the headline feature
of the tier this product is aimed at was refused to everyone, at every price.

**The free tier is not the problem, and it is worth saying because I got this wrong
first.** `house_party` is `maxHosts: 1` with `hostRoles: false`, and its own `featureLines`
says **"1 host"** — free → 2 hosts → roles is a coherent ladder that advertises exactly
what it delivers. The defect was one layer up: the control did not exist on any tier.

**A co-host gets a key, not an account.** `invite_host` mints a `hosts` row with
`auth_user_id` NULL and a `host_claims` hash beside it, and returns the plaintext once. The
invitee types it on the join screen; `claim_host` binds the seat to whatever anonymous
session they are holding. That is the point of the whole key mechanism — the DJ and the
floor staff should not need accounts, and `docs/design-host-accounts.md` said so before any
of it was built.

This is also where the imported "RunIt Flow" canvas and the app disagree. The canvas
assumes founders hold email accounts and only co-hosts hold keys; this app shipped keys for
the **founder** (note T), so the coherent build was "issue a second key, scoped to a role"
— reusing `mint_token`, `claim_host` and `rotate_host_key` rather than S4's email model.

**`claim_host` gained a one-seat-per-person guard.** Whoever holds two keys for one event
could otherwise bind both rows to themselves. Not an escalation — `is_host` is already true
from the first seat — but it *strands* the second: the co-host it was minted for can never
claim it, and nothing on screen would say why.

**THE CAPS ARE A TABLE NOW.** Every entitlement was enforced in a repository method, on the
stated grounds that a check in a button handler is bypassed by the second caller. That does
not go far enough: a check in a *client* is bypassed by the second client, and
`src/data/supabase/README.md` already forbade client-only enforcement in as many words.
`public.tier_limits` holds the numbers, `invite_host` reads them, and no client can write
them.

Duplicating them into SQL is real drift risk, which is why `src/domain/tiers.test.ts`
re-parses the migration's own seed and fails on mismatch — the same shape as
`tokens.test.ts` re-parsing `theme.css`. `docs/design-host-accounts.md` predicted this exact
drift and named this exact remedy. Verified by mutation: giving the party tier a third host
in SQL alone fails the suite.

**The tier audit learned to see SQL.** `tools/audit-tier-claims.mjs` counted a
`checkFeature` call anywhere under `src/`, which a call in `MemoryRepository` satisfies —
and that adapter does not ship. It now also counts enforcement in the migration, and it
*reports where each flag is enforced* rather than only that it is. `hostRoles` reads `SQL`;
`pinnedAnnouncements` and `pushNotifications` are still flagged `in-memory adapter ONLY`,
which is issue #21 made legible instead of hidden behind one green line. Deliberately not a
failure yet: making it one today would fail the build on two flags that predate the check,
which is how a gate gets switched off.

**`roleLabel` travels now.** Both adapters stripped it on the way out of `hosts.all`, so a
seat list could only ever render the permission grade — "Riley · Bride" was reachable only
through the `Session`. Memory also set `roleLabel: displayName`, which printed
"DJ Marco · DJ Marco". Mutation-checked: restoring the strip fails two journeys.

**What proved it.** Lane B's 198 journeys run `MemoryRepository`, so they prove the screen
and nothing about the grant. **Lane E proves the rest**, run live: the free tier stops at
one host, an empty `role_label` falls back to the role's own name, the seat stays unclaimed
until the key is presented, only the hash is stored, the founder cannot collect the
co-host's seat, and **the DJ redeems his key as a different identity with no account** —
which is the whole claim.

## V. The QR stopped being a dead string
The canvas has said *"Scanned the QR? Your code is filled in"* since the first artboard,
and generation shipped long ago. What nobody checked is what the QR **encoded**:
`runit://join?code=…`, a custom scheme. `src/lib/invite.ts` described the consequence in
its own docblock, accurately, and then nothing acted on it for months:

> it only resolves on a phone that already has Runit installed. To anyone else it is a
> dead string.

A printed card is handed to strangers. The one person a printed QR exists for — somebody
at the door without the app — got nothing at all. Scanning produced an unopenable URL and
no error.

**Two things the issue and the code both had wrong, found by measuring rather than
reading.** `invite.ts` claimed `runit-legal` was "already positioned to serve" an
association file. It is not: Apple fetches from the **domain root**, and `runit-legal` is a
GitHub Pages *project* site that can only answer under `/runit-legal/`. The apex 404s and
no user-site repo exists. And GitHub Pages **cannot set a Content-Type** — probing
`runit-legal/.nojekyll`, also extensionless, returns `application/octet-stream` where Apple
documents `application/json`. Both were assumptions dressed as facts, mine included, and
both took one `curl` to settle.

So the links live on a Cloudflare Pages subdomain, which can be told what to serve.
`runit-legal` does not move: App Store Connect's privacy and support URLs are registered
and unchanged.

**The web files are in this repo, not the host's, and that is the point.** A misconfigured
universal link does not error — it silently opens Safari, forever. A wrong team id, a
drifted bundle id, a path prefix that stopped matching, a host that changed: every one
fails that way. Keeping `web/` beside the app makes them checkable, and
`src/lib/invite.test.ts` now asserts that four artefacts describe the same app at the same
address. Mutation-checked both ways: a wrong team id in the association file fails, and an
`associatedDomains` pointing elsewhere fails.

**`/i/<CODE>`, not `/join?code=`.** Shorter on a card, smaller as a QR, and it gives the
association file one unambiguous prefix to match. It needs a matching app route or
expo-router falls through to `+not-found` — an invitation opening the app on an error
screen, which is worse than opening the browser. `src/app/i/index.tsx` exists as well,
because a dynamic segment needs a segment: a truncated `/i/` would otherwise say "this
event does not exist" to somebody holding a real invitation. The empty-code guard inside
`[code].tsx` was unreachable until a journey caught it.

**The change is an improvement even if the association never validates.** Without it the
link opens a page showing the code big enough to type; before it, the same scan opened
nothing. The failure mode went from silence to a readable page, which is why this shipped
without a device to confirm the rest.

**What is NOT proven, and must be said plainly.** No lane here can show that iOS accepts
the file, that Apple's CDN fetched it, or that a real tap reaches the app. There is no Mac
in this environment and Apple caches for days. Lane F proves the QR encodes the link;
jest proves the config agrees; a phone proves the rest and nothing else does. Until one
has, the universal link is **unverified** — check it with Settings → Developer → Universal
Links → Diagnostics.

**Postscript to V: the host was somebody else's.** `INVITE_ORIGIN` shipped for one commit
as `runit.pages.dev`. That name is taken — by an unrelated project serving an OAuth
callback page that answers **200 on every path**. So for one commit every QR this app
generates pointed at a stranger's website, and `associatedDomains` declared a relationship
with a domain we do not control.

The unit tests passed the whole time, and they were correct to. They assert that
`INVITE_ORIGIN`, `app.json` and the association file **agree** — and they did agree,
perfectly, about the wrong host. **Agreement is not ownership.** Nor is a status code: a
`200` check would have passed against that catch-all too.

`tools/verify-links.mjs` is the lane that can tell the difference, and the only thing that
distinguishes our host from anyone's is what comes back in the **body** — an association
file naming our team and bundle id, and a page carrying our App Store id. Pointed at the
stranger's host it reports four specific failures; pointed at an undeployed name it skips
loudly, because Cloudflare Pages must be connected by a human in a browser and a gate
nobody can satisfy gets deleted.

`pages.dev` names are global and first-come. Probe before choosing one: an unclaimed
`<name>.pages.dev` does not resolve at all, while a taken one answers.

## W. The rest of the ladder became true, and Lane E ran whole for the first time
Note U made *one* cap real: `tier_limits` exists, and `invite_host` reads it. That left the
other three advertised limits exactly as they were — printed on the pricing page, enforced
in `MemoryRepository` alone, and free for the taking against Supabase. #22, #21 and #34
close that, and the arc is worth writing down because each one failed in a *different* way.

**#22 — the guest cap, which counted nothing.** `join_event` admitted every caller. The
free tier says "up to 30 guests" and the room simply kept filling; `event_full` sat in
`JoinReason` as copy only the in-memory adapter could produce, which is the tell — a reason
with no producer is a promise with no enforcement. The function now counts against
`tier_limits.max_guests` and raises **54023**.

**A guest already seated must still get back in, and that is the load-bearing half.**
`join_event` is idempotent on `(event_id, auth_user_id)`, so the cap has to be checked
*only for a new seat*. Checked before the idempotent branch, a reinstall at a full event
would lock out someone already standing in the room — the worst failure this feature could
have, and invisible until the room is full. Lane E asserts both directions: the 11th guest
is refused, and Ada rejoins.

**#21 — the pin, which degrades rather than refuses.** `pinned_announcements` is false on
`house_party`. A trigger folds a free-tier pin to `pinned = false` and **lets the broadcast
through**. That asymmetry is deliberate: refusing the insert would lose the host's message
over a formatting privilege they did not know they lacked. The announcement is the thing
they came to send; the pin is decoration. Lane E asserts both — the pin drops *and* the row
lands.

**#34 — a column a policy could not hide.** `hosts_read` admits any joined guest, and the
table carries `auth_user_id`. A policy says *who* may read; it cannot say *which columns*.
`toHost` dropped it client-side and that was never a control — a mapper runs on the client
and PostgREST answers whatever the grant allows. `revoke select on public.hosts` plus a
grant naming six columns closes it, the way `events` already narrows writes.

**The revoke names the ROLE, so it applies to hosts too**, and that is stronger than the
issue asked for. Nothing on the client has ever needed the column — `SupabaseRepository.ts`
selects named columns and `toHost` discards it — so leaving it readable to hosts would be a
capability with no caller.

### What running the file actually caught

`supabase/verify-policies.sql`'s own header says anything added here must be **run, not
merely written**. Running it caught two bugs, and both were in the *test*:

    two assertions looked a host row up by `where auth_user_id = ...` while standing in
    `set local role authenticated`. After #34 that raises 42501 — outside any handler,
    aborting the whole DO block, which is precisely the failure mode #31 was filed for.
    The first cost a round trip at line 253; the second, at line 347, cost another.

Both are now read as the owner, because they are claims about a **row**, not about what a
client may see. The permission itself is asserted separately, from a guest *and* from a
host. A test that reads a column the schema hides does not prove the column is hidden; it
just stops the file.

The whole file now runs end to end: **79 assertions, 0 failures**, first complete run since
the block was unblocked. `tools/verify-policies.mjs` now carries that number as a
**coverage floor**, the same doctrine lanes A and A2 already use: an abort cannot hide
(it never reaches the closing RAISE, so there is no report to parse), but a file that
*shrinks* would report "0 FAILURE(S)" in the same words over half the coverage.

## X. The gutter that was never declared, on the screen no lane could see
`CreateEventScreen`'s content container set `paddingVertical` and no
`paddingHorizontal`, so both of its screens rendered flush at **x = 0**: labels against
the bezel, text-field borders clipped off both edges, and — on the second screen — the
recovery key itself, which `create_event` returns exactly once and never again.

**`<Screen>` sets vertical insets ONLY, and that is deliberate.** Its docblock is the
place this is stated: the artboards' 66 / 70 / 28 are the canvas's fake status bar and
home indicator, and they become `paddingTop` / `paddingBottom` derived from
`useSafeAreaInsets`. The horizontal gutter is each screen's own to declare, and every
other scrolling screen declares it — `ChatScreen`, `MusicScreen`, `BroadcastPanel`,
`DjQueuePanel`, `PhotoApprovalsPanel` and `EventDetailsPanel` all use 20;
`JoinScreen` uses 24 and puts it on `<Screen>` itself with a comment saying why. This
screen was derived from `EventDetailsPanel` and lost the line in transit.

### Why nothing caught it, which is the part worth keeping

**Lane D is a COMPARISON lane.** It reads `design/renders/<screen>.png` and
`design/screenshots/<screen>.png` in the same message and walks the regions. The create
screens came from `docs/design-host-accounts.md`, not from `Runit.dc.html`, so they have
no render — and with nothing to compare against, the one lane that could have seen this
cannot run on them at all. Everything else was blind for its own reason: the colour gate
reads a single pixel, the contrast gate reads colour pairs, and no static audit measures
geometry.

### The gutter gate, and why it belongs in lane B rather than in a static audit

Lanes A2 and A3 are static audits **because react-native-web is structurally blind** to
what they check: it drops `hitSlop`, renders `KeyboardAvoidingView` as a plain `View`
with `behavior` stripped, and filters `keyboardShouldPersistTaps` out before it reaches
the DOM. An assertion there would pass identically on a correct fix and on no fix at all.

**Padding is not in that category.** `paddingHorizontal` becomes real CSS padding on a
real element and `getBoundingClientRect()` returns where the pixels actually are — the
same footing as contrast, which the shots gate already measures honestly for exactly
this reason. So the gate lives beside it in `tools/shoot-app.mjs`.

**What it claims is deliberately narrow: nothing readable or tappable within 8px of
either edge.** Not "every gutter is 20" — that would fail the tab bar (12) and the join
screen (24), and a gate that reports two dozen false failures gets switched off. That
lesson is already written down one note over: an audit run at the wrong level is how
44×44 nearly killed the touch-target lane. Flush-to-zero is the bug class; 8 catches it
with room, and it reported **zero** false positives across all 22 screens.

Mutation-checked, which is the only thing that makes a passing gate mean anything:
reverting the one-line fix fails it with 18 named elements, all on `00-create-event`
and none anywhere else.

### It measures the ink, not the box — added when it flagged a screen that was fine

The retention line in note AI sets `paddingHorizontal` on the `<Text>` itself, because it
is a sibling of the album grid rather than a child of it and has no container to inherit a
gutter from. react-native-web renders that `<Text>` as a div, so the padding insets the
glyphs while the div's own rect still starts at **x = 0** — and the gate, reading
`getBoundingClientRect()`, reported a defect the screen did not have. Two elements, both
correct on screen.

The fix is to measure where the characters land: for a leaf text element the gate now takes
a `Range` over its contents and uses that rect. This cannot weaken it — a full-bleed line
with no gutter still measures 0 either way — and the probe that proves it is the one that
matters: with the padding the album is clean, and zeroing that padding **in the DOM**, so
nothing else on the page moves, brings the line straight back at `left 0`.

That last detail is the method, not a footnote. Deleting the padding **in the source** and
re-running the walk fails the *colour* gate first — the line rewraps, the page gets shorter,
and the sampled pixel lands inside a hue tile — so the run goes red without the gutter gate
ever having been consulted. A red board is not evidence that the gate you were testing has
teeth. Mutate in the DOM when the source mutation moves the layout out from under a
different gate.

### The walk now includes the key panel

`00-create-key` was added to `tools/shoot-app.mjs`. It is the screen in this app where a
layout defect costs the most — only a bcrypt hash is stored, so a screen that clips or
hides that string has destroyed it — and it had never been shot, which meant nothing in
any lane had ever looked at it. **A gate can only see the screens the walk visits**, so
adding the check and adding the screen are one change, not two.

What is still missing is a render to compare either screen against; lane D remains unable
to run on them. Filed rather than left in this paragraph.

## Y. Un-pinning, and the fix that would have undone the fix before it
`broadcasts` carried a SELECT policy and an INSERT policy and nothing else. So a pin was
permanent: a notice that stopped being true two hours in — *"Last call at the bar is 11 PM
sharp"* — sat above every guest's feed for the rest of the night, and no control anywhere
in the app could move it. `SupabaseRepository` said so in a comment rather than in an
issue, which is how it stayed true for months.

**Only `pinned` moves.** `revoke update on public.broadcasts` then
`grant update (pinned)`, the same shape `events`, `reports` and `hosts` already use. An
un-pin control implemented without the column grant also hands every host the power to
rewrite the **body** of an announcement guests have already read, and to re-attribute it
by editing `author_name`. An announcement is a thing that was said; only its prominence is
still editable afterwards. Lane E asserts the refusal at 42501.

### The trap this set for the note before it

`broadcasts_pin_to_plan` — the trigger from note W that folds a free tier's pin — was
`before insert`. Adding an UPDATE policy on top of an insert-only trigger leaves a
free-tier host **one statement** away from the pin #21 had just taken off her: send the
announcement (folded to `false`), then `update ... set pinned = true`, with nothing in the
path to fold it a second time.

**The cap would have been undone by the feature that came after it, silently, and every
gate would still have been green.** The trigger is now `before insert or update`, which is
safe in both directions because `fold_pin_to_plan` acts only `if new.pinned` — an un-pin
skips the body entirely. Lane E asserts the closed door directly: *a free-tier host cannot
pin via UPDATE either.*

This was found by an adversarial reviewer reading the migration, not by writing the
feature. Nothing in #26 mentions the trigger; the two issues were filed a session apart
and the interaction lives only in the order they were done.

### The asymmetry, which is the whole subtlety of the client half

**Pinning is gated on the plan. Un-pinning never is.** The symmetric version reads as
consistent and is a real bug: a host who pins on a paid tier and then downgrades would be
refused permission to take her own pin down — the exact dead end this feature exists to
remove, re-created inside its own implementation. `event.setTier` makes it reachable in
one line, and a real plan change makes it reachable in production.

Postgres already had the right shape (`if new.pinned`), so a symmetric client gate would
also have put the adapter out of step with the server. `MemoryRepository` gates only the
`true` direction; `SupabaseRepository` gates neither and lets the trigger fold, because a
rule stated twice is a rule that drifts.

That one is not mine either — it came back as a `wrong` verdict on my own plan from the
adversarial pass over the issue survey, before any of it was written.

### What proves it

- **Lane E**, live: un-pin lands one row; the body update is refused 42501; a free-tier
  UPDATE cannot re-pin; **a guest's UPDATE affects zero rows and raises nothing.** That
  last one is why `setPinned` ends in `assertWrote` — without it the refusal reads as
  success and the pin springs back on the next realtime frame. 83 assertions, 0 failures.
- **jest**, mutation-checked in both directions: making the entitlement symmetric fails
  the downgrade test; the adapter test pins the payload to exactly `{ pinned }`.
- **Lane B**, one journey measuring feed ORDER twice — pinned above, then below again.
  "The control is on screen" and "the label changed" would both pass against a button
  that does nothing to the feed. Making `setPinned` a no-op fails it.

## Z. Push stopped being sold, and the flag stayed as the build target
`pushNotifications` was a `TierFeatures` flag, granted on the **$79 Event** and **$599
Venue** tiers, with *"Pinned announcements + push"* printed on the Event card. There is no
push. `expo-notifications` is not a dependency and never has been.

Underneath it, `chat.send` took a third argument — `push: boolean` — that **every caller
passed `true` and every adapter threw away.** `MemoryRepository` computed `canPush` and
then wrote `void canPush`. `SupabaseRepository` destructured `{ body, pinned }` and left
`push` in the type signature, unread. A parameter that cannot change any outcome is a
promise the type system makes on behalf of code that does not exist.

**This closes #21, and it is the second of the two ways that issue could end.**
`pinnedAnnouncements` ended the other way — real enforcement, a trigger on `broadcasts`
folding a pin the tier cannot carry. Push had no such route: you cannot gate a capability
nothing has, so the only honest options were build it or stop selling it, and building it
is blocked three ways (an APNs key behind an Apple login with 2FA, the dependency, and a
paid-tier decision). `pnpm audit:tiers` now reports **12 features, 3 granted, every one
enforced**, with no yellow line under it for the first time.

**THE FLAG STAYS, at `false` on every tier.** That is not a hedge, it is the remedy the
gate itself prints when it fails:

    Either build the enforcement, or set the flag false on every tier until you do
    and take the line out of featureLines. The flag may stay in TierFeatures as the
    build target.
    — tools/audit-tier-claims.mjs:130-133

Eight siblings already live that way — `customBranding`, `venueBranding`, `zipExport`,
`requestCaps`, `multiDjQueues`, `folderTemplates`, `bulkQrPrinting`, `prioritySupport` —
and `entitlements.test.ts` records the reasoning for `requestCaps` in as many words.

**It was deleted outright first, and that was wrong twice over.** It made push the only one
of nine unenforced flags handled differently, for no stated reason. And it took the flag
out of `'feature %s never disappears as tiers get dearer'` — an existing monotonicity test
that had been covering it — so a deletion sold as removing fiction quietly removed
coverage as well. Caught by re-reading the tool's own failure text, not by any gate.

**The database was already honest and the price list was not**, which is the detail worth
keeping. `tier_limits` deliberately had no push column, and `tiers.test.ts` asserted that
— but it asserted only that half. The TypeScript ladder went on carrying the flag,
granting it on two tiers, and selling it in copy, and the test that existed to catch
exactly this could not see any of it.

It now checks both sides: no column in SQL, **no tier GRANTING it**, and no `/push/i` in
any tier's `featureLines`. Not "the key is absent" — that first version quietly forbade
the remedy the sibling gate recommends, and **two gates disagreeing about one flag is
worse than either rule alone.** Mutation-checked in both directions: granting it on a tier
fails three separate tests plus `audit:tiers`, and restoring the copy line fails one.

The docblock says to **delete that test on the day push is built, not weaken it.**

**Nothing renders `featureLines` today** — `PricingScreen` is cut (note P), and no paid
tier is reachable (#30). That is precisely why this was worth doing now rather than later:
the copy is a promise waiting for a screen, and #30 would have shipped it.

The pill itself was already gone (note O). What survived that pass was the argument and
the price list behind it — the same shape as the six capabilities that hid inside one line
of prose until they were made into issues.

## AA. Push exists, and the price list stopped lying by becoming true
Note Z removed "+ push" from the $79 card because the app could not send a notification.
This builds the capability and puts the line back. The promise is the same words; the
difference is that something now happens.

**What existed before: nothing.** `expo-notifications` was not a dependency, there was no
token anywhere, no server function, and `chat.send`'s `push: boolean` was discarded by both
adapters (`void canPush`).

### The token cannot be written by an UPDATE, and that is not a style choice

`guests` has **no SELECT policy** — deliberate, and load-bearing for the anonymity promise
on the join screen. Postgres applies SELECT policies to the rows an `UPDATE ... WHERE`
must read in order to evaluate its WHERE, and **PostgREST always emits a WHERE.** So the
obvious implementation —

    await db.from('guests').update({ push_token }).eq('id', myGuestId)

— matches **zero rows and raises nothing**, on every device, forever. Measured, not
reasoned: issue #36 has the run, and it also proves the sibling policy `guests_update_self`
is unreachable for the same reason.

**`assertWrote()` cannot rescue it, which is the sharper half.** `.select()` after an
update returns rows only if a SELECT policy admits them — so on this one table a
*successful* write comes back empty too. The guard would fire on the good path and stay
silent on the bad one. Inverted is worse than absent.

So the write goes through `set_push_token`, SECURITY DEFINER, scoped to the caller's own
seat at one event. A person at two parties has two rows, and revoking at one must not
silence the other.

### The send is a trigger, because a client-invoked send is a second authority

A device cannot reach 180 others, so something server-side has to fan out. Doing it from
the app fails in both directions: a caller can insert a broadcast and never call the
function (announcement sent, nobody buzzed, silently), and a caller can call the function
*without* inserting — which would make the sender a second authority on who may address the
room, holding a service key and re-implementing `is_host` outside the schema.

`after insert on broadcasts` → `pg_net` → an Edge Function that reads tokens as the service
role. The trigger fires on a row RLS has already admitted, so authorisation is settled
before the request is built. **One trigger covers two of the three cues**, because
`start_schedule_item` already posts a `schedule_started` broadcast rather than notifying
separately. "Your song is next" needs its own, on `song_requests` UPDATE — a request is
accepted by being *updated*, so an insert-side trigger would notify nobody, ever.

**It must never fail the insert.** Losing a host's announcement because a notification
could not be queued is exactly backwards; every failure path returns normally, and Lane E
asserts an announcement lands on both tiers with the Vault secrets absent.

### The tier gate is a column now, and that is what makes it a gate

`tier_limits.push_notifications` did not exist while push did not exist — note Z's own
reasoning, that a column claiming to gate a capability nothing has is a second fiction. It
exists now because **`fan_out_push` reads it**. `pnpm audit:tiers` reports
`pushNotifications — SQL`, which is the same standing `hostRoles` and `pinnedAnnouncements`
have.

### What is proven, and what is not

Lane E, live: **95 assertions, 0 failures.** A guest's token is stored trimmed and scoped;
another guest's call cannot overwrite it; **no client can read any token, their own
included**; `null` clears it; a host calling it is a quiet no-op (a host has no `guests`
row); both triggers exist and the song one is on UPDATE; neither fan-out is callable by a
client; and an announcement lands with push unconfigured. jest covers the adapter, mutation
checked — swapping the RPC for a direct update fails three tests.

**Nothing here proves a phone buzzes.** Not one lane in this environment can:

- Lane B has no push API *and* boots `MemoryRepository`, so it sees a stub returning `null`.
- Lane C could witness an Android notification, but only once FCM credentials are wired.
- **iOS is unprovable here at all** — no Mac, no device. A wrong APNs key produces "no
  notification arrived", which is indistinguishable from "nobody sent one."
- `pg_net` is fire-and-forget: the outcome lands in `net._http_response`, outside the
  transaction. **A failed push is silent.** That is the shape `assertWrote` exists to make
  loud, with no equivalent available.

**`push.web.ts` returns `null` and touches nothing.** `getExpoPushTokenAsync` does a round
trip to `exp.host` that never resolves behind Playwright's static server — the same trap
`capture.web.ts` documents for the file chooser. It deliberately does *not* return a
sentinel the way capture does: a fake token would be stored as a real routable address that
routes nowhere, and every assertion built on it would be measuring the stub.

Do not let a green board be read as push coverage.

## AB. A browser visitor was a new person on every reload
`expo-secure-store`'s web build is, verbatim, `export default {};`. Every method is
`undefined`. So on web `SecureStore.getItemAsync(...)` did not return null — it **threw**,
supabase-js swallowed it, and the session never persisted.

**The cost was not "you have to log in again", because there is no logging in.** Every page
load minted a **fresh anonymous auth user**. The invitation preview never appeared, because
a brand-new identity has joined nothing. And the project accumulated one permanent
`auth.users` row per reload, forever. Issue #12.

**No chunking here, and that is a decision rather than an omission.** The native store
splits at 1800 bytes because SecureStore refuses values over 2048 — a keychain constraint,
not a property of storage. `localStorage` holds megabytes. Copying the chunking would carry
the scar without the wound and add a torn-write failure mode that cannot occur.

**The at-rest guarantee is genuinely weaker and the file says so out loud.** The native path
hands every fragment to the iOS Keychain / Android Keystore; `localStorage` is plain text
readable by any script on the origin. That is the standard position for a browser session
and the token is a short-lived anonymous JWT that RLS scopes to one event — but it is not
equivalent, and a reader should not have to infer that from silence.

**It can never throw.** "Block all cookies" makes the accessor itself throw on *access*,
Safari private mode has thrown on write, and a full quota throws on set. A store that
propagates any of those takes sign-in down entirely, which is strictly worse than not
persisting. Every path is guarded and falls back to an in-memory map for the life of the
tab — the app then behaves exactly as it did before this file existed.

### The bug inside the fix, and the test that was passing for the wrong reason

`getItem` first returned `localStorage.getItem(key)` directly. That is wrong in one real
case: a browser can pass the probe and still refuse the **real** write — a full quota is
the ordinary way — and then `localStorage` answers `null` for a session this tab is
genuinely holding. Preferring that null signs the guest out mid-party. It now falls back to
the in-memory copy on a null, not only on a throw.

**The test that was meant to catch it did not.** Its fake threw on *every* `setItem`, so the
usability probe failed too and the store took its "unusable" branch — passing while never
executing the line under test. **Mutation-testing caught it**: removing the fallback changed
nothing. The fake now models quota properly (a one-byte probe fits, a 4.6KB session does
not), and removing the fallback fails it.

That is the whole argument for mutation-testing an assertion before trusting it, and it is
the second time in two days a test of mine measured nothing while reporting green.

## AC. Three ways a photo escaped the resize, and a web path that never had one
`#11` named one bug. There were three on native, and the worst was not a skipped resize.

**The picker's dimensions were never trustworthy, and its own types say so:**

    Width of the image or video. Can be `0` if the system did not provide the width.
    — expo-image-picker/build/ImagePicker.types.d.ts

They are declared `number`, not `number | undefined`, so **`pnpm typecheck` is green on the
broken code and would be green on any patch that only added `?? 0`.**

| what the picker returns | what happened |
|---|---|
| both `undefined` | `Math.max` is `NaN`; every comparison with `NaN` is false, so `NaN > 1600` skipped the resize |
| both `0` | `longEdge` 0, `0 > 1600` false, same skip — no `NaN` involved, and a shorter path to it |
| **one `0`, one real** | `longEdge` was real so a scale *was* computed, and `resize({ width: Math.round(0 * 0.4) })` asked for **width zero** |

The third is worse than the other two: not a skipped resize but a degenerate one, and the
contextual `manipulate`/`resize` API validates nothing.

**The fix removes the input rather than defending it.** `renderAsync()` returns an
`ImageRef` whose `width`/`height` come from the decoded native bitmap, so the picker's
numbers are never read at all. And `resize` documents that *"if you specify only one value,
the other will be calculated automatically to preserve image ratio"* — so clamping the long
edge directly deletes the multiplication, which **was** the bug. The orientation branch is
load-bearing rather than tidy: the old code always passed `width`, which was right for
portrait only by arithmetic accident.

There was **no test file for `capture.ts` at all.** There is now, and it is mutation-checked
against the original implementation: **seven of its eight tests fail** on the old code.

**The remaining honest gap:** both a resized and an unresized capture produce a valid JPEG,
so nothing static can tell them apart. Only Lane C, reading the output file's size back off
a device, can. The commit claims the resize is now *impossible to skip* — not that the
trigger was ever observed on a particular handset.

### The web path had no compression whatsoever

`capture.web.ts` measured `naturalWidth`/`naturalHeight` purely to report them, then handed
the **original file** to `upload()`. A 12MB original went straight at a bucket with a 10MB
per-object limit and failed as a generic transfer error.

**`shrink()` is exported and takes its decoder and canvas as arguments, deliberately.** No
lane here can reach it through `capturePhoto`: the compression lives in the `change`
listener, reachable only on the non-fidelity branch, and that branch opens an OS file
chooser nothing in `tools/shoot-app.mjs` answers — which is the entire reason the fidelity
branch exists. jsdom implements no `canvas.toBlob`. **A seam was the only way this could be
tested at all**; without one it would have shipped unverified, which is what the scoping
predicted.

Three details that are each a silent bug if missed:

- **`imageOrientation: 'from-image'`.** An `<img>` applies EXIF orientation; a raw canvas
  draw does not. Without it every portrait upload from a phone lands sideways — silently,
  and only on web.
- **`toBlob` can yield `null`**, and returning `null` from `capturePhoto` means *"the guest
  backed out"* — which `actions.ts` swallows in silence. A compression failure would have
  looked exactly like a cancelled camera: no photo, no toast, no error. It falls back to the
  original bytes.
- **A decode reporting 0 must not build a 0×0 canvas.** The same unvalidated-input trap as
  native, one platform over; a blank image is worse than an uncompressed one.

**`MAX_EDGE` and `QUALITY` moved to `captureConstants.ts`, which imports nothing.**
`capture.web.ts` cannot value-import `capture.ts` without dragging three Expo packages into
the browser bundle and breaking its own stated invariant — and `./capture` from inside
`capture.web.ts` is a Metro resolution hazard besides.

The fidelity branch is untouched and still the first statement in the function.
`guest-photos.spec.ts` asserts the literal `data:image/png;base64,iVBOR…` prefix, and
routing the synthetic pixel through the compressor would turn it into a `blob:` URI and
fail — that assertion is the only thing proving the URI came out of the capture path.

## AD. A door painted on the guest screen
`RoleSwitch` — "Host view →" — was drawn for **every guest at every event**. Against the
shipping adapter its only possible outcome for them is a toast saying the host console is
not theirs: `becomeHost` matches `hosts.auth_user_id = auth.uid()`, so a role is not
something a picker can grant. Its own docblock said as much — *"this is not an edge case;
it is what nine people out of ten will experience if they tap it"* — and it stayed.

It is now drawn only for someone who **holds a host seat**, which is a different question
from which view is on screen and needed a new observable to answer. `session.current.kind`
says "which view"; a host who switched to the guest side reads `kind: 'guest'` and still
holds her seat, and must keep the way back. `holdsHostSeat` says "which seat".

**Not `disabled`, and not a denial toast.** The house rule against disabling applies to a
control someone could earn — by upgrading, by hitting a cap differently. This one cannot be
earned by any action available on that screen, so the honest treatment is note O's: do not
draw it. The ways *in* for a real host are untouched — a host key on the join screen, or
creating the event.

**In `MemoryRepository` the flag is hard-coded true**, and that is deliberate rather than
lazy: the fixtures are a host and a guest in one process, which is what lets the screenshot
harness and all 208 journeys reach the host artboards at all. **So Lane B cannot see the
hiding** — it is provable only in jest against the Supabase adapter, and it is,
mutation-checked.

`is_host` is now asked once in `loadFetchOnce` rather than only when someone taps. A host
who claimed a key last night reopens the app as `kind: 'guest'` until something says
otherwise, and a flag that gates whether a control is *drawn* has to be known before first
paint. A failed `is_host` counts as **not** holding a seat: the safe unknown hides a
control rather than offering one that refuses.

### The opposite failure, found on the way and deliberately not fixed here

The console's copy of the same control is its **only exit**, and for a founder it throws.
`becomeGuest` opens with `requireGuest()`, and a founder has no `guests` row —
`create_event` binds her host seat and deliberately does not seat her as a guest. So she
taps "Guest view →" and gets *"The host console is only available to this event's host."*
She **is** the host; the message is about the other direction.

Hiding the console's copy would have stranded her completely. Two opposite failures of one
control want two fixes, so that one is **#37** rather than a second half of this note.

## AE. The guest list, so that "Send to 180 guests" names something
The composer has always read **"Send to 180 guests"**, and until now nothing in the app
could set that number. `invitees` has existed since the first migration with four host-only
policies, a unique index and a count-folding trigger. There was simply no screen.

**The near-miss is the point of this note.** The cheap fix looked like deleting the copy —
and it would have deleted a **tested distinction**, not a fiction. `invitedCount` and
`guestCount` are two deliberately different facts, recorded in four places:

- `types.ts` — *"the canvas hardcodes 180 into 'Send to 180 guests' while its guestCount
  pill says 172, so these are two genuinely different numbers."*
- the schema — `invited_count` is *"what a host ADDRESSES, which is a different number
  from who is present."*
- the fold — counting rows is deliberate: *"someone imported but not yet emailed is still
  someone you are expecting."*
- a Playwright test named **"the composer addresses all 180 invited, not the 173 standing
  in the room"**, with a belt-and-braces assertion that survives a rewording.

The number was right. The gap was that no screen could set it. **When a promise and the
code disagree, build the code.**

### Nothing sends, and that is a fence rather than an omission

There is no send control anywhere, and **`invited_at` is written by no code path** — not
by the client (the new column grant makes it unwritable), not by the server. The schema
already separates *on the list* from *was emailed*, and the app now respects that boundary.

Whether Runit emails people who have not heard of it is a product and legal decision —
CAN-SPAM sender identity, a GDPR lawful basis for a third-party address the subject never
gave *us*, PECR soft-opt-in that Runit cannot claim, an unsubscribe list that no table
could hold. `init.sql` frames the stakes at the top of the table: *"a HOST uploading OTHER
PEOPLE'S email addresses, before those people have consented to anything or heard of
Runit."* Adding a name to a list one host can read is not that decision, and the six open
questions are in the issue rather than answered here.

### The column grant this table never had

`invitees` was the one write-target with an UPDATE policy and no column grant, so a host
could rewrite `email` — re-pointing an invitation at a different person — or
`joined_guest_id`, claiming an arrival that never happened. Now `(email, display_name)`
only. Same shape `events`, `broadcasts`, `reports` and `hosts` already use.

### Half a trigger had never fired

`invitees_fold` is `after insert **or delete**`, and only the insert arm had ever executed.
Lane E now exercises the delete: a host removes someone and the count folds back **down**.
Three more assertions land with it — the grant refusing `invited_at` and `joined_guest_id`,
and cross-event isolation, which nothing had ever tested. **101 assertions, 0 failures.**

### The seed had a fuse in it

`seed-events.sql` wrote `invited_count` **by hand**. The trigger recomputes the column from
the table, so a hand-written 10 would survive exactly until the first real invitee — at
which point *"Send to 10 guests"* becomes *"Send to 1 guest"*. Correct arithmetic, and it
would read as a regression to whoever met it first. The column is no longer written there
at all; ten real rows are, and the trigger fills it in.

### Memory shifts by a delta; Postgres recomputes

A deliberate divergence. The fixtures carry a seeded `invitedCount` of 180 with no rows
behind it, because writing 180 fixture invitees to make one number true would be absurd.
Recomputing in the adapter would collapse 180 to 1 the moment a host added anybody. The
property every journey actually needs is that the number **moves**, and a delta gives that
on top of a seeded baseline. Against Supabase there is no baseline: the count *is* the row
count and the trigger is the authority.

Mutation-checked — removing the shift fails four of the six journeys, and the two it
leaves green are the two that do not claim the number moves.

## AF. The album stops being write-only
A photo uploaded, the row came back with `storage_path`, and **nothing in the app had ever
read it** — `createSignedUrl`, `getPublicUrl` and `.download(` appeared zero times in
`src/`. A guest saw her own photo only off her own disk via the upload overlay; the moment
that settled or the app restarted it became a coloured hue tile, and a second device never
saw anything else. `PhotosScreen` describes the hue tile as *"the permanent rendering for
the nine seeded rows"* — true for seeds, and silently true for every real photo since.

**The read policy already existed and had never been exercised.** `event_photos_select` has
mirrored `photos_read` since the first migration. Lane E had **zero** assertions against
`storage.objects`, so the rule keeping a pending photo private to its uploader was
unverified by anything. It is now: a guest reads an approved object and their own pending
one, another guest reads neither, a host reads all four.

### Thumbnails, and the policy that would have hidden every one of them

There is **no full-size viewer** — tapping a tile opens the report sheet, the grid is ~120pt
and the host queue 64pt — so a 400px copy is the *only* size anything renders. It is a
second uploaded object rather than an on-the-fly transform because Supabase's image
transformation is a paid add-on; generating it on the phone costs a little storage and a
tile downloads ~15KB instead of ~300KB.

**`event_photos_select` had to be widened to admit it.** The policy matches
`storage.objects.name = p.storage_path`, so a thumbnail's name matched *no* row and was
unreadable to everyone, its own uploader and the host included. Silent, total, and
indistinguishable from "signing is broken". Mutation-proven: under the original policy the
full-size object reads 1 and the thumbnail reads **0**.

**A failed thumbnail is not a failed photo.** A guest who just took a picture must not lose
it because a derived copy could not be written — the row lands with `thumb_path` null and
the full-size stands in, which is also how every photo predating this renders. No backfill.

### The field, and the comparator that would have swallowed it

`displayUrl` is its own field. Folding it into `localUri` — device bytes, resolved by
completely different machinery — is the collision `storagePath`'s docblock has warned about
since before an adapter existed, and two tests assert that null.

**It had to go in `photoCache`'s comparator**, and that is the longest-to-notice failure
available here: omit it and `RowCache` hands back the old object with `displayUrl` null, the
signal never publishes, and the feature resolves every URL, pays the egress and **renders
nothing**. `mappers.test.ts` walks the type and forces every new field into the comparator,
so the guard caught it before the reasoning did.

### Signing

`createSignedUrls` **plural** — the album is a grid and per-tile signing is one round trip
per photo. Cached for **one hour** and re-signed only near expiry: guests never lose access
because a stale URL is silently re-signed, so the number is really about how long a link
that *escapes* the app keeps working for whoever holds it.

**Never signed inside `recompute()`.** That fires on every realtime frame across eight
tables, so signing there would re-sign the album every time anyone voted on a song.
Resolution is a separate pass that returns early when nothing is new, which is what stops
recompute → resolve → recompute from spinning.

### Three things the adversarial pass caught in this code

- **`void promise` does not catch.** The resolver is called from `recompute`, and `void`
  turned every throw into an unhandled rejection — which fired immediately, because
  `FakeClient` had no `createSignedUrls` and every existing adapter test reaches
  `recompute()`. Predicted from the design and reproduced verbatim.
- **A test that could not fail.** The fake returned signed URLs in request order, so keying
  by array index and keying by the server's own `path` behaved identically — the assertion
  named the right property and could not see it. The fake now returns them **reversed**,
  because the API guarantees no correspondence and every entry carries its own `path`. With
  that, index-keying fails two tests.
- **`storage.protect_delete()` blocks every direct SQL delete**, before RLS is consulted.
  That is asserted rather than worked around, because it settles how the retention sweep
  must eventually be built: through the Storage API with a service role, never with SQL.

### What no lane here proves

That a photo appears on a screen. Lane B boots `MemoryRepository`, where `displayUrl` is
null on every row, so it cannot see a signed URL at all — it proves the hue tile still
renders and nothing regressed. Only Lane C can witness the image, by hand, and iOS remains
unprovable in this environment.

## AG. You could not look at a photo
Tapping a photo did **nothing**. The tile was a plain `View`; only the small `⋯` badge
inside it was pressable, and that opens the report sheet. So a shared photo album had no
way to see a photo larger than a ~120pt square, and the host's approval queue asked for a
moderation decision from a 64pt one.

It was invisible while the album rendered coloured placeholders, and became the first thing
anyone would reach for the moment note AF made it render actual images.

**The tile is the control now**, and its `testID` stays on the same node — it is a
`Pressable` rather than a `Pressable` wrapped around a `View`. `guest-photos.spec.ts` counts
the album with `getByTestId(/^tile-/)`, and a second element per tile matching that prefix
silently doubled the count from 9 to 18 once already. The `⋯` badge keeps its deliberate
`report-tile-` name for the same reason, and reporting is reachable from inside the viewer
too — Guideline 1.2 wants it available, and someone who has just enlarged a photo is the
likeliest person to want it.

**The two modals must not stack.** Opening the report sheet closes the viewer first;
leaving both up puts the sheet behind a full-screen photo on iOS, which reads as a frozen
app.

### The full size is signed only here

The grid renders 400px thumbnails because that is all a tile needs. `photos.fullUrl()`
resolves the 1600px original **on demand**, so the ~20× bytes are paid by the person who
chose to look rather than by every tile on every album load. That split is the whole economy
of note AF, and a test fails if this path ever signs `thumbPath` instead.

Three layers render, each a real state rather than a spinner: the hue the guest already
associates with this photo from the grid, then the thumbnail they were just looking at,
then the full size. A photo that cannot be signed stays at whichever layer it reached —
which is exactly what a pending photo somebody else uploaded is supposed to look like.

### Two rejections that were both correct

**The React Compiler refused `setState` inside the effect.** The obvious shape is
`setFull(null)` at the top so the previous photo's image cannot flash under the next one's
thumbnail. Holding the id alongside the URL gets the same property with no reset at all: a
stale URL simply does not match.

**Lane A2 refused the tile**, because its size is `tileSize`, computed from the window
width, and A2 is a declaration check that refuses to pretend otherwise. The style now
declares the floor a tile never goes below.

### The audit learned a rule instead of collecting a third exemption

A2's exemption list held two entries of one shape — a `flex: 1` backdrop inside a `<Modal>`
— and the second one left an instruction: *"a third means the tool should learn the pattern
rather than this list growing one sheet at a time."* The viewer's backdrop was the third.

So the pattern is a rule now and **both exemptions are deleted**. It matches on the style
and the enclosing `<Modal>`, never on the name, because that same entry said why: *"matching
on the NAME 'backdrop' would not do — a name is not a measurement."* Mutation-checked in
both directions: a small control still fails, and a `flex: 1` Pressable with no `<Modal>` in
the file still fails.

## AH. A way to keep a photo, before there is a deadline to keep it by
A photo taken in RunIt lived in exactly one place: RunIt's bucket. Capture writes to the
app's **cache** directory — which iOS may reclaim — with no `expo-media-library`, no share
sheet, and no export (`zipExport` is `false` on every tier with zero call sites). So nobody
had a copy, **including the person who took it**.

**This ships before the retention warning, and the order is the point.** Retention is
decided — 30 days free, 90 on $19, a year on $79, unlimited on $599 — and it comes with a
warning. A deadline nobody can act on is not a warning, it is bad news: telling someone
their photos go on the 14th while giving them no way to keep one is the same failure as
selling push notifications with no push.

**Add-only permission.** `requestPermissionsAsync(true)` asks for the write scope, and the
config plugin declares only `savePhotosPermission`. RunIt writes and never reads a camera
roll; asking for more than it needs is the fastest way to be refused by somebody who was
willing to say yes. A test fails if the `true` is ever dropped.

**A refusal is not a failure.** They chose it, and each outcome says something different
and true — *saved*, *needs permission*, *could not save*. Collapsing the first two would be
the app lying about the guest's own decision, which is the same rule `capture.ts` states
for backing out of the camera.

**It saves the full size.** `photos.fullUrl()` (note AG) already resolves the 1600px
original on demand and this is its second consumer. A remote photo is downloaded first —
`saveToLibraryAsync` takes a local path, and a signed URL expires, so it is fetched now
rather than handed to the OS to fetch whenever it likes. **Our copy is deleted afterwards,
in a `finally`**: the camera roll holds its own, and leaving it would grow the cache by a
full-size photo every time anybody saved one. A test asserts the delete happens even when
the save throws.

**The web sibling downloads instead**, because a browser has no camera roll — and returns
early under `EXPO_PUBLIC_FIDELITY=1` touching nothing at all. A real download in the
harness either opens an OS dialog nothing answers or writes files into the Playwright
container for the length of the run: the same class of trap `capture.web.ts` documents for
the file chooser.

### What no lane here can prove, and it is most of the point

**That a file lands in anybody's camera roll.** Lane B's stub writes nothing, so the
journey proves the control is present and does not throw — and its docblock says exactly
that rather than implying more. Only Lane C can witness a real save, by hand, and iOS not
at all.

### Left open deliberately

Whether saving should be **gated to paid tiers**. `zipExport` is a ready-made unenforced
flag to hang it on, and gating the only way to keep your own photograph — on a product that
deletes it after thirty days — is a pricing decision with a sharp edge. It ships available
to everyone, because that is the honest default while retention exists, and narrowing it
later is a deliberate choice somebody makes rather than one that arrives by accident.

## AI. The album says how long it lasts, and the number is real
`albumRetentionDays` was **transcribed marketing copy with no reader anywhere** — 90 on the
$19 tier, 365 on the $79, and `null` on the free tier, which meant *forever*. Not as a
decision: nothing swept, so photos stayed because nobody had written the code to remove
them. `tiers.ts` says as much about its own feature lines: *"transcribed verbatim from the
canvas, and that is exactly how the file came to advertise eight things nothing enforces."*

**The free tier is 30 days now**, and the numbers live in `tier_limits` where the drift
guard can see them. They could not before: because these two fields had no SQL counterpart,
`tiers.test.ts` **structurally could not cover them** — they were the only `TierLimits`
members outside it.

**`fromSql` was the wrong helper**, and the new test caught it on its first run. It maps SQL
`null` to `Infinity`, which is the convention the numeric *caps* use (`maxGuests: INF`);
`albumRetentionDays` is `number | null` and uses `null` for unlimited, so the venue tier
would never have compared equal. Two conventions, both correct in their place, and a shared
helper that quietly bridged them wrongly.

### It ships after the save control, not before

A deadline nobody can act on is not a warning, it is bad news. The line names the thing to
do — *"Tap one and choose Save"* — and the thing exists (note AH), which is the entire
reason that landed first.

**It sits at the FOOT of the album**, deliberately, and a journey asserts the position. A
deadline should not be the first thing someone meets when they open a shared photo album at
a party; it should be there when they scroll to the end and start choosing favourites.

**The copy says photos are KEPT for N days. It does not promise a deletion**, because no
code performs one. Saying "removed after 30 days" would be the exact failure this session
has spent its time unpicking — a sentence the software cannot honour.

**No line at all on the unlimited tier.** `null` is not "kept forever"; that is a promise
about somebody else's storage bill that nobody should make in UI copy.

### What is deliberately still missing

**The sweep.** It is irreversible, and it cannot be built in SQL at all —
`storage.protect_delete()` refuses every direct delete on `storage.objects`, for the owner
as much as for a guest, which Lane E now asserts. It has to go through the Storage API with
a service role, and it deletes strangers' wedding photographs, so it gets its own work and
its own care.

**`eventTtlHours` is untouched** and still has no reader. It is a different decision from
retention — TTL is enforcement (an event past its TTL refuses writes; no bytes at stake),
retention is destruction — and #23 was right that they are two issues wearing one number.

## AJ. The founder could not leave her own console
`HostConsoleChrome` renders exactly one non-segment control, `RoleSwitch`, and for the
person most likely to be standing there it raised. `becomeGuest` opened with
`const guestId = this.requireGuest()`, which throws on a null guest id — **and a founder's
is always null.** `create_event` binds her host seat and deliberately mints no `guests`
row, for a reason that is still right: a brand-new party reading *"1 already here"* before
anyone arrives is worse than the gap.

So she tapped "Guest view →", the throw hit `RoleSwitch`'s catch-all, and the app told her:

> The host console is only available to this event's host.

She **is** the host. Wrong sentence, wrong failure, and the five segments all stay inside
`/host/*` — there was nothing else to tap. `LeaveSheet` is mounted on `ChatScreen`, which
is on the other side of the door that would not open.

### Hiding the control was the cheap fix, and it is the wrong one

The tidy version is to draw `RoleSwitch` only where a guest seat exists. It closes the
issue, ships in one line, and leaves a host permanently unable to see what her guests see —
having deleted the promise rather than kept it. `RoleSwitch` being drawn in the console
**is** that promise.

**So she takes a seat.** `becomeGuest` calls `join_event` when `myGuestId` is null: the
same call a guest makes, idempotent on `(event_id, auth_user_id)`, so this is not a second
route into `guests` that could drift from the first. Her nickname is her host name, because
a blank one would be the only identity in the room with nothing on it.

### What makes the seat free is in SQL, where a client cannot bypass it

`public.guest_seats(event)` counts guests **excluding anyone holding a host seat at that
event**, and both places that ask the question now ask it there:

- `fold_guest_count`, so "N already here" counts guests rather than staff;
- `join_event`'s cap check, so a free party still fits ten friends instead of nine because
  the host looked at it — and nothing anywhere would have explained the missing one.

The founder also skips the cap gate entirely (`not exists (select 1 from hosts …)`), which
is why she is not refused at a full event.

**`hosts` folds too, and that trigger is not belt-and-braces.** `claim_host` binds
`auth_user_id` on a seat that already exists, so a guest promoted to co-host changes the
answer without inserting or deleting a single `guests` row. Without
`hosts_fold_guests`, the stored count is simply wrong from that moment until the next
arrival. It is `after insert or delete or update of auth_user_id` — a display-name edit
must not re-count every guest.

### Which lane saw what, which is the part worth keeping

**Lane B could not see this and still cannot.** MemoryRepository never had the bug: its
fixture seeds a host *and* a guest, so `becomeGuest` always had something to switch to.
All 228 journeys were green over a console a real founder could not leave — #20 in one
sentence.

The fixture models it now (`create` leaves `myGuestId` null, exactly as `create_event`
does), and that is worth doing for its own sake — it is the same move as `?empty=1` making
`Seed.event` nullable. But it does **not** make the e2e able to catch this: with the fix
removed, all three new journeys still pass, because Memory's `becomeGuest` never called
`requireGuest`. They are regression guards for the screens, and `create-event.spec.ts`
says so in its docblock rather than implying more.

**The fix is tested at the seam instead**, where it lives: four adapter tests over
`FakeClient` assert that a founder's switch calls `join_event` with the event's own code
and her host name, that someone who already holds a seat does not call it again, and that
two trips to the floor mint one seat. All four fail under mutation — the first three under
"never join", two under "always join", one under a blank nickname.

**And the half in SQL is Lane E's**, which is the only lane that can watch a policy and a
trigger behave: seven assertions, run in context against the live database, that the room
is full at ten, that the host is admitted anyway, that her seat does not appear in
`guest_count` (10 over 11 rows), that a stranger is **still** refused with 54023 afterwards,
that `guest_seats` is revoked from `authenticated`, and that binding and unbinding a host
seat moves the count both ways. Mutating `guest_seats` to a naive count fails three of
them. The stranger's 54023 is the control for the host's admission: the same call, the same
full event, the opposite outcome.

### The copy, which was the smaller half of the same bug

One catch, two directions, one sentence. Going to the guest side cannot fail for a seat
reason any more, so that direction now names what can still fail — the request — and the
host-direction message is left alone, because for a guest it was always true.

## AK. "seen by 0", forever
`broadcast_reads` shipped in the first migration with a policy, a fold trigger, and **no
writer**. So `seen_count` summed an empty table and every announcement in the host console
read *seen by 0* — under the host's own eyes, however many people had opened it. The
migration's debt note had said so from the beginning and named both exits: write
`chat.markRead()`, or stop rendering the number.

Deleting the number is the cheap exit, and it deletes the one thing a host actually wants
to know after posting. So the number is real now.

### The caller was the hard part, which is why this was not a five-minute fix

**Marking on load counts fetches.** Open the Chat tab and six announcements you never
scrolled to are "read" — a number that is wrong in the direction that flatters, which is
worse than one that is always zero. So `ChatScreen` measures the viewport: each bubble
reports its box through `onLayout` (coordinates relative to the content container, which is
the frame `contentOffset` is measured in), the ScrollView reports its own height and
offset, and a sweep marks whatever overlaps.

All three live in refs and are touched only in handlers. The React Compiler rules reject
reading a ref during render, and none of it belongs in state anyway: it drives one network
call and never a repaint, so `setState` here would re-render the feed on every scroll frame
to change nothing on screen.

**A list, not one id.** A screenful arrives at once; a request per bubble is what makes a
feature like this expensive on a venue's wifi. Three layers of deduplication, and each one
earns its place: the screen's `sent` set stops the resend, the adapter's `readMarks` stops
a second caller, and the composite primary key makes anything that gets through a 23505 —
which is the desired state arriving twice, exactly as it is for votes and blocks.

**Fire-and-forget by contract.** A read that fails to record is a wrong number, not a
broken screen, and a scroll handler has nowhere to put an error. The adapter un-marks on
failure so the next sweep retries; without that, an announcement whose first write lost the
network is "seen by 0" for the rest of the night and nothing anywhere tries again.

### Staff are not readers, which is note AJ one level down

A host can reach the guest feed — she takes a seat on demand — and an announcement reading
*seen by 1* the moment its own author looks at it is the same lie as a brand-new party
reading *1 already here*. `fold_seen_count` excludes a read whose guest seat is held by a
host of that event. The row is still stored; it is simply not counted, so the number under
an announcement means guests, exactly as the headcount does.

### The test that had to be fixed, not accepted

*"Counts a reader once, not once per glance"* passed with the deduplication removed from
**both** the screen and the adapter. The three seeded announcements fit at 402×874, so
`scrollTop = scrollHeight` moved nothing, fired no scroll event, and ran no second sweep —
the test scrolled a feed that could not scroll. It posts six more announcements first now,
and fails as it should.

That is the second time in two days that a mutation ran green for a reason that had nothing
to do with the code under test (note X: a source mutation that tripped the colour gate
first). **A mutation test proves nothing until you have checked that the mutation reached
the assertion.**

### And the fixture caught a bug in yesterday's fix

`becomeGuest` calls `loadFetchOnce`, which re-derives `holdsHostSeat` from `is_host` — and
on the guest screen `RoleSwitch` is drawn only for someone holding a seat (#29). A
transient failure of that RPC in the middle of a role switch would have left her on the
guest side with **no way back**: note AJ's bug, pointing the other way. It surfaced because
`FakeClient`'s default RPC reply is not `true`, so a test written for #24 failed for a
reason in #37. The flag is pinned across the switch now — nobody loses a seat by walking
through a door they could only reach by holding one.

### Coverage

| Claim | Lane |
|---|---|
| The number moves, once, for what was on screen | **B**, 8 journeys, all four mutations caught |
| Below the fold is not read until you scroll to it | **B** — the assertion this file exists for |
| One insert per screenful; a duplicate is absorbed; a failure retries | **jest** + FakeClient, five mutations caught |
| `reads_own` admits your own read and refuses a forged one | **E**, live |
| The fold does not count staff | **E**, live — a naive count fails it |
| Two devices, two readers | **nothing here.** Memory has exactly one reader, and Lane E writes rows rather than driving the app |

## AL. The QR that could be shown and never read
`README.md` has promised *"guests scan a QR or type a code"* since the first commit. Only
half of it existed: `EventQr` renders on the host console, Lane F decodes what it actually
encodes — and **nothing anywhere read a QR in.** The canvas's *"Scanned the QR? Your code
is filled in"* sat over a field the prototype pre-filled by hand.

Note O records the attempt to close that by editing the README, and reverting it: the code
was what was behind, and quietening the claim made the gap harder to find rather than
smaller. The sentence is unchanged now, because it was always right — what was missing was
the button beside it.

### The interesting failures of a scanner are string failures

`codeFromScan` is pure and lives in `src/lib/invite.ts`, beside `joinLink`, which is what
produced the string being read. It accepts our own `/i/CODE` link, the `runit://` scheme
still registered, and a bare code off a printed card — and it **refuses an `/i/` link on
any other host**, which is the half worth having. A sticker on a lamppost could otherwise
put an arbitrary code into the field of an app that is about to send a nickname somewhere,
and `INVITE_ORIGIN` pointed at a stranger's website for one commit, so "the host does not
matter" is not a hypothesis this codebase gets to hold.

The round-trip test scans `joinLink()`'s own output rather than a hand-written string, so
it cannot drift from the generator. That one test could not see uppercasing — `joinLink`
already uppercases on the way out — which a mutation run showed, so a second assertion
scans a lower-case link.

### Typing never stops being an option

The issue asked for a manual fallback never more than one tap away. The honest reading is
stronger: typing stays the **primary** path, the field is never hidden or replaced, and
every exit from the sheet lands back on it — a code, a refusal, a denied permission, or the
"Type the code instead" control that is drawn whatever else is true, including while the
camera is running. A scanner someone cannot get out of is worse than no scanner.

A QR that is not ours says so (*"That QR is not a RunIt invitation"*) rather than doing
nothing, which is the difference between "wrong code" and "this app is broken". And
`onBarcodeScanned` fires on every frame that resolves a code, so one scan per opening is a
guard, not a nicety.

### Two plugins now write the same Info.plist key

`expo-image-picker` has declared `NSCameraUsageDescription` since photo capture; `expo-camera`
declares it too. Config plugins apply in order and the later one silently wins, so two
plausible strings would mean a guest at the door is asked to allow the camera *"to add
photos to the album"*. One sentence covers both uses, and `appConfig.test.ts` fails if they
ever disagree — the only place that can catch it, since the plist is prebuild output and
`/ios` is gitignored.

### What is verified, and the part that is not

| Claim | Lane |
|---|---|
| Every string a scanner can be handed parses, or is refused | **jest**, 8 cases, three mutations caught |
| A scan reaches the field, resolves the invitation, and joins | **B**, 6 journeys, three mutations caught |
| The permission strings agree and name both uses | **jest**, mutation caught |
| **A camera reads a real QR** | **nothing here.** No lane in this environment can point a lens at anything |

`QrScanner.web.tsx` is the same shape as `capture.web.ts`: headless Chromium refuses
`getUserMedia`, so the web sibling keeps `CameraView` out of the browser bundle entirely and,
under `EXPO_PUBLIC_FIDELITY=1` only, offers one control that feeds `codeFromScan` the exact
string `joinLink()` produces. That proves the wiring and nothing about a lens. Outside the
harness it says plainly that scanning needs the phone.

**Lane C could witness the real thing** — the emulator has a virtual scene the camera can be
pointed at, and it is how photo capture was witnessed end to end. That has not been done for
this, and until it is, native scanning is unverified. **Issue #42**, filed rather than left
in this paragraph — and it wants the dev client rebuilt first, because `expo-camera` is a
new native dependency.

## AM. Your own name, which no screen ever showed you
A guest types a nickname once, on the join screen, and that is the last they see of it.
`grep -rn nickname src/features` found it in `JoinScreen` — the field — and otherwise only
as somebody *else's* name, on a row you might report.

So a guest learned theirs was wrong the way the room did: **denormalised onto a song
request, in front of everyone.** And there was nothing anywhere to change it.

### The capability was in SQL the whole time

`join_event` is idempotent on `(event_id, auth_user_id)` and updates the nickname on
conflict. Nothing ever called it for that. What *looked* like the route —
`guests_update_self`, `using (auth_user_id = auth.uid())` — **could never fire**, which is
issue #36: `guests` has no SELECT policy, Postgres applies SELECT policies to the rows an
`UPDATE … WHERE` must read, and PostgREST always sends a WHERE. Measured live: no-WHERE
touched 1 row, with a WHERE touched 0.

**That policy is deleted, not kept as documentation.** A policy saying "a guest may update
their own row" invites exactly that implementation, and the failure is the silent one
`assertWrote()` exists to catch — zero rows, nothing raised. It had already caught one
author: the first design for the push token was a direct `update guests set push_token`,
which would have failed on every device forever. The column grant beside it stays, because
it is what stops a future select-own policy from silently making `event_id` writable in the
same commit.

`set_nickname` replaces it — SECURITY DEFINER, scoped to `auth.uid()`, the same shape
`set_push_token` already uses.

### A rename has to move the copies, and stop before the record

`song_requests.requested_by_name` and `photos.uploaded_by_name` are `not null` on purpose,
so a deleted guest does not blank the history — the same reasoning as
`broadcasts.author_name`. A rename touching only `guests.nickname` leaves the old name on
everything the guest has already sent, which is the state they opened it to fix. So the
function rewrites both, in the same transaction.

It deliberately does **not** touch `blocks.blocked_name` or a report's subject label. Those
are a host's record of who they actioned, and a record that changes under the person who
wrote it is not a record. A rename is not a way to become someone else in a moderation
queue.

**It returns what it stored.** The trim and the 40-character cap happen server-side, so a
screen echoing its own input would show a name the room is not seeing.

### The pill, which is not in the canvas

The canvas has no identity surface at all — in a prototype the nickname is whatever the
designer typed. The pill follows the conditional-pill pattern already beside it (`{n}
blocked` appears only when non-empty), drawn only for a guest session with a name, capped
at 110pt so a 40-character name cannot take the header from the event.

### Two lint rules and an audit shaped the sheet, and all three were right

- **`react-hooks/set-state-in-effect`** rejected `useEffect(() => { if (!visible)
  setDraft(nickname) })`. The caller renders the sheet only while it is open instead, so
  every opening is a fresh mount — the same property, no effect, and a cancelled draft
  cannot come back.
- **Lane A3** required `submitBehavior` to be stated. `blurAndSubmit`: this is the only
  field of the form and submitting closes the sheet, so a raised keyboard would sit over
  the screen underneath.
- **Lane A3 again** required a keyboard strategy. A `KeyboardAvoidingView` per note Q's
  table — content pinned to the visible bottom, and inside a `Modal` the KAV is the
  outermost element, so `keyboardVerticalOffset` stays 0.

### One guard no journey reaches, said rather than implied

The pill is drawn only when the session is a guest with a non-empty name. **No e2e journey
can produce an empty one** — every path into `EventHeader` carries a nickname, including a
host who has taken a seat (#37), whose name is her host display name. Deleting that
condition passes all eight journeys; the mutation was run. It stays because `Session`
permits the empty string, and a bare rounded box in the header is not a thing to discover
on a phone.

### Coverage

| Claim | Lane |
|---|---|
| The name is visible, changeable, and reaches what you already sent | **B**, 8 journeys, three of four mutations caught |
| A cancelled draft does not come back; an empty name draws no Save | **B** |
| The client takes the STORED name, refuses without a seat, and re-reads | **jest** + FakeClient, three mutations caught |
| The rename is scoped to one guest, trimmed, capped | **jest** on the fixture, two mutations caught |
| `set_nickname` is granted, refuses a non-member, caps server-side, and moves the denormalised copy in one transaction | **E**, live, 9 assertions |
| `guests_update_self` is gone and a direct UPDATE still touches zero rows | **E**, live |

## AN. The insets that never arrived, and the comparison built on them
`SafeAreaProvider initialMetrics={FIDELITY_METRICS}` did not reach a single screen, and
nothing said so. Measured from the pixels before it was measured from the source: the
402×874 preset injects a 62pt top inset and the 414×896 preset injects 44, and **both
produced a first non-background row at 5pt** with the outermost container computing
`padding-top: 0px`.

The cause is in the package. `NativeSafeAreaProvider.web.js` appends a fixed element padded
with `env(safe-area-inset-*)`, reads it back on mount and calls `onInsetsChange` — and in a
browser those values are zero. So `initialMetrics` was the initial state of a `useState`
that got overwritten a tick later, every single time.

### What it cost is the reason this is a note

CLAUDE.md said the injection is *"what makes the web export measurable against the
canvas"*. **That was false.** `design/renders/` is drawn from the canvas, whose artboards
pad 66/70/28 precisely because of the device frame; `design/screenshots/` was shot with
those insets absent. So Lane D — the eye, the one lane that reads a screen as a person sees
it — has been comparing two images with a systematic ~70pt vertical offset and reading the
result as close enough. Every Lane D judgement before this rests on that.

Numbers, after: the join screen's first content ink sits at 72pt in the screenshot against
~78pt in the render, where before it was ~5pt. And the two presets now genuinely differ —
70pt of padding at 402×874, 52pt at 414×896 — which is the pair of measurements that
exposed the bug in the first place.

### The fix is the contexts, not a wrapper

The metrics are pushed straight into `SafeAreaInsetsContext` and `SafeAreaFrameContext`,
**inside** the provider, where nothing overwrites them. `initialMetrics` stays: it is
correct on native and it is what the first paint uses.

Anything that inset the pixels instead — a CSS variable, a fidelity-only padded wrapper —
would have made the screenshots look right while `useSafeAreaInsets()` kept returning
zeros. Every screen that *adds* an inset to its own padding (`Screen.tsx` does exactly
that) would then be computing from the wrong number, and the harness would be lying in a
new direction.

### And a gate, because the silence is the actual bug

A hidden `inset-probe` renders `useSafeAreaInsets()` — the same hook every screen reads,
not the constant, which would have agreed with itself throughout — and `pnpm shots` fails
before writing anything if it does not match the frame the export was built with.
Mutation-checked: removing the context providers gives

```
FAIL: useSafeAreaInsets() reports 0x0, expected 62x34.
```

which is the original defect, stated in one line, at the moment it happens.

`pnpm shots:appstore` exists now too. The store preset needs `EXPO_PUBLIC_FIDELITY_FRAME`
on the **export** and `SHOT_PRESET` on the **shoot**, and two env vars that must agree are
a script's job, not a paragraph's.
