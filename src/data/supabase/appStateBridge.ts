import { AppState, type AppStateStatus } from 'react-native';

/**
 * Stop paying for a party nobody is looking at.
 *
 * WHY THIS EXISTS. Joining opens eight Realtime channels, and nothing ever closed
 * them: `session.leave()` is the only teardown in the codebase and it has zero
 * production call sites. There was also no `AppState` wiring anywhere, so a phone
 * that joined once kept two timers running for the life of the install --
 * the Realtime socket heartbeat every 25s and GoTrue's refresh ticker every 30s --
 * with the app in the background and the phone in a pocket.
 *
 * That is roughly 104,000 socket frames per month per installed device, from a guest
 * doing nothing at all. Twenty beta testers who joined once ≈ 2 million messages a
 * month, which is the whole free-tier allowance. **The cost scaled with INSTALLS
 * rather than with use**, which is why it tracked handing out builds.
 *
 * It only became reachable on 2026-09-05: before anonymous sign-in was switched on,
 * `signInAnonymously()` threw before `startTables` ever ran.
 *
 * ONE LISTENER PER PROCESS. `SupabaseRepository.create()` is called once by
 * `src/app/_layout.tsx`, but the test suite creates many, so a previous registration
 * is replaced rather than stacked.
 */
export interface AppStateBridgeTarget {
  suspend(): Promise<void>;
  resume(): Promise<void>;
}

type Subscription = { remove(): void };

let current: Subscription | null = null;

export function attachAppStateBridge(target: AppStateBridgeTarget): () => void {
  current?.remove();

  // `background` and `inactive` are BOTH not-active: iOS passes through `inactive`
  // for the app switcher and for an incoming call, and treating only `background`
  // as suspended leaves the socket open for every one of those.
  let wasActive = AppState.currentState === 'active';

  const sub: Subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
    const isActive = next === 'active';
    if (isActive === wasActive) return;
    wasActive = isActive;
    // Fire and forget on purpose: React Native gives no way to hold the app open
    // until a promise settles, and a rejected teardown must not crash the app on
    // its way to the background. Both sides are individually idempotent.
    void (isActive ? target.resume() : target.suspend()).catch(() => undefined);
  });

  current = sub;
  return () => {
    sub.remove();
    if (current === sub) current = null;
  };
}
