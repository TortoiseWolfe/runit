import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useModerationActions } from '@/state/actions';
import { useBlocked } from '@/state/hooks';
import { alpha, border, eyebrow, insetDelta, radius, useTheme, weight } from '@/theme';

/**
 * Managing who you have blocked.
 *
 * A block you cannot undo is a trap, not a control -- a mis-tap on a dense grid
 * would silently remove someone from the album for the rest of the night with no
 * way back. Guideline 1.2 asks only for the ability to block; this exists because
 * the other direction has to work too.
 *
 * The names come from `guest_blocks.blocked_name`, stamped by trigger when the block
 * was made. There is no directory to look them up in -- `guests` has no select policy
 * -- which is exactly why that column exists.
 */
export function BlockedPanel() {
  const { tokens, fade } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const blocked = useBlocked();
  const { unblock } = useModerationActions();

  return (
    <View style={s.wrap}>
      <View
        style={[
          s.header,
          { paddingTop: insets.top + insetDelta.header, borderBottomColor: tokens.base300 },
        ]}
      >
        <Text style={[s.title, { color: tokens.baseContent }]}>Blocked</Text>
        <Pressable
          onPress={() => router.navigate('/photos')}
          accessibilityRole="button"
          accessibilityLabel="Done"
          testID="blocked-done"
          hitSlop={8}
          style={s.done}
        >
          <Text style={[s.doneText, { color: tokens.baseContent }]}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.content} testID="blocked-list">
        <Text style={[s.section, { color: alpha(tokens.baseContent, fade.muted) }]}>
          {blocked.length} blocked
        </Text>

        {blocked.length === 0 && (
          <Text style={[s.empty, { color: alpha(tokens.baseContent, fade.faint) }]}>
            You have not blocked anyone. Blocking hides someone’s photos and song
            requests from you, and nobody is told.
          </Text>
        )}

        {blocked.map((b) => (
          <View
            key={b.guestId}
            testID={`blocked-${b.guestId}`}
            style={[s.row, { borderColor: tokens.base300, backgroundColor: tokens.base200 }]}
          >
            <Text style={[s.name, { color: tokens.baseContent }]} numberOfLines={1}>
              {b.nickname}
            </Text>
            <Pressable
              onPress={() => unblock(b.guestId, b.nickname)}
              accessibilityRole="button"
              accessibilityLabel={`Unblock ${b.nickname}`}
              testID={`unblock-${b.guestId}`}
              style={[s.unblock, { borderColor: tokens.base300 }]}
            >
              <Text style={[s.unblockText, { color: tokens.baseContent }]}>Unblock</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: border,
  },
  title: { fontSize: 19, fontWeight: weight.semibold },
  done: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  doneText: { fontSize: 15, fontWeight: weight.medium },
  content: { padding: 20, gap: 10, paddingBottom: 40 },
  section: { ...eyebrow.card },
  empty: { fontSize: 14, lineHeight: 21, paddingVertical: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    borderWidth: border, borderRadius: radius.selector, paddingVertical: 10, paddingHorizontal: 14,
  },
  name: { flex: 1, fontSize: 15, fontWeight: weight.medium },
  // 36 clears SC 2.5.8 (24, AA) with margin.
  unblock: {
    minHeight: 36, alignItems: 'center', justifyContent: 'center',
    borderWidth: border, borderRadius: radius.field, paddingHorizontal: 14,
  },
  unblockText: { fontSize: 13, fontWeight: weight.medium },
});
