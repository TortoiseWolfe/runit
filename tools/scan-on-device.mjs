#!/usr/bin/env node
/**
 * LANE C's QR-SCAN WITNESS -- issue #42.
 *
 *   pnpm scan:device
 *
 * `#28` shipped the scanner and every part of it is tested EXCEPT the camera.
 * `src/lib/invite.test.ts` proves the parsing, `tests/e2e/qr-scan.spec.ts` proves the
 * wiring through `QrScanner.web.tsx` -- but headless Chromium refuses `getUserMedia` and
 * react-native-web has no `CameraView`, so nothing in this repo had ever RUN one. This
 * script is the only thing here that can, and it exists as a script rather than as the
 * hand-driven session Lane C has always been because a measurement taken once and never
 * repeated guards nothing.
 *
 * WHAT IT ACTUALLY WITNESSES, and the list is deliberately short:
 *   - the ungranted state draws its copy and its `Allow camera` button
 *   - the SYSTEM permission dialog appears and grants
 *   - `CameraView` mounts with `barcodeTypes: ['qr']` accepted by this SDK's native module
 *   - `onBarcodeScanned` FIRES against a real lens
 *   - `codeFromScan` turns what the lens saw into the code, in the field, on the device
 *
 * WHAT IT CANNOT WITNESS, and saying so is the point of the paragraph:
 *   - the iOS usage string. Android's permission dialog is composed by the system from the
 *     permission group; `NSCameraUsageDescription` is an iOS plist key and no Android run
 *     can read it. `src/lib/appConfig.test.ts` is what guards that, and only a real iPhone
 *     confirms it.
 *   - anything about iOS at all. There is no Mac in this environment.
 *
 * IT READS `uiautomator dump`, NOT SCREENSHOTS. `adb exec-out screencap` frequently
 * returns a STALE FRAME just after navigation, so a screenshot can show the previous
 * screen while the app has already moved on -- every assertion here is against the live
 * hierarchy and the PNGs are illustration, filed as evidence and never as proof.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'design/device');
const PKG = 'com.turtlewolfe.runit';

// The seeded event. TYPED here, as it is in `verify-qr.mjs` and `make-qr-poster.mjs` --
// `weddingSeed` is a TypeScript fixture and these are plain node scripts. What is NOT typed
// three times is the host: all three read `INVITE_ORIGIN` out of `src/lib/invite.ts`, which
// is the half that actually moves. A wrong code here fails loudly at the poster gate below;
// a wrong host would fail as a silent 90-second timeout, which is why that one is derived.
const EXPECTED_CODE = 'SR1017';

// ADB_LIBUSB=0 OR ADB HANGS FOREVER ON WSL2 -- `adb start-server` produces no output at
// all and never returns, because adb blocks enumerating USB. Set here rather than
// documented, because a doc costs an hour every time somebody has not read it.
const env = { ...process.env, ADB_LIBUSB: '0' };

/**
 * WHEN THIS LANE FAILS IT LEAVES STATE -- and until now it did not, which is the reason
 * three CI runs in a row could be diagnosed only by running a fourth. `fail()` printed a
 * sentence and exited, so the one machine that could see the device threw away everything
 * it knew on the way out.
 *
 * IT IS DELIBERATELY NOT `design/device/`. That directory holds COMMITTED evidence, and a
 * CI artifact pointed at it uploads files out of the checkout and presents them as frames
 * from the run -- which is exactly what happened: a failed run produced an artifact of
 * five PNGs, every one of them a file already in git. `test-results/lane-c/` is the
 * sibling of `test-results/lane-b` and `lane-h`, and is gitignored.
 */
const DIAG = join(import.meta.dirname, '..', 'test-results', 'lane-c');

const leaveState = () => {
  // Best effort by construction: this runs while something is already wrong, and a device
  // that has gone away must not turn a named failure into an unhandled throw.
  for (const [name, produce] of [
    ['screen.png', () => screencap()],
    ['hierarchy.xml', () => adb('exec-out', 'uiautomator', 'dump', '/dev/tty')],
    // The JS error that stops a screen rendering appears here and NOWHERE else -- not in
    // the hierarchy, which simply lacks the node, and not in Metro's log, which only knows
    // it served a bundle.
    ['logcat.txt', () => adb('logcat', '-d', '-t', '600')],
  ]) {
    try {
      mkdirSync(DIAG, { recursive: true });
      writeFileSync(join(DIAG, name), produce());
      console.error(`  state: test-results/lane-c/${name}`);
    } catch (e) {
      console.error(`  could not capture ${name}: ${e.message}`);
    }
  }
};

