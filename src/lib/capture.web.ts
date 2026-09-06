import type { CapturedPhoto } from './capture';

import { MAX_EDGE, MAX_THUMB, QUALITY } from './captureConstants';

/**
 * Web implementation. Metro picks this file over `capture.ts` for the web bundle,
 * which is the point: **it imports none of the Expo capture packages.** They stay
 * out of the web bundle entirely rather than being branched around at runtime.
 *
 * TWO BRANCHES, AND THE FIRST ONE IS NOT A CHEAT.
 *
 * Under `EXPO_PUBLIC_FIDELITY=1` this returns a synthetic image immediately. That
 * flag is already this repo's seam for "the browser is not the phone" -- it is
 * what injects real iPhone safe-area insets and renders the scheme-probe. Without
 * this branch the screenshot harness and the Playwright suite HANG: a real
 * `<input type="file">` opens the OS file chooser, and nothing in
 * `tools/shoot-app.mjs` registers a `filechooser` handler, so the click never
 * resolves. `getUserMedia` is worse -- headless Chromium simply refuses it.
 *
 * With the branch, `tests/e2e/guest-photos.spec.ts` keeps testing what it was
 * written to test -- that an upload files into the ACTIVE folder and waits for a
 * host -- with a real URI now flowing through `upload()` instead of a hardcoded
 * null. What Lane B still cannot prove is the camera itself, and that is honest:
 * per FIDELITY note G, only a device can witness a real capture.
 */

/** A 1x1 transparent PNG. Small, valid, and obviously synthetic if it ever leaks
 *  into a screenshot -- which it should not, since uploads land pending. */
const FIDELITY_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * SHRINK A PICKED FILE BEFORE IT LEAVES THE BROWSER (#11).
 *
 * The web path had no compression of any kind. It measured `naturalWidth`/`naturalHeight`
 * purely to report them and then handed the ORIGINAL file to `upload()` -- so a 12MB
 * original went straight at a bucket with a 10MB per-object limit and failed as a generic
 * transfer error. Native has clamped the long edge since it was written; web never did.
 *
 * EXPORTED FOR TESTING, and that is deliberate rather than lazy. No lane in this repo can
 * reach this code through `capturePhoto`: the compression lives in the `change` listener,
 * which is only reachable on the NON-fidelity branch -- and that branch opens an OS file
 * chooser nothing in `tools/shoot-app.mjs` answers, which is exactly why the fidelity
 * branch exists. jsdom implements no `canvas.toBlob` either. So a seam that takes its
 * decoder and its canvas as arguments is the only way this is testable at all; without
 * one it ships unverified.
 */
export async function shrink(
  file: Blob,
  deps: {
    decode: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
    canvas: (w: number, h: number) => {
      draw: (src: unknown, w: number, h: number) => void;
      toBlob: (type: string, quality: number) => Promise<Blob | null>;
    };
  },
  /** Long edge to clamp to. Defaults to the full-size limit; the thumbnail passes MAX_THUMB. */
  maxEdge: number = MAX_EDGE,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await deps.decode(file);
  const longEdge = Math.max(bitmap.width, bitmap.height);

  // The same unvalidated-input trap the native path had: a decode that reports 0 must not
  // produce a zero-sized canvas. Hand the original back untouched instead -- an
  // uncompressed upload is worse than a compressed one and better than a blank one.
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    bitmap.close?.();
    return { blob: file, width: 0, height: 0 };
  }

  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const c = deps.canvas(width, height);
  c.draw(bitmap, width, height);
  bitmap.close?.();

  // JPEG to match native, which always saves SaveFormat.JPEG. A picked PNG becoming a
  // JPEG is parity rather than a regression; flattening transparency to black is the
  // known cost of that parity.
  const out = await c.toBlob('image/jpeg', QUALITY);

  // `toBlob` yields null on failure, and returning null HERE would be indistinguishable
  // from "the guest backed out of the picker" -- `actions.ts` swallows that silently, so
  // a compression failure would look like a cancelled camera: no photo, no toast, no
  // error. Fall back to the original bytes instead.
  if (!out) return { blob: file, width: bitmap.width, height: bitmap.height };
  return { blob: out, width, height };
}

/** The real browser implementation of the two seams above. */
const browserDeps = {
  decode: (blob: Blob) =>
    // `imageOrientation: 'from-image'` is load-bearing on a phone: an <img> applies EXIF
    // orientation and a raw canvas draw does not, so without it every portrait upload
    // from a phone lands sideways -- silently, and only on web.
    createImageBitmap(blob, { imageOrientation: 'from-image' as ImageOrientation }),
  canvas: (w: number, h: number) => {
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    const ctx = el.getContext('2d');
    return {
      draw: (src: unknown, dw: number, dh: number) =>
        ctx?.drawImage(src as CanvasImageSource, 0, 0, dw, dh),
      toBlob: (type: string, quality: number) =>
        new Promise<Blob | null>((res) => el.toBlob(res, type, quality)),
    };
  },
};

export async function capturePhoto(): Promise<CapturedPhoto | null> {
  if (process.env.EXPO_PUBLIC_FIDELITY === '1') {
    // The same synthetic pixel for both, so `guest-photos.spec.ts`'s literal data-URI
    // assertion still proves the value came out of the capture path.
    return { uri: FIDELITY_PIXEL, width: 1, height: 1, thumbUri: FIDELITY_PIXEL };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Hints a phone browser toward the camera rather than the photo roll. Ignored
    // on desktop, which is correct -- there is no camera to prefer.
    input.setAttribute('capture', 'environment');

    // A cancelled file dialog fires no event in most browsers, so this promise
    // would hang forever on a backed-out pick. `cancel` is the modern signal;
    // the focus fallback covers browsers that do not emit it.
    const done = (value: CapturedPhoto | null) => {
      window.removeEventListener('focus', onFocus);
      resolve(value);
    };
    const onFocus = () => setTimeout(() => { if (!input.files?.length) done(null); }, 300);

    input.addEventListener('cancel', () => done(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      // Compress BEFORE minting the URL the caller will upload, so the object URL that
      // escapes this function always points at the shrunk bytes.
      void (async () => {
        const full = await shrink(file, browserDeps);
        // The thumbnail is derived from the ORIGINAL, not from the already-compressed
        // full-size: re-encoding a JPEG twice compounds its artefacts, and on a 400px
        // copy that shows.
        let thumbUri: string | null = null;
        try {
          const t = await shrink(file, browserDeps, MAX_THUMB);
          thumbUri = URL.createObjectURL(t.blob);
        } catch {
          // Not fatal. The full-size stands in, same as on native.
        }
        done({
          uri: URL.createObjectURL(full.blob),
          width: full.width,
          height: full.height,
          thumbUri,
        });
      })().catch(() =>
        // A decode failure is not a cancellation. Hand back the original rather than
        // null, which `actions.ts` would swallow as "they backed out".
        done({ uri: URL.createObjectURL(file), width: 0, height: 0, thumbUri: null }),
      );
    });

    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}
