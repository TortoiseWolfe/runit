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

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // 1. Buffer opens BEFORE the channel, so nothing can arrive unbuffered.
    this.buffer = [];

    // 2. Subscribe and wait for the server to confirm. `subscribe()` resolves its
    //    callback with SUBSCRIBED only once the channel is actually joined --
    //    selecting before that point reopens the very gap this avoids.
    await this.subscribed();

    // 3. Now the snapshot. Any change from here on is in the buffer.
    const query = this.loose.from(this.table).select('*');
    const { data, error } = await (this.filter
      ? query.eq(this.filter.column, this.filter.value)
      : query);
    if (error) throw error;

    this.rows = new Map(((data ?? []) as RowOf<T>[]).map((r) => [this.key(r), r]));

    // 4. Replay. An event for a row the select already returned is idempotent:
    //    both paths write the same map under the same key.
    const queued = this.buffer;
    this.buffer = null;
    for (const p of queued) this.apply(p);

    this.onChange();
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
      ch.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') resolve();
        // CHANNEL_ERROR and TIMED_OUT are terminal for this attempt. Rejecting
        // rather than hanging matters: a silent never-resolving start() presents
        // as an app stuck on a spinner with no error anywhere.
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(err ?? new Error(`Realtime channel for ${this.table} failed: ${status}`));
        }
      });
      this.channel = ch;
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
    if (this.channel) {
      await this.client.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
