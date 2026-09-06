# Lane H — the adapter that ships, against the database that ships

`pnpm export:web:live && pnpm smoke:live`

## Why it exists

Every one of the 262 Playwright journeys boots `MemoryRepository`. They prove the
**screens**. They say nothing about `SupabaseRepository`, and that gap has a body count:
a founder stranded in her own console (#37), "seen by 0" forever (#24), a role switch that
could only ever refuse (#29). Each was found by holding a phone. Issue #20.

Four things only this lane can see:

1. **RPC argument names.** PostgREST resolves overloads by argument *name*, so `p_titel`
   is not a type error — it is a 404 at runtime against a function that exists.
   `database.types.ts` is hand-written, so nothing else checks it.
2. **Column names and filters.** `FakeClient` records what was sent and never evaluates it.
   `.eq('event', id)` where the column is `event_id` passes every unit test.
3. **RLS admitting what the app needs.** Lane E proves policies *refuse* the right things,
   by forging `request.jwt.claims` inside a transaction — which bypasses GoTrue entirely.
   Sixteen assertions once passed against a project where `signInAnonymously()` had never
   succeeded.
4. **Anonymous sign-in**, which is a dashboard toggle no token can flip, and which was OFF
   while build #3 shipped.

## Why it runs against the LIVE project

The organisation is on the free plan, which counts **paused** projects toward its limit of
two. A dedicated test project costs $0 and is simply unavailable until one is deleted or
the org upgrades. Branching is Pro-only ($0.0134/hour).

That was a deliberate decision with the alternatives measured, not a default.

## What that costs, stated rather than discovered later

- **One anonymous `auth.users` row per run**, and Supabase never garbage-collects them.
  This is the same fact that makes `leave()` different from `closeEvent()`.
- **One event, one folder, one host seat, one guest, one broadcast and one song request**
  per run.

So the suite is **non-destructive by construction**. It creates its own event and works
only inside it. It never rotates a key, closes an event, moderates a photo, or writes to
any row it did not create. It prints the event code it leaves behind.

## Why it is NOT in `run-checks.sh`

`pnpm checks:docker` runs many times an hour while working. Each lane-H run writes to the
production project, so putting it in the default gate would trade a clean database for
convenience. It is a deliberate command — the same standing as `pnpm android`: a
measurement with a cost, run before a build rather than on every save.

It skips loudly without `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_PUBLISHABLE_KEY`, in the
same shape as lane E, so a green board never silently means "the adapter went unchecked".

## Sweeping what it leaves

Events are named `smoke <YYYYMMDDHHMMSS>`. Deleting one cascades to its folders, hosts,
guests, broadcasts, song requests and votes.

```sql
-- 1. What is there.
select code, name, created_at from public.events where name like 'smoke %' order by created_at;

-- 2. Remove them. Everything below the event cascades.
delete from public.events where name like 'smoke %';

-- 3. The anonymous identities they minted. Scoped to users that hold NO seat of any kind,
--    which is what a swept smoke run leaves behind -- never a user with a real seat.
delete from auth.users u
 where u.is_anonymous
   and not exists (select 1 from public.guests g where g.auth_user_id = u.id)
   and not exists (select 1 from public.hosts  h where h.auth_user_id = u.id);
```

Run step 3 **after** step 2, not before: while the event still exists its host row still
references the user, so the guard correctly refuses to delete it.

## What it does NOT cover yet

Photos and storage (signed URLs, the widened `event_photos_select`, the thumbnail path),
moderation, push delivery, and the invitee list. Those are the obvious next assertions; the
lane is a smoke test, not a second suite.
