import { Pressable, StyleSheet, Text, View } from 'react-native';

import { connectionMessage } from '@/data/repository';
import { useConnection } from '@/state/hooks';
import { useRepository } from '@/state/RepositoryProvider';
import { border, radius, useTheme, weight } from '@/theme';

/**
 * "Reconnecting" / "Not live" — issue #45, and FIDELITY note AP.
 *
 * NOT IN THE CANVAS, because a prototype's socket never dies. A shipped one does: measured
 * twice in ~15 live runs, a host's own announcement never arrived, and every screen went on
 * serving a frozen snapshot with nothing anywhere saying so. `RealtimeTable` had even
 * recorded the reason — `liveError` — and nobody read it.
 *
 * A PILL RATHER THAN A TOAST, and that is forced rather than chosen. Toasts auto-dismiss
 * after 2.2s (`toastMetrics.durationMs`); a connection that has stopped is a standing
 * condition, and a message that removes itself while the condition persists is a worse lie
 * than silence.
 *
 * TAPPABLE ONLY WHEN TAPPING DOES SOMETHING. While `reconnecting` the supervisor is already
 * working through its backoff and a tap would just restart what is running, so it renders as
 * a plain View. At `stale` the budget is spent and nothing further will happen on its own —
 * so it becomes the way back. A control that names a problem and cannot act on it is the
 * shape this repo has closed three times (#29, #37, #24).
 *
 * It is deliberately NOT `disabled` in either state: the house rule reserves that for
 * nothing at all, because react-native-web renders it as `aria-disabled` and
 * `empty-world.spec.ts` asserts a whole screen carries none.
 */
export function ConnectionPill() {
  const { tokens } = useTheme();
  const connection = useConnection();
  const repo = useRepository();

  if (connection === 'live') return null;

  const stale = connection === 'stale';
  const label = connectionMessage(connection);
  const body = (
    <Text
      style={[s.text, { color: stale ? tokens.warningContent : tokens.baseContent }]}
      numberOfLines={1}
    >
      {stale ? 'Not live · tap' : 'Reconnecting…'}
    </Text>
  );

  // `warning` is an existing paired token in both schemes, so lane A's colour parser and
  // lane B's contrast gate are satisfied by construction and no token is hand-edited.
  const skin = stale
    ? { backgroundColor: tokens.warning, borderColor: tokens.warning }
    : { backgroundColor: tokens.base200, borderColor: tokens.base300 };

  return stale ? (
    <Pressable
      onPress={() => void repo.reconnect()}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="connection-pill"
      hitSlop={8}
      style={[s.pill, s.cap, skin]}
    >
      {body}
    </Pressable>
  ) : (
    <View accessibilityLabel={label} testID="connection-pill" style={[s.pill, s.cap, skin]}>
      {body}
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: border,
  },
  // The guest header already carries up to three pills beside a flexing event name.
  cap: { maxWidth: 132 },
  text: { fontSize: 12, fontWeight: weight.medium },
});
