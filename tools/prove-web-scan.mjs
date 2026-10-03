/**
 * The browser QR scanner, witnessed through a camera (2026-10-03).
 *
 * `QrScanner.web.tsx` opens the back camera with `getUserMedia` and reads frames with jsQR.
 * No journey can see that: Lane B runs the harness build, which never opens a camera, and
 * headless Chromium refuses `getUserMedia` anyway. This drives the SHIPPABLE build
 * (`dist-guest/`) in a Chromium whose camera is a file -- `--use-file-for-fake-video-capture`
 * -- showing a QR generated here from `joinLink()`, and asserts three outcomes:
 *
 *   1. OURS: the code lands in `join-code` and the sheet closes (the camera was released).
 *   2. NOT OURS: a QR for somebody else's URL is SAID to be not ours, and nothing is typed.
 *   3. BLOCKED: a denied permission says how to allow it, instead of a dead black frame.
 *
 * WHAT IT CANNOT PROVE: Safari. iOS has its own media stack and its own autoplay rules
 * (`playsInline`, `muted` -- both set). Only an iPhone proves those, the same standing as
 * Lane C for native.
 *
 * It sends nothing anywhere: every request off the local server is aborted, so the
 * invitation lookup that follows a scan never reaches Supabase and mints no anonymous user.
 *
 *   pnpm export:web:guest && pnpm prove:web-scan
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';

import { serveDir } from './lib/serve.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist-guest');
const OUT = join(ROOT, 'test-results/web-scan');
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(red('no dist-guest/ -- run `pnpm export:web:guest` first.'));
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/** The same string `joinLink()` builds (src/lib/invite.ts) -- kept literal here so a drift fails. */
const CODE = 'SR1017';
const OURS = `https://runit-app.pages.dev/i/${CODE}`;

/** A one-frame YUV4MPEG2 "camera" showing `text` as a QR, black on white. */
function y4m(text, file) {
  const W = 640;
  const H = 480;
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const scale = Math.floor(360 / (n + 8));
  const side = scale * (n + 8);
  const x0 = Math.floor((W - side) / 2) + 4 * scale;
  const y0 = Math.floor((H - side) / 2) + 4 * scale;
  const Y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c))
        for (let dy = 0; dy < scale; dy++)
          Y.fill(16, (y0 + r * scale + dy) * W + x0 + c * scale, (y0 + r * scale + dy) * W + x0 + (c + 1) * scale);
  const UV = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV]);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), frame, frame]));
  return file;
}

const server = await serveDir(DIST);
let failed = 0;

/*
 * HEADLESS CHROMIUM ANSWERS `NotSupportedError` TO EVERY CAMERA REQUEST unless
 * `--use-fake-ui-for-media-stream` auto-accepts the prompt -- measured: with a granted context
 * permission and a fake device, still "Not supported". And it never produces a real denial
 * (`--deny-permission-prompts` gives the same NotSupportedError). So the BLOCKED case stubs
 * `getUserMedia` to reject with `NotAllowedError`, which is what Safari raises when the
 * person taps Don't Allow; it tests the mapping, not Safari's prompt.
 */
async function run(name, { video, allow }, check) {
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  if (video) args.push(`--use-file-for-fake-video-capture=${video}`);
  const browser = await chromium.launch({ args });
  const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
  if (!allow) {
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
  }
  const page = await context.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith(server.url) ? r.continue() : r.abort()));
  try {
    await page.goto(`${server.url}/join`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('join-scan').click({ timeout: 45_000 });
    await check(page);
    console.log(green(`  ok  ${name}`));
  } catch (e) {
    failed++;
    await page.screenshot({ path: join(OUT, `${name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
    console.log(red(`  FAIL ${name}: ${String(e.message ?? e).split('\n')[0]}`));
  } finally {
    await browser.close();
  }
}

await run('a RunIt invitation fills the code and closes the camera', { video: y4m(OURS, join(OUT, 'ours.y4m')), allow: true }, async (page) => {
  await page.waitForFunction(
    (c) => document.querySelector('[data-testid="join-code"]')?.value === c,
    CODE,
    { timeout: 20_000 },
  );
  if ((await page.locator('[data-testid="qr-video"]').count()) !== 0) throw new Error('the camera preview is still mounted');
});

await run("somebody else's QR is called not ours", { video: y4m('https://example.com/menu', join(OUT, 'foreign.y4m')), allow: true }, async (page) => {
  await page.getByText("That QR code isn't a RunIt invitation.").waitFor({ timeout: 20_000 });
  const v = await page.getByTestId('join-code').inputValue();
  if (v) throw new Error(`a foreign QR typed "${v}" into the field`);
});

await run('a blocked camera says how to allow it', { allow: false }, async (page) => {
  await page.getByText('The camera is blocked for this page', { exact: false }).waitFor({ timeout: 20_000 });
});

await server.close();
console.log(failed ? red(`${failed} of 3 failed -- screenshots in test-results/web-scan/`) : green('all 3 held'));
process.exit(failed ? 1 : 0);
