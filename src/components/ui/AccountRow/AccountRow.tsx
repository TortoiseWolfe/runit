import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DeleteAccountSheet } from '@/features/session/DeleteAccountSheet';
import type { DeletionImpact } from '@/data/types';
import { useAccountActions } from '@/state/actions';
import { useAccount } from '@/state/hooks';
import { alpha, eyebrow, radius, useTheme, weight } from '@/theme';

/**
 * WHO IS SIGNED IN, AND THE TWO WAYS OUT OF IT -- #19.
 *
 * IT DRAWS NOTHING WITHOUT AN ADDRESS, and that is not an empty state -- it is the common
 * case. Nearly everyone who opens this app is a guest, the join screen's fine print promises
 * them "no account, no phone number", and an account row under that sentence would make it
 * read as false to exactly the people it was written for. Same rule `MyEventsList` follows
 * for a person who hosts nothing.
 *
 * IT CROSSES TWO FEATURES, which is this folder's stated bar: the join screen draws it for a
 * host standing outside every event, the console's Event panel for one standing inside one.
 * The same row and the same two controls.
 *
 * DELETE IS A LINK, NOT A BUTTON, and that is deliberate rather than timid. It is the only
 * irreversible control in the product; giving it the same weight as Sign out would put the
 * two a thumb's width apart with nothing but a word between them.
 */
export function AccountRow() {
  const { tokens, fade } = useTheme();
  const email = useAccount();
  const { signOut, impact } = useAccountActions();
  const [deleting, setDeleting] = useState(false);
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<DeletionImpact | null>(null);

  /*
   * THE TAP DOES THE COUNTING, not an effect inside the sheet. The React Compiler rejects
   * `setState` in an effect and it is right to: this is a real event, and the sheet should
   * be a pure reading of what the tap found rather than a render that corrects itself.
   *
   * The sheet opens FIRST and says it is counting. Waiting for the number before showing
   * anything would make an irreversible control feel like a dropped tap, which is how
   * somebody presses it twice.
   */
  const openDelete = async () => {
    setCounts(null);
    setCounting(true);
    setDeleting(true);
    const got = await impact();
    setCounts(got);
    setCounting(false);
  };

  if (!email) return null;

  return (
    <View style={s.wrap} testID="account-row">
      <Text style={[s.eyebrow, { color: alpha(tokens.baseContent, fade.muted) }]}>
        SIGNED IN AS
      </Text>
      <Text style={[s.email, { color: tokens.baseContent }]} numberOfLines={1} testID="account-email">
        {email}
      </Text>

      <View style={s.controls}>
        <Pressable
          onPress={signOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out of this account"
          testID="account-signout"
          style={[s.button, { borderColor: tokens.base300 }]}
        >
          <Text style={[s.buttonText, { color: tokens.baseContent }]}>Sign out</Text>
        </Pressable>

        <Pressable
          onPress={openDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete your account"
          hitSlop={10}
          testID="account-delete"
        >
          <Text style={[s.danger, { color: tokens.error }]}>Delete account…</Text>
        </Pressable>
      </View>

      <DeleteAccountSheet
        visible={deleting}
        counting={counting}
        counts={counts}
        onClose={() => setDeleting(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, paddingVertical: 4 },
  eyebrow: { ...eyebrow.section, fontSize: 11 },
  email: { fontSize: 15, fontWeight: weight.semibold },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  // 36 tall, over SC 2.5.8's 24pt AA minimum with room for the neighbouring link.
  button: {
    height: 36, paddingHorizontal: 14, borderRadius: radius.field, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  buttonText: { fontSize: 14, fontWeight: weight.semibold },
  danger: { fontSize: 13, fontWeight: weight.semibold, paddingVertical: 8 },
});
