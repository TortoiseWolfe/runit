import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { alpha, eyebrow, radius, useTheme } from '@/theme';

/**
 * A section that states what it holds in one line, and opens when you want to change it.
 *
 * THE HOST EVENT SCREEN IS FIVE SCREENS IN A COLUMN. Measured: 1309px against an 874px
 * viewport, of which the event-details form is only 310px. The rest is `who is helping`
 * (241px), `who is invited` (170px), `getting back in` (114px) and the event switcher
 * (142px), all stacked and all permanently open. No amount of spacing work reaches that,
 * because spacing was never the problem -- everything was expanded at once.
 *
 * SAME RULE AS `ZonePicker`, AND IT IS THE ONE THAT MATTERS: collapsed is not hidden.
 * The `summary` says the section's actual STATE in words -- "3 invited", "Nobody yet",
 * "Key issued" -- so nothing about the event is concealed by closing it. What folds away
 * is the means of CHANGING that state, which on a screen a host fills once before doors
 * is the part that does not need to be on screen the whole time.
 *
 * A summary that reads "Invitees" rather than "3 invited" would make this a worse screen
 * than the one it replaces: a host would have to open every section to find out where
 * they were. Pass state, never a restatement of the title.
 */
export interface DisclosureProps {
  /** The eyebrow, e.g. `Who is invited`. Rendered uppercase by `eyebrow.section`. */
  title: string;
  /** The section's STATE in a few words. Always visible. Never a restatement of `title`. */
  summary: string;
  /** `<testID>-toggle` on the row; the body is only in the tree when open. */
  testID: string;
  /** Open on first render. For a section carrying something that must be read once. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Disclosure({ title, summary, testID, defaultOpen = false, children }: DisclosureProps) {
  const { tokens, fade } = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}. ${summary}. ${open ? 'Collapse' : 'Expand'}`}
        testID={`${testID}-toggle`}
        style={s.row}
      >
        <Text style={[s.title, { color: alpha(tokens.baseContent, fade.muted) }]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[s.summary, { color: alpha(tokens.baseContent, fade.body) }]}
          numberOfLines={1}
          testID={`${testID}-summary`}
        >
          {summary}
        </Text>
        <Text style={[s.chev, { color: tokens.accent }]}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? <View style={s.body}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 18 },
  // 44 tall: this is the largest target on the screen after the Save button, and it is
  // what a host hits with a thumb while holding a phone one-handed. Well over SC 2.5.8.
  row: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: radius.field,
  },
  title: { ...eyebrow.section, fontSize: 12, flexShrink: 0 },
  /** Takes the slack and truncates first, so the chevron never leaves the gutter. */
  summary: { fontSize: 13, flex: 1, textAlign: 'right' },
  chev: { fontSize: 13, flexShrink: 0 },
  body: { gap: 8, marginTop: 8 },
});
