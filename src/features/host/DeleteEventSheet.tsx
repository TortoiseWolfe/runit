import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { EventDeletionImpact } from '@/data/types';
import { useEventActions } from '@/state/actions';
import { alpha, border, radius, useTheme, weight } from '@/theme';
import { deleteSheetState } from '@/features/session/deletionSentence';
import { eventDeletionSentence } from './eventDeletionSentence';

/**
 * DELETING ONE PARTY AND KEEPING YOUR ACCOUNT -- #73.
 *
 * `create_event` allows TEN events per identity, forever, and nothing frees one. A host who
 * made three to try the app has burned three of her ten permanently; #19 gave her a way to
 * delete EVERYTHING, which is the nuclear option wearing a cap remedy's clothes.
 *
 * IT COUNTS BEFORE IT ASKS, the same contract the account sheet has and for the same reason:
 * what goes is mostly not hers. The one field that is new here is `coHosts`, and it is the
 * one that changes the sentence -- account deletion KEEPS an event somebody else holds a
 * seat at, this TAKES it, because she chose this party by name. A planner and a DJ who have
 * been building a run of show all week are not a detail to leave off.
 *
 * NO BUTTON WHILE THE COUNT IS IN FLIGHT, and none at all if it could not be read. Same
 * three states as the account sheet, decided by the same kind of pure function so that both
 * branches a journey cannot reach are still tested.
 */
export function DeleteEventSheet({
  visible,
  counting,
  counts,
  eventName,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  counting: boolean;
  counts: EventDeletionImpact | null;
  eventName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { tokens, fade } = useTheme();
  const { removeEvent } = useEventActions();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const ok = await removeEvent();
    setBusy(false);
    if (!ok) return;
    onClose();
    onDeleted();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="delete-event-sheet"
    >
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.6) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID="delete-event-backdrop"
      />
      <View style={[s.sheet, { backgroundColor: tokens.base200, borderTopColor: tokens.base300 }]}>
        {/* The event's NAME, because a host with several parties open is one tap from
            deleting the wrong one, and "this event" names nothing. */}
        <Text style={[s.title, { color: tokens.baseContent }]} numberOfLines={2}>
          Delete {eventName}?
        </Text>

        {deleteSheetState({ counting, counts }) === 'counting' ? (
          <Text
            style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}
            testID="delete-event-counting"
          >
            Counting what this would remove…
          </Text>
        ) : counts !== null ? (
          <>
            <Text
              style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}
              testID="delete-event-impact"
            >
              {eventDeletionSentence(counts)}
            </Text>
            <Text style={[s.fine, { color: alpha(tokens.baseContent, fade.soft) }]}>
              Your account and your other events stay. This cannot be undone.
            </Text>
            <Pressable
              onPress={confirm}
              accessibilityRole="button"
              testID="delete-event-confirm"
              style={[s.confirm, { backgroundColor: tokens.error }]}
            >
              <Text style={[s.confirmText, { color: tokens.base100 }]}>
                {busy ? 'Deleting…' : 'Delete this event'}
              </Text>
            </Pressable>
          </>
        ) : (
          <Text
            style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}
            testID="delete-event-unknown"
          >
            We couldn&apos;t work out what this would remove, so we haven&apos;t offered to do
            it. Try again in a moment.
          </Text>
        )}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          testID="delete-event-cancel"
          style={[s.cancel, { borderColor: tokens.base300 }]}
        >
          <Text style={[s.cancelText, { color: tokens.baseContent }]}>Keep this event</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: border, borderTopLeftRadius: radius.box, borderTopRightRadius: radius.box,
    padding: 24, paddingBottom: 40, gap: 12,
  },
  title: { fontSize: 19, fontWeight: weight.semibold },
  body: { fontSize: 14, lineHeight: 20 },
  fine: { fontSize: 12, lineHeight: 18 },
  confirm: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  confirmText: { fontSize: 16, fontWeight: weight.semibold },
  cancel: { height: 48, borderRadius: radius.field, borderWidth: border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15 },
});
