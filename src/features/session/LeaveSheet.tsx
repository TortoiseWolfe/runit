import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSessionActions } from '@/state/actions';
import { alpha, border, radius, useTheme, weight } from '@/theme';

/**
 * The way out of an event, which the app did not have.
 *
 * A guest who joined without the optional host key had no route back: the tab bar offers
 * Chat, Photos and Music; `/join` is unguarded but nothing navigates to it; and the one
 * session control on screen, RoleSwitch, calls becomeHost, fails `is_host` and toasts.
 * Deleting the app was the only exit. That is what this fixes.
 *
 * IT CALLS closeEvent(), NOT leave(), AND THE DIFFERENCE IS THE WHOLE POINT.
 * `join_event` is idempotent on `(event_id, auth_user_id)`, so keeping the anonymous
 * session means re-joining lands on the SAME guests row -- votes, photo attribution and
 * blocks intact. `leave()` signs out, which mints a new auth user, which does not
 * conflict, which INSERTS: the same person twice in the guest list, the first identity
 * orphaned, a second seat against the cap, and an abandoned user Supabase never collects.
 * On a visible button that would be one permanent user per tap.
 *
 * So nothing here is destructive, and the copy does not pretend otherwise. It says the
 * one true consequence -- you need the code again -- and stops.
 */
export function LeaveSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { tokens, fade } = useTheme();
  const { closeEvent } = useSessionActions();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    await closeEvent();
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="leave-sheet"
    >
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.6) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID="leave-sheet-backdrop"
      />
      <View style={[s.sheet, { backgroundColor: tokens.base200, borderTopColor: tokens.base300 }]}>
        <Text style={[s.title, { color: tokens.baseContent }]}>Leave this event?</Text>
        <Text style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}>
          You&apos;ll need the event code to come back in. Your photos, votes and blocks stay
          as they are.
        </Text>
        <Pressable
          onPress={confirm}
          disabled={busy}
          accessibilityRole="button"
          testID="leave-confirm"
          style={[s.confirm, { backgroundColor: tokens.primary }]}
        >
          <Text style={[s.confirmText, { color: tokens.primaryContent }]}>
            {busy ? 'Leaving…' : 'Leave event'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          testID="leave-cancel"
          style={[s.cancel, { borderColor: tokens.base300 }]}
        >
          <Text style={[s.cancelText, { color: tokens.baseContent }]}>Stay</Text>
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
  body: { fontSize: 14, lineHeight: 20 },
  confirm: { height: 52, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  confirmText: { fontSize: 16, fontWeight: weight.semibold },
  cancel: { height: 48, borderRadius: radius.field, borderWidth: border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15 },
});
