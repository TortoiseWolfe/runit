import type { CapturedPhoto } from './capture';

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

export async function capturePhoto(): Promise<CapturedPhoto | null> {
  if (process.env.EXPO_PUBLIC_FIDELITY === '1') {
    return { uri: FIDELITY_PIXEL, width: 1, height: 1 };
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
      const url = URL.createObjectURL(file);
      // Read the real dimensions so the caller gets the same shape as native.
      const img = new Image();
      img.onload = () => done({ uri: url, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({ uri: url, width: 0, height: 0 });
      img.src = url;
    });

    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}
