import { mailtoFor, type ComposeOutcome } from './invite';

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

/**
 * THE WEB HALF: a `mailto:` handed to whatever the browser treats as the mail app.
 *
 * It CANNOT report what happens next -- the browser opens the handler and hears nothing back --
 * so it is always `unconfirmed`, and `invitees.send` does not stamp `invitedAt` on it. That is
 * the honest answer rather than the tidy one: on desktop, Send used to do nothing at all.
 *
 * `unavailable` when there is nobody to address or the list is too long for one link; the
 * screen then points at Copy addresses, which has no length limit.
 *
 * UNDER `EXPO_PUBLIC_FIDELITY=1` IT RECORDS AND DOES NOT NAVIGATE. Handing a `mailto:` to
 * headless Chromium opens nothing and asserts nothing, so the harness stores the URL where a
 * journey can read it and check the BCC line -- the same shape as `capture.web.ts`'s synthetic
 * pixel. A test that only watched for a toast would pass on a Send that addressed nobody,
 * which is precisely the bug this replaced.
 */
export async function composeInviteEmail(m: {
  bcc: readonly string[];
  subject: string;
  body: string;
}): Promise<ComposeOutcome> {
  const url = mailtoFor(m);
  if (!url) return 'unavailable';
  if (process.env.EXPO_PUBLIC_FIDELITY === '1') {
    (globalThis as { __runitLastMailto?: string }).__runitLastMailto = url;
    return 'unconfirmed';
  }
  // A `mailto:` does not unload the page -- the browser hands it to the mail handler.
  window.location.href = url;
  return 'unconfirmed';
}
