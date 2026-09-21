import { FIDELITY_PIXEL } from './captureConstants';

/**
 * The web half -- `EXPO_PUBLIC_FIDELITY=1` only, and it exists for the reason
 * `capture.web.ts` states outright: a real `<input type=file>` opens an OS chooser that
 * nothing in the harness answers, and the journey hangs rather than fails.
 *
 * Returns the same synthetic 1x1 PNG `capture.web.ts` does, so a journey asserting that a
 * screenshot travelled is asserting the value came from the PICKER PATH rather than from a
 * literal somewhere in the screen.
 */
export async function pickScreenshot(): Promise<string | null> {
  if (process.env.EXPO_PUBLIC_FIDELITY !== '1') return null;
  return FIDELITY_PIXEL;
}
