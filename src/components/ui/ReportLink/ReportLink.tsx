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
 *
 * AND ONE COMPONENT, ONE LINK -- which was NOT true until this prop existed. `JoinScreen`
 * hand-rolled the whole control: its own Pressable, its own copy of the string, its own
 * `testID="open-feedback"`, its own a11y label. The docblock above said "one component, one
 * sheet" and was right about the sheet and wrong about the link, because the link was the
 * part nothing forced.
 *
 * THAT DUPLICATE WAS ALSO A LIVE DEFECT, not merely untidy. Its style carried no
 * `paddingVertical` -- it leaned on `hitSlop={10}` for its target, and **react-native-web
 * drops `hitSlop` entirely** (the reason `audit:targets` exists at all). So on the browser
 * route, which is now the route most guests take, the join screen's report control was a
 * ~18pt text line: under WCAG 2.2 SC 2.5.8's 24, on the one screen written for the person
 * who cannot get in. `audit:targets` passed it, correctly and uselessly, because a declared
 * `hitSlop` is what it asks for. Only using this component fixes it, because the padding
 * here is real box.
 */
export interface ReportLinkProps {
  /**
   * Horizontal gutter this control supplies FOR ITSELF, in points.
   *
   * DEFAULT 0, AND THE DIRECTION IS THE WHOLE ARGUMENT. Most parents already pad their
   * content, so 0 is right for them; Photos and Music do not, because this is a sibling of
   * a grid that owns its own padding, and they pass 20.
   *
   * It defaults to the value that FAILS LOUDLY when it is wrong. A forgotten `inset={20}`
   * renders flush at x=0 and the gutter gate reds the board by name. A forgotten
   * `inset={0}` renders a 40pt indent that no gate in this repo can see -- it is not a
   * colour, not a target, not an edge, just wrong. The same trade `audit-native-styles`
   * states outright: never swap a loud failure for a quiet wrong answer.
   */
  inset?: number;
  /**
   * Open the sheet on mount, for somebody who arrived already asking to report.
   *
   * THE BRIDGE PAGE IS WHY THIS EXISTS. `web/i/index.html` is the one surface every new
   * tester passes through and the surface where the 2026-09-11 cohort stopped, and it is a
   * static file with no framework -- it cannot open an in-app sheet. What it can do is link
   * to `/join?report=1`, and `JoinScreen` turns that into this.
   *
   * IT IS A PROP RATHER THAN THIS COMPONENT READING THE PARAM, deliberately. A shared UI
   * component that reaches for `useLocalSearchParams` would carry a route's vocabulary into
   * five screens that have nothing to do with that route -- and the host console, which
   * mounts this on every segment, would start responding to a query string meant for the
   * join screen. The screen that owns the URL reads the URL.
   */
  autoOpen?: boolean;
}

export function ReportLink({ inset = 0, autoOpen = false }: ReportLinkProps) {
  const { tokens, fade } = useTheme();
  const [open, setOpen] = useState(autoOpen);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Tell us something is wrong"
        testID="open-feedback"
        style={[s.wrap, { marginHorizontal: inset }]}
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
   * WHAT MOVED AND WHAT DID NOT. The margin is now the caller's (`inset`), because not
   * every parent needs one -- but `alignSelf` stays here and stays unconditional. It is
   * what stops the box stretching to the full width, and a full-width box is what made the
   * gutter gate unsatisfiable in steps 1 and 2 above. Hand the gutter to the caller; never
   * hand them the thing that makes the gutter measurable.
   *
   * `paddingVertical` is the TARGET, and it replaced a `hitSlop={10}` that
   * react-native-web throws away. 10 + a 16pt line + 10 clears WCAG 2.2 SC 2.5.8 as real
   * box on every platform, which is what `audit:targets` asks for when it says to prefer
   * slop only where a control has no interactive neighbour.
   */
  wrap: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 12,
  },
  link: { fontSize: 13, fontWeight: weight.semibold },
});
