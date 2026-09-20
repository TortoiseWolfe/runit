import { Redirect, Slot } from 'expo-router';
import { View } from 'react-native';

import { GuestTabBar } from '@/components/ui/GuestTabBar';
import { Toast } from '@/components/ui/Toast';
import { useSession } from '@/state/hooks';
import { useTheme } from '@/theme';

export default function GuestLayout() {
  const session = useSession();
  const { tokens } = useTheme();
  /*
   * THE HARNESS WORLD HAS TO SURVIVE THIS REDIRECT (#76).
   *
   * `?guest=1`, `?empty=1` and their siblings are read from `window.location.search` when
   * the repository is built, so a redirect that drops the query string silently REBOOTS THE
   * APP INTO A DIFFERENT WORLD. Leaving a party in `?guest=1` landed on a plain `/join`,
   * which is `weddingSeed` -- a world where the person is staff -- and the journey then
   * asserted against a fixture it had not asked for.
   *
   * In the shipped app there is never a query string here, so this is exactly `/join`.
   */
  if (session.kind === 'anonymous') {
    const search =
      typeof window !== 'undefined' && typeof window.location?.search === 'string'
        ? window.location.search
        : '';
    return <Redirect href={`/join${search}` as '/join'} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.base100 }}>
      <Slot />
      <GuestTabBar />
      <Toast />
    </View>
  );
}
