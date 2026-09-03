import { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';

/* eslint-disable no-restricted-imports -- This file, and only this file, picks
   the repository implementation. The ESLint boundary rule exists to stop every
   OTHER file doing it; swapping in a Supabase adapter should be a one-line
   change here and nothing else. */
import { MemoryRepository } from '@/data/memory/MemoryRepository';
import { weddingSeed } from '@/data/memory/fixtures/wedding';
/* eslint-enable no-restricted-imports */

import { RepositoryProvider } from '@/state/RepositoryProvider';
import { ToastProvider } from '@/state/ToastProvider';
import { ThemeProvider, useTheme } from '@/theme';

/**
 * The fidelity harness renders in a browser, where safe-area-context reports
 * zeros -- which would silently collapse every inset the design depends on.
 * Under EXPO_PUBLIC_FIDELITY=1 we inject real iPhone 16 Pro geometry so the web
 * export is measurable against the canvas. 62/34 are measured from
 * design/ios-frame.jsx, not guessed.
 */
const FIDELITY_METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 },
};

function Chrome() {
  const { isDark, tokens, scheme } = useTheme();
  // Mount-gated so the server renders nothing here. Rendering the scheme during
  // static export would emit "light" into the HTML and then "dark" on the
  // client, which is a hydration text mismatch (React #418) -- a warning of our
  // own making, in the console where real errors need to be visible.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <>
      {mounted && process.env.EXPO_PUBLIC_FIDELITY === '1' && (
        <Text testID="scheme-probe" style={{ position: 'absolute', opacity: 0 }}>{scheme}</Text>
      )}
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.base100 },
        }}
      >
        <Stack.Screen name="pricing" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const repository = useMemo(() => MemoryRepository.create(weddingSeed), []);
  const fidelity = process.env.EXPO_PUBLIC_FIDELITY === '1';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider {...(fidelity ? { initialMetrics: FIDELITY_METRICS } : {})}>
        <ThemeProvider>
          <RepositoryProvider repository={repository}>
            <ToastProvider>
              <Chrome />
            </ToastProvider>
          </RepositoryProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
