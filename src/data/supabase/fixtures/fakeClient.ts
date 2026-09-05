/**
 * A deliberately small stand-in for supabase-js.
 *
 * SCOPE, AND WHY IT IS NARROW. This does NOT reimplement PostgREST. It models exactly
 * the four things that differ between MemoryRepository and SupabaseRepository, which
 * is the only place a test of the adapter can learn anything the in-memory suite does
 * not already know: auth, the shapes an RLS refusal takes, the ordering of the photo
 * upload, and realtime channel lifecycle.
 *
 * CALIBRATED FROM PROVEN BEHAVIOUR, NOT FROM BELIEF. The obvious objection to a fake
 * is that it encodes the author's model, and the author's model is exactly what is
 * wrong. So the response shapes below are the ones `supabase/verify-policies.sql`
 * measured against the real database (lane E, 13/13):
 *
 *   - a refused UPDATE   -> `{ data: [], error: null }`   ZERO ROWS, NO ERROR
 *   - a refused INSERT   -> `{ data: null, error: { code: '42501' } }`  it RAISES
 *   - a duplicate vote   -> 23505, which the composite key makes idempotent
 *   - an unknown code    -> P0002 from join_event
 *   - a rewind           -> P0001 from start_schedule_item
 *
 * The asymmetry between the first two is the entire point: only one of them is loud.
 *
 * WHAT IT CANNOT PROVE, stated so nobody reads a green suite as more than it is: that
 * a column name is spelled right, that a filter selects what we meant, that a policy
 * admits us, or that realtime delivers. Those need a database, which is lane E and the
 * two-devices gate.
 */

type Result = { data: unknown; error: unknown };

/** One recorded operation, so a test can assert on WHAT was sent, not only the reply. */
export interface Op {
  kind: 'select' | 'insert' | 'update' | 'delete' | 'rpc' | 'upload';
  table: string;
  payload?: unknown;
  filters: [string, unknown][];
  selected: boolean;
}

type Responder = (op: Op) => Result | undefined;

/** A thenable builder: every chain method returns `this` and awaiting resolves it. */
class Query implements PromiseLike<Result> {
  constructor(
    private readonly op: Op,
    private readonly resolve: (op: Op) => Result,
  ) {}
  select(): this {
    this.op.selected = true;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.op.filters.push([column, value]);
    return this;
  }
  maybeSingle(): PromiseLike<Result> {
    const r = this.resolve(this.op);
    const rows = (r.data ?? []) as unknown[];
    return Promise.resolve({ data: rows.length > 0 ? rows[0] : null, error: r.error });
  }
  then<A, B>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    err?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.resolve(this.op)).then(ok, err);
  }
}

export interface FakeChannel {
  name: string;
  subscribed: boolean;
  removed: boolean;
  /** Push a postgres_changes payload to this channel's handler. */
  emit(payload: unknown): void;
}

export class FakeClient {
  readonly ops: Op[] = [];
  readonly channels: FakeChannel[] = [];
  /** Set of tables whose select() was called; used to prove subscribe-before-select. */
  readonly order: string[] = [];

  session: unknown = null;
  signInCalls = 0;
  signOutCalls = 0;
  /** Fails the NEXT storage upload, so a failed transfer can be driven. */
  failNextUpload: string | null = null;

  private responders: Responder[] = [];
  private rows = new Map<string, Record<string, unknown>[]>();

  /** Seed what a select() returns for a table. */
  seed(table: string, rows: Record<string, unknown>[]): this {
    this.rows.set(table, rows);
    return this;
  }

  /** Add a rule. First responder to return a Result wins; otherwise defaults apply. */
  on(responder: Responder): this {
    this.responders.push(responder);
    return this;
  }

  private run = (op: Op): Result => {
    this.ops.push(op);
    for (const r of this.responders) {
      const hit = r(op);
      if (hit) return hit;
    }
    if (op.kind === 'select') {
      this.order.push(`select:${op.table}`);
      return { data: this.rows.get(op.table) ?? [], error: null };
    }
    // Default for a write: it worked and returned the row. A test that wants a
    // refusal asks for one explicitly, so no test passes by accident.
    return { data: [{ id: 'row' }], error: null };
  };

  private op(kind: Op['kind'], table: string, payload?: unknown): Query {
    return new Query({ kind, table, payload, filters: [], selected: false }, this.run);
  }

