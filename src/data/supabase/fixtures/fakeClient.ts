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

import { AuthApiError, AuthRetryableFetchError } from '@supabase/auth-js';
import { TIERS } from '@/domain/tiers';
import type { TierId } from '@/data/types';

type Result = { data: unknown; error: unknown };

/** One recorded operation, so a test can assert on WHAT was sent, not only the reply. */
export interface Op {
  kind: 'select' | 'insert' | 'update' | 'delete' | 'rpc' | 'upload' | 'sign';
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
  /**
   * Drive a subscribe STATUS the way supabase-js does after the join -- a socket drop, a
   * failed rejoin, a server-side close (#45). The real client keeps invoking that callback
   * for the life of the channel, which is the fact the adapter used to ignore.
   *
   * It deliberately does NOT set `removed`: removal has to come from the adapter, or the
   * anti-storm assertion proves nothing. Same rule the failSubscribe branch already keeps.
   */
  push(status: string, err?: unknown): void;
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
  /** Fails the NEXT anonymous sign-in, so a provider outage can be driven. */
  failNextSignIn: unknown = null;
  /** What getSession() reports beside a null session -- a refresh that died. */
  sessionError: unknown = null;

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
    /**
     * `photos` INSERT MODELS THE TRIGGER (#50), and this fixture otherwise models nothing.
     *
     * CLAUDE.md is blunt that `FakeClient` "records what was sent and never evaluates it",
     * and that is still true everywhere else. This one exception exists because the client
     * stopped PREDICTING a photo's moderation state and started reading it back off the
     * inserted row -- so a fake that answers `{id:'row'}` with no status makes every upload
     * throw, and a fake that echoes the payload would answer with a status the real
     * database ignores. Either would be a test agreeing with itself.
     *
     * The rule is `set_photo_status`: the EVENT'S TIER decides, and the uploader has no
     * say. Read from the same `TIERS` table the migration's seed is drift-checked against.
     */
    if (op.kind === 'insert' && op.table === 'photos') {
      const ev = (this.rows.get('events') ?? [])[0] as { tier?: TierId } | undefined;
      const moderated = TIERS[ev?.tier ?? 'house_party'].features.photoModeration;
      return { data: [{ id: 'row', status: moderated ? 'pending' : 'approved' }], error: null };
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
    getSession: async () => ({ data: { session: this.session }, error: this.sessionError }),
    signInAnonymously: async () => {
      this.signInCalls++;
      if (this.failNextSignIn) {
        const error = this.failNextSignIn;
        this.failNextSignIn = null;
        // The real client's failure shape. The success shape below also gains the
        // `user` it always omitted -- this fixture is calibrated from proven
        // behaviour, so both are corrected together.
        return { data: { user: null, session: null }, error };
      }
      this.session = { user: { id: 'auth-user' } };
      return { data: { user: { id: 'auth-user' }, session: this.session }, error: null };
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
  /**
   * Channel names whose next subscribe reports CLOSED as its FIRST status.
   *
   * Kept apart from `failSubscribeFor` because the shapes differ where it matters: a
   * CHANNEL_ERROR was always handled, and CLOSED had no branch at all -- it left the
   * promise unsettled, so `start()` hung and a join hung with it, silently and forever.
   */
  closeSubscribeFor = new Set<string>();

  /** Paths whose next signing must come back refused, as RLS would refuse a pending photo. */
  refuseSignFor = new Set<string>();

  storage = {
    from: (bucket: string) => ({
      /**
       * THE MINIMUM HONEST MODEL of `createSignedUrls` (#10).
       *
       * It records the call and fabricates a URL per path. It does NOT evaluate the
       * storage policies -- nothing here could, and pretending to would be worse than
       * not modelling it, because a test would then be asserting this file's opinion of
       * `event_photos_select` rather than Postgres's. That policy is Lane E's job and
       * Lane E now covers it.
       *
       * What it DOES model faithfully is the response shape, which is the part an adapter
       * gets wrong: per-path failures arrive INSIDE a 200 as `{ error, path, signedUrl }`
       * entries, not as a top-level error.
       */
      createSignedUrls: async (paths: string[], expiresIn: number) => {
        this.ops.push({
          kind: 'sign', table: bucket, payload: { paths, expiresIn },
          filters: [], selected: false,
        });
        // RETURNED IN A DIFFERENT ORDER THAN REQUESTED, deliberately. The API promises no
        // correspondence between the request array and the response array -- every entry
        // carries its own `path` for exactly that reason. Returning them in order would
        // make an adapter that zips by INDEX pass this fake and hand one photo's URL to
        // another photo's tile in production. Reversing is the cheapest way to make the
        // fake refuse to hide that bug.
        return {
          data: [...paths].reverse().map((path) =>
            this.refuseSignFor.has(path)
              ? { path, signedUrl: null, error: 'Object not found' }
              : { path, signedUrl: `https://fake.test/${path}?token=${paths.length}`, error: null },
          ),
          error: null,
        };
      },
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
    let status: ((s: string, e?: unknown) => void) | null = null;
    const ch: FakeChannel = {
      name, subscribed: false, removed: false,
      emit: (p) => handler?.(p),
      push: (s, e) => {
        ch.subscribed = s === 'SUBSCRIBED';
        status?.(s, e);
      },
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
        status = cb;
        if (this.closeSubscribeFor.has(name)) {
          this.closeSubscribeFor.delete(name);
          cb('CLOSED');
          return api;
        }
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

/* ------------------------------------------------------------- auth failure shapes */

/**
 * REAL auth errors, from the vendor's own classes -- NOT object literals.
 *
 * This is the load-bearing detail of the whole auth-error change. The adapter
 * discriminates on the `__isAuthError` brand, which only the real constructors set.
 * A literal `{ code: 'anonymous_provider_disabled', status: 422 }` would fail that
 * predicate, so a test built on one would go GREEN while the device still fell
 * through to "Could not join. Try again." That is precisely the
 * green-suite-broken-app failure this fixture's docblock is written against.
 *
 * Imported from `@supabase/auth-js` rather than `@supabase/supabase-js`, because the
 * latter re-exports these at runtime but NOT in its type declarations. Test-only, and
 * safe to reach for undeclared: supabase-js pins auth-js EXACTLY ("2.115.0", no
 * caret), so it cannot drift underneath us. Deliberately NOT added to package.json --
 * node-linker=hoisted would make an explicit declaration win the hoist and freeze the
 * copy while supabase-js moved on, which is the same quiet-wrong-answer trade
 * CLAUDE.md rejects for the React Native colour parser.
 */
export const authApiError = (code: string, status = 400) => new AuthApiError(code, status, code);
/** A dead socket. Carries NO `code` at all -- which is why the adapter reads `name`. */
export const authOffline = () => new AuthRetryableFetchError('Network request failed', 0);