const fail = (msg, ...rest) => {
  console.error(`\x1b[31mFAIL: ${msg}\x1b[0m`);
  for (const line of rest) console.error(`  ${line}`);
  leaveState();
  process.exit(1);
};
const ok = (msg) => console.log(`\x1b[32m  ok\x1b[0m ${msg}`);
const step = (msg) => console.log(`\x1b[36m→\x1b[0m ${msg}`);

const adb = (...args) =>
  execFileSync('adb', args, { env, encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r/g, '');
const shell = (cmd) => adb('shell', cmd);

/** One node of the live view hierarchy. */
const parseDump = (xml) =>
  [...xml.matchAll(/<node\b([^>]*)>/g)].map((m) => {
    const attr = (name) => new RegExp(`${name}="([^"]*)"`).exec(m[1])?.[1] ?? '';
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(m[1]);
    return {
      id: attr('resource-id'),
      desc: attr('content-desc'),
      text: attr('text'),
      cls: attr('class'),
      hint: attr('hint'),
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
    };
  });

const dump = () => {
  // -c - streams the XML to stdout. Writing to /sdcard and cat-ing it back races with the
  // next dump when a step retries.
  const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
  return parseDump(xml);
};

/**
 * RN's `testID` surfaces as `resource-id` on most views and as `content-desc` on some --
 * a Pressable carrying `accessibilityLabel` puts the label in `content-desc` and the
 * testID in `resource-id`, and a bare View does the opposite. Matching either is not
 * looseness; it is the actual contract, and guessing one would make a missing control and
 * a differently-reported control indistinguishable.
 */
const find = (nodes, id) => nodes.find((n) => n.id === id || n.id.endsWith(`:id/${id}`) || n.desc === id);

const tap = (node, what) => {
  if (!node?.bounds) fail(`cannot tap ${what}: it has no bounds`);
  const x = Math.round((node.bounds.x1 + node.bounds.x2) / 2);
  const y = Math.round((node.bounds.y1 + node.bounds.y2) / 2);
  shell(`input tap ${x} ${y}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the hierarchy. Returns the nodes the predicate accepted, or fails naming what it
 * was waiting for AND what it saw -- a timeout that says only "not found" sends you
 * looking at the app when the answer is usually that the selector moved.
 */
async function waitFor(what, predicate, { timeoutMs = 30_000, everyMs = 1_000, hints = [] } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  for (;;) {
    last = dump();
    const hit = predicate(last);
    if (hit) return { nodes: last, hit };
    if (Date.now() > deadline) {
      const ids = [...new Set(last.map((n) => n.id).filter(Boolean))];
      fail(
        `timed out after ${timeoutMs / 1000}s waiting for ${what}`,
        `the hierarchy currently holds ${last.length} nodes`,
        `resource-ids seen: ${ids.slice(0, 25).join(', ') || '(none)'}`,
        ...hints,
      );
    }
    await sleep(everyMs);
  }
}

const screencap = () => execFileSync('adb', ['exec-out', 'screencap', '-p'], { env, maxBuffer: 64 << 20 });

/**
 * IS THE PREVIEW ACTUALLY PAINTING? A `CameraView` that mounts but never produces a frame
 * leaves a BLACK SurfaceView, and every check short of looking at pixels calls that a
 * success: the node is in the hierarchy, the permission is granted, no error is logged.
 * The first version of this lane screenshotted the sheet the instant the hierarchy said
 * the camera had taken over and filed a photograph of a black rectangle as its evidence
 * that the layout survives a live preview.
 *
 * So: sample the middle of the sheet and measure. A dead surface is uniform -- near-zero
 * mean AND near-zero spread. A rendered room is neither. Spread is what carries the claim;
 * mean alone would be satisfied by a camera that failed to a flat grey.
 */
const previewSpread = (node) => {
  const png = PNG.sync.read(screencap());
  const b = node.bounds;
  const x1 = Math.round(b.x1 + (b.x2 - b.x1) * 0.3);
  const x2 = Math.round(b.x1 + (b.x2 - b.x1) * 0.7);
  const y1 = Math.round(b.y1 + (b.y2 - b.y1) * 0.25);
  const y2 = Math.round(b.y1 + (b.y2 - b.y1) * 0.6);
  const lum = [];
  for (let y = y1; y < y2; y += 4) {
    for (let x = x1; x < x2; x += 4) {
      const i = (y * png.width + x) << 2;
      lum.push(0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]);
    }
  }
  const mean = lum.reduce((a, v) => a + v, 0) / lum.length;
  const sd = Math.sqrt(lum.reduce((a, v) => a + (v - mean) ** 2, 0) / lum.length);
  return { mean, sd };
};

const shot = (name) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.png`), screencap());
  console.log(`     evidence: design/device/${name}.png`);
};