  from(table: string) {
    return {
      select: () => this.op('select', table).select(),
      insert: (payload: unknown) => this.op('insert', table, payload),
      update: (payload: unknown) => this.op('update', table, payload),
      delete: () => this.op('delete', table),
    };
  }

  rpc(name: string, args?: unknown): PromiseLike<Result> {
    return this.op('rpc', name, args);
  }

  auth = {
    getSession: async () => ({ data: { session: this.session }, error: null }),
    signInAnonymously: async () => {
      this.signInCalls++;
      this.session = { user: { id: 'auth-user' } };
      return { data: { session: this.session }, error: null };
    },
    signOut: async () => {
      this.signOutCalls++;
      this.session = null;
      return { error: null };
    },
    // GoTrue's refresh ticker is a 30s interval that runs independently of the
    // Realtime socket, so backgrounding has to stop it separately.
    startAutoRefresh: async () => {
      this.autoRefreshCalls.push('start');
    },
    stopAutoRefresh: async () => {
      this.autoRefreshCalls.push('stop');
    },
  };

  /** `start`/`stop` in call order, for the AppState assertions. */
  autoRefreshCalls: ('start' | 'stop')[] = [];

  /**
   * The socket, which is NOT closed by removeChannel().
   *
   * Modelled because that asymmetry is the whole bug: unsubscribing all eight
   * channels leaves the socket open and heartbeating every 25s forever. Only
   * `realtime.disconnect()` closes it, so a fixture without this cannot tell a fixed
   * adapter from a broken one.
   */
  realtime = {
    disconnect: async () => {
      this.disconnectCalls++;
    },
  };

  disconnectCalls = 0;

  /** Channel names (`runit:<table>`) whose next subscribe must fail. */
  failSubscribeFor = new Set<string>();

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: unknown, opts?: { contentType?: string }) => {
        this.ops.push({
          kind: 'upload', table: bucket, payload: { path, body, opts },
          filters: [], selected: false,
        });
        this.order.push(`upload:${path}`);
        if (this.failNextUpload) {
          const message = this.failNextUpload;
          this.failNextUpload = null;
          return { data: null, error: { message } };
        }
        return { data: { path }, error: null };
      },
    }),
  };

  channel(name: string) {
    let handler: ((p: unknown) => void) | null = null;
    const ch: FakeChannel = {
      name, subscribed: false, removed: false,
      emit: (p) => handler?.(p),
    };
    this.channels.push(ch);
    const api = {
      // `name` is here so removeChannel can match. The real client returns an opaque
      // RealtimeChannel and the adapter hands that same object back; the fake has to
      // preserve that identity or a lifecycle test passes for the wrong reason.
      name,
      on: (_evt: string, _filter: unknown, cb: (p: unknown) => void) => {
        handler = cb;
        return api;
      },
      subscribe: (cb: (status: string, err?: unknown) => void) => {
        this.order.push(`subscribe:${name}`);
        if (this.failSubscribeFor.has(name)) {
          this.failSubscribeFor.delete(name);
          // The real client leaves the channel REGISTERED on this branch, which is
          // exactly what makes an unremoved one rejoin forever. The fake therefore
          // does not mark it subscribed and does not remove it either -- removal has
          // to come from the adapter, or the test proves nothing.
          cb('CHANNEL_ERROR', new Error(`channel ${name} failed`));
          return api;
        }
        ch.subscribed = true;
        // Synchronous SUBSCRIBED. The real client is async, but the ORDER is what is
        // under test and a microtask here would only make the assertion flakier.
        cb('SUBSCRIBED');
        return api;
      },
    };
    return api;
  }

  async removeChannel(ch: unknown): Promise<void> {
    const found = this.channels.find((c) => c === ch || (ch as FakeChannel)?.name === c.name);
    if (found) found.removed = true;
  }

  /** Ops of one kind against one table, for assertions. */
  find(kind: Op['kind'], table: string): Op[] {
    return this.ops.filter((o) => o.kind === kind && o.table === table);
  }
}

/* -------------------------------------------------------- the proven refusal shapes */

/** A refused UPDATE or DELETE: zero rows, NO error. The dangerous one. */
export const refusedSilently = (): Result => ({ data: [], error: null });
/** A refused INSERT: RLS raises. The loud one. */
export const refusedLoudly = (): Result => ({
  data: null,
  error: { code: '42501', message: 'new row violates row-level security policy' },
});
export const pgError = (code: string, message = code): Result => ({
  data: null,
  error: { code, message },
});
