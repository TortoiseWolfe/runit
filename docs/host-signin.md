# Host sign-in, and what has actually been measured

#18. A host signs in with a six-digit code emailed to her; guests stay anonymous, which is
a promise printed on the join screen and is why sign-in is a quiet link rather than a field.

The screen is `/signin`, the seam is `session.requestEmailCode` / `submitEmailCode`, and the
decision that matters is in `SupabaseRepository`.

## The branch that can destroy an event

`create_event` binds a host seat to whatever `auth.uid()` was holding the phone, and
`is_host` matches on it forever after. So one screen serves two different acts:

| | what it is | the call | `verifyOtp` type |
|---|---|---|---|
| `attach` | she is still holding that identity | `updateUser({ email })` — KEEPS the uid | `email_change` |
| `sign_in` | second phone, reinstall, cleared app | `signInWithOtp` — mints a NEW uid | `email` |

Calling `signInWithOtp` in the first case succeeds, delivers a code, and leaves her event in
the database reachable by nothing but its recovery key. **Nothing raises.** `is_anonymous` is
the test, because it answers the only question that matters: can this identity still be
upgraded, or is it already somebody's account.

## What each layer proves, and what it cannot

- **The journeys** (`tests/e2e/signin.spec.ts`, 16) prove the SCREEN: two phases, the code
  field appearing, the countdown drawing no control, editing the address starting over. They
  boot `MemoryRepository`, which has no uids, so the destructive mistake is invisible to
  them — a mutation hardcoding `sign_in` once left all sixteen green.
- **The fixture** refuses a mismatched mode now (`pendingMode`), which is what killed that
  mutation. It is the backend's behaviour, not invention: `verifyOtp` rejects a correct code
  under the wrong type.
- **The adapter tests** (`SupabaseRepository.test.ts`) prove WHICH CALL goes out, by
  recording it. Four mutations die. They cannot prove what GoTrue does with it, because the
  fake answers for GoTrue.
- **`pnpm rehearse:signin`** proves the rest, against the live project, with a real inbox.

## Measured 2026-09-20, against `qwusbxallkbzfladvgfx`

```
--branch=attach   anonymous bdf8c83f… creates RZHHNS, attaches the address
                  -> uid UNCHANGED, is_anonymous false, my_events still lists RZHHNS
--branch=sign_in  the same address, no local session
                  -> lands on bdf8c83f…, the identity that holds the seat
--branch=exists   a fresh anonymous identity offers an address that is already an account
                  -> code "email_exists"
                     message "A user with this email address has already been registered"
```

The third is the shape `requestEmailCode` keys its fallback on. Without that fallback a
returning host is told her own address is unusable.

## The emails

Three templates, all carrying `{{ .Token }}` and no link, declared in
`supabase/config.toml` under `[remotes.production.auth.email.template.*]` and compared
against the live project by `pnpm audit:auth-config`. Seen arriving:

| template | subject | when |
|---|---|---|
| `confirmation` | Your RunIt sign-in code | first time an address is seen |
| `magic_link` | Your RunIt sign-in code | every sign-in after |
| `email_change` | Confirm your RunIt email | the attach branch |

FIDELITY note AZ has the history: for a day every one of these was Supabase's default
link-only body, over a completely green board.

## Two traps

**Send to a plus-address, never `jonpohlner@gmail.com`.** That address already holds a
non-anonymous `auth.users` row with no host seat, from a 2026-09-10 test signup. An attach
against it falls to `sign_in` by design — so a rehearsal aimed there silently exercises the
other branch and reports success.

**The per-address throttle is 60 seconds** (`max_frequency`). A second request inside it is
a 429 that names the remaining seconds; that is the configured behaviour, not a fault.

## What is still unproven, and needs a phone

- iOS autofill lifting the code out of the message (`textContentType="oneTimeCode"`).
- That a real host on a real device walks it without hitting anything the harness smooths.

## Residue

Each attach rehearsal leaves one event and one `auth.users` row; `--branch=exists` leaves a
throwaway anonymous user. Outstanding from 2026-09-20: event `RZHHNS`, and the users behind
`jonpohlner+runit-attach@` and `jonpohlner+runit-rehearsal@`. `docs/smoke-live.md` has the
manual sweep; #19's deletion path is the route that removes them through the product.
