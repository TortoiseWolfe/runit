import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { FeedbackSheet } from '@/features/session/FeedbackSheet';
import { alpha, useTheme, weight } from '@/theme';

/**
 * THE WAY TO SAY SOMETHING IS WRONG, FOR SOMEBODY ALREADY INSIDE THE PARTY -- #77.
 *
 * The join screen's copy of this serves the person who CANNOT GET IN, which is the report
 * this product has most needed since a real party produced zero sign-ins. It does not serve
 * the guest whose photo will not upload or whose song request vanished: they are already
 * through the door and never see that screen again.
 *
 * IT DOES NOT GO IN THE CHAT FOOTER, and that was tried. It displaced "Announcements only ·
 * hosts post here" -- the line that tells a guest why there is no compose box -- and
 * `guest-chat.spec.ts` went red, correctly. A control that has to take something's place is
 * in the wrong place.
 *
 * SO IT SITS AT THE END OF THE TWO TABS WHERE THINGS VISIBLY BREAK. Photos and Music are
 * where a guest notices: the picture did not appear, the song did not show up. Chat is the
 * one tab where a guest expects to be a reader, so a broken thing there looks like a quiet
 * evening rather than a bug.
 *
 * ONE COMPONENT, ONE SHEET. `FeedbackSheet` is unchanged and reused -- a second copy of that
 * form would be a second place the "here is what we are sending" sentence lives, and those
 * two would drift.
 */
export function ReportLink() {
  const { tokens, fade } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Tell us something is wrong"
        hitSlop={10}
        testID="open-feedback"
        style={s.wrap}
      >
        <Text style={[s.link, { color: alpha(tokens.baseContent, fade.soft) }]}>
          Something not right? Tell us →
        </Text>
      </Pressable>
      <FeedbackSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const s = StyleSheet.create({
  /*
   * MARGIN AND `alignSelf`, NOT PADDING, AND IT TOOK TWO GOES TO GET THERE. The gutter gate
   * measures the CONTROL'S OWN BOX -- react-native-web renders this Pressable as a
   * `<button>` and `getBoundingClientRect()` is what the gate reads.
   *
   *   1. padding on the Text  -> the button is still full width. `left 0px / right 0px`.
   *   2. padding on the Pressable -> padding is INSIDE the box, so the button is STILL full
   *      width and still starts at x=0. Same failure, identical message.
   *   3. margin, plus `alignSelf: 'flex-start'` so it stops stretching -> the box itself
   *      begins at 20.
   *
   * The first version carried a comment claiming it had handled exactly this. It had
   * identified the trap and then fixed the wrong element, twice.
   *
   * It is needed at all because this is a sibling of a grid that owns its padding, so it
   * inherits no gutter -- the same trap the retention line beside it hit (FIDELITY note X).
   */
  wrap: {
    alignSelf: 'flex-start',
    marginHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  link: { fontSize: 13, fontWeight: weight.semibold },
});
