import { Share } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * The platform half of sharing. Native implementation.
 *
 * Split from `invite.ts` the way `capture.ts` is split from the repository: everything
 * that can be a pure string lives there and is tested, and only the parts that genuinely
 * need a device live here. That is also why this file has no logic worth testing -- if it
 * grows any, it belongs next door.
 *
 * `Share` is React Native's own, so this adds no dependency. It gives the OS sheet, which
 * means the host reaches their guests through whatever they already use -- Messages, mail,
 * a group chat -- rather than through a channel Runit had to build and operate.
 */

/** True when the sheet was actually used. `false` on a dismissed sheet, which is not an error. */
export async function shareText(message: string): Promise<boolean> {
  const result = await Share.share({ message });
  return result.action === Share.sharedAction;
}

/**
 * Write the calendar file somewhere the OS can read it, then offer it.
 *
 * A FILE, not a calendar write. `expo-calendar` would need a calendar permission for
 * something a file does without one, and the .ics then works with whichever calendar app
 * the guest actually uses. FIDELITY note K makes the same argument about the microphone.
 */
export async function shareIcs(filename: string, contents: string): Promise<boolean> {
  const dir = new Directory(Paths.cache, 'runit-ics');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, filename);
  // Overwrite rather than append: the same event shared twice must not produce a file
  // containing two calendars, which some parsers read as one malformed one.
  if (file.exists) file.delete();
  file.create();
  file.write(contents);

  const result = await Share.share({ url: file.uri, title: filename });
  return result.action === Share.sharedAction;
}
