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
import { SupabaseRepository } from '@/data/supabase/SupabaseRepository';
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
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const fidelity = process.env.EXPO_PUBLIC_FIDELITY === '1';

  /**
   * Opt-in flaky transfer, for verification only.
   *
   * The in-memory adapter completes a transfer instantly, because nothing is
   * being sent anywhere -- so `uploading` and `failed` are unreachable, and the
   * progress bar and Retry button would ship with nothing able to exercise them.
   * This injects a transfer that reports progress and then fails once.
   *
   * TWO TRIGGERS, because one platform each:
   *
   * `EXPO_PUBLIC_FLAKY=1` is the portable one -- Metro inlines EXPO_PUBLIC_* at
   * bundle time, so it reaches the Android and iOS dev clients, and a build made
   * without it does not contain the branch at all. That is the gate: not a
   * runtime check someone could guess past, but an absent code path.
   *
   * `?flaky=1` is web-only and additionally gated on EXPO_PUBLIC_FIDELITY, so the
   * Playwright suite can drive it per-test without restarting Metro. It reads
   * `window.location`, which is why it cannot serve native: React Native defines
   * `window` but not a navigable location, so the query string does not exist
   * there. Verified by trying -- the retry path was invisible on the emulator
   * until the env trigger was added.
   *
   * A deliberately-breaking upload path is a fixture, never a feature.
   */
  const flakyEnv = process.env.EXPO_PUBLIC_FLAKY === '1';
  const flakyQuery =
    fidelity &&
    typeof window !== 'undefined' &&
    typeof window.location?.search === 'string' &&
    new URLSearchParams(window.location.search).get('flaky') === '1';
  const flaky = flakyEnv || flakyQuery;

  /**
   * The one place an implementation is named.
   *
   * NOT a straight swap, and the reason is worth stating: all 98 e2e runs boot
   * `dist/` against `weddingSeed` through MemoryRepository, with a webServer that
   * only serves static files. Repointing this line unconditionally would make the
   * whole Playwright suite depend on a live network and a seeded database -- so
   * the suite would go from proving the screens to proving nothing, in one commit.
   *
   * So the backend is chosen by env. EXPO_PUBLIC_* is inlined by Metro at bundle
   * time, so a build made without it does not contain the Supabase branch at all;
   * the harness never sets it and keeps its 98 runs unchanged. The honest cost is
   * that those runs then prove nothing about the adapter, which is what the
   * two-devices-on-one-code gate exists to cover.
   */
  const repository = useMemo(
    () =>
      process.env.EXPO_PUBLIC_BACKEND === 'supabase'
        ? SupabaseRepository.create()
        : MemoryRepository.create(
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
