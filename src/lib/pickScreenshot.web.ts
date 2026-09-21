import { browserDeps, shrink } from './capture.web';
import { FIDELITY_PIXEL } from './captureConstants';

/**
 * THE WEB HALF OF THE BUG-REPORT PICKER -- and until #78 it returned `null` always.
 *
 * `FeedbackSheet.tsx` draws "Add a picture (optional)" unconditionally, so in any web build
 * WITHOUT `EXPO_PUBLIC_FIDELITY=1` a person tapped that control and nothing happened: no
 * chooser, no error, no state change. That is the drawn-control-that-does-nothing failure
 * `empty-world.spec.ts`'s `aria-disabled` assertion exists to catch, and no lane here could
 * see it -- Lane B always runs WITH the flag, where the stub returns a pixel and the control
 * appears to work. It was latent only because no browser build is deployed; the browser guest
 * route is what would have armed it.
 *
 * THE FIDELITY BRANCH STAYS, AND STAYS FIRST. It is not a cheat and it is not dead code: a
 * real `<input type="file">` opens an OS chooser that nothing in `tools/shoot-app.mjs`
 * answers, so the journey would HANG rather than fail. `capture.web.ts` says the same thing
 * at greater length and for the same reason. The pixel is the shared `FIDELITY_PIXEL`, so a
 * journey asserting that exact data URI still proves the value came out of the PICKER PATH
 * rather than from a literal in the screen.
 *
 * NO `capture` ATTRIBUTE, deliberately -- the one line that differs from `capturePhoto`.
 * That attribute hints a phone browser toward the camera, which is right for a guest
 * photographing the room and wrong here: somebody reporting a bug has already taken the
 * screenshot. This is the library, on web exactly as on native.
 *
 * WHAT IS HONESTLY WEAKER ON WEB THAN ON NATIVE. The native picker passes
 * `allowsEditing: true`, and its docblock calls that crop "the redaction step, and the whole
 * reason this is the picker" -- a person can cut another guest out before sending. A browser
 * file input has no crop and there is no standard one to reach for. The core property
 * survives: nothing is captured silently, and the person chooses the file and sees what they
 * are sending. What is lost is fixing a picture they have already taken, so on web they have
 * to crop it before they choose it. Stated rather than papered over, per `design/FIDELITY.md`.
 *
 * IT SHRINKS, because the caller does not. `SupabaseRepository.feedback.send` fetches this
 * URI and uploads the bytes as `image/jpeg` at `{uid}/{uuid}.jpg`, and the bucket caps an
 * object at 10MB -- so an unshrunk phone screenshot can fail as a generic transfer error, the
 * exact defect #11 fixed for `event-photos`. Re-encoding to JPEG also makes the bytes match
 * the content type the uploader declares, instead of sending a PNG labelled as a JPEG.
 *
 * THE IMPORT NAMES `./capture.web` EXPLICITLY, AND THE BARE SPECIFIER IS A TRAP. Metro
 * resolves `./capture` to `capture.web.ts` in a web bundle, so the bare form RUNS correctly --
 * but tsc knows nothing of platform extensions and resolves it to `capture.ts`, the native
 * half, which exports neither of these. `pnpm typecheck` says so out loud, which is the good
 * outcome; the bad one is the same divergence pointing the other way, where tsc is happy and
 * the web bundle gets a different module than the types describe. That is `orderedForRequest`'s
 * bug exactly (`undefined` at runtime, six journeys red) one layer over. Naming the file makes
 * both resolvers agree, and this file is only ever in a web bundle, so nothing is being
 * hardcoded that was not already true.
 *
 * NONE OF THE BRANCH BELOW THE FLAG IS REACHABLE BY ANY LANE HERE, for the reason at the top:
 * the chooser is the thing the harness cannot answer. The compression half IS covered, via
 * `shrink`'s injected seam in `capture.web.test.ts` -- which is why this calls that function
 * rather than growing its own.
 */
export async function pickScreenshot(): Promise<string | null> {
  if (process.env.EXPO_PUBLIC_FIDELITY === '1') return FIDELITY_PIXEL;

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    // A cancelled file dialog fires no event in most browsers, so this promise would hang
    // forever on a backed-out pick. `cancel` is the modern signal; the focus fallback covers
    // browsers that do not emit it. Lifted from `capturePhoto`, where it was earned.
    const done = (value: string | null) => {
      window.removeEventListener('focus', onFocus);
      resolve(value);
    };
    const onFocus = () =>
      setTimeout(() => {
        if (!input.files?.length) done(null);
      }, 300);

    input.addEventListener('cancel', () => done(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      void (async () => {
        const out = await shrink(file, browserDeps);
        done(URL.createObjectURL(out.blob));
      })().catch(() =>
        // A decode failure is not a cancellation, and `actions.ts` cannot tell the two
        // apart -- it swallows null silently. Hand back the original bytes instead, so the
        // report still carries its picture. The uploader labels everything `image/jpeg`
        // and the bucket admits PNG and WebP too, so mislabelled bytes still land.
        done(URL.createObjectURL(file)),
      );
    });

    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}
