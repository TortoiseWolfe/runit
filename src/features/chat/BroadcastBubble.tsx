import { StyleSheet, Text, View } from 'react-native';

import type { Broadcast } from '@/data/types';
import { formatClock, initialsFor } from '@/lib/format';
import { alpha, border, useTheme, weight } from '@/theme';

/**
 * Canvas: a 32px neutral-filled avatar circle, then meta at 11px/.6 and a
 * base-200 bubble with an asymmetric radius --
 * `border-radius: 1.25rem 1.25rem 1.25rem .35rem` -- the flattened bottom-left
 * corner that points back at the avatar. 20/20/20/5.6 in points.
 */
export function BroadcastBubble({
  broadcast,
  timeZone,
}: {
  broadcast: Broadcast;
  /** The EVENT's zone, not the phone's -- see formatClock. */
  timeZone: string;
}) {
  const { tokens, fade, depth } = useTheme();
  return (
    <View style={s.row}>
      <View style={[s.avatar, { backgroundColor: tokens.neutral }]}>
        <Text style={[s.initials, { color: tokens.neutralContent }]}>
          {initialsFor(broadcast.authorName)}
        </Text>
      </View>
      <View style={s.body}>
        <Text style={[s.meta, { color: alpha(tokens.baseContent, fade.muted) }]}>
          {broadcast.authorName} · {broadcast.authorRoleLabel} · {formatClock(broadcast.createdAt, timeZone)}
        </Text>
        <View style={[s.bubble, { backgroundColor: tokens.base200, borderColor: tokens.base300, boxShadow: depth.plate }]}>
          <Text style={[s.text, { color: tokens.baseContent }]}>{broadcast.body}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 12, fontWeight: weight.semibold },
  body: { maxWidth: '84%' },
  meta: { fontSize: 11, marginBottom: 4, marginLeft: 12 },
  bubble: {
    borderWidth: border,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 5.6,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  text: { fontSize: 15, lineHeight: 21 },
});
