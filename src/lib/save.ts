import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

/**
 * Put a photo in the phone's camera roll. Native implementation — issue #39.
 *
 * WHY THIS EXISTS AT ALL. A photo taken in RunIt lives in exactly one place: RunIt's
 * bucket. Capture writes to the app's CACHE directory, which iOS may reclaim; there is no
 * share sheet and no export. So nobody has a copy, **including the person who took it** —
 * and retention is coming, which turns that from a gap into a countdown.
 *
 * WHY IT IS NOT IN THE REPOSITORY, the same argument as `capture.ts` and `push.ts`: the
 * camera roll is a DEVICE concern. Putting `MediaLibrary` behind `RunitRepository` would
 * make every future adapter carry one. `src/lib/` sits outside the ESLint import boundary
 * for exactly this class of thing.
 *
 * IT ASKS FOR ADD-ONLY PERMISSION. `requestPermissionsAsync(true)` requests the
 * write-only scope; RunIt never reads anybody's camera roll, and asking for more than it
 * needs is the fastest way to be refused by someone who was willing to say yes.
 */

export type SaveResult = 'saved' | 'denied' | 'failed';

/**
 * `uri` may be a local `file://` (the guest's own photo, already on disk) or a signed
 * https URL (anyone else's). A remote one is downloaded to the cache first, because
 * `saveToLibraryAsync` takes a local path.
 */
export async function savePhotoToLibrary(uri: string): Promise<SaveResult> {
  // ADD-ONLY. The `true` is the whole point of this line.
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    // A refusal is a NORMAL STATE, not an error -- the same rule `capture.ts` states for
    // backing out of the camera. The caller distinguishes it so it can say something
    // truthful rather than "failed".
    return 'denied';
  }

  let local = uri;
  let downloaded: string | null = null;
  try {
    if (!uri.startsWith('file://')) {
      // A signed URL expires, so it is fetched now rather than handed to the OS to fetch
      // whenever it feels like it.
      const dir = new FileSystem.Directory(FileSystem.Paths.cache, 'runit-saves');
      if (!dir.exists) dir.create({ intermediates: true });
      const dest = new FileSystem.File(dir, `${Date.now()}.jpg`);
      await FileSystem.File.downloadFileAsync(uri, dest);
      downloaded = dest.uri;
      local = dest.uri;
    }

    await MediaLibrary.saveToLibraryAsync(local);
    return 'saved';
  } catch {
    return 'failed';
  } finally {
    // OUR copy, not theirs. The camera roll holds its own; leaving this behind would grow
    // the cache by a full-size photo every time somebody saved one.
    if (downloaded) {
      try {
        new FileSystem.File(downloaded).delete();
      } catch {
        // A cache file we could not remove is not worth telling anyone about.
      }
    }
  }
}
