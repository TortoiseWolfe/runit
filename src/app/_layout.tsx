import { useMemo, useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
  type Metrics,
} from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';

/* eslint-disable no-restricted-imports -- This file, and only this file, picks
   the repository implementation. The ESLint boundary rule exists to stop every
   OTHER file doing it; swapping in a Supabase adapter should be a one-line
   change here and nothing else. */
import { MemoryRepository } from '@/data/memory/MemoryRepository';
import { weddingSeed } from '@/data/memory/fixtures/wedding';
import { emptySeed } from '@/data/memory/fixtures/empty';
import { invitedSeed } from '@/data/memory/fixtures/invited';
import { hostingSeed } from '@/data/memory/fixtures/hosting';
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
 *
 * `initialMetrics` ALONE DID NOT DO THIS, AND SAID NOTHING (#7). Read the package:
 * `NativeSafeAreaProvider.web.js` appends a fixed element padded with
 * `env(safe-area-inset-*)`, reads it back on mount and calls `onInsetsChange` --
 * and in a browser those values are ZERO. So the injected metrics were the
 * initial state of a `useState` that was overwritten a tick later, every time.
 * Measured from the pixels before it was measured from the source: the 402x874
 * and 414x896 presets, which inject 62 and 44, both produced a first non-background
 * row at 5pt, and the first container computed `padding-top: 0px`.
 *
 * WHAT THAT COST is the reason this is a note and not a one-liner. Lane D compares
 * `design/renders/` -- drawn from the canvas, whose artboards pad 66/70/28 BECAUSE
 * of the device frame -- against `design/screenshots/`, shot with those insets
 * absent. Every Lane D judgement made before this rested on two images with a
 * systematic ~60pt vertical offset, read as close enough.
 *
 * So the metrics are ALSO pushed straight into the two contexts `useSafeAreaInsets`
 * and `useSafeAreaFrame` actually read, inside the provider, where nothing
 * overwrites them. `initialMetrics` stays because it is correct on native and it is
 * what the first paint uses before the web provider clobbers it.
 */
/** Never fires: the value is constant, we only need the server/client split. */
const subscribeNever = () => () => {};

/**
 * `WIDTHxHEIGHTxTOPxBOTTOM`, defaulting to iPhone 16 Pro -- the geometry
 * design/renders/ was drawn at and Lane B compares against.
 *
 * It is overridable because the App Store screenshot preset renders at 414x896
 * (1242x2688 at 3x, the size Apple's upload panel demands), and 414x896 is an
 * iPhone 11 Pro Max, whose top inset is 44 rather than 62. Injecting 62 into a
 * 414-wide frame put every screen's content ~18pt too high -- riding up under
 * where the status bar belongs, which in a store screenshot reads as an app that
 * ignores the notch.
 */
const FIDELITY_FRAME = (process.env.EXPO_PUBLIC_FIDELITY_FRAME ?? '402x874x62x34')
  .split('x')
  .map(Number);

const FIDELITY_METRICS: Metrics = {
  frame: { x: 0, y: 0, width: FIDELITY_FRAME[0]!, height: FIDELITY_FRAME[1]! },
  insets: { top: FIDELITY_FRAME[2]!, left: 0, right: 0, bottom: FIDELITY_FRAME[3]! },
};

function Chrome() {
  const { isDark, tokens, scheme } = useTheme();
  // Read through the hook every screen reads, not from the constant: this is the value
  // that was silently zero for months (#7), and a probe echoing FIDELITY_METRICS would
  // have agreed with itself the whole time.
  const insets = useSafeAreaInsets();
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
        <>
          <Text testID="scheme-probe" style={{ position: 'absolute', opacity: 0 }}>{scheme}</Text>
          {/*
            THE GATE FOR #7. `initialMetrics` was discarded by the web provider and nothing
            said so, so the harness spent months comparing screenshots taken with no insets
            against renders drawn with them. `pnpm shots` reads this back and fails if it
            does not match the frame the export was built with -- a red gate rather than a
            drift nobody can see.
          */}
          <Text testID="inset-probe" style={{ position: 'absolute', opacity: 0 }}>
            {`${insets.top}x${insets.bottom}`}
          </Text>
        </>
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
   * Boot with NO event, the way a cold open against Supabase actually looks.
   *
   * Same shape as `?flaky=1` above and gated the same way, for the same reason: it is a
   * fixture, not a feature, and it must not exist in a build that did not ask for it.
   * Without this the suite can only render worlds where the data is already there --
   * which is how three inert controls reached a phone.
   */
  const emptyWorld =
    fidelity &&
    typeof window !== 'undefined' &&
    typeof window.location?.search === 'string' &&
    new URLSearchParams(window.location.search).get('empty') === '1';

  /**
   * Boot as a HOST WHO CAME BACK -- two events made, standing in neither (#17).
   *
   * Where every host is the second time she opens the app: the anonymous session persists,
   * so she keeps her identity and loses `event.current`. `weddingSeed` cannot stand in,
   * because there the join screen is an INVITATION and the list is a secondary control;
   * here the list is the only thing on the screen that leads anywhere, which is the state
   * the issue is about.
   */
  const hostingWorld =
    fidelity &&
    typeof window !== 'undefined' &&
    typeof window.location?.search === 'string' &&
    new URLSearchParams(window.location.search).get('hosting') === '1';

  /**
   * Boot with no event but a resolvable INVITATION -- the state a link or a QR puts a
   * guest in, and the only one of the three in which `event.lookUp` does any work.
   *
   * `?empty=1` is the cold open; this is the one step after it. Both had to exist as
   * separate worlds because they differ in exactly the thing under test: with no
   * preview the join screen must fall back to "An event", and with one it must not.
   */
  /**
   * Boot with the live connection already broken -- #45.
   *
   * `MemoryRepository` has no socket, so it is `live` by definition and the connection pill
   * is UNREACHABLE in the only lane that can screenshot it. That is precisely the gap
   * `?empty=1` was added to close: the failure is never "the control is broken", it is "no
   * test can reach the state where the control matters".
   *
   * `stale` rather than `reconnecting` because it is the state with a control on it.
   */
  const staleWorld =
    fidelity &&
    typeof window !== 'undefined' &&
    typeof window.location?.search === 'string' &&
    new URLSearchParams(window.location.search).get('stale') === '1';

  const invitedWorld =
    fidelity &&
    typeof window !== 'undefined' &&
    typeof window.location?.search === 'string' &&
    new URLSearchParams(window.location.search).get('invited') === '1';

  /**
   * The one place an implementation is named.
   *
   * NOT a straight swap, and the reason is worth stating: all 142 e2e runs boot
   * `dist/` against `weddingSeed` through MemoryRepository, with a webServer that
   * only serves static files. Repointing this line unconditionally would make the
   * whole Playwright suite depend on a live network and a seeded database -- so
   * the suite would go from proving the screens to proving nothing, in one commit.
   *
   * So the backend is chosen by env. EXPO_PUBLIC_* is inlined by Metro at bundle
   * time, so a build made without it does not contain the Supabase branch at all;
   * the harness never sets it and keeps its 142 runs unchanged. The honest cost is
   * that those runs then prove nothing about the adapter, which is what the
   * two-devices-on-one-code gate exists to cover -- and issue #20, which is the
   * standing proposal to close it with a throwaway project rather than a device.
   */
  const repository = useMemo(
    () =>
      process.env.EXPO_PUBLIC_BACKEND === 'supabase'
        ? SupabaseRepository.create()
        : MemoryRepository.create(
            // Order matters: `?invited=1` is a strictly more furnished empty world, so
            // it has to be read before the plainer flag can claim the same request.
            // Order matters: each is a strictly more furnished empty world, so the richer
            // flags have to be read before a plainer one claims the same request.
            hostingWorld
              ? hostingSeed
              : invitedWorld
                ? invitedSeed
                : emptyWorld
                  ? emptySeed
                  : weddingSeed,
            {
              ...(flaky ? { transfer: flakyTransfer({ steps: [0.4], failAttempts: [1] }) } : {}),
              ...(staleWorld ? { connection: 'stale' as const } : {}),
            },
          ),
    [flaky, emptyWorld, invitedWorld, staleWorld, hostingWorld],
  );

  const app = (
    <ThemeProvider>
      <RepositoryProvider repository={repository}>
        <ToastProvider>
          <Chrome />
        </ToastProvider>
      </RepositoryProvider>
    </ThemeProvider>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider {...(fidelity ? { initialMetrics: FIDELITY_METRICS } : {})}>
        {/*
          INSIDE the provider, not instead of it: the provider still measures, still
          works on a device, and these two contexts are simply the last word under the
          harness. Anything else -- a CSS variable, a fidelity-only wrapper View --
          would inset the pixels while `useSafeAreaInsets()` kept returning zeros, and
          every screen that adds an inset to its own padding would then be measuring
          the wrong number. See the note above.
        */}
        {fidelity ? (
          <SafeAreaFrameContext.Provider value={FIDELITY_METRICS.frame}>
            <SafeAreaInsetsContext.Provider value={FIDELITY_METRICS.insets}>
              {app}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        ) : (
          app
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
