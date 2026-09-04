import type { Observable, Unsubscribe } from '../repository';

/**
 * The Supabase side's Signal.
 *
 * Same contract as MemoryRepository's -- hold one value, replace it only in
 * `set()` -- because `useObservable` depends on that: "Requires that an
 * observable's getSnapshot be referentially stable between writes"
 * (src/state/useObservable.ts). `useSyncExternalStore` compares snapshots by
 * IDENTITY, so an observable that builds a fresh array on every `get()` re-renders
 * forever and looks like a performance problem rather than the correctness bug it
 * is. That is the single most likely way this adapter goes wrong.
 *
 * WHAT THIS ADDS over the in-memory one, and why it is needed here rather than
 * there. A realtime patch to ONE table triggers a recompute of every derivation,
 * and most of them will be unchanged. MemoryRepository can shrug that off because
 * its writes are user actions -- a handful per minute. Here the writes are other
 * people's: sixty guests voting means sixty recomputes, and without this guard
 * every one of them replaces all fifteen arrays and re-renders every screen.
 *
 * So `set()` keeps the OLD value when the new one is equivalent. Skipping the
 * notify is not the point -- keeping the old IDENTITY is, because that is what
 * useSyncExternalStore reads.
 */
export class Signal<T> implements Observable<T> {
  private listeners = new Set<(v: T) => void>();

  constructor(
    private value: T,
    /** Defaults to `Object.is`. Pass `shallowArrayEqual` for derived lists. */
    private readonly equal: (a: T, b: T) => boolean = Object.is,
  ) {}

  get(): T {
    return this.value;
  }

  set(next: T): void {
    if (this.equal(this.value, next)) return;
    this.value = next;
    // Copy before iterating: a listener may unsubscribe itself, and mutating a
    // Set mid-iteration silently skips the next entry.
    for (const l of [...this.listeners]) l(next);
  }

  subscribe(listener: (v: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * Element-wise identity comparison.
 *
 * Rows are rebuilt as new objects on every recompute, so this only helps when the
 * rows themselves are reused -- which is exactly what `RowCache` below arranges.
 * The two are a pair; either alone does nothing.
 */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

export function setEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Keeps object identity stable for rows whose content has not changed.
 *
 * Without this, `shallowArrayEqual` never fires: every realtime patch re-maps
 * every row into a fresh object, so a list of twenty unchanged photos compares
 * unequal twenty times over and the whole screen re-renders. With it, a mapped
 * row is reused unless its fields actually differ, so an unrelated table's update
 * costs nothing downstream.
 *
 * `key` must be the row id and `same` must compare every field the UI reads --
 * an under-strict `same` shows stale data, which is far worse than an extra
 * render, so the comparators that use this list their fields explicitly rather
 * than reaching for a generic deep-equal.
 */
export class RowCache<T> {
  private prev = new Map<string, T>();

  constructor(
    private readonly key: (row: T) => string,
    private readonly same: (a: T, b: T) => boolean,
  ) {}

  reconcile(rows: T[]): T[] {
    const next = new Map<string, T>();
    const out = rows.map((row) => {
      const id = this.key(row);
      const old = this.prev.get(id);
      const kept = old !== undefined && this.same(old, row) ? old : row;
      next.set(id, kept);
      return kept;
    });
    this.prev = next;
    return out;
  }
}
