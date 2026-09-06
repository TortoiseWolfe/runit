/**
 * THE RETENTION SWEEP (#40).
 *
 * The album has told guests "Photos here are kept for N days after the event" since #23, and
 * nothing deleted anything. This is the half that makes the sentence true.
 *
 * WHY IT CANNOT BE SQL, which is the whole reason this file exists rather than a pg_cron job
 * with a DELETE in it. `storage.protect_delete()` refuses every direct delete on
 * `storage.objects` -- for the project owner as much as for a guest, and lane E asserts
 * exactly that. The bytes can only be removed through the Storage API with a service role,
 * and the service key deliberately exists nowhere in the app bundle, `.env` or `eas.json`.
 * An Edge Function is the one place it is already present.
 *
 * BYTES FIRST, ROW SECOND, and idempotent because it WILL be interrupted. `init.sql` has
 * carried that rule since the first migration: `storage_path` is the only thing that can
 * name an object, so deleting the row first strands the bytes where nothing can ever reach
 * them again. This session stranded 980 bytes learning it the other way round.
 *
 * WHAT IT DOES NOT DECIDE. Which photos are expired is `public.photos_past_retention()`, in
 * SQL, beside the `tier_limits` row it reads. A sweep that re-implemented the arithmetic
 * would be a second opinion about what "expired" means, and the two would drift.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'event-photos';

/**
 * One run's ceiling. A sweep is not a migration: a bounded batch that runs daily drains any
 * backlog in days, and an unbounded one turns a first run on a large project into a single
 * request that times out halfway -- which, given the order above, is a run that deleted
 * bytes and left rows.
 */
const DEFAULT_LIMIT = 200;

type Payload = { dry_run?: boolean; limit?: number };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // The service role: the only identity that may remove bytes, and the reason this runs
    // here rather than anywhere a client could reach.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  /**
   * AUTHORISED AGAINST VAULT, NOT AGAINST THE GATEWAY.
   *
   * `verify_jwt` only proves the caller holds *a* project JWT, and the anon key is public --
   * it is compiled into the app bundle. For a fan-out that is tolerable; for an endpoint
   * that destroys photographs it is not. So the caller must also present a secret that
   * exists only in Vault, which this function reads with the service role.
   *
   * Absent secret = not armed. That is a normal state before someone wires it, not an
   * error, and it must fail CLOSED: a sweep that ran without its credential would be a
   * deleter anyone could trigger.
   */
  const presented = req.headers.get('x-sweep-key');
  const { data: ok, error: authError } = await db.rpc('sweep_authorised', { p_key: presented });

  // THE COMPARISON HAPPENS IN THE DATABASE and the secret never crosses the wire. Reading
  // `vault.decrypted_secrets` from here was the first shape and it does not work at all --
  // PostgREST exposes `public`, not `vault` -- but the better reason is that an endpoint
  // which can RETURN the secret is a worse thing to own than one that can only ask whether
  // a guess matches.
  if (authError) {
    console.error('sweep: could not check authorisation', authError);
    return new Response(JSON.stringify({ error: 'authorisation check failed' }), { status: 500 });
  }
  if (ok !== true) {
    // Not armed (no `sweep_key` in Vault) and wrong key are the same answer on purpose:
    // distinguishing them tells a prober whether the endpoint is live.
    console.error('sweep: refused -- bad key, or no sweep_key in Vault');
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  let payload: Payload = {};
  try {
    payload = await req.json();
  } catch {
    // An empty body is a normal invocation; the defaults are the safe ones.
  }
  const limit = Math.max(0, Math.min(payload.limit ?? DEFAULT_LIMIT, 1000));

  /**
   * DRY RUN IS THE DEFAULT-SHAPED ESCAPE, not the default.
   *
   * The caller must ask for a real sweep, but the report is identical either way, so the
   * thing you check before arming a schedule is the thing that then runs. An irreversible
   * job whose rehearsal takes a different code path has not been rehearsed.
   */
  const dry = payload.dry_run === true;

  const { data: due, error } = await db.rpc('photos_past_retention', { p_limit: limit });
  if (error) {
    console.error('sweep: could not read what is past retention', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (due ?? []) as {
    id: string;
    storage_path: string;
    thumb_path: string | null;
    event_code: string;
    expired_at: string;
  }[];

  if (rows.length === 0) {
    console.log('sweep: nothing past retention');
    return new Response(JSON.stringify({ dry, considered: 0, bytes_removed: 0, rows_removed: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (dry) {
    console.log(`sweep: DRY RUN -- ${rows.length} photo(s) are past retention`);
    return new Response(
      JSON.stringify({
        dry: true,
        considered: rows.length,
        bytes_removed: 0,
        rows_removed: 0,
        sample: rows.slice(0, 10).map((r) => ({
          event: r.event_code,
          expired_at: r.expired_at,
          objects: [r.storage_path, r.thumb_path].filter(Boolean),
        })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let bytesRemoved = 0;
  let rowsRemoved = 0;
  const failures: { id: string; step: string; error: string }[] = [];

  for (const row of rows) {
    const objects = [row.storage_path, row.thumb_path].filter(Boolean) as string[];

    // BYTES FIRST. `remove` on a path that is already gone is not an error -- a row whose
    // objects were swept by a previous interrupted run, or a seeded row that never had
    // bytes at all, must still be able to finish. That is what makes this idempotent.
    const { error: rmError } = await db.storage.from(BUCKET).remove(objects);
    if (rmError) {
      // AND THE ROW STAYS. Deleting it now would strand these bytes permanently: nothing
      // but this row could ever name them again.
      console.error(`sweep: could not remove bytes for ${row.id}; leaving the row`, rmError);
      failures.push({ id: row.id, step: 'storage', error: rmError.message });
      continue;
    }
    bytesRemoved += objects.length;

    // ROW SECOND. `photos_fold` recomputes `folders.photo_count` from this delete, so the
    // album's own counter follows without a second write.
    const { error: rowError } = await db.from('photos').delete().eq('id', row.id);
    if (rowError) {
      console.error(`sweep: removed bytes for ${row.id} but could not delete the row`, rowError);
      failures.push({ id: row.id, step: 'row', error: rowError.message });
      continue;
    }
    rowsRemoved += 1;
  }

  console.log(
    `sweep: ${rowsRemoved}/${rows.length} photo(s) removed, ${bytesRemoved} object(s), ${failures.length} failure(s)`,
  );
  return new Response(
    JSON.stringify({ dry: false, considered: rows.length, bytes_removed: bytesRemoved, rows_removed: rowsRemoved, failures }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
