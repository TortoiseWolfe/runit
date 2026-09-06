import type { SaveResult } from './save';

/**
 * Web implementation. Metro picks this over `save.ts` for the web bundle, which is the
 * point: **it imports `expo-media-library` not at all**, so the package stays out of the
 * browser bundle rather than being branched around at runtime.
 *
 * A BROWSER HAS NO CAMERA ROLL. The honest equivalent is a download, and that is what this
 * does — an anchor with `download`, which is the only way a page can hand someone a file.
 *
 * IT RETURNS EARLY UNDER `EXPO_PUBLIC_FIDELITY=1` AND TOUCHES NOTHING. A real download in
 * the screenshot harness either opens an OS save dialog nothing answers or writes files
 * into the Playwright container for the length of the run — the same class of trap
 * `capture.web.ts` documents for the file chooser. It reports `saved` because from the
 * caller's point of view nothing went wrong, and a spec that asserted a failure here would
 * be asserting the stub.
 */
export async function savePhotoToLibrary(uri: string): Promise<SaveResult> {
  if (process.env.EXPO_PUBLIC_FIDELITY === '1') return 'saved';

  try {
    const a = document.createElement('a');
    a.href = uri;
    // A hint only: a cross-origin URL ignores it and the browser names the file itself.
    // Not worth a fetch-and-blob round trip to control, since the bytes are the point.
    a.download = `runit-${Date.now()}.jpg`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'saved';
  } catch {
    return 'failed';
  }
}
