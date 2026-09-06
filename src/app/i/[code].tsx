import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Where a universal link lands.
 *
 * `https://runit.pages.dev/i/HOUSE7` is what the QR encodes and what a guest taps in a
 * message. With the association file in place iOS opens the app on THIS path rather than
 * the browser, so the route has to exist -- without it expo-router falls through to
 * `+not-found` and an invitation would open the app on an error screen, which is worse
 * than opening the browser.
 *
 * It only translates and forwards. `/join` already knows how to take a `?code=`, fill the
 * field and look the invitation up, and duplicating any of that here would give the app
 * two join screens that drift.
 *
 * `Redirect` rather than a `useEffect` + `router.replace`: it runs during render, so
 * there is no frame where an empty screen is visible, and it leaves nothing in the
 * history for a back gesture to return to.
 */
export default function InviteLinkRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const clean = typeof code === 'string' ? code.trim().toUpperCase() : '';
  // A bare /i/ with no code is a mistyped or truncated link. Send them to the join screen
  // to type it rather than to a not-found: they are holding an invitation either way.
  return <Redirect href={clean ? `/join?code=${encodeURIComponent(clean)}` : '/join'} />;
}
