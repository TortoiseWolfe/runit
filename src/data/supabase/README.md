# Supabase adapter — contract

Both halves exist now: the database, and `SupabaseRepository.ts`. This file
remains the **contract** — what an implementation has to satisfy — because the
adapter is not the only thing that will ever read it, and because two of its
requirements are still unmet (server-side `maxGuests`, issue #22; and the three
entitlements enforced only in the in-memory adapter, issue #21).

## The live project

| | |
|---|---|
| ref | `qwusbxallkbzfladvgfx` (public — it is the hostname) |
| url | `https://qwusbxallkbzfladvgfx.supabase.co` |
| org | `gnjjvppwbaljcklvwkis` — `RunIt`, owned by spoketowork@gmail.com · free · $0/mo |
| region | `us-east-2` |
| schema | `supabase/migrations/00000000000000_init.sql`, applied |

Credentials go in `.env.local` (gitignored). `.env.example` has the shape.

**`join_event` is an oracle** — a uuid on a hit, `unknown_code` on a miss — so a
code can be *guessed* even though the events table cannot be *listed*. The only
thing bounding that is the anonymous sign-in rate limit, which the GRANTS section
of the migration forces every call behind. Supabase's own docs contradict
themselves on whether that limit is adjustable. **Prove it by rehearsal.**

## The identity problem drives everything

Guests have no account. Use **Supabase Anonymous Auth**: `signInAnonymously()`
gives each guest a real `auth.users` row and a JWT, so every RLS policy stays in
the normal `auth.uid()` idiom. A new install is a new guest, which is correct.

Join becomes: `signInAnonymously()` → an edge function `join_event(code,
nickname)` that validates the code, checks the guest cap, and inserts a `guests`
row keyed to `auth.uid()`.

Hosts are normally authenticated users. One `auth.users` row can be both.

## What the interface already assumes

- **Reads are observables.** `Observable<T>` maps onto a Realtime channel
  subscription. `get()` is the current snapshot; `subscribe()` is the channel.
- **Writes are async and may reject with `EntitlementError`.** Tier limits are
  enforced in the write path. Mirror each check with a Postgres trigger or an
  RLS policy — a client-side-only check is not enforcement.
- **`hue` is stored on the photo**, not a colour. It survives migration and
  re-themes on a light/dark switch with no data change.
- **Ownership is by id.** `myVotes` is per-guest, from a `song_votes` row, not a
  client-local map.

## Schema sketch

Workspace convention is a single monolithic migration file with RLS on every
table. Tables: `events`, `hosts`, `guests`, `broadcasts`, `broadcast_reads`
(a trigger maintains `broadcasts.seen_count` — this is what makes "seen by 158"
honest rather than fabricated), `schedule_items`, `song_requests`, `song_votes`
(trigger maintains `vote_count`), `folders`, `photos`, `event_now_playing`.

Two policies worth calling out, because the design states them as product
promises on the join screen — "Hosts can see nicknames; guests can't see each
other":

- Guests may **not** `SELECT` the `guests` table.
- Guests may read only `approved` photos, plus their own pending ones.

## Races the in-memory adapter does not have

- `playNext()` must promote the top accepted request in one transaction, or two
  DJ devices promote the same track.
- Vote counts must come from a trigger over `song_votes`, not from incrementing
  a column.
