# Lane C: witnessing the QR scanner on a device

`pnpm scan:device` is the only check in this repo that points a lens at anything.

Everything about the scanner is tested except the camera: `src/lib/invite.test.ts` proves
the parsing, `tests/e2e/qr-scan.spec.ts` proves the wiring through `QrScanner.web.tsx`.
But headless Chromium refuses `getUserMedia` and react-native-web has no `CameraView`, so
until this lane existed **nothing here had ever run one**. Issue #42, FIDELITY note AR.

## Running it

```bash
# 1. an emulator, with the virtual scene as its back camera
export ADB_LIBUSB=0                      # or adb HANGS on WSL2, silently, forever
emulator -avd <name> -camera-back virtualscene -gpu swiftshader_indirect \
         -no-audio -no-boot-anim -no-window &

# 2. a bundler. NOT start:go -- this is a dev client, not Expo Go
pnpm start &

# 3. the poster, if src/lib/invite.ts's INVITE_ORIGIN has changed since it was committed
pnpm export:web && pnpm qr:poster

# 4. the lane
pnpm scan:device
```

No `-virtualscene-poster` flag: the lane hangs its own poster through `adb emu
virtualscene-image`, so a run does not depend on how somebody started the emulator.

## The dev client has to be rebuilt first

`expo-camera` is a **native** dependency. A dev client built before it was added carries no
camera module, and the failure is a red screen about a missing native module that reads like
a code bug. The lane asks the package manager what the *installed* build declares and stops
with the fix if `android.permission.CAMERA` is absent:

```bash
npx expo prebuild -p android --clean && pnpm android
```

`--clean` matters. The permission and its usage strings come from config plugins at prebuild
time, and `/android` is gitignored output — a prebuild that updates in place can leave
yesterday's manifest.

## What it witnesses

| Claim | How |
|---|---|
| The ungranted sheet draws its copy and an Allow button | hierarchy: `qr-allow` present, text read back |
| The system permission dialog appears and grants | hierarchy: `permission_allow_foreground_only_button` |
| `CameraView` mounts with `barcodeTypes: ['qr']` accepted | hierarchy: `qr-allow` gone, `qr-scanner` remains |
| **The preview actually paints** | **pixels**: luminance spread in the sheet's middle |
| The way back to typing survives a live camera | hierarchy: `qr-cancel` present while the camera runs |
| **`onBarcodeScanned` fires on our own `EventQr` output** | **`join-code` reads `SR1017`**, which nothing else can put there |

## What it cannot witness, and must not be read as covering

- **iOS.** Lane C is Android. There is no Mac in this environment.
- **`NSCameraUsageDescription`.** Android composes its dialog from the permission group; the
  usage string is an iOS plist key. The screenshot shows *Android's* sentence, not ours.
  `src/lib/appConfig.test.ts` guards that the two plugins writing it agree; only an iPhone
  confirms what it says.

## Traps, all of them paid for

- **`ADB_LIBUSB=0` or adb hangs.** No output, never returns. The lane sets it itself.
- **`am force-stop` returns before the process dies**, so the launch intent that follows is
  swallowed and the run lands on the launcher. The lane waits for the pid, then retries.
- **`adb reverse tcp:8081 tcp:8081`** — `127.0.0.1` inside the emulator is the *emulator's*
  loopback. `expo run:android` installs this mapping as a side effect, so the lane worked
  only for as long as a build happened to have run since boot. The lane sets it itself.
- **`virtualscene-image` answers `OK` whether or not it did anything.** Textures upload when
  a camera client attaches, so the swap must happen **before** the scanner opens.
- **The scene's default pose faces the television**, not the posters. The lane plays the
  emulator's own `Reset_position` then `Walk_to_image_room`. Reset first: the walk is a
  recorded pose sequence, not a destination, so replaying it from wherever the last run
  finished compounds instead of repeating.
- **`CameraView` mounts long before it paints.** A black SurfaceView passes every check short
  of reading pixels.
- **`adb exec-out screencap` returns stale frames after navigation.** Every assertion here is
  against `uiautomator dump`; the PNGs are illustration, never proof.
- **The AVD may ship `hw.keyboard = no`** and Gboard may come up floating. Neither affects
  this lane, but both silently break any lane that types.

## The poster

`pnpm qr:poster` drives the same web export Lane F decodes, screenshots the same
`[data-testid="event-qr"]`, mounts it on a 1024×1024 white field, and **decodes it before
writing**. When a scan fails there are two candidate causes — the app cannot read QRs, or the
wall is unreadable — and proving the poster decodes at generation time leaves one.

`design/device/qr-poster.png` is committed, so `pnpm scan:device` re-decodes it against the
current `INVITE_ORIGIN` before hanging it. A stale poster would be seen perfectly, rejected
correctly by `codeFromScan` as a foreign host, and reported as a 90-second timeout that reads
exactly like a broken camera.
