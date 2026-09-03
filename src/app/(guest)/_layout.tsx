import { Redirect, Slot } from 'expo-router';
import { View } from 'react-native';

import { GuestTabBar } from '@/components/ui/GuestTabBar';
import { Toast } from '@/components/ui/Toast';
import { useSession } from '@/state/hooks';
import { useTheme } from '@/theme';

export default function GuestLayout() {
  const session = useSession();
  const { tokens } = useTheme();
  if (session.kind === 'anonymous') return <Redirect href="/join" />;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.base100 }}>
      <Slot />
      <GuestTabBar />
      <Toast />
    </View>
  );
}
