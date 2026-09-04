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

function makeClient(rows: Record<string, unknown>[], gate?: Gate) {
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
        subscribe: (cb: (s: string) => void) => {
          state.subscribed = true;
          state.order.push('subscribe');
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
