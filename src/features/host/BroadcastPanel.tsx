import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClock } from '@/lib/format';
import { useHostActions } from '@/state/actions';
import { useEvent, useFeed, useNowNext, useSchedule } from '@/state/hooks';
import { alpha, border, eyebrow, fade, radius, useTheme, weight } from '@/theme';

/** Artboard 03, Broadcast segment. */
export function BroadcastPanel() {
  const { tokens } = useTheme();
  const event = useEvent();
  const feed = useFeed();
  const schedule = useSchedule();
  const { nowIndex } = useNowNext();
  const { send, startScheduleItem, addScheduleItem } = useHostActions();
  const [draft, setDraft] = useState('');
  const [pinned, setPinned] = useState(false);

  // Addressed to everyone invited, not just whoever is currently in the room.
  const invited = event?.invitedCount ?? 0;
  const onSend = async () => {
    if (!draft.trim()) return;
    await send(draft, pinned, true);
    setDraft('');
    setPinned(false);
  };

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} testID="host-broadcast">
      <TextInput
        value={draft}
        onChangeText={setDraft}
        multiline
        placeholder={`Announce something to all ${invited} guests…`}
        placeholderTextColor={alpha(tokens.baseContent, fade.faint)}
        accessibilityLabel="Announcement"
        testID="broadcast-draft"
        style={[
          s.textarea,
          { borderColor: tokens.base300, backgroundColor: tokens.base200, color: tokens.baseContent },
        ]}
      />

      <View style={s.pillRow}>
        <Pressable
          onPress={() => setPinned((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ selected: pinned }}
          testID="pin-toggle"
          style={[
            s.pill,
            { borderColor: tokens.base300, backgroundColor: pinned ? tokens.primary : 'transparent' },
          ]}
        >
          <Text style={[s.pillText, { color: pinned ? tokens.primaryContent : tokens.baseContent }]}>
            {pinned ? 'Pinned ✓' : 'Pin to top'}
          </Text>
        </Pressable>
        <View style={[s.pill, { borderColor: tokens.base300 }]}>
          <Text style={[s.pillText, { color: tokens.baseContent }]}>Push notification · on</Text>
        </View>
      </View>

      <Pressable
        onPress={onSend}
        accessibilityRole="button"
        testID="broadcast-send"
        style={[s.send, { backgroundColor: tokens.primary }]}
      >
        <Text style={[s.sendText, { color: tokens.primaryContent }]}>Send to {invited} guests</Text>
      </Pressable>

      <View style={s.sectionHead}>
        <Text style={[s.sectionTitle, { color: alpha(tokens.baseContent, fade.muted) }]}>
          Run of show
        </Text>
        <Pressable onPress={addScheduleItem} accessibilityRole="button" testID="schedule-add">
          <Text style={[s.link, { color: tokens.accent }]}>+ Add</Text>
        </Pressable>
      </View>

      <View style={[s.scheduleCard, { borderColor: tokens.base300 }]}>
        {schedule.map((item, i) => {
          const past = i < nowIndex;
          const current = i === nowIndex;
          return (
            <Pressable
              key={item.id}
              onPress={() => startScheduleItem(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Start ${item.title}`}
              testID={`schedule-${item.id}`}
              style={[
                s.scheduleRow,
                {
                  borderTopColor: tokens.base300,
                  backgroundColor: current ? tokens.base200 : 'transparent',
                  borderTopWidth: i === 0 ? 0 : border,
                },
              ]}
            >
              <Text style={[s.time, { color: alpha(tokens.baseContent, fade.body) }]}>
                {item.timeLabel ?? 'TBD'}
              </Text>
              <Text
                style={[
                  s.scheduleTitle,
                  {
                    color: alpha(tokens.baseContent, past ? fade.past : 1),
                    fontWeight: current ? weight.semibold : weight.regular,
                  },
                ]}
              >
                {item.title}
              </Text>
              <Text style={[s.action, { color: alpha(tokens.baseContent, fade.body) }]}>
                {current ? 'Now' : past ? 'Done' : 'Start →'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[s.helper, { color: alpha(tokens.baseContent, fade.faint) }]}>
        Tap a row when it starts. Guests see “Now / Next” at the top of Chat and get an announcement.
      </Text>

      <Text style={[s.sectionTitle, { color: alpha(tokens.baseContent, fade.muted), marginTop: 8 }]}>
        Sent
      </Text>
      {[...feed].reverse().map((b) => (
        <View
          key={b.id}
          style={[s.sentCard, { backgroundColor: tokens.base200, borderColor: tokens.base300 }]}
        >
          <Text style={[s.sentText, { color: tokens.baseContent }]}>{b.body}</Text>
          <Text style={[s.sentMeta, { color: alpha(tokens.baseContent, fade.soft) }]}>
            {b.authorName} · {formatClock(b.createdAt)} · seen by {b.seenCount}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingVertical: 16, paddingHorizontal: 20, gap: 14 },
  textarea: {
    minHeight: 110, borderRadius: radius.selector, borderWidth: border,
    padding: 14, fontSize: 16, lineHeight: 22, textAlignVertical: 'top',
  },
  pillRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border },
  pillText: { fontSize: 13 },
  send: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 16, fontWeight: weight.semibold },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 },
  sectionTitle: { ...eyebrow.section, fontSize: 12 },
  link: { fontSize: 13 },
  scheduleCard: { borderRadius: radius.selector, borderWidth: border, overflow: 'hidden' },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  // 72 not 64: the design itself wraps "11:30 PM" at 64. FIDELITY note A.
  time: { width: 72, fontSize: 14, fontVariant: ['tabular-nums'] },
  scheduleTitle: { flex: 1, fontSize: 14 },
  action: { fontSize: 12 },
  helper: { fontSize: 12, lineHeight: 18 },
  sentCard: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.selector, borderWidth: border },
  sentText: { fontSize: 14, lineHeight: 20 },
  sentMeta: { fontSize: 11, marginTop: 6 },
});