/**
 * THE SDK, resolved the way every other Android tool here resolves it. `adb emu` reaches
 * the running emulator's console, which is the only way to change the virtual scene after
 * boot -- the `-virtualscene-poster` LAUNCH flag would make this lane depend on how
 * somebody started the emulator half an hour ago.
 */
const SDK = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.HOME, 'Android/Sdk');
const MACRO_RESET = join(SDK, 'emulator/resources/macros/Reset_position');
const MACRO_WALK = join(SDK, 'emulator/resources/macros/Walk_to_image_room');
const POSTER = join(OUT, 'qr-poster.png');

// ---------------------------------------------------------------------------

step('a device is attached');
const devices = adb('devices')
  .split('\n')
  .slice(1)
  .filter((l) => l.trim().endsWith('device'));
if (devices.length !== 1) {
  fail(
    `expected exactly one attached device, found ${devices.length}`,
    'start one with:',
    "  emulator -avd <name> -camera-back virtualscene \\",
    '    -virtualscene-poster wall=design/device/qr-poster.png -gpu swiftshader_indirect',
  );
}
ok(devices[0].split('\t')[0]);

/**
 * THE STALE-DEV-CLIENT GATE, and it is the reason this issue was filed rather than done.
 * `expo-camera` is a NATIVE dependency: a dev client built before it was added carries no
 * camera module, and the failure is a red screen about a missing native module that reads
 * like a code bug. Asking the package manager what the INSTALLED build declares is the
 * only question whose answer cannot be a stale artefact on disk.
 */
step('the installed dev client carries the camera');
const pkgInfo = shell(`dumpsys package ${PKG}`);
if (!pkgInfo.includes(PKG)) {
  fail(`${PKG} is not installed`, 'build and install it with:  pnpm android');
}
if (!/requested permissions:[\s\S]*?android\.permission\.CAMERA/.test(pkgInfo)) {
  fail(
    `${PKG} does not declare android.permission.CAMERA`,
    'the installed dev client predates expo-camera. Rebuild it:',
    '  npx expo prebuild -p android --clean && pnpm android',
  );
}
ok('android.permission.CAMERA is declared');

/**
 * Start from the state a real guest is in. `expo run:android` installs with permissions
 * already granted, which would skip the two things this lane exists to see: the copy the
 * app draws when it has no camera, and the system dialog.
 */
step('revoking the camera, so the permission path is the one under test');
try {
  shell(`pm revoke ${PKG} android.permission.CAMERA`);
} catch {
  /* already revoked; pm exits non-zero rather than saying so */
}
ok('revoked');

/**
 * METRO, AND THE HOP THAT REACHES IT. A dev client is an empty shell until a bundler
 * answers, and the two ways this goes wrong look identical from the device: no Metro at
 * all, and a Metro the device cannot route to.
 *
 * `adb reverse` is the second one. `127.0.0.1:8081` INSIDE the emulator is the emulator's
 * own loopback, not this machine's; `expo run:android` installs the reverse mapping as a
 * side effect, so the lane passed for as long as a build happened to have run since the
 * emulator booted, and failed the moment the emulator was restarted on its own. Setting it
 * here makes the lane independent of what ran before it.
 */
step('reaching Metro');
const METRO_PORT = 8081;
const status = await fetch(`http://127.0.0.1:${METRO_PORT}/status`).catch(() => null);
if (!status?.ok) {
  fail(
    `no Metro answering on 127.0.0.1:${METRO_PORT}`,
    'a dev client with no bundler sits on its launcher screen forever. Start one:',
    '  pnpm start        # dev client — NOT start:go, which targets Expo Go',
  );
}
adb('reverse', `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`);
ok(`Metro is up and reversed onto the device's ${METRO_PORT}`);

