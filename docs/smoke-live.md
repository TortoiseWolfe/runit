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
- **One event, one folder, one host seat, one guest, one broadcast, one song request and
  one photo row** per run.
- **No storage objects.** The run deletes its own two objects on the way out —
  `event_photos_delete` admits the host of the event through the Storage API, and the run
  *is* that host. It is best-effort and never fails the gate: tidying that fails is not the
  journey failing, so it reports and moves on.

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
guests, broadcasts, song requests, votes and photo rows.

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

### BYTES FIRST, ROWS SECOND — and this was learned the expensive way

`init.sql` has said it since the first migration, for whoever eventually writes real
deletion:

> Deleting the row first strands the object, since `storage_path` is the only thing that
> can name it.

Storage objects are worse than stranded: `event_photos_delete` is
`using (is_host(((storage.foldername(name))[1])::uuid))`, so the **event must still exist**
for anyone to be allowed to delete its bytes. Delete the event first and the objects become
unreachable to every route the app has — `storage.protect_delete()` refuses direct SQL for
the owner as much as for a guest, so there is no SQL fallback either. Only a service role
can remove them after that, which is the same blocker #40's retention sweep has.

This happened during development of this lane: twelve objects, 840 bytes, orphaned in
`event-photos` by sweeping rows before bytes. They can only be removed from the Storage
dashboard or with a service key.

**So the run sweeps its own bytes before it finishes**, and the SQL above is only ever for
rows. If you ever sweep by hand, delete the objects while the event still exists.

## Photos, which is the longest chain and the one most able to fail silently

Two objects go up (#10 added a 400px thumbnail beside the 1600px original), the row names
both, `event_photos_select` must admit the **thumbnail** as well as the original, and
`createSignedUrls` must produce a URL that resolves. Lane H asserts the whole chain renders:

- the album's `<img>` has **decoded** (`naturalWidth > 0`), and
- its src is a **signed storage URL**, and
- that URL names the **thumbnail** (`_t.jpg`).

All three clauses are load-bearing. An `<img>` whose src 403s renders nothing while every
DOM assertion still passes. And decoding alone is satisfied by the `data:` URI of the
guest's own bytes, which would prove only that `capture.web.ts` works.

The viewer is asserted separately, because it signs a **different path** (`storage_path`,
not `thumb_path`) — a policy admitting one and not the other passes everything above. That
assertion waits for the src to *stop* being the thumbnail: the viewer deliberately shows the
thumbnail first and swaps in the full size, so "an image decoded" catches the thumbnail
every time and reports `fullUrl` as broken.

**Mutation-checked**: removing `displayUrl` from `photoCache`'s comparator in
`mappers.ts` — the exact failure its own comment warns about — turns the album assertion
red with "no image decoded", while the viewer still passes because it resolves on demand
rather than through the comparator.

**The policy itself is lane E's job**, not this one: `verify-policies.sql` asserts that a
member reads an approved photo *and its thumbnail*, that another guest reads neither while
it is pending, and that a direct SQL delete is refused. Lane H proves the chain renders;
lane E proves the rule.

### No approval queue here, and that is the tier rather than a bug

`create_event` mints `house_party`, whose uploads are **auto-approved** — so a photo goes
straight to the album and the host's queue stays empty. Moderation is unreachable from any
event this app can currently create, because `events.tier` is outside the column grant and
there is no purchase path (#30). Lane H asserts what a real event can actually do, and
checks the queue reads "All caught up" so the behaviour is pinned rather than assumed.

## What it does NOT cover yet

Moderation (needs a paid tier), push delivery, the invitee list, reports, and the run of
show. Those are the obvious next assertions; the lane is a smoke test, not a second suite.
