import { createElement } from 'react';
import { View } from 'react-native';

import { alpha, radius, useTheme } from '@/theme';
import type { DateTimeFieldProps } from './DateTimeField';

export { toDateValue, toTimeValue } from './DateTimeField';

/**
 * Web implementation. Metro picks this over `DateTimeField.tsx` for the web bundle, which
 * keeps `@react-native-community/datetimepicker` out of it entirely rather than branching
 * around it at runtime -- the `expo-secure-store` rule: a native module's web build is a stub
 * by DEFAULT, so a shared-code caller throws rather than degrading.
 *
 * A REAL `<input type="date">`, NOT A TEXT BOX. The browser already has a date picker and it
 * is better than anything drawn here: it is localised, keyboard-accessible, and understands
 * the reader's own conventions. React's own `createElement` reaches it -- on web, RN renders
 * through react-dom, so a raw DOM tag is simply a tag. react-native-web's
 * `unstable_createElement` does the same job and is NOT used: it ships no types, so importing
 * it turns this file into `any` and the one gate that would catch a typo here stops working.
 *
 * AND IT KEEPS THE HARNESS DRIVABLE, which is the constraint that decided the shape. The
 * whole e2e suite types into `create-date` with `fill()`, and a native picker is undrivable
 * by Playwright. An `<input type="date">` takes `fill('2026-09-11')` exactly as a text input
 * did, so the suite is unchanged AND the human gets a picker. A React Native modal wrapping a
 * hand-drawn calendar would have improved neither.
 *
 * THE VALUE FORMAT IS THE SAME ON BOTH PLATFORMS and that is not a coincidence: `type="date"`
 * emits `YYYY-MM-DD` and `type="time"` emits `HH:MM`, which are the two shapes `instantFrom`
 * already parses. The DOM agreed with the schema before either of us did.
 */
export function DateTimeField({
  mode, value, onChange, placeholder, accessibilityLabel, testID, minDate,
}: DateTimeFieldProps) {
  const { tokens, fade } = useTheme();

  return (
    <View>
      {createElement('input', {
        type: mode,
        value,
        min: mode === 'date' ? minDate : undefined,
        placeholder,
        'aria-label': accessibilityLabel,
        'data-testid': testID,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        style: {
          // Matched to the text fields beside it by hand, because this element never passes
          // through react-native-web's style resolver -- it is a DOM node.
          boxSizing: 'border-box',
          width: '100%',
          minHeight: 46,
          paddingLeft: 14,
          paddingRight: 14,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: tokens.base300,
          borderRadius: radius.field,
          backgroundColor: tokens.base100,
          color: value ? tokens.baseContent : alpha(tokens.baseContent, fade.faint),
          fontSize: 16,
          fontFamily: 'inherit',
          // Chrome paints the native picker indicator in its own colours; on the dark scheme
          // that is a black glyph on a dark field. `color-scheme` is what tells the browser
          // which set to use, and it is the only way to reach that shadow DOM.
          colorScheme: tokens.base100 === '#1A1A2E' ? 'dark' : 'light',
        },
      })}
    </View>
  );
}

export default DateTimeField;
