import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { zoneLabel } from '@/lib/eventForm';
import { alpha, border, radius, useTheme } from '@/theme';

/**
 * The event's time zone, folded into the line that reads the time back.
 *
 * IT USED TO BE SEVEN PILLS OVER TWO ROWS, permanently open, on both screens that edit
 * an event. That is 91px of a form measured at 1406px against an 874px viewport -- and
 * it bought almost nothing, because `zoneChoices` already resolves and pre-selects THIS
 * PHONE'S zone (`eventForm.ts:36-40`). A host standing at their own venue, which is
 * nearly all of them, was being shown six alternatives they would never touch.
 *
 * The control was also simultaneously too big and too small: seven cities out of the
 * several hundred zones that exist, so a host in Phoenix or Tokyo could not pick theirs
 * at all while a host in New York was given six they did not want.
 *
 * WHY IT SITS ON THE READING LINE RATHER THAN IN A ROW OF ITS OWN. The reading is
 * already the defence against a wrong zone -- it is what catches HOUSE7 holding an
 * 11:13 AM start under a "Doors 7:00 PM" label. The zone is the variable that line
 * interprets, so putting the two together says what they are for. It also costs nothing
 * vertically: the reading row existed already.
 *
 * THE READING STAYS ITS OWN NODE, passed in rather than composed here, because
 * `event-starts-preview` is asserted verbatim by
 * `tests/e2e/host-event-details.spec.ts:114` and appending the zone to it would have
 * quietly changed what that assertion measures.
 *
 * COLLAPSED IS NOT HIDDEN. The current zone is always on screen, in words. What folds
 * away is the list of alternatives -- so nothing about the event's state is concealed,
 * only the means of changing it.
 */
export interface ZonePickerProps {
  /** The date/time reading this zone interprets. Rendered to the left of the control. */
  reading: ReactNode;
  value: string;
  onChange: (zone: string) => void;
  /** From `zoneChoices()` -- the event's own zone, this phone's, then the common list. */
  choices: string[];
  /** `event-zone` or `create-zone`; each pill gets `<prefix>-<IANA name>`. */
  testIDPrefix: string;
}

export function ZonePicker({ reading, value, onChange, choices, testIDPrefix }: ZonePickerProps) {
  const { tokens, fade } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={s.wrap}>
      <View style={s.line}>
        <View style={s.readingSlot}>{reading}</View>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Time zone, ${zoneLabel(value)}. ${open ? 'Hide' : 'Show'} other zones`}
          testID={`${testIDPrefix}-toggle`}
          style={s.trigger}
        >
          <Text style={[s.triggerText, { color: tokens.accent }]} numberOfLines={1}>
            {zoneLabel(value)} {open ? '▴' : '▾'}
          </Text>
        </Pressable>
      </View>

      {open ? (
        <View style={s.zoneRow}>
          {choices.map((z) => {
            const on = z === value;
            return (
              <Pressable
                key={z}
                onPress={() => {
                  onChange(z);
                  // Close on choose. Leaving it open would put the list back between the
                  // reading and the next field, which is the layout this replaced.
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Time zone ${zoneLabel(z)}`}
                testID={`${testIDPrefix}-${z}`}
                style={[
                  s.zone,
                  { borderColor: tokens.base300, backgroundColor: on ? tokens.primary : 'transparent' },
                ]}
              >
                <Text style={[s.zoneText, { color: on ? tokens.primaryContent : tokens.baseContent }]}>
                  {zoneLabel(z)}
                </Text>
              </Pressable>
            );
          })}
          <Text style={[s.note, { color: alpha(tokens.baseContent, fade.faint) }]}>
            The list is short on purpose; your phone&rsquo;s own zone is always first.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  /** Takes the slack so the trigger sits hard right against the gutter. */
  readingSlot: { flex: 1 },
  // 32 tall, over SC 2.5.8's 24 AA minimum. It shares the pills' height so the row does
  // not change height when the list opens beneath it.
  trigger: {
    height: 32, paddingHorizontal: 10, justifyContent: 'center',
    borderRadius: radius.pill,
  },
  triggerText: { fontSize: 13 },
  zoneRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  zone: {
    height: 32, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: border,
    alignItems: 'center', justifyContent: 'center',
  },
  zoneText: { fontSize: 13 },
  note: { fontSize: 11, lineHeight: 16, width: '100%' },
});
