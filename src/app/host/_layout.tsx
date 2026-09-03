import { Redirect, Slot } from 'expo-router';
import { View } from 'react-native';

import { HostConsoleChrome } from '@/features/host/HostConsoleChrome';
import { Toast } from '@/components/ui/Toast';
import { useSession } from '@/state/hooks';
import { useTheme } from '@/theme';

export default function HostLayout() {
  const session = useSession();
  const { tokens } = useTheme();
  if (session.kind === 'anonymous') return <Redirect href="/join" />;
  if (session.kind !== 'host') return <Redirect href="/chat" />;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.base100 }}>
      <HostConsoleChrome />
      <Slot />
      <Toast />
    </View>
  );
}