/**
 * FORCE-STOP FIRST, THEN WAIT FOR THE PROCESS TO ACTUALLY BE GONE. `am start` with a
 * dev-client URL is SWALLOWED if the app is already foregrounded -- the launch silently
 * no-ops and you debug the previous session. `am force-stop` returns as soon as the kill
 * is REQUESTED, though, so firing the intent on the next line races the teardown and gets
 * swallowed exactly as if no force-stop had happened: the run lands on the launcher and
 * the failure names the launcher's resource-ids, which point nowhere near the cause.
 *
 * Observed, not theorised -- one run in this sitting did precisely that, between two that
 * passed, with nothing changed but a filename.
 */
step('launching the app');
const metroHost = process.env.METRO_HOST ?? `127.0.0.1:${METRO_PORT}`;
const url = `exp+runit://expo-development-client/?url=${encodeURIComponent(`http://${metroHost}`)}`;

async function launch() {
  shell(`am force-stop ${PKG}`);
  for (let i = 0; i < 30; i++) {
    if (!shell(`pidof ${PKG} || true`).trim()) break;
    await sleep(500);
  }
  shell(`am start -a android.intent.action.VIEW -d '${url}' ${PKG}`);
}

// Three attempts, because the intent being dropped and the bundle being slow look the
// same from here and only one of them is fixed by waiting longer.
let launched = false;
for (let attempt = 1; attempt <= 3 && !launched; attempt++) {
  await launch();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (find(dump(), 'join-code')) {
      launched = true;
      break;
    }
    await sleep(2_000);
  }
  if (!launched) console.log(`     attempt ${attempt} did not reach the join screen; retrying`);
}
if (!launched) {
  fail(
    'the app never reached the join screen',
    `intent: ${url}`,
    'if the hierarchy shows the launcher the intent was dropped; if it shows a dev-client',
    'launcher screen, Metro is reachable from here but not from the device.',
  );
}
ok('join screen is up');
shot('android-qr-01-join.dark');

/**
 * HANG OUR QR ON THE WALL. The virtual scene's two posters are the only surfaces in it we
 * control; `virtualscene-image` swaps them on a RUNNING emulator, so this lane sets its own
 * subject rather than trusting how somebody launched the emulator half an hour ago. Both
 * surfaces get it because which one is in frame depends on where the camera is standing.
 *
 * THIS MUST HAPPEN BEFORE THE SCANNER OPENS, and a mutation test is what proved it. The
 * scene uploads its poster textures when a camera client attaches, so a swap issued while
 * `CameraView` is already running is accepted -- `virtualscene-image` answers OK -- and
 * changes nothing the lens sees. With this block sitting after the permission grant the
 * lane passed while reading a QR that the emulator's `-virtualscene-poster` LAUNCH FLAG
 * had put on the wall, which is precisely the dependency it was written to remove. It
 * would have gone on passing on this machine and failed on any other.
 */
step('hanging the QR in the virtual scene');
if (!existsSync(POSTER)) {
  fail(`no poster at ${POSTER}`, 'generate it from the app\'s own EventQr with:  pnpm qr:poster');
}

/**
 * THE POSTER IS COMMITTED, SO IT CAN GO STALE -- and a stale one fails in the worst
 * possible way. `codeFromScan` REFUSES a link on a foreign host, by design and with a test
 * for it, so a poster still encoding a previous `INVITE_ORIGIN` would be seen perfectly by
 * the camera, rejected correctly by the parser, and reported here as a 90-second timeout
 * that reads exactly like a broken camera. Decoding it against the app's CURRENT origin
 * turns that into one sentence naming the fix.
 *
 * Same shape as `tokens.test.ts` re-parsing `theme.css`: the artefact is committed for
 * convenience and re-derived from the source of truth so it cannot quietly disagree.
 */
