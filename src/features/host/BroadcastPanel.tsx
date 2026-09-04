import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClock } from '@/lib/format';
import { useHostActions } from '@/state/actions';
import { useEvent, useFeed, useNowNext, useSchedule } from '@/state/hooks';
import { alpha, border, eyebrow, radius, useTheme, weight } from '@/theme';

/** Artboard 03, Broadcast segment. */
export function BroadcastPanel() {
  const { tokens, fade } = useTheme();
  const event = useEvent();
  const feed = useFeed();
  const schedule = useSchedule();
  const { nowIndex } = useNowNext();
  const { send, startScheduleItem, restartScheduleItem, addScheduleItem } = useHostActions();
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
        {/* A bare text link is ~15pt tall -- under the 24x24 of WCAG 2.2 SC 2.5.8
            (Target Size (Minimum), Level AA). hitSlop is the right fix here and
            not on the rows above: this link has no interactive neighbour, so RN's
            "z-index of sibling views takes precedence" caveat cannot bite. */}
        <Pressable
          onPress={addScheduleItem}
          accessibilityRole="button"
          accessibilityLabel="Add a run-of-show item"
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          testID="schedule-add"
        >
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
              onLongPress={past ? () => restartScheduleItem(item.id) : undefined}
              accessibilityRole="button"
              accessibilityLabel={`Start ${item.title}`}
              // "Start Ceremony" does not say that it announces to everyone, nor
              // that it cannot be taken back. The hint is where that belongs.
              accessibilityHint={
                past
                  ? `Already ran. Double tap and hold to restart it and move the run of show back for all ${invited} guests.`
                  : `Announces to all ${invited} guests. This cannot be undone.`
              }
              testID={`schedule-${item.id}`}
              style={[
                s.scheduleRow,
                { backgroundColor: current ? tokens.base200 : 'transparent' },
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
  scheduleCard: { borderRadius: radius.selector, borderWidth: border, padding: 4, gap: 6 },
  // Rows are separated deliberately. They used to sit flush inside a card with
  // overflow:'hidden' and no gap, so the nearest thing to the current row was the
  // PAST row -- and tapping that rewound the run of show for every guest. The gap
  // is the fix that hitSlop cannot be: RN's own docs say slop "never extends past
  // the parent view bounds" and that overlaps resolve by sibling z-order, so slop
  // between flush siblings buys ambiguity, not safety.
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderRadius: radius.field },
  // 72 not 64: the design itself wraps "11:30 PM" at 64. FIDELITY note A.
  time: { width: 72, fontSize: 14, fontVariant: ['tabular-nums'] },
  scheduleTitle: { flex: 1, fontSize: 14 },
  action: { fontSize: 12 },
  helper: { fontSize: 12, lineHeight: 18 },
  sentCard: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.selector, borderWidth: border },
  sentText: { fontSize: 14, lineHeight: 20 },
  sentMeta: { fontSize: 11, marginTop: 6 },
});
