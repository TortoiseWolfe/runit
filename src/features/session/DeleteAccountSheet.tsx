import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { DeletionImpact } from '@/data/types';
import { deleteSheetState, deletionSentence } from './deletionSentence';
import { useAccountActions } from '@/state/actions';
import { alpha, border, radius, useTheme, weight } from '@/theme';

/**
 * THE ONLY IRREVERSIBLE CONTROL IN THE PRODUCT -- #19, App Store Guideline 5.1.1(v).
 *
 * IT READS THE COUNTS BEFORE IT OFFERS THE BUTTON, and that is the whole design. The most
 * consequential fact about deleting a host's account is that it destroys HER GUESTS'
 * PHOTOGRAPHS -- third-party content, of identifiable people, taken by people who never
 * agreed to anything of hers. "This cannot be undone" over a number nobody counted is not
 * consent, so `my_deletion_impact()` is asked the moment this opens and the sentence names
 * what it found.
 *
 * A FAILED COUNT DRAWS NO CONFIRM BUTTON. If the impact cannot be read, the sheet says so
 * and offers only Cancel -- offering an irreversible control beside a number that failed to
 * load is how somebody destroys four hundred photographs believing there were none.
 *
 * WHILE IT IS COUNTING THERE IS NO CONTROL AT ALL, rather than a disabled one.
 * `empty-world.spec.ts` asserts `[aria-disabled="true"]` has count 0 across a screen, which
 * is this repo's gate against drawing a door nobody can open -- the same swap `SignInScreen`
 * makes for its resend throttle and `CreateEventScreen` for its submit.
 *
 * IT NAMES WHAT SURVIVES TOO, in both directions. An event with somebody else's seat on it
 * stays with them, and photographs she added to OTHER people's events stay in those albums
 * under her name -- both are things she would otherwise discover afterwards, and one of them
 * is the difference between deleting an account and destroying somebody else's evening.
 */
export function DeleteAccountSheet({
  visible,
  counting,
  counts,
  onClose,
}: {
  visible: boolean;
  /** The count is still in flight. No control is drawn while this is true. */
  counting: boolean;
  /** What deletion would destroy, or null if it could not be read. */
  counts: DeletionImpact | null;
  onClose: () => void;
}) {
  const { tokens, fade } = useTheme();
  const router = useRouter();
  const { deleteAccount } = useAccountActions();
  const [busy, setBusy] = useState(false);

  /*
   * THE COUNT IS THE CALLER'S, and not because of a lint rule -- though the React Compiler
   * rejecting `setState` inside an effect is what forced the question. The load belongs to
   * the TAP that opens this, which is a real event with a real handler, rather than to a
   * render that then corrects itself. It also means this component is a pure reading of
   * three props, so the sentence it prints can be tested without a repository at all.
   */

  const confirm = async () => {
    setBusy(true);
    const ok = await deleteAccount();
    setBusy(false);
    if (!ok) return;
    onClose();
    // `replace`, not `push`: there is nothing to come back to. The world this identity
    // could see is gone, and `/join` is where a person with no event stands.
    router.replace('/join');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="delete-account-sheet"
    >
      <Pressable
        style={[s.backdrop, { backgroundColor: alpha(tokens.neutral, 0.6) }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID="delete-account-backdrop"
      />
      <View style={[s.sheet, { backgroundColor: tokens.base200, borderTopColor: tokens.base300 }]}>
        <Text style={[s.title, { color: tokens.baseContent }]}>Delete your account?</Text>

        {deleteSheetState({ counting, counts }) === 'counting' ? (
          <Text
            style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}
            testID="delete-account-counting"
          >
            Counting what this would remove…
          </Text>
        ) : counts !== null ? (
          <>
            <Text
              style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}
              testID="delete-account-impact"
            >
              {deletionSentence(counts)}
            </Text>
            <Text style={[s.fine, { color: alpha(tokens.baseContent, fade.soft) }]}>
              Photos you added to other people&apos;s events stay in their albums. This cannot
              be undone.
            </Text>
            {counts.eventsDeleted > 0 ? (
              <Text
                style={[s.fine, { color: alpha(tokens.baseContent, fade.soft) }]}
                testID="delete-account-keep-hint"
              >
                To keep an event, add a co-host to it first — it stays with them.
              </Text>
            ) : null}
            <Pressable
              onPress={confirm}
              accessibilityRole="button"
              testID="delete-account-confirm"
              style={[s.confirm, { backgroundColor: tokens.error }]}
            >
              <Text style={[s.confirmText, { color: tokens.base100 }]}>
                {busy ? 'Deleting…' : 'Delete everything'}
              </Text>
            </Pressable>
          </>
        ) : (
          <Text
            style={[s.body, { color: alpha(tokens.baseContent, fade.body) }]}
            testID="delete-account-unknown"
          >
            We couldn&apos;t work out what this would remove, so we haven&apos;t offered to do
            it. Try again in a moment.
          </Text>
        )}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          testID="delete-account-cancel"
          style={[s.cancel, { borderColor: tokens.base300 }]}
        >
          <Text style={[s.cancelText, { color: tokens.baseContent }]}>Keep my account</Text>
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
