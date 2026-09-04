/**
 * Web implementation. Metro picks this over `share.ts` for the web bundle, which keeps
 * `expo-file-system` out of it entirely rather than branching around it at runtime.
 *
 * WHY IT RESOLVES INSTEAD OF THROWING. The Playwright suite drives these paths, and the
 * point of the tests is the CALLER's behaviour -- does the button raise the right toast,
 * does it stay enabled, does it not leave a spinner up. Headless Chromium has no share
 * sheet and blocks the download an .ics would otherwise start, so a web build that threw
 * would fail the suite for a reason that has nothing to do with the code under test.
 *
 * Same shape as `capture.web.ts`: the browser is not the phone, and pretending otherwise
 * is how a harness goes green on a broken app.
 */

/** navigator.share exists on some mobile browsers and no desktop ones. */
export async function shareText(message: string): Promise<boolean> {
  const nav = globalThis.navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
  if (typeof nav?.share === 'function') {
    try {
      await nav.share({ text: message });
      return true;
    } catch {
      // A dismissed sheet rejects. That is a cancellation, not a failure.
      return false;
    }
  }
  // No sheet available. Reporting FALSE rather than throwing is what lets the caller say
  // "copy this code" instead of "something went wrong" -- which is the honest message on
  // a desktop browser.
  return false;
}

export async function shareIcs(): Promise<boolean> {
  // A real download is blocked in the harness sandbox and is not what the tests assert.
  return false;
}
