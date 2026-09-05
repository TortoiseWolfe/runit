import { RealtimeTable } from './RealtimeTable';
import type { RunitClient } from './client';

/**
 * The race this class exists to close, driven directly.
 *
 * Select-then-subscribe drops every change landing in the gap between the two -- one
 * network round trip. It is invisible when nothing is happening and it is a photo that
 * appears for some guests and not others when a host hits Send while phones are opening.
 * No integration test reproduces that reliably; a fake with a controllable select does
 * it every run.
 *
 * A PURPOSE-BUILT FAKE rather than the shared fixtures/fakeClient, because what matters
 * here is TIMING -- holding the select open while changes arrive -- and putting that
 * machinery in the shared fake would complicate every other test to serve this one.
 */

type Handler = (p: unknown) => void;

class Gate {
  private release!: () => void;
  readonly opened = new Promise<void>((r) => (this.release = r));
  open() { this.release(); }
}

function makeClient(
  rows: Record<string, unknown>[],
  gate?: Gate,
  opts: { failSubscribe?: boolean; failSelect?: boolean } = {},
) {
  let handler: Handler | null = null;
  const state = {
    subscribed: false,
    removed: 0,
    selects: 0,
    /** Order of events, so "subscribe happened first" is observable. */
    order: [] as string[],
    emit: (p: unknown) => handler?.(p),
  };

  const client = {
    from: () => ({
      select: () => {
        const q = {
          eq: () => q,
          then: async (ok: (v: unknown) => unknown) => {
            state.selects++;
            state.order.push('select');
            // The gap. A test emits into it, and start() must not lose those.
            if (gate) await gate.opened;
            // A select that fails AFTER a successful subscribe is its own leak path:
            // the channel is live and start() throws past it.
            if (opts.failSelect) return ok({ data: null, error: { message: 'select refused' } });
            return ok({ data: rows, error: null });
          },
        };
        return q;
      },
    }),
    channel: () => {
      const api = {
        on: (_e: string, _f: unknown, cb: Handler) => {
          handler = cb;
          return api;
        },
        subscribe: (cb: (s: string, e?: unknown) => void) => {
          state.order.push('subscribe');
          if (opts.failSubscribe) {
            // The real client leaves the channel REGISTERED on this branch. The fake
            // must not remove it for the adapter, or the assertion proves nothing.
            cb('CHANNEL_ERROR', new Error('boom'));
            return api;
          }
          state.subscribed = true;
          cb('SUBSCRIBED');
          return api;
        },
      };
      return api;
    },
    removeChannel: async () => {
      state.removed++;
    },
  };
  return { client: client as unknown as RunitClient, state };
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe('ordering', () => {
  it('subscribes before it selects', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await t.start();
    expect(state.order).toEqual(['subscribe', 'select']);
  });
});

describe('the gap between subscribe and select', () => {
  it('does NOT lose a change that arrives while the select is in flight', async () => {
    // THE WHOLE POINT. Without buffering, this insert vanishes: the snapshot that
    // lands afterwards overwrites the map and knows nothing about it.
    const gate = new Gate();
    const { client, state } = makeClient([row('a')], gate);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});

    const started = t.start();
    state.emit({ eventType: 'INSERT', new: row('b') });
    gate.open();
    await started;

    expect(t.all().map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('replays a delete that lands in the gap, so a removed row does not come back', async () => {
    const gate = new Gate();
    const { client, state } = makeClient([row('a'), row('b')], gate);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});

    const started = t.start();
    state.emit({ eventType: 'DELETE', old: { id: 'a' } });
    gate.open();
    await started;

    // The select still returned 'a' -- it was taken before the delete committed. The
    // buffer is what corrects it.
    expect(t.all().map((r) => r.id)).toEqual(['b']);
  });

  it('applies buffered events in arrival order, so the last write wins', async () => {
    const gate = new Gate();
    const { client, state } = makeClient([], gate);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});

    const started = t.start();
    state.emit({ eventType: 'INSERT', new: row('a', { status: 'pending' }) });
    state.emit({ eventType: 'UPDATE', new: row('a', { status: 'approved' }) });
    gate.open();
    await started;

    expect(t.get('a')).toMatchObject({ status: 'approved' });
  });

  it('is idempotent when a buffered event repeats a row the select already returned', async () => {
    const gate = new Gate();
    const { client, state } = makeClient([row('a', { status: 'pending' })], gate);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});

    const started = t.start();
    state.emit({ eventType: 'UPDATE', new: row('a', { status: 'approved' }) });
    gate.open();
    await started;

    expect(t.all()).toHaveLength(1);
    expect(t.get('a')).toMatchObject({ status: 'approved' });
  });
});

