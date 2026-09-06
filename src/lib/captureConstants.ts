/**
 * The two numbers both capture paths clamp to, in a module that imports NOTHING.
 *
 * They lived in `capture.ts`. `capture.web.ts` cannot import that file for a value:
 * its whole invariant is that it "imports none of the Expo capture packages -- they stay
 * out of the web bundle entirely rather than being branched around at runtime", and a
 * value import would drag `expo-image-manipulator`, `expo-image-picker` and
 * `expo-file-system` into the browser bundle. It is also a Metro platform-resolution
 * hazard: `./capture` from inside `capture.web.ts` can resolve back to itself.
 *
 * So they live here, where both platforms can have them and neither pays for the other.
 */

/**
 * Long edge, in pixels. A 12MP phone photo is ~4000px and ~5MB; unresized bytes are what
 * turn "it works on my emulator" into an OOM after six shots.
 */
export const MAX_EDGE = 1600;

/**
 * JPEG quality. 0.8 is the usual knee -- below it artefacts show on skin tones, which for
 * a wedding album is the one thing that must not happen.
 */
export const QUALITY = 0.8;
