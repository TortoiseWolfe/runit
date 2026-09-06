import type {
  RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient,
} from '@supabase/supabase-js';

import type { RunitClient } from './client';
import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
type TableName = keyof Tables;
type RowOf<T extends TableName> = Tables[T]['Row'];

/**
 * One table's rows, seeded by a select and kept live by a Realtime channel.
 *
 * THE RACE THIS EXISTS TO AVOID. The obvious order is select-then-subscribe, and
 * it drops every change that lands in the gap between the two -- a window of one
 * network round trip. At a quiet moment that is invisible. At the moment a host
 * hits Send while sixty phones are opening, it is a photo that never appears for
 * some guests and does for others, with nothing in any log.
 *
 * So the order here is: subscribe, BUFFER, select, then replay the buffer over the
 * snapshot. Anything that arrived during the select is applied after it, in order,
 * and an event for a row the select already returned is idempotent because both
 * paths key by primary key. The cost is a few queued objects; the alternative is a
 * bug that only reproduces under load.
 *
 * DELETE PAYLOADS ARE NOT FULL ROWS. Postgres sends only the replica identity --
 * by default the primary key -- so `payload.old` has the key columns and nothing
 * else. Anything reading `old.event_id` on a delete gets undefined. This class
 * only ever reads the key from `old`, which is why the key extractor is a
 * constructor argument rather than assumed to be `id`: `now_playing` is keyed by
 * `event_id`, and `song_votes` by a composite.
 */
/**
 * What a table reports about its own channel -- #45.
 *
 * A discriminated union rather than `Error | null`, so a caller cannot read "no error" as
 * "healthy" on a table that has never started.
 */
export type TableHealth = { live: true } | { live: false; error: Error };

export class RealtimeTable<T extends TableName> {
  private rows = new Map<string, RowOf<T>>();
  private channel: RealtimeChannel | null = null;
  private buffer: RealtimePostgresChangesPayload<RowOf<T>>[] | null = null;
  private started = false;

  /**
   * `null` until the first report, which is what makes the transition guard work in BOTH
   * directions: the first failure and the first success each notify once, and a burst of
   * repeats notifies nobody. A plain boolean seeded `false` would swallow the first
   * failure -- it would look like "already down".
   */
  private healthy: boolean | null = null;

  constructor(
    private readonly client: RunitClient,
    private readonly table: T,
    /** Primary key. Not always `id` -- now_playing is keyed by event_id. */
    private readonly key: (row: RowOf<T>) => string,
    /** PostgREST filter, e.g. `event_id=eq.<uuid>`. Applied to BOTH select and channel. */
    private readonly filter: { column: string; value: string } | null,
    /** Called after any change, including the initial load. */
    private readonly onChange: () => void,
    /**
     * Called when the CHANNEL's health changes -- on transitions only, never on every event.
     *
     * A SECOND CALLBACK RATHER THAN AN ARGUMENT ON `onChange`, and the difference matters.
     * `onChange` is wired straight to `SupabaseRepository.recompute`, which is also called
     * from about twenty other sites; giving it a parameter would mean either `recompute`
     * branches on why it was called -- collapsing "the rows moved" and "the channel died"
     * into one wire, which is the defect this exists to fix -- or the argument is ignored,
     * and TypeScript would not complain, because a function taking fewer arguments satisfies
     * the wider type. That is the same shape as the `push` boolean this repo already deleted.
     *
     * Required, not optional: an optional health callback is an opt-out, and the eight
     * production sites already share one `onChange` reference. They share this one too.
     */
    private readonly onHealth: (h: TableHealth) => void,
  ) {}

  /** Whether this table's channel is currently delivering. */
  get live(): boolean {
    return this.healthy === true;
  }

  /**
   * The same client with its schema types dropped, for exactly one call.
   *
   * supabase-js's fluent builder cannot resolve a GENERIC table name: `from(T)`
   * where T is a type parameter fails to distribute over the table union and
   * collapses to `SelectQueryError`. The safety that matters here is at the
   * `RowOf<T>` boundary below -- the builder is only being asked for `select('*')`
   * with an optional `eq`, which has no schema-dependent surface to get wrong.
   */
  private get loose(): SupabaseClient {
    return this.client as unknown as SupabaseClient;
  }

  all(): RowOf<T>[] {
    return [...this.rows.values()];
  }

  get(id: string): RowOf<T> | undefined {
    return this.rows.get(id);
  }