describe('deletes carry only the primary key', () => {
  it('keys off `old` and never reads another column from it', async () => {
    // No table here is REPLICA IDENTITY FULL, so Postgres sends only the replica
    // identity. Anything reading old.event_id on a delete gets undefined.
    const { client, state } = makeClient([row('a'), row('b')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await t.start();
    state.emit({ eventType: 'DELETE', old: { id: 'a' } });
    expect(t.all().map((r) => r.id)).toEqual(['b']);
  });

  it('ignores a delete whose key is missing rather than throwing', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await t.start();
    state.emit({ eventType: 'DELETE', old: {} });
    expect(t.all().map((r) => r.id)).toEqual(['a']);
  });
});

describe('a non-default primary key', () => {
  it('keys now_playing by event_id, which has no id column at all', async () => {
    const { client, state } = makeClient([{ event_id: 'e1', title: 'September' }]);
    const t = new RealtimeTable(client, 'now_playing', (r) => r.event_id, null, () => {});
    await t.start();
    expect(t.get('e1')).toMatchObject({ title: 'September' });
    // play_next upserts, so the FIRST call emits INSERT and later ones UPDATE.
    state.emit({ eventType: 'UPDATE', new: { event_id: 'e1', title: 'Superstition' } });
    expect(t.get('e1')).toMatchObject({ title: 'Superstition' });
  });
});

describe('notification', () => {
  it('fires once for the initial load and once per later change', async () => {
    let calls = 0;
    const { client, state } = makeClient([row('a')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => calls++);
    await t.start();
    expect(calls).toBe(1);
    state.emit({ eventType: 'INSERT', new: row('b') });
    expect(calls).toBe(2);
  });

  it('does not fire for a buffered event before the snapshot lands', async () => {
    // A recompute mid-load would publish a half-built state -- an empty photo grid
    // for one frame, which reads as a flash of "nothing here".
    let calls = 0;
    const gate = new Gate();
    const { client, state } = makeClient([row('a')], gate);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => calls++);
    const started = t.start();
    state.emit({ eventType: 'INSERT', new: row('b') });
    expect(calls).toBe(0);
    gate.open();
    await started;
    expect(calls).toBe(1);
  });
});

describe('lifecycle', () => {
  it('start() is idempotent, so a double mount does not open two channels', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await t.start();
    await t.start();
    expect(state.selects).toBe(1);
  });

  it('stop() removes the channel and drops the rows', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await t.start();
    await t.stop();
    expect(state.removed).toBe(1);
    expect(t.all()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ leak paths */

/**
 * A channel that is registered on the client but not referenced by anything is not
 * inert: supabase-js rejoins it on its own backoff -- 1s, 2s, 5s, then every 10s for
 * the life of the process. Eight of those per failed join, and eight more per retry
 * tap. These are the tests the repository-level ones could NOT prove, because
 * `startTables` tears every table down on failure and masks the difference.
 */
describe('a start that fails must not leave a channel behind', () => {
  it('removes the channel when subscribe reports CHANNEL_ERROR', async () => {
    const { client, state } = makeClient([row('a')], undefined, { failSubscribe: true });
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});

    await expect(t.start()).rejects.toThrow();
    expect(state.removed).toBe(1);
  });

  it('removes the channel when the SELECT fails after a good subscribe', async () => {
    // The subtler half: step 2 succeeded, so the channel is live, and step 3 throws
    // straight past it.
    const { client, state } = makeClient([row('a')], undefined, { failSelect: true });
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});

    // NOT `.toThrow()`: a PostgREST failure is a plain `{ message, code }`, not an
    // Error, and `start()` rethrows it as-is. Asserting toThrow() here passes only
    // when the value happens to be an Error, which this one never is.
    await expect(t.start()).rejects.toMatchObject({ message: 'select refused' });
    expect(state.subscribed).toBe(true);
    expect(state.removed).toBe(1);
  });

  it('a failed start can be retried, rather than silently no-opping forever', async () => {
    // `started` was set before the work and never reset, so a second start() returned
    // immediately and the table sat permanently empty while reporting itself alive.
    const { client, state } = makeClient([row('a')], undefined, { failSelect: true });
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await expect(t.start()).rejects.toMatchObject({ message: 'select refused' });

    const good = makeClient([row('a')]);
    const t2 = new RealtimeTable(good.client, 'photos', (r) => r.id, null, () => {});
    await expect(t2.start()).resolves.toBeUndefined();

    // And the failed one really did try again rather than short-circuit.
    await expect(t.start()).rejects.toMatchObject({ message: 'select refused' });
    expect(state.selects).toBe(2);
  });
});

describe('pause vs stop', () => {
  it('pause closes the channel but KEEPS the rows', async () => {
    // Backgrounding. `start()` replaces rows only once its select returns, so keeping
    // them is what stops the first frame after a resume rendering empty.
    const { client, state } = makeClient([row('a'), row('b')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await t.start();

    await t.pause();
    expect(state.removed).toBe(1);
    expect(t.all().map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('stop closes the channel AND clears them — the control', async () => {
    // Without this pair, a `pause` that merely aliased `stop` would pass the test
    // above by never being called at all.
    const { client, state } = makeClient([row('a'), row('b')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await t.start();

    await t.stop();
    expect(state.removed).toBe(1);
    expect(t.all()).toEqual([]);
  });

  it('a paused table can be started again', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => {});
    await t.start();
    await t.pause();
    await t.start();

    expect(state.selects).toBe(2);
    expect(t.all().map((r) => r.id)).toEqual(['a']);
  });
});
