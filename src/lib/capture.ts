import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';

import { MAX_EDGE, QUALITY } from './captureConstants';

/**
 * Take a photo and hand back a local URI. Native implementation.
 *
 * WHY THIS IS NOT IN THE REPOSITORY. Screens depend on `RunitRepository`, and a
 * Supabase adapter will implement that same interface. Camera access is a device
 * concern, not a backend one -- putting `ImagePicker` behind the repository would
 * make every future adapter carry a camera. So capture lives here and the
 * repository keeps taking a URI, which is the right currency at that seam:
 * an adapter can `fetch(uri).blob()` when it needs bytes, and until then the
 * check that a guest is even *allowed* another photo runs before anything is
 * materialised in the JS heap.
 *
 * `src/lib/` is deliberately outside the ESLint import boundary
 * (eslint.config.js) for the same reason -- it is neither a screen nor an adapter.
 *
 * Returns `null` when the guest backs out. That is not an error and must not be
 * reported as one.
 */



export interface CapturedPhoto {
  /** A `file://` URI inside the app's cache directory. */
  uri: string;
  width: number;
  height: number;
}

/**
 * Copy into our own cache directory.
 *
 * The picker hands back a URI in a temp location that the OS is free to reclaim,
 * and on Android a `content://` URI can be revoked as soon as the activity that
 * granted it goes away. Owning the bytes means a pending photo survives a
 * backgrounded app, which matters because a photo sits in the host's approval
 * queue for as long as the host takes to look at it.
 */
function adopt(uri: string): string {
  const dir = new Directory(Paths.cache, 'runit-photos');
  if (!dir.exists) dir.create({ intermediates: true });
  // The source name is the picker's temp name; keep its extension, drop its path.
  const ext = uri.split('.').pop()?.split('?')[0] ?? 'jpg';
  const dest = new File(dir, `${Date.now()}.${ext}`);
  new File(uri).copy(dest);
  return dest.uri;
}

export async function capturePhoto(): Promise<CapturedPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;

  const shot = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    // No in-picker editing. The canvas's shutter is one tap, and a crop step
    // between tapping and the photo appearing is a different product.
    allowsEditing: false,
    quality: 1,
    exif: false,
  });
  if (shot.canceled || !shot.assets?.[0]) return null;

  const asset = shot.assets[0];

  /*
   * THE PICKER'S DIMENSIONS ARE NOT TRUSTED, and this is not defensive habit --
   * `expo-image-picker`'s own types say so:
   *
   *     Width of the image or video. Can be `0` if the system did not provide the width.
   *
   * They are declared `number`, not `number | undefined`, so TYPESCRIPT CANNOT CATCH IT
   * and never will. The previous version read them straight into the scale arithmetic and
   * had three separate failure modes, all silent, all shipping a full-resolution frame:
   *
   *   - both undefined -> Math.max is NaN -> `NaN > 1600` is false -> resize skipped
   *   - both zero      -> longEdge 0      -> `0 > 1600` is false   -> resize skipped
   *   - ONE zero       -> worse than a skip: longEdge is real so scale is ~0.4, and
   *                       `resize({ width: Math.round(0 * 0.4) })` asked for width ZERO
   *
   * Rendering first gives an `ImageRef` whose width/height come from the DECODED bitmap
   * rather than from picker metadata, so there is no unvalidated input left to defend.
   */
  const probe = await ImageManipulator.ImageManipulator.manipulate(asset.uri).renderAsync();
  const longEdge = Math.max(probe.width, probe.height);

  // A tripwire, not a guard against the picker any more: this now says "the native
  // decoder returned nonsense", which is a different and much less likely claim. Loud,
  // because silently uploading a full frame is what this whole function exists to stop.
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    throw new Error(`capture: the decoded image reported no size (${probe.width}x${probe.height})`);
  }

  /*
   * CLAMP THE LONG EDGE; let the library derive the other one. `resize` documents it:
   * "If you specify only one value, the other will be calculated automatically to
   * preserve image ratio." That deletes the multiplication entirely -- and the
   * multiplication was the bug. The old code only ever passed `width`, which was correct
   * for portrait BY ARITHMETIC ACCIDENT and stops being correct once the edge is clamped
   * directly, so the orientation branch is load-bearing rather than tidy.
   */
  const out =
    longEdge > MAX_EDGE
      ? await ImageManipulator.ImageManipulator.manipulate(probe)
          .resize(probe.width >= probe.height ? { width: MAX_EDGE } : { height: MAX_EDGE })
          .renderAsync()
          .then((r) =>
            r.saveAsync({ compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG }),
          )
      : await probe.saveAsync({ compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG });

  return { uri: adopt(out.uri), width: out.width, height: out.height };
}