  /**
   * Why the channel last failed, when it did. Null while live.
   *
   * Kept rather than swallowed: a table serving a frozen snapshot looks identical to a
   * healthy one, and the difference matters to anyone debugging "why is nothing updating".
   *
   * IT HAD NO READER FOR MONTHS, and this docblock used to say "Nothing renders it yet --
   * surfacing it is a UI decision, not this class's". That deferral is what made #45
   * undiagnosable: the one fact that explains a frozen screen was recorded and nobody
   * looked. It is written on every terminal status now, not only at join time, and the
   * supervisor in SupabaseRepository reads it.
   */
  liveError: Error | null = null;

  /**
   * THE ONE PLACE A TABLE GOES DOWN. Both the join-time failure and a channel that dies
   * later come through here, so the teardown, the `started` reset and the report cannot
   * drift apart -- they used to be a `catch` block that only the first case reached.
   */
  private async fail(e: unknown): Promise<void> {
    this.liveError = e instanceof Error ? e : new Error(String(e));
    this.started = false;
    // THE BUFFER IS NOT TOUCHED HERE, and that is not an omission. On the join-time path
    // `start()` is still running: it goes on to select and then replays `this.buffer`, so
    // nulling it here made that replay throw on `null`. Post-join the buffer is already
    // null. The buffer belongs to start()'s flow; this method owns health and teardown.
    // The anti-storm teardown, unchanged in intent and now reaching the case it never
    // did: a channel that dies AFTER joining was previously left registered, so
    // supabase-js kept rejoining it on its own backoff while we knew nothing about it.
    await this.teardownChannel();
    if (this.healthy === false) return;
    this.healthy = false;
    this.onHealth({ live: false, error: this.liveError });
  }

