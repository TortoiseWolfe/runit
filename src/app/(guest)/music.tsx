import { StyleSheet, Text, View } from 'react-native';

import { EventHeader } from '@/features/chat/EventHeader';
import { alpha, fade, useTheme } from '@/theme';

/** TODO: artboard 02 Music. Not yet built -- the shell routes here so navigation and
 *  the fidelity harness are exercisable before the screen exists. */
export default function Placeholder() {
  const { tokens } = useTheme();
  return (
    <View style={s.wrap}>
      <EventHeader eyebrow="Requests" />
      <View style={s.body}>
        <Text style={[s.text, { color: alpha(tokens.baseContent, fade.muted) }]}>
          Requests — not built yet
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14 },
});
