# The retention sweep (#40)

`supabase/functions/sweep-photos` · scheduled by `cron.job` `photo-retention-sweep`, 04:17 daily

## What it does

The album has said *"Photos here are kept for N days after the event"* since #23. This is
what makes that true. For every photo whose event is past its tier's
`album_retention_days`, it removes **both** objects and then the row.

| tier | keeps |
|---|---|
| `house_party` (free) | 30 days |
| `party` | 90 days |
| `event` | 365 days |
| `venue` | **never** — `null` |

## Why it is not SQL

`storage.protect_delete()` refuses **every** direct delete on `storage.objects` — for the
project owner as much as for a guest, and lane E asserts it. A `pg_cron` job with a `DELETE`
in it is not a smaller version of this feature; it is a version that does not run. Bytes can
only be removed through the Storage API with a service role, and the service key exists
nowhere in the app bundle, `.env` or `eas.json`. An Edge Function is the one place it already
is.

## The order, which is the load-bearing part

**Bytes first, row second, idempotent.** `init.sql` has carried that rule since the first
migration: `storage_path` is the only thing that can name an object, so deleting the row
first strands the bytes where nothing can reach them again. If the Storage API fails, the row
is deliberately **left** so a later run can retry. If the object is already gone — a seeded
row that never had bytes, or a previous interrupted run — that is not an error and the row
still goes.

`folders.photo_count` follows on its own: `photos_fold` recomputes it from the delete.

## What decides "expired" — and where

`public.photos_past_retention(limit)`, in SQL, beside the `tier_limits` row it reads. The
function does not re-implement the arithmetic; a sweep that did would be a second opinion
about what expired means, and the two would drift.

**The clock runs from `events.starts_at`**, not the photo's `created_at`. The album's sentence
already says "after the event", so a photo uploaded three days late expires with the party.
Building it the other way would quietly break a promise that is already on screen.

## Authorisation

`verify_jwt` is on, but that only proves the caller holds *a* project JWT — and the anon key
is public, compiled into the app bundle. For a fan-out that is tolerable; for an endpoint that
destroys photographs it is not. So the caller must also present **`x-sweep-key`**, checked by
`public.sweep_authorised()` inside the database, so the secret never crosses the wire and no
endpoint can return it. A missing secret and a wrong secret answer identically — telling them
apart tells a prober whether the endpoint is armed.

Three Vault secrets:

| name | what |
|---|---|
| `sweep_key` | the real credential |
| `sweep_url` | where the function lives |
| `sweep_gateway_key` | the **publishable** key, only to satisfy `verify_jwt`. Authorises nothing. |

Absent secrets = not armed, and `run_photo_sweep()` returns quietly rather than erroring
nightly on a project nobody has wired.

## Running it by hand

```bash
# Rehearse. Identical report, deletes nothing.
curl -sX POST "$SUPABASE_URL/functions/v1/sweep-photos" \
  -H "Authorization: Bearer $PUBLISHABLE_KEY" \
  -H "x-sweep-key: $SWEEP_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run":true}'
```

Drop `dry_run` to sweep for real. `{"limit":N}` caps one run; the default is 200 and the
ceiling is 1000.

**Dry run is an escape, not the default.** The caller has to ask for a real sweep, but the
report is the same either way — an irreversible job whose rehearsal takes a different code
path has not been rehearsed.

## Stopping it

```sql
select cron.unschedule('photo-retention-sweep');   -- stop
update cron.job set active = false where jobname = 'photo-retention-sweep';  -- pause
```

## What no lane here proves

`run-checks.sh` never executes an Edge Function, so **no gate in this repo proves this one
works**. What exists instead:

- **Lane E** asserts the rule: an expired free-tier photo is selected, a recent one is not,
  an unlimited tier never is, and all three functions are revoked from every client role.
- **Verified by hand against the live project**, end to end: an event created through the real
  path with two real objects, backdated past its retention, then dry-run (`considered: 1`),
  swept (`bytes_removed: 2, rows_removed: 1`), and run again (`considered: 0`). Both objects
  and the row were gone, `folders.photo_count` had folded to 0, and every other event's photos
  were untouched. The scheduled path was proven separately by calling `run_photo_sweep()` and
  reading the 200 back out of `net._http_response`.

pg_net is fire-and-forget, so a failed nightly run lands in `net._http_response` and nowhere
else. That is the same silence the push fan-out has, and it is worth knowing before trusting
a quiet log:

```sql
select status_code, left(content, 200), created
  from net._http_response order by id desc limit 5;
```