  /**
   * Reported at the END of `start()`, never from the SUBSCRIBED callback.
   *
   * A channel is joined before its snapshot has returned. Publishing "live" there would
   * announce a healthy table that has no rows yet -- the inverse of the bug this fixes.
   */
  private up(): void {
    this.liveError = null;
    if (this.healthy === true) return;
    this.healthy = true;
    this.onHealth({ live: true });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      // 1. Buffer opens BEFORE the channel, so nothing can arrive unbuffered.
      this.buffer = [];

      // 2. Subscribe and wait for the server to confirm. `subscribe()` resolves its
      //    callback with SUBSCRIBED only once the channel is actually joined --
      //    selecting before that point reopens the very gap this avoids.
      //
      //    BUT A FAILURE HERE MUST NOT COST THE SNAPSHOT, and it used to. This
      //    `await` threw, `start()` unwound, and the select below never ran -- so a
      //    channel that could not subscribe produced a table with NO ROWS rather than
      //    rows that merely stopped updating. On a real phone that presented as: zero
      //    guests, a broadcast the host had just sent and could not see, and `Show QR`
      //    and `Share invite` doing nothing at all -- because both are
      //    `disabled={!event}`, and `event` comes from a table that never loaded.
      //    Every one of those symptoms, from one channel that did not join.
      //
      //    Live updates are an ENHANCEMENT over a snapshot. They are not a precondition
      //    for having one, and treating them as one turns a degraded connection into a
      //    blank app. So a failed subscribe is recorded and the select proceeds.
      let live = true;
      try {
        await this.subscribed();
      } catch (e) {
        live = false;
        // `fail()` owns the teardown, the `started` reset and the report. It is called
        // here and from the post-join branch of the status callback, so the two paths
        // cannot drift.
        await this.fail(e);
      }

      // 3. Now the snapshot. Any change from here on is in the buffer.
      const query = this.loose.from(this.table).select('*');
      const { data, error } = await (this.filter
        ? query.eq(this.filter.column, this.filter.value)
        : query);
      if (error) throw error;

      this.rows = new Map(((data ?? []) as RowOf<T>[]).map((r) => [this.key(r), r]));

      // 4. Replay. An event for a row the select already returned is idempotent:
      //    both paths write the same map under the same key. When the channel never
      //    joined the buffer is empty, so this is a no-op rather than a special case.
      const queued = this.buffer;
      this.buffer = null;
      for (const p of queued) this.apply(p);

      // `started` stays FALSE when there is no channel, so a later start() -- an app
      // returning to the foreground, or the reconnect supervisor -- retries the
      // subscription instead of being a silent no-op on a table showing a frozen snapshot.
      this.started = live;
      // Only now, with the snapshot in hand. `fail()` has already reported the other case.
      if (live) this.up();

      this.onChange();
    } catch (e) {
      // FAILING HALFWAY USED TO LEAK A LIVE CHANNEL. Step 2 can succeed and step 3
      // still throw, which left a subscribed channel registered on the client with
      // nothing holding a reference to it -- supabase-js then rejoins it on its own
      // backoff for the life of the process. `started` is reset too: leaving it true
      // makes a later start() a silent no-op, so the table would sit permanently
      // empty while reporting itself alive.
      this.started = false;
      this.buffer = null;
      await this.teardownChannel();
      throw e;
    }
  }

  /**
   * Close the channel but KEEP the rows, for backgrounding.
   *
   * `stop()` clears the rows because it ends a session. Pausing must not: `start()`
   * only replaces `this.rows` once its select has returned, so keeping them here is
   * what stops the first frame after a resume flashing empty.
   */
  async pause(): Promise<void> {
    this.started = false;
    this.buffer = null;
    await this.teardownChannel();
  }

  /**
   * Remove the channel from the client, not merely drop the reference.
   *
   * `removeChannel()` is the only thing that unsubscribes it. A channel that is
   * merely dereferenced stays registered and keeps being rejoined.
   */
  private async teardownChannel(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    if (ch) await this.client.removeChannel(ch);
  }

  private subscribed(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ch = this.client.channel(`runit:${this.table}`);
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: this.table,
          ...(this.filter ? { filter: `${this.filter.column}=eq.${this.filter.value}` } : {}),
        },
        (payload) => {
          const p = payload as RealtimePostgresChangesPayload<RowOf<T>>;
          if (this.buffer) this.buffer.push(p);
          else if (this.apply(p)) this.onChange();
        },
      );
      // REGISTERED BEFORE subscribe(), not after. The failure branch below has to be
      // able to remove this channel, and subscribe() may invoke its callback before
      // the assignment that used to sit at the end of this function ever ran.
      this.channel = ch;

      // THE CALLBACK STAYS LIVE FOR THE CHANNEL'S LIFETIME (#45). It used to be a one-shot
      // promise settler: `SUBSCRIBED` resolved, the two error statuses rejected, and after
      // the promise settled every later call was a no-op on an already-settled promise. But
      // supabase-js keeps invoking this -- for a socket drop, a failed rejoin, a server-side
      // close -- so a channel that joined and THEN died produced no observable effect
      // anywhere. Measured twice in ~15 live runs: a host's own announcement never appeared.
      let settled = false;
      ch.subscribe((status, err) => {
        // THE IDENTITY GUARD, and it is the most load-bearing line in this file.
        //
        // `teardownChannel()` nulls `this.channel` BEFORE awaiting `removeChannel(ch)`, so a
        // `CLOSED` produced by OUR OWN pause()/stop()/fail() arrives here afterwards. Without
        // this line, backgrounding the app would report eight faults and kick the reconnect
        // supervisor into retrying channels we deliberately closed -- a new bug wearing the
        // old one's clothes.
        if (ch !== this.channel) return;

        if (status === 'SUBSCRIBED') {
          if (!settled) {
            settled = true;
            resolve();
          }
          // Health is NOT reported here: a joined channel has no snapshot yet. `start()`
          // calls `up()` once the select returns.
          return;
        }

        // CLOSED IS HANDLED NOW, and its absence was a second bug. There was no `else`: a
        // CLOSED arriving first left this promise unsettled forever, so `await
        // this.subscribed()` hung, the select never ran, `startTables`' allSettled never
        // settled, and `joinAsGuest` hung with no timeout and no message -- which is
        // precisely the failure the comment below names.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const e = err ?? new Error(`Realtime channel for ${this.table} failed: ${status}`);
          if (!settled) {
            // Rejecting rather than hanging matters: a silent never-resolving start()
            // presents as an app stuck on a spinner with no error anywhere. `start()`'s
            // catch calls fail(), which owns the teardown.
            settled = true;
            reject(e);
            return;
          }
          // Post-join death. Nothing is awaiting this promise any more, so the report and
          // the teardown have to happen here.
          void this.fail(e);
        }
      });
    });
  }

  /** Returns whether anything actually changed. */
  private apply(payload: RealtimePostgresChangesPayload<RowOf<T>>): boolean {
    if (payload.eventType === 'DELETE') {
      // `old` carries only the replica identity (the primary key). Reading any
      // other column here yields undefined.
      const old = payload.old as Partial<RowOf<T>>;
      const id = this.keyFromPartial(old);
      return id !== null && this.rows.delete(id);
    }
    const row = payload.new as RowOf<T>;
    this.rows.set(this.key(row), row);
    return true;
  }

  /**
   * DELETE gives a partial row, so `key()` may read a missing column. Guarding
   * here rather than inside every key function keeps those one-liners honest.
   */
  private keyFromPartial(partial: Partial<RowOf<T>>): string | null {
    try {
      const id = this.key(partial as RowOf<T>);
      return typeof id === 'string' && id.length > 0 ? id : null;
    } catch {
      return null;
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.buffer = null;
    this.rows.clear();
    await this.teardownChannel();
  }
}
