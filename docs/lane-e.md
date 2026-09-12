# Lane E: running the policy assertions

`supabase/verify-policies.sql` is the only check in this repo that can watch row-level
security behave. It seeds an event, a guest and a host inside a `DO` block, switches role
with `set local role authenticated` and a forged `request.jwt.claims`, asserts **142**
behaviours, and RAISES at the end so nothing commits — the "error" it prints *is* the report.

## It had never run

Not once, completely, before 2026-09-06. Three separate defects were hiding in that silence,
and each was invisible for the same reason: running it needed a production database password
that nobody had to hand, so it skipped, and a skip and a pass look identical on a board.

1. **`42601` — a duplicate `pho uuid`** in the DECLARE block killed the whole file at compile
   time. Zero of 143 assertions had run since `aed8fb1`.
2. **`00000000000000_init.sql` could not be applied to an empty database.**
   `photos_past_retention` is `language sql`, whose body Postgres name-resolves at CREATE
   time, and it selected from `public.tier_limits` ~1100 lines before that table was created.
   It only worked on the live project because the table was already there.
3. **The #44 song-merge assertions used a guest who holds no seat.** `buid2` is the guest the
   tier cap *refuses* a few hundred lines earlier — that refusal is the point of the 54023
   assertion — so `request_song` correctly raised "not a guest of this event" and everything
   below aborted.

`EXPECTED_ASSERTIONS` was **143**, which was arithmetic over sets that had never executed.
The first complete run measured **142**.

## Running it without a production password

This is the route to prefer. It needs nothing from anyone.

```bash
npx supabase start                       # ~12 containers, first pull is slow

# NOT `supabase db push` / `db reset` — see below. Apply it directly:
docker exec -i supabase_db_runit psql -U postgres -v ON_ERROR_STOP=1 \
  < supabase/migrations/00000000000000_init.sql

SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm verify:policies
```

**Loopback runs without TLS, and that is not the same as skipping verification.** The local
container serves no TLS at all, so a strict `ssl` option cannot handshake. `verify-policies.mjs`
matches the loopback *host* — not a flag or an env var — so it can never be turned on for a
remote database by accident. Every other host keeps `rejectUnauthorized: true`, because that
connection carries a real password.

### `supabase db push` and `db reset` were a SILENT NO-OP until #48

The CLI **reserves the migration name `init`** and skips the file, saying so only in the
noise of a `start`:

```
Skipping migration 00000000000000_init.sql... (replace "init" with a different file name
to apply this migration)
```

The file was `00000000000000_init.sql`, so both canonical Supabase deployment commands
applied nothing and exited 0. It was not the all-zero version — it was the word.

