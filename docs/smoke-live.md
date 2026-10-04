# Lane H — the adapter that ships, against the database that ships

`pnpm export:web:live && pnpm smoke:live`

## Why it exists

Every one of the 270 Playwright journeys boots `MemoryRepository`. They prove the
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

-- 2. Remove them, with their identities: the statement below, not a bare delete.

```

**Do not sweep identities by "anonymous and seatless".** This file used to, and since #77
that predicate also matches a cold visitor who filed a report from the join screen without
joining: `feedback.auth_user_id` is `on delete cascade`, so the sweep would have deleted
their report. Collect the smoke run's identities BEFORE the events go, and delete only
those, in the same statement:

```sql
with ev as (select id from public.events where name ~ '^smoke [0-9]{14}$'),
 ids as (select h.auth_user_id as uid from public.hosts h join ev on ev.id = h.event_id
         union select g.auth_user_id from public.guests g join ev on ev.id = g.event_id),
 del_ev as (delete from public.events e using ev where e.id = ev.id returning 1),
 del_u as (delete from auth.users u using ids where u.id = ids.uid and u.is_anonymous
   and not exists (select 1 from public.feedback f where f.auth_user_id = u.id)
   and not exists (select 1 from public.hosts h where h.auth_user_id = u.id and h.event_id not in (select id from ev))
   and not exists (select 1 from public.guests g where g.auth_user_id = u.id and g.event_id not in (select id from ev))
   returning 1)
select (select count(*) from del_ev) as events, (select count(*) from del_u) as identities;
```

`hosts.auth_user_id` is `set null` and `guests.auth_user_id` is `cascade`, so one statement
is safe. Last run 2026-10-04: 14 events (09-10 to 10-04), 23 identities, 8 orphaned objects
deleted through the Storage API first.

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

This happened during development of this lane: **fourteen objects, 980 bytes**, orphaned in
`event-photos` by sweeping rows before bytes. They can only be removed from the Storage
dashboard or with a service key, and they are the whole remaining litter — every run since
cleans up after itself.

**So the run sweeps its own bytes before it finishes** — pass *or* fail, because a run that
aborts is exactly the run you repeat, and a sweep that only fires on success leaks fastest
when things are going worst. That is how the first orphans happened. Mutation-checked by
breaking a mid-journey step and confirming the bytes still went.

The SQL above is only ever for rows. If you sweep by hand, delete the objects while the
event still exists.

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

## The second guest, which is what unlocked the rest

Reports refuse a self-report, blocking needs somebody to block, and "seen by" needs a reader
who is not the author — so none of it is reachable with one identity. The lane opens a
**second browser context**: a second anonymous user joining by code.

That also gives the suite its only test of realtime **between clients** rather than a client
hearing its own echo. And it makes two numbers real that `MemoryRepository` cannot model:
`guest_seats()` excluding the host's own seat (the room reads 1 while `guests` holds 2), and
a `seen_count` moving off zero for a reader who is not the author.

What it covers: the guest list and `fold_invited_count` reaching the composer; a report
filed through `file_report()`, arriving in the host queue and being resolved; and a block
removing somebody's song from the blocker's queue only, with unblocking putting it back.

## One assertion is about realtime. The rest are not, deliberately

Every host segment re-mounts and refetches on navigation, so *"the row reached the host
queue"* and *"a websocket pushed it within N seconds"* are different claims. Exactly one
assertion here — the broadcast — is about delivery, and it reports its own latency. The
others are allowed a refetch (`seeInConsole`) rather than being quietly turned into flaky
tests of the transport.

Measured on this project: realtime usually delivers in **240ms–1.2s**, and twice in roughly
fifteen runs a row did not appear inside the timeout at all. Recorded in the tracker rather
than smoothed over here.

The same care applies to folded counters. `fold_invited_count` runs in the database and the
new number arrives over realtime, so reading the composer immediately after the insert is a
race the write usually loses — it reported "Send to 0 guests" on one run in four. Waiting
for the fold asserts the trigger; reading once asserts a millisecond.

## When it fails

It leaves `test-results/lane-h/`:

| file | what it is |
|---|---|
| `trace.zip` | the whole run in the Playwright trace viewer — DOM snapshots, network, console, action by action. `pnpm exec playwright show-trace test-results/lane-h/trace.zip` |
| `trace-bo.zip` | the same for the second guest, when one had been opened |
| `failure.png` / `failure.html` | the page at the moment it stopped |
| `failure.txt` | the **whole** error, the URL, every console line, and the event code |

The event code is in the report on purpose: without it the artifact is not enough to sweep
what the failed run left in the production project. And the storage sweep runs on the failure
path too — a run that aborts is exactly the run you repeat.

Traces are discarded on a green run, the same semantics `playwright.config.ts` gives the
journeys with `retain-on-failure`.

**This did not exist while the lane was being built**, and its absence is why six throwaway
probe scripts were written: each one re-derived, badly, the state the browser had been holding
a moment earlier. Two failures were misdiagnosed for several cycles because the error was
truncated to its first line — the call log beneath it named the cause immediately.

## What it does NOT cover, and why neither is a matter of effort

- **Push delivery.** `push.web.ts` returns `null` by design, and its docblock explains why a
  fake token would be worse than none: it would flow into `set_push_token` and be stored as
  a routable address that routes nowhere, and every assertion built on it would be measuring
  the stub. Push needs a device (#27's credentials) or lane C.
- **Photo moderation.** `create_event` mints `house_party`, which auto-approves uploads, and
  no client can set `events.tier` (#30). The approval queue has **no reachable state** in any
  event this app can currently create, so an approve/hide journey would require setting up
  state out of band — which the lane cannot do (it has no database credentials) and should
  not pretend to.

Both are printed at the end of every run, so a green board is not mistaken for "the backend
works".
