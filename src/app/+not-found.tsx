import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

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
      </View>
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
