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
