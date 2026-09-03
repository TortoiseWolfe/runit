import { useCallback, useSyncExternalStore } from 'react';

import type { Observable } from '@/data/repository';

/**
 * Subscribe a component to a repository observable.
 *
 * Deliberately NOT a store mirror. An earlier plan piped every observable into
 * a global store, but that is a second copy of the same data that can drift,
 * and useSyncExternalStore already gives tearing-free reads straight from the
 * source. The decoupling that matters -- screens never naming an
 * implementation -- comes from the interface, not from the store.
 *
 * Requires that an observable's getSnapshot be referentially stable between
 * writes, which Signal guarantees: it holds one value and replaces it only in
 * set().
 */
export function useObservable<T>(observable: Observable<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) => observable.subscribe(onChange),
    [observable],
  );
  const get = useCallback(() => observable.get(), [observable]);
  return useSyncExternalStore(subscribe, get, get);
}
