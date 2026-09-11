import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { alpha, radius, useTheme } from '@/theme';

/**
 * A DATE OR A TIME, PICKED RATHER THAN TYPED.
 *
 * The create screen asked a person to type `2026-09-11` and `19:00` into free-text fields,
 * and `instantFrom` parses them with `^\d{4}-\d{2}-\d{2}$` and `^\d{2}:\d{2}$`. That
 * strictness is RIGHT and stays -- `eventForm.ts` says why: "coercing '11/09/2026' into some
 * instant is how an event lands on the wrong evening, and the wrong evening is what a guest's
 * calendar then holds." HOUSE7 held an 11:13 AM start under a "Doors 7:00 PM" label.
 *
 * But strict parsing is a DEFENCE against a bad input, not a substitute for a good one.
 * Nobody thinks in ISO-8601, and most Americans do not think in 24-hour time, so an
 * ordinary `09/11/2026` or `7pm` produced a form that silently refused to make a date.
 *
 * THE VALUE STAYS ISO. This component changes how a value is CHOSEN, never how it is stored
 * or parsed -- `instantFrom`, `wallClockToInstant` and every test around them are untouched.
 * A picker that emitted a different string shape would move the bug rather than fix it.
 *
 * `minimumDate` is where the past-date hole closes. Nothing anywhere -- not the form, not
 * `create_event` -- refused an event in the past, so you could create one for last Tuesday.
 * A floor makes that unrepresentable instead of merely unvalidated.
 */
export interface DateTimeFieldProps {
  mode: 'date' | 'time';
  /** ISO `YYYY-MM-DD` for a date, `HH:MM` (24h) for a time. Empty until chosen. */
  value: string;
  onChange: (next: string) => void;
  /** Shown when `value` is empty, exactly as a placeholder would be. */
  placeholder: string;
  accessibilityLabel: string;
  testID: string;
  /** `YYYY-MM-DD`. Dates before this cannot be chosen. Ignored in time mode. */
  minDate?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The two shapes `instantFrom` accepts, and nothing else may be emitted. */
export const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Read the field's own value back into a Date for the picker's initial position. Falls back
 * to NOW rather than to the epoch -- opening a date picker in 1970 is a small cruelty.
 */
function seed(mode: 'date' | 'time', value: string): Date {
  const now = new Date();
  if (mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y!, m! - 1, d!, 12, 0, 0);
  }
  if (mode === 'time' && /^\d{2}:\d{2}$/.test(value)) {
    const [h, min] = value.split(':').map(Number);
    const at = new Date(now);
    at.setHours(h!, min!, 0, 0);
    return at;
  }
  return now;
}

/** What a person reads in the field. The stored value is ISO; this is not. */
function display(mode: 'date' | 'time', value: string): string | null {
  if (!value) return null;
  const d = seed(mode, value);
  if (mode === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  }
  if (!/^\d{2}:\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
}

export function DateTimeField({
  mode, value, onChange, placeholder, accessibilityLabel, testID, minDate,
}: DateTimeFieldProps) {
  const { tokens, fade } = useTheme();
  const [open, setOpen] = useState(false);
  const shown = display(mode, value);

  const commit = (event: DateTimePickerEvent, picked?: Date) => {
    // ANDROID DISMISSES BY EVENT, iOS BY THE SHEET. `type === 'dismissed'` is Android's
    // cancel; closing the state unconditionally is what keeps iOS's inline spinner from
    // being stuck open. Backing out must not write a value -- a cancel that sets today's
    // date is the app deciding for somebody who declined to.
    setOpen(false);
    if (event.type === 'dismissed' || !picked) return;
    onChange(mode === 'date' ? toDateValue(picked) : toTimeValue(picked));
  };

  return (
    <View>
      {/* A Pressable rather than a disabled-looking field: this OPENS something, and a
          control that looks like a text box but does not take text is its own small lie. */}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={[
          s.field,
          { borderColor: tokens.base300, backgroundColor: tokens.base100 },
        ]}
      >
        <Text
          style={[
            s.text,
            { color: shown ? tokens.baseContent : alpha(tokens.baseContent, fade.faint) },
          ]}
          numberOfLines={1}
        >
          {shown ?? placeholder}
        </Text>
      </Pressable>

      {open ? (
        <DateTimePicker
          value={seed(mode, value)}
          mode={mode}
          display="default"
          onChange={commit}
          minimumDate={mode === 'date' && minDate ? seed('date', minDate) : undefined}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderRadius: radius.field,
    paddingHorizontal: 14,
    // 46 matches the text fields beside it -- this sits in a row with them and a picker
    // that were a different height would read as a different KIND of control.
    minHeight: 46,
    justifyContent: 'center',
  },
  text: { fontSize: 16 },
});