const INVITE_ORIGIN = /INVITE_ORIGIN = '([^']+)'/.exec(
  readFileSync(join(ROOT, 'src/lib/invite.ts'), 'utf8'),
)?.[1];
if (!INVITE_ORIGIN) fail('could not read INVITE_ORIGIN out of src/lib/invite.ts');
const posterPng = PNG.sync.read(readFileSync(POSTER));
const encoded = jsQR(
  new Uint8ClampedArray(posterPng.data),
  posterPng.width,
  posterPng.height,
)?.data;
const wanted = `${INVITE_ORIGIN}/i/${EXPECTED_CODE}`;
if (encoded !== wanted) {
  fail(
    'the committed poster is not what this app would print',
    `poster encodes: ${encoded ?? '(it does not decode at all)'}`,
    `app would print: ${wanted}`,
    'regenerate it:  pnpm export:web && pnpm qr:poster',
  );
}
ok(`the poster encodes ${wanted}`);
for (const surface of ['wall', 'table']) {
  const res = adb('emu', 'virtualscene-image', surface, POSTER).trim();
  if (!res.startsWith('OK')) {
    fail(
      `the emulator refused to hang the poster on the ${surface}`,
      res,
      'the camera is probably not in virtualscene mode. Restart the emulator with:',
      '  emulator -avd <name> -camera-back virtualscene -gpu swiftshader_indirect',
    );
  }
}
ok('wall and table both show the QR');

step('opening the scanner');
const joinNodes = dump();
tap(find(joinNodes, 'join-scan'), 'join-scan');

const { nodes: sheet } = await waitFor(
  'the scanner sheet, in its ungranted state',
  (n) => find(n, 'qr-scanner') && find(n, 'qr-allow'),
);
ok('the sheet draws the ungranted copy and an Allow camera button');
const preCopy = sheet.find((n) => n.text.includes('needs the camera'));
if (!preCopy) {
  fail(
    'the sheet is up but the ungranted explanation is missing',
    'expected copy containing "needs the camera"',
    `texts seen: ${sheet.map((n) => n.text).filter(Boolean).join(' | ')}`,
  );
}
ok(`copy: "${preCopy.text}"`);
shot('android-qr-02-permission-needed.dark');

step('asking for the camera');
tap(find(dump(), 'qr-allow'), 'qr-allow');

/**
 * The system dialog is composed by the permission controller, not by us. Match its button
 * by id first and by text second: the id is stable across versions the text is not, and
 * the text is stable across the OEM skins the id is not.
 */
const { hit: allowButton } = await waitFor('the system permission dialog', (n) => {
  const byId = n.find((x) => x.id.endsWith(':id/permission_allow_foreground_only_button'));
  if (byId) return byId;
  return n.find((x) => /^(while using the app|allow|only this time)$/i.test(x.text.trim()));
});
ok(`system dialog: "${allowButton.text || allowButton.id}"`);
shot('android-qr-03-system-dialog.dark');
tap(allowButton, 'the system allow button');

/**
 * THE SHEET, WITH A LENS BEHIND IT. `#42` asks whether the layout survives a live preview
 * "rather than the empty frame the web stub draws", and this is the only lane that can
 * look. `Reset_position` puts the virtual device back at the scene's default pose, which
 * faces the television -- so the camera is genuinely running and genuinely CANNOT see a
 * QR, which makes this observation deterministic instead of a race against the scan.
 *
 * The assertion is a hierarchy fact and the PNG is illustration. What it proves is the
 * invariant `QrScanner`'s own docblock claims and no web test can reach: the way back to
 * typing is drawn WHILE THE CAMERA IS RUNNING. A scanner someone cannot get out of is
 * worse than no scanner, and until now nothing had ever seen one running.
 */
step('the sheet, with the camera live');
adb('emu', 'automation', 'play', MACRO_RESET);
const { nodes: liveSheet } = await waitFor(
  'the camera to take over the sheet',
  (n) => find(n, 'qr-scanner') && !find(n, 'qr-allow'),
);
const escape = find(liveSheet, 'qr-cancel');
if (!escape) {
  fail(
    'the camera is live and the way back to typing is gone',
    'QrScanner draws qr-cancel whatever else on the sheet is true — including while the',
    'camera is running. A guest whose camera will not focus is now trapped.',
    `resource-ids present: ${liveSheet.map((n) => n.id).filter(Boolean).join(', ')}`,
  );
}
ok('camera live, and "Type the code instead" is still drawn');