**Renamed to `00000000000000_schema.sql` (#48), and the CLI now says `Applying migration`.**
Verified end to end: 16 tables, 34 policies, the seed present, 153 lane E assertions and a
matching schema fingerprint, all from a plain `supabase db reset`.

### Resetting between attempts

```bash
npx supabase db reset
```

That is the whole recipe now, and it is better than what came before: it rebuilds the
database rather than dropping a schema, so **Supabase's default privileges survive** and the
client grants come back intact — checked, `anon` and `authenticated` hold INSERT/SELECT on
`events` afterwards.

`supabase/reset-local.sql` remains for the psql route (applying the migration by hand
without the CLI). **Use that file rather than a `drop schema` of your own.** `00000000000000_init.sql`
contains no table grants at all — it relies on Supabase's
`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated`, which is attached
to the *schema*. So `drop schema public cascade` destroys it, and every table the migration
then creates arrives with no client grant.

That fails two ways and the second is worse. Lane E aborts early with
`permission denied for table events`, which at least says something. But the **revoke**
assertions — "my_events is revoked from anon", and eight like it — would **pass trivially**,
because there was never a grant to revoke. This document carried the broken recipe for about
an hour; a real run is what caught it.

## What a local run does and does not prove

| | local | live |
|---|---|---|
| The file compiles | ✅ | ✅ |
| The committed migration's policies behave as asserted | ✅ | ✅ |
| **Production has not drifted from the committed migration** | ❌ | ✅ |
| Dashboard-only state (anonymous sign-in) | ❌ | lane H |

The success line names which target it ran against, because "the assertions pass" means
different things for each.

## In CI, with no credential

`.github/workflows/policies.yml` does exactly the above on every push that touches
`supabase/**` — start three containers, apply the migration with `ON_ERROR_STOP=1`, run the
lane. Nothing in it is secret, so it cannot skip for want of a credential, which is the
property that matters: a gate that can silently skip is the whole bug.

It also guards, as a side effect, the thing nothing else does — that the migration can build
a database at all.

## Schema drift (#49)

Lane E asserts what the policies **do**. It cannot see an extra column, a dropped trigger, or
a tier cap edited in the database only — and this repo deploys statement-by-statement through
the MCP, so the committed migration is a *description* of what was meant to happen.

```bash
pnpm schema:fingerprint            # six md5s over policies, functions, columns, triggers, indexes, tier_limits
pnpm schema:check                  # compare against supabase/schema-fingerprint.json
pnpm schema:fingerprint --url=...  # against any database you can reach
```

**At the 2026-09-07 capture there was no drift**: all six groups from the live project
matched a local build of the committed migration exactly. That baseline is committed, and
`policies.yml` asserts it on every push touching `supabase/**` — so a migration change that
was never deployed goes red, with no credential needed.

### When production and the file disagree ON PURPOSE

**No allowance is in force today** — #63 was reverted on 2026-09-12 and the entry deleted.
This section stays because the mechanism is permanent and the next deliberate divergence
should reach for it rather than re-derive it.

**That combination went red and stayed red, and nobody read it.** #63 raised `max_guests` to
40 and `max_hosts` to 2 on `house_party` in the database only, for one party, with a revert
date — so production and the committed migration disagreed on `tier_limits` by design. The
baseline records production; CI compares it to a local build; the `Schema fingerprint` step
failed on the merge that did it and on the next two merges as well.

A permanently red gate is a gate nobody reads, and it would have swallowed a real drift
exactly as happily. So the baseline carries an `expectedDivergence` list:

```json
"expectedDivergence": [
  { "group": "tier_limits", "fingerprint": "<what the OTHER side hashes to>",
    "until": "2026-09-13", "reason": "..." }
]
```

It is as narrow as one fingerprint and it **expires**. A group with an allowance still fails
on any third value, and the day after `until` it fails as `STALE` with the reason printed.
Both behaviours are mutation-checked — do not soften either into "skip this group".

It is a fingerprint rather than a diff on purpose: a hash answers "has anything moved?" in six
numbers. When one changes, run `supabase/schema-fingerprint.sql` against both sides to find
out what.

**Refreshing the baseline records a fact, not a wish.** Only run `--write` after re-checking
production, and say so in the commit message.

## Running it against the live project

```bash
export SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres'
pnpm verify:policies
```

The password is the **database** password — Supabase dashboard → Settings → Database. It is
not the access token and not the publishable key, and **no MCP tool can produce it**:
`create_project` has no password parameter, so the value is generated server-side and never
returned to a caller. If it was never recorded, reset it there; the app authenticates over
PostgREST with the publishable key and does not use it.

Set the same string as the `SUPABASE_DB_URL` **Actions secret** and it runs on every push.
The repository is private, so it has a secret store — three files used to claim otherwise,
which is why the lane never ran in CI.

## Two traps in the SQL itself

Both make a *passing* statement look like a failing one:

- `text[] || 'a literal'` parses the literal as an **array literal** and raises 22P02 inside
  whatever exception handler you are standing in. Use `format()`.
- Several assertions in one `UNION` share a single statement snapshot, so a `STABLE` function
  cannot see a row a sibling branch just inserted. `join_event` looked broken twice and was
  fine both times.

## The rule

**Anything added here must be RUN, not merely written** — and the number in
`EXPECTED_ASSERTIONS` must come from a real complete run, not from adding to the previous
value. That rule was already written down, and ignoring it cost three bugs in one file.
