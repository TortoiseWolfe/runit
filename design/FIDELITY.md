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
