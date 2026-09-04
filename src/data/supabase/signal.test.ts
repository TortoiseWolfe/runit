import { RowCache, Signal, setEqual, shallowArrayEqual } from './signal';

/**
 * These tests are about IDENTITY, not values.
 *
 * `useObservable` feeds these straight into `useSyncExternalStore`, which compares
 * snapshots with Object.is. An observable that returns an equal-but-new array on
 * every read re-renders forever, and it presents as jank rather than as a bug --
 * so "the value is right" is not the property worth asserting here.
 */

describe('Signal', () => {
  it('holds one value and returns the same reference between writes', () => {
    const v = { a: 1 };
    const s = new Signal(v);
    expect(s.get()).toBe(v);
    expect(s.get()).toBe(s.get());
  });

  it('notifies subscribers on a real change', () => {
    const s = new Signal(1);
    const seen: number[] = [];
    s.subscribe((n) => seen.push(n));
    s.set(2);
    s.set(3);
    expect(seen).toEqual([2, 3]);
  });

  it('KEEPS THE OLD REFERENCE when the new value is equivalent', () => {
    const first = [{ id: 'a' }];
    const s = new Signal(first, shallowArrayEqual);
    // A realtime patch to an unrelated table recomputes this derivation and hands
    // back a new array of the same rows. If that replaced the snapshot, every
    // screen reading it would re-render for someone else's vote.
    s.set([first[0]!]);
    expect(s.get()).toBe(first);
  });

  it('does not notify when the value is equivalent', () => {
    const first = [{ id: 'a' }];
    const s = new Signal(first, shallowArrayEqual);
    let calls = 0;
    s.subscribe(() => calls++);
    s.set([first[0]!]);
    expect(calls).toBe(0);
    s.set([{ id: 'b' }]);
    expect(calls).toBe(1);
  });

  it('survives a listener unsubscribing itself mid-notify', () => {
    // Set iteration order is live: removing an entry during iteration skips the
    // next one, so one of these two would silently never fire.
    const s = new Signal(0);
    const seen: string[] = [];
    const off1 = s.subscribe(() => {
      seen.push('one');
      off1();
    });
    s.subscribe(() => seen.push('two'));
    s.set(1);
    expect(seen).toEqual(['one', 'two']);
  });
});

describe('shallowArrayEqual', () => {
  it('compares element identity, not contents', () => {
    const a = { id: 'x' };
    expect(shallowArrayEqual([a], [a])).toBe(true);
    // Same CONTENT, different object: unequal on purpose. RowCache is what makes
    // these two the same reference; without it this returning true would hide a
    // real update.
    expect(shallowArrayEqual([a], [{ id: 'x' }])).toBe(false);
  });

  it('is false at different lengths', () => {
    const a = { id: 'x' };
    expect(shallowArrayEqual([a], [a, a])).toBe(false);
    expect(shallowArrayEqual([], [])).toBe(true);
  });
});

describe('setEqual', () => {
  it('compares membership', () => {
    expect(setEqual(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(setEqual(new Set(['a']), new Set(['b']))).toBe(false);
    expect(setEqual(new Set(['a']), new Set(['a', 'b']))).toBe(false);
  });
});

describe('RowCache', () => {
  const cache = () =>
    new RowCache<{ id: string; n: number }>(
      (r) => r.id,
      (a, b) => a.n === b.n,
    );

  it('reuses the previous object when the row has not changed', () => {
    const c = cache();
    const [first] = c.reconcile([{ id: 'a', n: 1 }]);
    const [second] = c.reconcile([{ id: 'a', n: 1 }]);
    expect(second).toBe(first);
  });

  it('replaces the object when a field the UI reads changed', () => {
    const c = cache();
    const [first] = c.reconcile([{ id: 'a', n: 1 }]);
    const [second] = c.reconcile([{ id: 'a', n: 2 }]);
    expect(second).not.toBe(first);
    expect(second!.n).toBe(2);
  });

  it('together with shallowArrayEqual, makes an unchanged list compare equal', () => {
    // This pairing IS the mechanism. Either half alone does nothing.
    const c = cache();
    const a = c.reconcile([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
    const b = c.reconcile([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
    expect(shallowArrayEqual(a, b)).toBe(true);
  });

  it('forgets rows that have gone, so a deleted id cannot resurrect', () => {
    const c = cache();
    const [first] = c.reconcile([{ id: 'a', n: 1 }]);
    c.reconcile([]);
    const [back] = c.reconcile([{ id: 'a', n: 1 }]);
    expect(back).not.toBe(first);
  });
});
