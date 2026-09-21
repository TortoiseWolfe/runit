# The browser guest route

A guest who will not install an app still has to be able to see the album and put a song
on. This is the build that lets them, how to prove it works, and the one flag that makes it
silently wrong. Issue #78.

## Three web builds, and only one of them is for a person

| script | output | flags | for |
|---|---|---|---|
| `pnpm export:web` | `dist/` | `FIDELITY=1` | lane B: screenshots and 442 journeys, on `MemoryRepository` |
| `pnpm export:web:live` | `dist-live/` | `FIDELITY=1` + `BACKEND=supabase` | lane H: the shipping adapter, through the harness |
| `pnpm export:web:guest` | `dist-guest/` | `BACKEND=supabase` | **a guest** |

**`dist-live` is not the guest build, and it is the one you will reach for.** It is the only
other script that talks to Supabase, so it looks like the answer. `EXPO_PUBLIC_FIDELITY=1`
is a harness switch, and four web halves branch on it:

- `capture.web.ts:113` hands back a synthetic 1×1 PNG instead of the camera roll.
- `musicSearch.web.ts:67` serves four fixture songs instead of a catalogue.
- `QrScanner.web.tsx:27` draws a fake scan button that feeds a hardcoded code.
- `save.web.ts:19` reports a save and writes nothing.

Every one is right in a harness and wrong in front of a person. Metro **inlines** the flag at
bundle time, so by the time there is a bundle the decision is invisible — which is why
`pnpm audit:guest-build` exists and runs on every checks pass.

## Proving it runs

`pnpm audit:guest-build` proves the bundle is not the harness one. It does not prove the
bundle works: one that exports cleanly and boots to a white screen passes it. That is
`pnpm prove:guest`.

```bash
pnpm supabase start                 # prints PUBLISHABLE_KEY and the ports
pnpm supabase db reset --local      # the committed migration, from scratch

EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421 \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_… \
  pnpm export:web:guest

pnpm prove:guest --key=sb_publishable_…
```

It seeds its own event through `create_event`, serves `dist-guest/`, and drives a real
browser:

1. the app boots and the join screen renders;
2. the code joins, and the screen names **the event row from Postgres** — a name no fixture
   has, which is what makes this different from every lane-B journey;
3. the join minted a GoTrue session key, so the bundle did not fall back to the fixture;
4. no `scheme-probe` in the DOM, which is the runtime half of the static audit.

**Against a local stack, never production**, and it refuses a non-loopback `--api` outright.
It creates an event; pointing it at the live project would leave a row per run, which is the
cost lane H pays deliberately and this has no reason to. The local stack is disposable, so
there is no sweep.

**Mutation-checked.** A `MemoryRepository` bundle dropped into `dist-guest/` fails at step 2:
the fixture renders Sam & Riley's wedding and the seeded name never appears.

## What it does not cover

Push, a real camera and universal links. Those need a phone, and `design/FIDELITY.md` says so
rather than implying coverage.

**Sign-in is lazy, and a first draft of `prove:guest` got this wrong.** A cold visitor holds
the `anon` role until they type a code; `signInAnonymously()` is on the join path. Asserting
a session on boot measured an eagerness this app does not have. See #79 for the one visible
consequence.
