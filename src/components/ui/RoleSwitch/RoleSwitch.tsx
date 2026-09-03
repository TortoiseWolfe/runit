import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { useRepository } from '@/state/RepositoryProvider';
import { useHosts, useSession } from '@/state/hooks';
import { useTheme } from '@/theme';

/**
 * Switch between the guest app and the host console.
 *
 * The canvas puts both on one sheet, side by side, because it is a prototype
 * for one reader. A shipped app would decide by who you are: a host opens
 * straight into the console. Until invites and sign-in exist, this is the
 * honest stand-in -- and it is what makes the host artboards reachable, by a
 * person and by the screenshot harness.
 */
export function RoleSwitch() {
  const { tokens } = useTheme();
  const router = useRouter();
  const repo = useRepository();
  const session = useSession();
  const hosts = useHosts();
  const isHost = session.kind === 'host';

  const onPress = async () => {
    if (isHost) {
      await repo.session.becomeGuest();
      router.replace('/chat');
      return;
    }
    const riley = hosts[0];
    if (!riley) return;
    await repo.session.becomeHost(riley.id);
    router.replace('/host/broadcast');
  };

  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID="role-switch" hitSlop={8}>
      <Text style={[s.text, { color: tokens.accent }]}>
        {isHost ? 'Guest view →' : 'Host view →'}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({ text: { fontSize: 12 } });
