import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';

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

/** Long edge, in pixels. A 12MP phone photo is ~4000px and ~5MB; unresized bytes
 *  are what turn "it works on my emulator" into an OOM after six shots. */
const MAX_EDGE = 1600;

/** JPEG quality. 0.8 is the usual knee -- below it artefacts show on skin tones,
 *  which for a wedding album is the one thing that must not happen. */
const QUALITY = 0.8;

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
  const longEdge = Math.max(asset.width, asset.height);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;

  const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  if (scale < 1) {
    context.resize({ width: Math.round(asset.width * scale) });
  }
  const rendered = await context.renderAsync();
  const out = await rendered.saveAsync({
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  return { uri: adopt(out.uri), width: out.width, height: out.height };
}
