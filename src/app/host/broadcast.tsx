import { StyleSheet, Text, View } from 'react-native';

import { alpha, fade, useTheme } from '@/theme';

/** TODO: artboard 03 Broadcast. Not yet built. */
export default function Placeholder() {
  const { tokens } = useTheme();
  return (
    <View style={s.body}>
      <Text style={[s.text, { color: alpha(tokens.baseContent, fade.muted) }]}>
        Host broadcast — not built yet
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14 },
});
