import { Redirect, Slot } from 'expo-router';
import { View } from 'react-native';

import { HostConsoleChrome } from '@/features/host/HostConsoleChrome';
import { HostConsoleFooter } from '@/features/host/HostConsoleFooter';
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
      {/*
        ONE MOUNT FOR FIVE SEGMENTS (#84 arc). Below <Slot/> so it is the floor of every
        host screen and never scrolls away; above <Toast/> so the toast, which floats
        126pt up, still lands over it rather than under. See HostConsoleFooter's docblock
        for why it is not in the chrome and not five copies.
      */}
      <HostConsoleFooter />
      <Toast />
    </View>
  );
}
