# Design: host accounts, event creation, deletion

**Status: PROPOSAL. Not implemented, and not fully verified.** Produced at the end of the
2026-09-05 session, after the finding that Runit has no supply side (issue #1). Claims about
specific line numbers were made by a design pass and should be re-checked before being acted
on — several are load-bearing.

Decided with the user: **hosts sign in by email; guests stay fully anonymous.** That second
half is a product promise printed in the UI (`JoinScreen.tsx:156`) and constrains everything
below.

---

## The three structural problems

**1. `session.leave()` conflates two teardowns.** It stops eight `RealtimeTable`s, discards
six row caches, *and* calls `auth.signOut()`. An email-authed host switching from the party
to the wedding must keep their identity. Split it:

- `closeEvent()` — context teardown, identity kept. The half that does not exist today.
- `signOut()` — identity teardown.
- `leave()` — both, unchanged, for guests.

A boolean parameter (`leave(signOut: boolean)`) is the wrong shape: it is the argument
someone passes wrong at 2am, and getting it wrong destroys an identity.

**2. `Session` has no `eventId`.** It is currently a three-way union carrying who you are but
not where. The proposal splits the two axes — `kind` is what you are doing in the open event,
`account` is who you are and survives every switch — and adds an `'account'` variant for
"signed in, no event open", which is the state a My Events screen renders.

**3. Events have no owner.** Add `owner_user_id`, and widen `events_read` with
`or owner_user_id = auth.uid()` so an owner who removed their own host seat does not lose
their event.

## `create_event` — the founding transaction

SECURITY DEFINER. Mints a unique code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0/O/1/I/L`,
matching `seed-events.sql:13`) with collision retry; inserts the event; **creates a default
folder and sets `active_folder_id`** — an event with no folder refuses every upload
(`seed-events.sql:53`); inserts the founding `hosts` row bound to `auth.uid()`.

New events get **`house_party`**, the column default, and that is internally consistent with
what the RPC builds: one folder, one host seat, no moderation queue.

**Flag — the wedding is not reachable end to end.** The planner can create all three events,
but all three are `house_party`: capped at 10 guests. There is no purchase path in v1. The
honest first cut is to say so in the UI ("Your event is on House party — up to 10") rather
than default new events to a paid tier, which would give the ladder away and leave the
entitlement layer permanently unexercised in production.

Tier changes get a named service-role-only route (`set_event_tier`), **not** a column grant —
a grant reopens exactly what `init.sql:600-607` closed, and `verify-policies.sql` already
asserts a host gets 42501 trying.

## `my_events()` — an RPC, not a policy, and not realtime

The property to protect is that a guest cannot enumerate events **they are not in**. It has
never meant a guest cannot see events they joined — `events_read` already returns exactly
those. So My Events needs no new read permission; it needs a *fast* one. A bare
`select * from events` applies the policy as a filter and calls `my_guest_id()` and
`is_host()` per row of the whole table.

An RPC with three index-backed equality tests against `auth.uid()`, SECURITY DEFINER because
`guests` has no select policy at all — an INVOKER version's join to `guests` resolves to
nothing and a plain guest's events vanish from their own list.

**Fetch-once, not realtime.** `events` is in the realtime publication; an unfiltered channel
would authorize every event change in the project against every signed-in host. Same
reasoning already written for `blockRows`.

## Coexistence with `claim_host`

Three host provenances, and `claim_host` needs guards rather than a rewrite:

| | Row created by | Credential |
|---|---|---|
| Founder | `create_event` | their mailbox |
| Co-host / staff | `invite_host` (new) | a printed key |
| Legacy seeded | `seed-events.sql:158` | a printed key |

An anonymous co-host holding a key keeps working with zero changes — which is the point: the
DJ and the floor staff should not need accounts. Two guards to add: **the founder's seat is
not claimable** (rebinding is right when the key *is* the credential, wrong for an owner who
can re-verify an email), and **one seat per person per event**.

`invite_host` closes the `hosts.invite` stub and the `init.sql:669` open item, returning the
plaintext key once — it is never stored, only its bcrypt hash.

**Flagged debt:** enforcing host caps in SQL duplicates the numbers from
`src/domain/tiers.ts`, which will drift silently. The right fix is a `public.tier_limits`
table with a test that reads both and fails on mismatch — the same shape as `tokens.test.ts`
re-parsing `theme.css`. That table would also give `join_event` its missing `maxGuests` check.

## Account deletion — Guideline 5.1.1(v)

Accounts make in-app deletion mandatory. It cannot be a plain RPC: `auth.users` is not
writable by `authenticated`, and **deleting a `storage.objects` row does not delete the
bytes**. So it is an Edge Function holding the service role key — which is exactly what
`init.sql:494-496` already anticipated: *"a sweep must run as SERVICE ROLE rather than by
widening `event_photos_delete`."* This is that note's first real caller.

**Do not** add a `folders` DELETE policy or widen `event_photos_delete` to make this work
from the client.

Order is **bytes first, row second, idempotent**, with the idempotency being a null-out of
`storage_path` so an interrupted run resumes without repeating or skipping.

**The most consequential line in the whole design:** deleting an owner's account cascades to
their guests' photos. Third-party content. So the confirm screen must read the counts first
and name them out loud — *"3 events · 412 photos by 38 guests"* — and where another host is
bound, offer **Transfer** before Delete. A host who taps Delete and silently destroys 400
wedding photographs is the worst surprise this app could produce.

Orphaning events instead is rejected as a default: Runit would hold photographs of
identifiable people with no controller, nobody able to action a takedown, and nobody to
answer a report.

## What breaks

- **The `Session` union gains a variant**, and three route guards treat "not anonymous" as
  "in an event" — they would route a signed-in host with no open event into a guest tab bar
  rendering a null event.
- **Attribution regresses** for a host who is also a guest: the adapters read
  `s.kind === 'guest' ? s.nickname : 'Guest'`, so a host requesting a song is attributed to
  "Guest". Needs a `nickname` on the host variant or it ships as a visible wrong name.
- **`MemoryRepository` cannot honestly implement multi-event.** It holds one `ev` with flat
  `hostList` / `folderList` / `photoList` beside it. **Recommendation: do not restructure it.**
  Implement `events.mine` as `[current]` and throw loudly on `create`/`open`, the way
  `setTier` and `hosts.invite` already do on the Supabase side. This is the largest hidden
  cost in the request and should be decided deliberately, not discovered halfway.
- **Lane B proves none of this.** Every Playwright journey boots `dist/` against
  `MemoryRepository`. Sign-in, create, switch and delete are invisible to it. The lanes that
  can see this are **E** (`verify-policies.sql`, which skips loudly without `SUPABASE_DB_URL`)
  and **C** (the Android emulator, by hand). Say so in the PR rather than letting a green
  board imply coverage.
- **Nothing covers** the OTP round trip, the anonymous-upgrade token type, the edge function,
  or storage byte deletion. Those need rehearsal against the live project.

## Rejected, with reasons

1. **An email field on `JoinScreen`** — the fine print there is a product promise. A
   low-emphasis "Running this event?" link keeps it literally true; an input does not.
2. **Magic links as the primary flow** — `detectSessionInUrl: false` plus no associated-domains
   config makes the link dead weight on device. A 6-digit code costs one template edit and
   works everywhere.
3. **Auto-joining the founder as a guest** — a brand-new event would read "1 already here"
   before anyone arrives.
4. **Copying the host's email into any `public.*` table** — `hosts_read` publishes every
   column of `hosts` to every guest.

## Sequencing

Steps 1–2 are pure repair and land independently of whether accounts ship at all:

1. Fix the host-only fetch path.
2. Split `leave()` into `closeEvent` / `signOut`; add `events.open`.
3. Schema: `owner_user_id`, indexes, `events_read`, `create_event`, `my_events`, the two
   `claim_host` guards — and **extend `verify-policies.sql` in the same commit**, because
   this repo's rule is that a policy is what Postgres does with it, not what it says.
4. `Session` union + routing, then the `/account` screens.
5. `invite_host` (and `tier_limits`, if in scope).
6. Deletion: edge function, SQL helpers, `deletionImpact`, `transferEvent`, and the
   confirmation that names the counts.

## New assertions `verify-policies.sql` needs

An anonymous caller gets 42501 from `create_event`. An email caller gets a code, and the
event has exactly one folder with `active_folder_id` set. The founder is `is_host` immediately
and still cannot change `tier`. `my_events()` returns the caller's events and zero for a
stranger. A guest of event A cannot see event B. `claim_host` refuses the owner's seat and
refuses a second seat. And the crisp pair: **a host with no `guests` row gets zero rows
inserting into `photos` and `song_requests`; after `join_event` the same host succeeds.**
