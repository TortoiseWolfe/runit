import { useMemo, useSyncExternalStore } from 'react';
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
import { flakyTransfer } from '@/data/memory/fixtures/flakyTransfer';
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
/** Never fires: the value is constant, we only need the server/client split. */
const subscribeNever = () => () => {};

const FIDELITY_METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 62, left: 0, right: 0, bottom: 34 },
};

function Chrome() {
  const { isDark, tokens, scheme } = useTheme();
  // Client-only render. The server must emit nothing here: writing the scheme
  // into the static HTML says "light", the client then says "dark", and that is
  // a hydration text mismatch (React #418) -- a warning of our own making, in
  // the console where real errors need to be visible.
  //
  // useSyncExternalStore with differing server/client snapshots is the
  // idiomatic way to express this. A setState-in-effect mount flag does the
  // same job but is exactly what the React Compiler rules reject.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
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
  const fidelity = process.env.EXPO_PUBLIC_FIDELITY === '1';

  /**
   * Opt-in flaky transfer, for the harness only.
   *
   * The in-memory adapter completes a transfer instantly, because nothing is
   * being sent anywhere -- so `uploading` and `failed` are unreachable, and the
   * progress bar and Retry button would ship with nothing able to exercise them.
   * `?flaky=1` injects a transfer that reports progress and fails once.
   *
   * Double-gated on EXPO_PUBLIC_FIDELITY so it cannot be triggered in a real
   * build by anyone who guesses the query string. A deliberately-breaking
   * upload path is a fixture, never a feature.
   */
  const flaky =
    fidelity &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('flaky') === '1';

  const repository = useMemo(
    () =>
      MemoryRepository.create(
        weddingSeed,
        flaky ? { transfer: flakyTransfer({ steps: [0.4], failAttempts: [1] }) } : {},
      ),
    [flaky],
  );

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
