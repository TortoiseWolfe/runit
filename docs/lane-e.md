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

# The CLI does not pick up a migration versioned 00000000000000, so apply it directly:
docker exec -i supabase_db_runit psql -U postgres -v ON_ERROR_STOP=1 \
  < supabase/migrations/00000000000000_init.sql

SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm verify:policies
```

**Loopback runs without TLS, and that is not the same as skipping verification.** The local
container serves no TLS at all, so a strict `ssl` option cannot handshake. `verify-policies.mjs`
matches the loopback *host* — not a flag or an env var — so it can never be turned on for a
remote database by accident. Every other host keeps `rejectUnauthorized: true`, because that
connection carries a real password.

### Resetting between attempts

`supabase db reset` does **not** apply this migration (see above), so reset the schema by hand:

```sql
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='storage' and tablename='objects'
  loop execute format('drop policy if exists %I on storage.objects', r.policyname); end loop;
end $$;
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
```

## What a local run does and does not prove

| | local | live |
|---|---|---|
| The file compiles | ✅ | ✅ |
| The committed migration's policies behave as asserted | ✅ | ✅ |
| **Production has not drifted from the committed migration** | ❌ | ✅ |
| Dashboard-only state (anonymous sign-in) | ❌ | lane H |

The success line names which target it ran against, because "the assertions pass" means
different things for each.

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
