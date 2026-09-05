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
export class RealtimeTable<T extends TableName> {
  private rows = new Map<string, RowOf<T>>();
  private channel: RealtimeChannel | null = null;
  private buffer: RealtimePostgresChangesPayload<RowOf<T>>[] | null = null;
  private started = false;

  constructor(
    private readonly client: RunitClient,
    private readonly table: T,
    /** Primary key. Not always `id` -- now_playing is keyed by event_id. */
    private readonly key: (row: RowOf<T>) => string,
    /** PostgREST filter, e.g. `event_id=eq.<uuid>`. Applied to BOTH select and channel. */
    private readonly filter: { column: string; value: string } | null,
    /** Called after any change, including the initial load. */
    private readonly onChange: () => void,
  ) {}

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
   * Why the last subscribe failed, when it did. Null while live.
   *
   * Kept rather than swallowed: a table serving a frozen snapshot looks identical to a
   * healthy one, and the difference matters to anyone debugging "why is nothing
   * updating". Nothing renders it yet -- surfacing it is a UI decision, not this
   * class's -- but it is here to be surfaced rather than re-derived.
   */
  liveError: Error | null = null;

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
        this.liveError = e instanceof Error ? e : new Error(String(e));
        // The channel is already unusable; drop it rather than leave supabase-js
        // rejoining it on its own backoff for the life of the process.
        await this.teardownChannel();
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
      // returning to the foreground, say -- retries the subscription instead of being
      // a silent no-op on a table that is showing a frozen snapshot.
      this.started = live;

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
      ch.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          resolve();
          return;
        }
        // CHANNEL_ERROR and TIMED_OUT are terminal for this attempt. Rejecting
        // rather than hanging matters: a silent never-resolving start() presents
        // as an app stuck on a spinner with no error anywhere.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Rejecting is enough HERE because `start()` removes the channel in its
          // catch, and that is the only caller. Removing it again on this branch
          // would be a second mechanism for one job -- one that no test can tell
          // apart from the first, since either alone satisfies the assertion.
          reject(err ?? new Error(`Realtime channel for ${this.table} failed: ${status}`));
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
