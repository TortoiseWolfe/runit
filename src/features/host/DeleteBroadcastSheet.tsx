import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Broadcast } from '@/data/types';
import { useHostActions } from '@/state/actions';
import { alpha, border, radius, useTheme, weight } from '@/theme';

/**
 * BEHIND A CONFIRMATION, WHICH THE ✕ ON A SCHEDULE ROW IS NOT -- and the difference is
 * whether anyone has seen it yet.
 *
 * A mistyped run-of-show row is private until the host taps Start. An announcement has
 * already been delivered: it is in the feed on every phone in the room, and `fan_out_push`
 * fired on the INSERT. So the two removals get different treatment, and this is the one
 * that asks.
 *
 * IT SAYS WHAT IT CANNOT DO. `pg_net` is fire-and-forget, so a push that has gone out has
 * gone out -- the notification is on the lock screen and no delete reaches it. #68 asks for
 * exactly this sentence: "the UI should say so rather than implying it can". A confirmation
 * that overstated its own effect would be worse than no confirmation, because the host
 * would stop looking for the guest she needs to correct in person.
 *
 * THE BODY IS QUOTED BACK. The sent list is a column of similar-looking cards and the
 * delete is not undoable, so the sheet names the one being removed rather than asking
 * "delete this announcement?" over whichever card the thumb happened to land on.
 */
export function DeleteBroadcastSheet({
  broadcast,
  onClose,
}: {
  broadcast: Broadcast | null;
  onClose: () => void;
}) {
  const { tokens, fade } = useTheme();
  const { removeBroadcast } = useHostActions();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!broadcast) return;
    setBusy(true);
    const ok = await removeBroadcast(broadcast.id);
    setBusy(false);
    // STAYS OPEN ON A FAILURE. Closing would leave the host looking at the announcement
    // she just asked to remove with nothing having said no -- the silent-refusal shape
    // `assertWrote` exists to turn into a sentence.
    if (ok) onClose();
  };

  return (
    <Modal
      visible={broadcast !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="delete-broadcast-sheet"
    >
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.6) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID="delete-broadcast-backdrop"
      />
      <View style={[s.sheet, { backgroundColor: tokens.base200, borderTopColor: tokens.base300 }]}>
        <Text style={[s.title, { color: tokens.baseContent }]}>Remove this announcement?</Text>
        <Text
          style={[s.quote, { color: tokens.baseContent, borderLeftColor: tokens.base300 }]}
          numberOfLines={3}
        >
          {broadcast?.body ?? ''}
        </Text>
        <Text style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}>
          It disappears from everyone&apos;s Chat tab. {broadcast?.seenCount ?? 0} already read
          it, and a notification that has been sent cannot be taken back — if it matters,
          say so in a new announcement.
        </Text>
        <Pressable
          onPress={confirm}
          disabled={busy}
          accessibilityRole="button"
          testID="delete-broadcast-confirm"
          style={[s.confirm, { backgroundColor: tokens.error }]}
        >
          <Text style={[s.confirmText, { color: tokens.errorContent }]}>
            {busy ? 'Removing…' : 'Remove for everyone'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          testID="delete-broadcast-cancel"
          style={[s.cancel, { borderColor: tokens.base300 }]}
        >
          <Text style={[s.cancelText, { color: tokens.baseContent }]}>Keep it</Text>
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
    padding: 24, paddingBottom: 40, gap: 14,
  },
  title: { fontSize: 19, fontWeight: weight.semibold },
  quote: { fontSize: 14, lineHeight: 20, paddingLeft: 12, borderLeftWidth: 3 },
  body: { fontSize: 14, lineHeight: 20 },
  confirm: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  confirmText: { fontSize: 16, fontWeight: weight.semibold },
  cancel: { height: 48, borderRadius: radius.field, borderWidth: border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15 },
});
