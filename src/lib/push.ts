import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Ask for the notification permission and hand back this device's Expo push token.
 * Native implementation.
 *
 * WHY THIS IS NOT IN THE REPOSITORY, same argument as `capture.ts`. A notification
 * permission is a DEVICE concern, not a backend one -- putting `expo-notifications`
 * behind `RunitRepository` would make every future adapter carry it. So the permission
 * and the token live here, and the repository takes a `string | null`, which is the right
 * currency at that seam: an adapter stores an opaque address and never learns what an
 * Expo token is.
 *
 * `src/lib/` is deliberately outside the ESLint import boundary for that reason.
 *
 * RETURNS `null` WHEN THE GUEST SAYS NO, and that is not an error. A notification is a
 * courtesy; the app works identically without it. Anything that reports a refusal as a
 * failure is wrong -- the same rule `capture.ts` states for backing out of the camera.
 */

/**
 * How a notification behaves when it lands while the app is OPEN.
 *
 * `broadcasts` is already in the realtime publication, so a guest looking at the app has
 * ALREADY seen the announcement appear in the feed a moment ago. Banner-ing it again is
 * telling someone something they are currently reading. Push earns its keep in the
 * backgrounded and killed cases, which is a narrower claim than the pricing copy ever
 * made and worth being straight about.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(): Promise<string | null> {
  // A SIMULATOR OR EMULATOR CANNOT RECEIVE REMOTE PUSH, and asking anyway produces an
  // opaque failure rather than a useful one. Returning null here means Lane C sees the
  // permission path run without a misleading error in the log.
  if (!Device_isPhysical()) return null;

  // Android needs a channel to exist before anything can be delivered to it. Creating it
  // is idempotent and must happen BEFORE the permission request, or the first
  // notification lands in a default channel the user cannot configure separately.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('announcements', {
      name: 'Announcements',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  // ASK ONLY IF NOT ALREADY ANSWERED. Re-requesting a denied permission does nothing on
  // iOS -- the OS shows the prompt once, ever -- so a caller that keeps asking silently
  // does nothing and looks broken to whoever wrote it.
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return null;

  // The projectId is what routes a token to THIS app in Expo's service. Without it the
  // call throws on a bare dev client, which is a confusing way to learn the config is
  // missing -- so it is read explicitly and refused clearly.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('push: no EAS projectId in the config, so no token can be minted');
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data ?? null;
}

/**
 * `expo-device` is not a dependency and one boolean does not justify adding one.
 * `Constants.isDevice` is populated by expo-constants on both platforms.
 */
function Device_isPhysical(): boolean {
  return Constants.isDevice !== false;
}
