import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNowNext, useSchedule } from '@/state/hooks';
import { alpha, border, useTheme, weight } from '@/theme';

/**
 * Canvas: a base-200 card with a 1rem radius. The summary row carries a green
 * status dot, "Now · <title>", a faded "· Next <title> <time>", and a
 * Full schedule / Hide affordance on the right. Expanding reveals the run of
 * show, past rows at .45 opacity.
 *
 * FIDELITY note B: in the canvas the summary text runs into the affordance at
 * 402pt (visible in design/renders/02-guest-chat.dark.png). The summary takes
 * flex:1 here and the affordance flex:0, which is what the design intends.
 */
export function NowNextCard() {
  const { tokens, fade } = useTheme();
  const [open, setOpen] = useState(false);
  const schedule = useSchedule();
  const { now, next, nowIndex } = useNowNext();

  const muted = alpha(tokens.baseContent, fade.muted);

  return (
    <View style={[s.card, { backgroundColor: tokens.base200, borderColor: tokens.base300 }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="now-next-toggle"
        style={s.summaryRow}
      >
        <Text style={[s.summary, { color: tokens.baseContent }]}>
          <Text style={{ color: tokens.success }}>● </Text>
          <Text style={s.nowWord}>Now</Text>
          <Text> · {now?.title ?? '—'}</Text>
          <Text style={{ color: muted }}>
            {next ? ` · Next ${next.title} ${next.timeLabel ?? ''}` : ' · nothing else tonight'}
          </Text>
        </Text>
        <Text style={[s.toggle, { color: muted }]}>{open ? 'Hide' : 'Full schedule'}</Text>
      </Pressable>

      {/* Past rows use a SINGLE fade level, never a product of two. They used to
          multiply -- fade.past * fade.body and fade.past * fade.muted, i.e. 0.315
          and 0.27 -- which rendered at 1.69:1 and 1.84:1, below even the 3:1
          non-text floor. A product of two ramp levels cannot be fixed by raising
          the ramp: both factors shrink together. One level says "past" well
          enough, and position in the list plus the Now highlight carry the rest.
          design/FIDELITY.md note H. */}
      {open && (
        <View style={s.list}>
          {schedule.map((item, i) => {
            const past = i < nowIndex;
            const current = i === nowIndex;
            return (
              <View key={item.id} style={[s.row, { borderTopColor: tokens.base300 }]}>
                <Text
                  style={[
                    s.time,
                    { color: alpha(tokens.baseContent, past ? fade.past : fade.body) },
                  ]}
                >
                  {item.timeLabel ?? 'TBD'}
                </Text>
                <Text
                  style={[
                    s.rowTitle,
                    {
                      color: alpha(tokens.baseContent, past ? fade.past : 1),
                      fontWeight: current ? weight.semibold : weight.regular,
                    },
                  ]}
                >
                  {item.title}
                </Text>
                <Text
                  style={[
                    s.place,
                    { color: alpha(tokens.baseContent, past ? fade.past : fade.muted) },
                  ]}
                >
                  {item.place}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: border, overflow: 'hidden' },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  summary: { flex: 1, fontSize: 13, lineHeight: 18 },
  nowWord: { fontWeight: weight.bold },
  toggle: { flexGrow: 0, flexShrink: 0, fontSize: 12 },
  list: { paddingHorizontal: 14, paddingBottom: 12, gap: 2 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 7, borderTopWidth: border },
  // 72 not the canvas's 64: at 64 the design itself wraps "11:30 PM" onto two
  // lines (design/renders/03-host-broadcast.*.png). FIDELITY note A.
  time: { width: 72, fontSize: 14, fontVariant: ['tabular-nums'] },
  rowTitle: { flex: 1, fontSize: 14 },
  place: { fontSize: 12 },
});
