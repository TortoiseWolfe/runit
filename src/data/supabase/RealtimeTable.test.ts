import { RealtimeTable, type TableHealth } from './RealtimeTable';
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
  opts: { failSubscribe?: boolean; failSelect?: boolean; closeSubscribe?: boolean } = {},
) {
  let handler: Handler | null = null;
  let status: ((s: string, e?: unknown) => void) | null = null;
  const state = {
    subscribed: false,
    removed: 0,
    selects: 0,
    /** Order of events, so "subscribe happened first" is observable. */
    order: [] as string[],
    emit: (p: unknown) => handler?.(p),
    /**
     * Drive a status the way supabase-js does AFTER the join -- a socket drop, a failed
     * rejoin, a server-side close. The real client keeps calling that callback for the
     * life of the channel, which is exactly the fact the adapter used to ignore.
     *
     * It deliberately does NOT set `removed`: removal has to come from the adapter, or
     * the anti-storm assertion proves nothing. Same rule the failSubscribe branch keeps.
     */
    emitStatus: (s: string, e?: unknown) => {
      state.subscribed = s === 'SUBSCRIBED';
      status?.(s, e);
    },
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
          status = cb;
          if (opts.closeSubscribe) {
            // A CLOSED as the FIRST status: a server-side close, or a socket that dies
            // mid-join. There was no branch for it, so the promise never settled.
            cb('CLOSED');
            return api;
          }
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

/**
 * One construction site for the six-argument constructor.
 *
 * `onHealth` joined `onChange` when a dying channel had to become observable (#45), and
 * threading a sixth argument through twenty-odd call sites is churn that hides the two
 * tests that actually care about it. Defaults are no-ops so every existing assertion keeps
 * its exact meaning.
 */
const make = (
  client: RunitClient,
  cbs: { onChange?: () => void; onHealth?: (h: TableHealth) => void } = {},
  key: (r: { id: string }) => string = (r) => r.id,
) =>
  new RealtimeTable(
    client, 'photos', key as never, null,
    cbs.onChange ?? (() => {}),
    cbs.onHealth ?? (() => {}),
  );

describe('ordering', () => {
  it('subscribes before it selects', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = make(client);
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
    const t = make(client);

    const started = t.start();
    state.emit({ eventType: 'INSERT', new: row('b') });
    gate.open();
    await started;

    expect(t.all().map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('replays a delete that lands in the gap, so a removed row does not come back', async () => {
    const gate = new Gate();
    const { client, state } = makeClient([row('a'), row('b')], gate);
    const t = make(client);

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
    const t = make(client);

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
    const t = make(client);

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
    const t = make(client);
    await t.start();
    state.emit({ eventType: 'DELETE', old: { id: 'a' } });
    expect(t.all().map((r) => r.id)).toEqual(['b']);
  });

  it('ignores a delete whose key is missing rather than throwing', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = make(client);
    await t.start();
    state.emit({ eventType: 'DELETE', old: {} });
    expect(t.all().map((r) => r.id)).toEqual(['a']);
  });
});

describe('a non-default primary key', () => {
  it('keys now_playing by event_id, which has no id column at all', async () => {
    const { client, state } = makeClient([{ event_id: 'e1', title: 'September' }]);
    const t = new RealtimeTable(client, 'now_playing', (r) => r.event_id, null, () => {}, () => {});
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
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => calls++, () => {});
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
    const t = new RealtimeTable(client, 'photos', (r) => r.id, null, () => calls++, () => {});
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
    const t = make(client);
    await t.start();
    await t.start();
    expect(state.selects).toBe(1);
  });

  it('stop() removes the channel and drops the rows', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = make(client);
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
  it('a failed subscribe costs live updates, NOT the data', async () => {
    // THE CONTRACT CHANGED HERE, deliberately, after a device report. start() used to
    // throw on a failed subscribe, which meant the select below it never ran -- so a
    // channel that could not join produced a table with NO ROWS. On a phone that was:
    // zero guests, a broadcast the host had just sent and could not see, and Show QR
    // and Share invite inert because both are `disabled={!event}`.
    //
    // Live updates are an enhancement over a snapshot, not a precondition for one.
    const { client, state } = makeClient([row('a')], undefined, { failSubscribe: true });
    const t = make(client);

    await t.start();

    // The rows are here. That is the whole point.
    expect(t.all()).toHaveLength(1);
    // The dead channel is still removed -- supabase-js would otherwise rejoin it on its
    // own backoff for the life of the process.
    expect(state.removed).toBe(1);
    // And the failure is recorded rather than swallowed, so a frozen table is
    // distinguishable from a healthy one.
    expect(t.liveError).toBeInstanceOf(Error);
  });

  it('removes the channel when the SELECT fails after a good subscribe', async () => {
    // The subtler half: step 2 succeeded, so the channel is live, and step 3 throws
    // straight past it.
    const { client, state } = makeClient([row('a')], undefined, { failSelect: true });
    const t = make(client);

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
    const t = make(client);
    await expect(t.start()).rejects.toMatchObject({ message: 'select refused' });

    const good = makeClient([row('a')]);
    const t2 = new RealtimeTable(good.client, 'photos', (r) => r.id, null, () => {}, () => {});
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
    const t = make(client);
    await t.start();

    await t.pause();
    expect(state.removed).toBe(1);
    expect(t.all().map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('stop closes the channel AND clears them — the control', async () => {
    // Without this pair, a `pause` that merely aliased `stop` would pass the test
    // above by never being called at all.
    const { client, state } = makeClient([row('a'), row('b')]);
    const t = make(client);
    await t.start();

    await t.stop();
    expect(state.removed).toBe(1);
    expect(t.all()).toEqual([]);
  });

  it('a paused table can be started again', async () => {
    const { client, state } = makeClient([row('a')]);
    const t = make(client);
    await t.start();
    await t.pause();
    await t.start();

    expect(state.selects).toBe(2);
    expect(t.all().map((r) => r.id)).toEqual(['a']);
  });
});

/**
 * CHANNEL HEALTH -- issue #45.
 *
 * The subscribe callback used to be a one-shot promise settler: it resolved on SUBSCRIBED,
 * rejected on two error statuses, and after the promise settled every later call was a no-op
 * on an already-settled promise. supabase-js keeps calling it for the life of the channel, so
 * a channel that joined and THEN died produced no observable effect anywhere -- measured twice
 * in ~15 live runs as a host's own announcement never appearing.
 *
 * `CLOSED` had no branch at all, which is a second and worse bug: as the FIRST status it left
 * the promise unsettled forever, so `start()` hung, the select never ran, and a join hung with
 * no timeout and no message.
 */
describe('channel health', () => {
  const health = () => {
    const seen: TableHealth[] = [];
    return { seen, on: (h: TableHealth) => seen.push(h) };
  };

  it('reports live only once the SNAPSHOT is in, not when the channel joins', async () => {
    // ROWS AT THE MOMENT OF THE REPORT, not afterwards. Asserting `h.seen` after `start()`
    // resolves cannot tell the two apart -- both orderings have reported by then. This
    // records what was true WHEN the callback fired, which is the only thing that differs.
    const at: number[] = [];
    let t: RealtimeTable<'photos'>;
    const { client } = makeClient([row('a')]);
    t = make(client, { onHealth: () => at.push(t.all().length) });
    await t.start();

    // Reporting from the SUBSCRIBED callback would announce a healthy table with no rows --
    // the inverse of the bug this fixes.
    expect(at).toEqual([1]);
    expect(t.live).toBe(true);
  });

  it('a CLOSED as the first status settles start() instead of hanging it', async () => {
    const { client } = makeClient([row('a')], undefined, { closeSubscribe: true });
    const t = make(client);

    // Before the CLOSED branch existed this never settled: `await this.subscribed()` hung,
    // startTables' allSettled never settled, and joinAsGuest hung with no message. A jest
    // timeout is what that failure looks like from here.
    await expect(t.start()).resolves.toBeUndefined();
    // And the contract holds: live updates were lost, the DATA was not.
    expect(t.all()).toHaveLength(1);
    expect(t.liveError).toBeInstanceOf(Error);
  });

  it('a channel that dies AFTER joining is reported, torn down, and left restartable', async () => {
    const h = health();
    const { client, state } = makeClient([row('a')], undefined, {});
    const t = make(client, { onHealth: h.on });
    await t.start();
    expect(state.removed).toBe(0);

    state.emitStatus('CHANNEL_ERROR', new Error('socket died'));
    await Promise.resolve();
    await Promise.resolve();

    expect(h.seen).toEqual([{ live: true }, { live: false, error: expect.any(Error) }]);
    expect(t.live).toBe(false);
    // Torn down, or supabase-js rejoins it on its own backoff for the life of the process
    // while we believe we are subscribed.
    expect(state.removed).toBe(1);
    // The rows survive: live updates are an enhancement over a snapshot.
    expect(t.all()).toHaveLength(1);

    // And `started` was reset, so the supervisor's retry is not a silent no-op.
    await t.start();
    expect(state.selects).toBe(2);
    expect(t.live).toBe(true);
  });

  it('reports staying-down once, not once per failed attempt', async () => {
    // TWO FAILED STARTS, not two statuses on one channel: after the first failure the
    // channel is torn down, so a second status on it is stopped by the identity guard and
    // would never reach the transition guard at all. Retrying a table that is already known
    // to be down is the reachable case, and it is what the supervisor does four times.
    const h = health();
    const { client } = makeClient([row('a')], undefined, { failSubscribe: true });
    const t = make(client, { onHealth: h.on });

    await t.start();
    await t.start();

    // Still one outage. Reporting each attempt would re-publish and re-schedule for a
    // condition that has not changed.
    expect(h.seen.filter((x) => !x.live)).toHaveLength(1);
  });

  /**
   * THE IDENTITY GUARD, and the most likely way this whole change goes wrong.
   *
   * `teardownChannel()` nulls `this.channel` BEFORE awaiting `removeChannel(ch)`, so a CLOSED
   * produced by our OWN pause() arrives at a callback that is still holding the old channel.
   * Without `if (ch !== this.channel) return`, backgrounding the app reports eight faults and
   * kicks the reconnect supervisor into retrying channels we deliberately closed.
   */
  it('does NOT report a fault for the CLOSED our own pause() causes', async () => {
    const h = health();
    const { client, state } = makeClient([row('a')]);
    const t = make(client, { onHealth: h.on });
    await t.start();

    await t.pause();
    state.emitStatus('CLOSED');
    await Promise.resolve();

    expect(h.seen.filter((x) => !x.live)).toHaveLength(0);
    expect(t.liveError).toBeNull();
  });
});
