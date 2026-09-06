import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { useRepository } from '@/state/RepositoryProvider';
import { useHosts, useSession } from '@/state/hooks';
import { useToast } from '@/state/ToastProvider';
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
  const { show } = useToast();
  const isHost = session.kind === 'host';

  /**
   * GUARDED, because becoming a host is not always allowed.
   *
   * Against the in-memory adapter this always succeeds -- it just switches. Against
   * Supabase it cannot: `is_host` matches `hosts.auth_user_id = auth.uid()`, so a
   * guest tapping this gets a rejection. Unguarded, that is an UNHANDLED PROMISE
   * REJECTION and a button that visibly does nothing, which is the worst of both --
   * the control says "Host view" and the app says nothing at all.
   *
   * Every guest at an event sees this button, so this is not an edge case; it is
   * what nine people out of ten will experience if they tap it.
   */
  const onPress = async () => {
    try {
      if (isHost) {
        await repo.session.becomeGuest();
        router.replace('/chat');
        return;
      }
      const first = hosts[0];
      if (!first) return;
      await repo.session.becomeHost(first.id);
      router.replace('/host/broadcast');
    } catch {
      // ONE CATCH, TWO DIRECTIONS, and it used to say the same sentence for both. A
      // founder tapping "Guest view" was told the console belongs to this event's host,
      // which she is -- the wrong sentence for the wrong failure, and the console has no
      // other door (#37). Going that way cannot fail for a seat reason any more:
      // `becomeGuest` takes a seat if she holds none. So the guest-direction message is
      // about the thing that CAN still fail, which is the request itself.
      //
      // Deliberately not the raw error either way: it names auth_user_id and a policy,
      // which is the right message for a log and the wrong one for a guest at a party.
      show(
        isHost
          ? 'Could not open the guest view. Check your connection and try again.'
          : 'The host console is only available to this event\u2019s host.',
      );
    }
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