// A frame takes a moment to arrive after the surface attaches, so poll rather than assume.
// 6 is well above the noise of a flat surface and far below the ~40+ a lit room produces.
const PAINTED_SD = 6;
let stats = { mean: 0, sd: 0 };
const paintDeadline = Date.now() + 30_000;
while (Date.now() < paintDeadline) {
  stats = previewSpread(find(dump(), 'qr-scanner'));
  if (stats.sd > PAINTED_SD) break;
  await sleep(1_000);
}
if (stats.sd <= PAINTED_SD) {
  fail(
    'the camera mounted but never painted a frame',
    `preview is flat: mean luminance ${stats.mean.toFixed(1)}, spread ${stats.sd.toFixed(1)}`,
    'this is the black-SurfaceView failure — the sheet looks correct and shows nothing.',
  );
}
ok(`the preview is painting (mean ${stats.mean.toFixed(1)}, spread ${stats.sd.toFixed(1)})`);
shot('android-qr-04-live-preview.dark');

/**
 * AND THEN AIM AT IT. This is the step whose absence cost the first run of this lane: the
 * scene's default camera pose faces the television, the posters hang behind it, and a
 * `CameraView` running perfectly against a wall it cannot see is indistinguishable from a
 * `CameraView` that never started. `Walk_to_image_room` is the emulator's OWN macro for
 * walking the virtual device to the poster, so this borrows Google's ground truth about
 * where in that room the poster is rather than inventing a pose.
 */
step('walking the virtual device to the poster');
// RESET FIRST. The walk is a recorded pose sequence, not a destination, so replaying it
// from wherever the last run left the camera compounds instead of repeating. This is what
// makes a second run of this lane mean the same thing as the first.
for (const macro of [MACRO_RESET, MACRO_WALK]) {
  if (!existsSync(macro)) {
    fail(
      `the emulator macro ${macro} is missing`,
      'set ANDROID_HOME, or check that the emulator package is installed',
    );
  }
  const played = adb('emu', 'automation', 'play', macro).trim();
  if (!played.startsWith('OK')) fail(`the emulator refused to play ${macro}`, played);
}
ok('reset, then walked to the poster wall');

/**
 * THE ASSERTION THE WHOLE LANE IS FOR. Nothing types into this field: if `join-code`
 * holds the code, a real lens read a real QR off the emulator's virtual scene wall,
 * `onBarcodeScanned` fired, and `codeFromScan` parsed the universal link the app's own
 * `EventQr` generated. The camera is the only path by which that string can get there.
 */
step('waiting for a live lens to read the wall');
const { hit: field } = await waitFor(
  `the scanned code to land in join-code`,
  (n) => {
    const f = find(n, 'join-code');
    // AN EMPTY EditText REPORTS ITS HINT AS ITS TEXT, so "not empty" is `text !== hint`
    // and not `text !== ''`. Comparing against a hardcoded 'Event code' would pass the day
    // somebody rewords the placeholder.
    return f && f.text.trim() && f.text.trim() !== f.hint.trim() ? f : null;
  },
  {
    timeoutMs: 90_000,
    everyMs: 1_500,
    // THE FAILURE SOMEBODY WILL ACTUALLY HIT, so it names its causes instead of printing a
    // node count. The first one is the quiet one: `virtualscene-image` answers OK even when
    // the back camera is `emulated`, so a wrongly-started emulator reaches this line looking
    // exactly like a broken scanner. The AVD ships `hw.camera.back = emulated`.
    hints: [
      '',
      'the camera IS running by this point — the sheet passed its paint check — so the',
      'question is what it is looking at:',
      '  · was the emulator started with `-camera-back virtualscene`? The AVD default is',
      '    `emulated`, and `virtualscene-image` answers OK anyway.',
      '  · did the walk macro run? `design/device/android-qr-04-live-preview.dark.png` shows',
      '    the last frame this lane saw.',
      '  · is the poster still the one this app would print? `pnpm export:web && pnpm qr:poster`.',
    ],
  },
);

if (field.text.trim().toUpperCase() !== EXPECTED_CODE) {
  fail(
    'the scan produced the wrong code',
    `field:  ${field.text}`,
    `wanted: ${EXPECTED_CODE}`,
    'the poster and the app disagree — regenerate it with: pnpm qr:poster',
  );
}
ok(`join-code reads "${field.text}" — scanned from the wall`);
shot('android-qr-05-scanned.dark');

console.log(`\n\x1b[32mWITNESSED\x1b[0m  expo-camera read ${EXPECTED_CODE} off a real lens.`);
console.log('  This is native evidence. It says nothing about iOS.');
