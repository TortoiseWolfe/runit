import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ReportLink } from '@/components/ui/ReportLink';
import { Toast } from '@/components/ui/Toast';
import { useTheme } from '@/theme';

export default function NotFound() {
  const { tokens } = useTheme();
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={[s.wrap, { backgroundColor: tokens.base100 }]}>
        <Text style={[s.text, { color: tokens.baseContent }]}>This screen doesn&apos;t exist.</Text>
        <Link
          href="/"
          accessibilityRole="link"
          style={[s.link, { color: tokens.accent }]}
        >
          Go home
        </Link>

        {/*
          THE SCREEN NOBODY MEANS TO REACH IS THE ONE WORTH HEARING ABOUT.

          Arriving here means a link was wrong -- a truncated invitation, a stale route, a
          deep link the app did not recognise. That is a defect report by definition, and
          "Go home" throws away the only person who can describe how they got here.

          `inset={20}` is NOT optional on this screen and the reason is worth naming: the
          wrapper is `alignItems: 'center'`, and `ReportLink` carries an unconditional
          `alignSelf: 'flex-start'` (which is what makes its box measurable at all). Those
          two combine to pin it to x=0 -- flush against the edge -- so the gutter gate
          would red the board. This is the default-0 contract working as designed: the
          wrong value fails loudly.
        */}
        <ReportLink inset={20} />
      </View>
      {/*
        WITHOUT THIS THE REPORT SENDS INTO SILENCE. `actions.ts` reports both outcomes
        through the toast -- "Thanks, that went straight to the people who build this" and
        every refusal, including the six-an-hour cap. A screen carrying the control and no
        <Toast/> is a control that swallows its own confirmation, which is the shape of
        every dead button this repo has already closed.
      */}
      <Toast />
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { fontSize: 16 },
  // Padding, not hitSlop: expo-router's Link does not accept hitSlop. 14pt of
  // text + 9pt each way clears SC 2.5.8's 24x24 AA minimum.
  link: { fontSize: 14, paddingVertical: 9, paddingHorizontal: 12 },
});
