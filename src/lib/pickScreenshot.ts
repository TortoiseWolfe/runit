import * as ImagePicker from 'expo-image-picker';

/**
 * A PICTURE FOR A BUG REPORT, CHOSEN BY THE PERSON SENDING IT -- #77.
 *
 * THE LIBRARY, NOT THE CAMERA, AND NEVER A VIEW CAPTURE. `capturePhoto` beside this opens
 * the camera, because a guest adding to the album is photographing the room. Somebody
 * reporting a bug has already taken the screenshot -- that is what people do when something
 * looks wrong -- so this opens the library and lets them pick it.
 *
 * The alternative was capturing the current view automatically. It is rejected outright: a
 * party app's screen is mostly OTHER PEOPLE'S photographs and names, and a silent capture
 * would send them to a repository without the reporter ever seeing what left their phone.
 * Going through the picker means they choose, and `allowsEditing` means they can crop
 * somebody out first.
 *
 * `allowsEditing: true` HERE AND FALSE IN `capturePhoto`, deliberately. There a crop step
 * between tapping the shutter and the photo appearing is a different product; here it is
 * the redaction step, and it is the whole reason this is the picker.
 *
 * NO `adopt()` COPY. A photo for the album sits in a host's approval queue for as long as
 * the host takes to look at it, so it has to survive a backgrounded app. This is uploaded in
 * the same breath it is chosen, so the picker's temp URI outlives its only use.
 */
export async function pickScreenshot(): Promise<string | null> {
  // NO PERMISSION REQUEST. `launchImageLibraryAsync` does not need one on modern iOS or
  // Android -- the OS picker runs out of process and hands back only what was chosen, which
  // is the same property that makes this the private option. Asking anyway would put a
  // scary system dialog in front of somebody trying to do us a favour.
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    quality: 0.7,
    exif: false,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;
  return picked.assets[0].uri;
}
