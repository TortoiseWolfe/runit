# Deleting an account

#19, and mandatory rather than optional: App Store Guideline 5.1.1(v) requires in-app
account deletion for any app that lets a person create an account. #18 shipped host sign-in
on 2026-09-20, so this became required the same day.

## It cannot be an RPC, and two separate walls say so

- `auth.users` is not writable by `authenticated`.
- **Deleting a `storage.objects` row does not delete the bytes**, and
  `storage.protect_delete()` refuses every direct SQL delete on that table — for the project
  owner as much as for a guest. Lane E asserts it.

So the bytes come out through the Storage API with a service role, which only an Edge
Function holds: `supabase/functions/delete-account`, the `sweep-photos` shape.

## What decides, and where

| question | answered by | where |
|---|---|---|
| which events die | `public.sole_host_events(uuid)` | SQL, beside `hosts` |
| what that would cost | `public.my_deletion_impact()` | SQL, read before confirming |
| doing it | `delete-account` | Edge Function, service role |

The rule is **no other seat**, not "she is the founder". An event with anybody else's seat on
it survives and only her own seat is removed. That is why there is no Transfer action to
build — `invite_host` already mints another seat, so a host who wants her event to outlive
her account invites somebody first. An **unclaimed** seat counts: `invite_host` mints
`auth_user_id` NULL, and reading "no other seat" as "no other account" would delete the event
out from under somebody holding the printed key.

## Authorisation is the caller's own JWT

Unlike `sweep-photos` and `send-push`, this function needs no Vault secret. Those act on
everybody's behalf at a cron's or a trigger's say-so; this one acts on exactly one identity —
the one whose token it was handed. **The uid is read from the token, never from the body**, so
no request shape names somebody else. `verify_jwt` gets a caller past the gateway and proves
nothing (the publishable key is public); `auth.getUser()` is what proves a user.

Measured on the deployed function:

```
publishable key only  -> 401 {"error":"no identity on this request"}
GET                   -> 405 method not allowed
a real user's JWT     -> 200 {"done":true,...}
```

**An anonymous caller is allowed, deliberately.** A host who made an event and never signed
in has a seat, an identity and guests' photographs; refusing her would make the deletion right
conditional on first taking the sign-in step.

## Order: bytes first, row second, idempotent

`init.sql` has carried the rule since the first migration and the retention sweep still got it
wrong once, stranding 980 bytes. It matters more here: `event_photos_delete` requires the
**event to still exist** (`is_host(foldername(name)[1])`) and `hosts` cascades from `events`.
Delete the event first and `is_host()` goes false forever — nothing but a service role could
reach those objects again, and this function *is* that service role, having just thrown away
the name it needed.

**By prefix, not by row.** The sweep removes `[storage_path, thumb_path]` per photo row, which
is right for expiry. Here nothing of the event may remain, and an upload interrupted between
the storage write and the row insert has no row to be found by. `storage.list(<event_id>/)`
finds it.

**Bounded and resumable.** A cascade is one non-resumable statement and an event with 2,000
photographs is not one request. It returns `{ done: false }` until nothing is left, so an
interrupted deletion resumes instead of leaving an account half gone.

## What it deliberately does not delete

Photographs she uploaded at **other people's** events. `photos.uploaded_by_guest_id` is
`on delete set null` and `uploaded_by_name` is denormalised, so they stay in somebody else's
album under her name. That is third-party content in the other direction — another host's
event, other guests' memories — and the confirmation sheet says so rather than letting her
discover it.

Her seats on events that survive **are** removed: `hosts.auth_user_id` is `on delete set
null`, so deleting the user alone would leave an unclaimed seat whose `host_claims` hash is
still valid, claimable by whoever holds the printed key.

## Running it by hand

```bash
curl -sX POST "$SUPABASE_URL/functions/v1/delete-account" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "apikey: $PUBLISHABLE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run":true}'
```

Drop `dry_run` to delete. `{"limit":N}` caps objects removed per call.

## First real run

2026-09-20, against production, as the identity `pnpm rehearse:signin` had created:

```
my_deletion_impact -> events_deleted 1, events_kept 0, photos 0, guests 0
dry run            -> {"dry":true,"events":1,"objects":0}
delete             -> {"done":true,"events":1,"removed":0}
```

Read back afterwards: `event_preview('RZHHNS')` is empty from a fresh session, `my_events()`
is empty, and `auth.users` no longer holds that uid.

## Deploying it

```bash
pnpm supabase functions deploy delete-account --project-ref qwusbxallkbzfladvgfx
```

**Needs a legacy full-access token**; a fine-grained one answers 403 on the functions list
endpoint before it gets as far as deploying. Same split as `PATCH /config/auth` — see
`reference-supabase-tokens-and-scopes` in memory. Pass it for one invocation; it never
belongs in `.env.local`.

**No lane here executes an Edge Function**, so what proves this works is the run above and
lane H, not `run-checks.sh`.
