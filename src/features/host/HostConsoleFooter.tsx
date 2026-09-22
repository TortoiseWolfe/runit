import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportLink } from '@/components/ui/ReportLink';
import { border, useTheme } from '@/theme';

/**
 * THE HOST'S WAY TO SAY SOMETHING IS WRONG -- and she had none at all.
 *
 * Five console segments, the shared chrome, the recovery-key block: not one of them carried
 * a report control. Her only route was five steps with an IDENTITY MUTATION in the middle --
 * tap `role-switch`, which calls `becomeGuest()` and lands her on Chat (which deliberately
 * has none), tab to Photos or Music, scroll past the whole grid, tap, then switch back and
 * hope `becomeHost` does not toast a refusal. The person who BUYS this product had the
 * worst path to telling us it was broken.
 *
 * THIS REPO HAD ALREADY WRITTEN THE LESSON DOWN, one control over. `HostConsoleChrome.tsx`
 * says of `ConnectionPill`: "THE HOST NEEDS THIS MOST... a guest-only pill would leave the
 * person who POSTS the announcements without one. That is the shape of #29 and #37: the
 * surface existed everywhere except where the affected person was standing." Feedback was
 * in exactly that state while that comment sat in the file.
 *
 * ONE MOUNT, IN `src/app/host/_layout.tsx`, NOT FIVE.
 *
 * The layout is 23 lines and already mounts `<Toast />`, so this slots between `<Slot />`
 * and the toast and serves every segment at once. Per-segment placement was the obvious
 * alternative and is wrong twice over: it is five copies of one decision, and it would put
 * the control at the END of five different scrolling documents -- which is precisely the
 * "hidden in plain sight" failure this exists to fix. A host who cannot get her broadcast
 * to send should not have to scroll to say so.
 *
 * NOT IN `HostConsoleChrome` EITHER. That is the segment switcher; a report link is not a
 * segment, and putting it there would make it compete with five things a host taps
 * constantly. It also would have displaced something, which is the rule the chat footer
 * broke: "a control that has to take something's place is in the wrong place."
 *
 * IT CLEARS THE TOAST BY CONSTRUCTION, measured rather than hoped. `Toast` floats at
 * `tabBar.contentHeight + max(insets.bottom, tabBarMin) + 29` -- 126pt off the floor on a
 * notched iPhone -- and this bar is ~40pt tall sitting on the floor itself. The host console
 * has no tab bar, so that offset is already generous here; the two cannot meet.
 */
export function HostConsoleFooter() {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="host-footer"
      style={[
        s.bar,
        { paddingBottom: insets.bottom, borderTopColor: tokens.base300 },
      ]}
    >
      {/*
        `inset={20}` because this bar owns no horizontal padding of its own -- the same
        reason Photos and Music pass it. The gutter gate measures the control's own box, so
        a forgotten inset here renders flush at x=0 and reds the board by name.
      */}
      <ReportLink inset={20} />
    </View>
  );
}

const s = StyleSheet.create({
  bar: { borderTopWidth: border },
});
