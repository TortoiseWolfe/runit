# CLAUDE.md — Runit

Guidance for Claude Code working in this repository.

## What this is

An event companion iOS app, built from a Claude Design canvas. Guests join with
a code and a nickname — no account, no phone number — and get three tabs: Chat
(host announcements plus a run-of-show), Photos (a shared album where uploads
wait for host approval), Music (song requests ranked by guest upvotes). Hosts
get a console: Broadcast, DJ queue, Photo approvals. There is a four-tier
pricing ladder with working entitlement gates.

**The design is the spec, and it lives in `design/`.** Read `design/README.md`
before changing any screen.

## Stack

Expo SDK 57 · React Native 0.86.3 · **Node 24.13.0** · pnpm 10.33.0 · expo-router 57.
No NativeWind (see below).

**One Node version, declared by the repo and obeyed by everything.**
`.nvmrc` is the source of truth. `engines.node` is `24.x` — a single major, not a
range — and `.npmrc` sets `engine-strict=true`, so a wrong Node fails
`pnpm install` instead of warning. `docker/checks.Dockerfile` installs that exact
Node over the base image's own, and `run-checks.sh` asserts the two match before
running anything.

This is deliberate and it is the second attempt. The first arrangement let the
Playwright base image choose: checks ran on **v22.18.0** while development ran on
**v24.13.0**, and nothing said a word. Copying the sibling repos' `engines: ">=22"`
would not have caught it either — that range accepts both. If you bump
`@playwright/test`, bump `NODE_VERSION` + `NODE_SHA256` with it, or the assertion
fails loudly. That is the intended behaviour.

**Docker runs the checks; the host runs the app** — because native device
pairing and EAS live outside a container, not because a container cannot serve
Metro here. Measured on this machine: `.wslconfig` sets `networkingMode=mirrored`
and `eth0` is a real LAN address, so a published container port *is* reachable
from a phone; and the bind mount is native ext4 on a block device, so inotify
works and no polling watcher is needed. Do not repeat the folklore — if you ever
want Metro in a container here, the only real obstacle is that it advertises its
container-internal IP in the QR payload, which `REACT_NATIVE_PACKAGER_HOSTNAME`
fixes.

```
pnpm start                      # host  — Metro, devices, hot reload
pnpm start:go                   # host  — same, but targeting Expo Go (see below)
docker compose run --rm checks  # container — everything a CI job would do
```

**`pnpm start` does not target Expo Go, and the failure is opaque.**
`expo-dev-client` is a dependency, and its presence flips `expo start`'s default
target — the QR encodes `exp+runit://expo-development-client/?url=…`, which a
custom Expo Go **cannot open**. Scanning it produces a generic "problem running
the requested app" that names nothing. That cost an hour once.

Use `pnpm start:go` when pairing with an Expo Go client (including the custom
SDK-57 one on TestFlight), and `pnpm start` when pairing with a dev client built
by `pnpm android` or EAS. `--go` is absent from `expo start --help` in SDK 57 but
still works.

## The constraint everything is shaped by

**React Native cannot parse `oklch()`.** Its colour parser takes hex, named
colours, rgb/rgba, hsl/hsla and hwb. Anything else normalises to `null`, which
renders transparent — silently, with no error.

Every colour in the design is `oklch()`. So:

- `src/theme/oklch.ts` converts, and the canvas's runtime-generated hues
  (album tiles, photo placeholders) go through it at render time.
- `src/theme/tokens.ts` holds converted hex, each carrying its oklch source.
- `src/theme/tokens.test.ts` re-parses `design/theme.css`, re-runs the
  conversion, and fails on any drift. **Never hand-edit a token.**
- `tools/audit-native-styles.mjs` runs every colour literal in `src/` through
  the real RN parser and fails the build on any `null`. It resolves that parser
  **through react-native's own tree**, not by a bare `require` — there are two
  copies installed (`0.86.3` via react-native, `0.74.89` via react-native-web) and
  `node-linker=hoisted` means a bare require gets whichever won the hoist. It also
  asserts the parser version equals the installed react-native version. Do **not**
  "fix" this by declaring the parser as a top-level dependency: hoisting makes an
  explicit dep win, which would freeze the parser while react-native moves on —
  trading a loud failure for a quiet wrong answer in the one gate that exists to
  catch quiet wrong answers.

This is also why NativeWind is not used: react-native-web would parse `oklch`
correctly in a browser while the device dropped it, so the web harness would go
green on a broken app.

## Commands

```
pnpm start                      # host: Expo dev server
pnpm start:go                   # host: Expo dev server targeting EXPO GO, not the dev client

pnpm checks:docker              # container: every gate, in one run
pnpm checks:shell               # container: a bash shell in the same image

pnpm test                       # jest
pnpm typecheck                  # tsc --noEmit
pnpm audit:styles               # Lane A: the RN colour-parser gate
pnpm audit:targets              # Lane A2: touch targets, WCAG 2.2 SC 2.5.8 (AA)
pnpm audit:keyboard             # Lane A3: keyboard strategy + return-key contract
pnpm audit:rpc                  # do .rpc() argument names exist on the function they are sent to
pnpm supabase <args>            # the Supabase CLI at the ONE version this repo declares
pnpm audit:cli-pin              # nothing hardcodes a CLI version behind supabase/.cli-version
pnpm audit:auth                 # the four live auth switches the product cannot run without
pnpm audit:auth-config          # [remotes.production] vs the live project's auth config
pnpm audit:mail                 # the sending domain's DKIM/SPF, and the neighbour's inbound mail
pnpm send:otp --to=<addr>       # #18: a REAL sign-in code. --twice is the assertion that closes it
pnpm smtp:pass --verify-to=..   # write the SMTP credential, and prove it by sending
pnpm dns:plan                   # what our DNS intent would change. Writes NOTHING
pnpm dns:apply                  # write it
pnpm export:web && pnpm shots   # Lane B: screenshots at 402x874 + colour gate
pnpm test:e2e                   # Lane B: 442 Playwright journeys, dark + light
pnpm verify:links               # Lane G: is the invitation host OURS, and does it serve JSON
pnpm qr:poster                  # regenerate the scan target from the app's own EventQr
pnpm scan:device                # Lane C: witness expo-camera reading that QR off a real lens
pnpm export:web:live            # Lane H: build the export against SUPABASE, not the fixture
pnpm export:web:guest           # the SHIPPABLE browser build: backend flag, NO harness flag
pnpm audit:guest-build          # one env var separates a guest's build from the harness one
pnpm prove:guest --key=<local>  # drive that build at a LOCAL stack and join a real event
pnpm smoke:live                 # Lane H: drive the SHIPPING adapter against the live project
pnpm feedback:sync              # TestFlight tester feedback -> GitHub issues
pnpm render:canvas              # regenerate design/renders/ from the canvas
pnpm icons                      # regenerate assets/*.png from design/brand/runit-logo.svg
```

`pnpm checks` runs the same sequence directly, without Docker, when you are
already inside the container or want it on the host.

### How the container is wired

- Base is `mcr.microsoft.com/playwright:v1.55.0-noble`, and `@playwright/test` is
  pinned to **exactly** `1.55.0` — no caret. The image ships exactly one browser
  set and pnpm blocks the post-install download that would heal a mismatch, so the
  two have to agree. `run-checks.sh` asserts it. It used to be `^1.55.0` while this
  paragraph called it "the pin"; a seven-minor range is not a pin, and 1.55.1
  already moves chromium 1187 → 1193. If you bump `@playwright/test`, bump the
  image tag with it — **and its `NODE_VERSION`/`NODE_SHA256`**, because a new base
  ships a new Node.
- The image's own Node is shadowed by an explicitly pinned one installed to
  `/usr/local` (checksum-verified against nodejs.org). The repo picks the
  runtime; the base image does not.
- Runs as **uid 1000**, so `dist/` and `design/screenshots/` come back through
  the bind mount owned by you rather than by root.
- `node_modules` is a **named volume**, not the bind mount, so the container's
  install never fights the host's — which `pnpm start` still needs.
- The pnpm store is a named volume too, so repeat runs don't re-download.

## Verification lanes

**A2 knows about modal backdrops now**, rather than exempting them one file at a time. A
`flex: 1` Pressable inside a `<Modal>` is the largest target in the app and `flex` resolves
at runtime, so there is no number to read; the rule matches the STYLE and the enclosing
`<Modal>`, never the name, because a name is not a measurement. Two exemptions were deleted
when it landed. FIDELITY note AG.

**A2 — static touch-target audit** (`pnpm audit:targets`). The only lane that can
see a touch target at all: react-native-web **drops `hitSlop`**, so Lane B keeps
reporting failure after a correct fix, and `uiautomator dump` reports
accessibility-tree bounds rather than touch rects, so Lane C is blind too.

It is a **declaration** check, not a geometry check — resolving `StyleSheet.create`
through spreads and conditionals would be a heuristic wearing a measurement's
clothes. It asks whether every `Pressable` declares a reachable target, and carries
the same coverage floor as Lane A.

**The bar is WCAG 2.2 SC 2.5.8 (Level AA) at 24×24**, not 44×44. 44 is SC 2.5.5
(Enhanced), Level AAA — and Apple's HIG number, which is why it gets quoted as
though it were the standard. An audit run at the wrong level reports two dozen
false failures and gets switched off.

**A3 — static keyboard audit** (`pnpm audit:keyboard`). Same band, same doctrine: no
lane that runs in CI can see a soft keyboard. Chromium has none to raise, and
react-native-web renders `KeyboardAvoidingView` as a plain `View` with `behavior`
stripped while its `View` filters `keyboardShouldPersistTaps`, `submitBehavior` and
`automaticallyAdjustKeyboardInsets` out before they reach the DOM — so a Playwright
assertion passes identically on a correct fix and on no fix at all.

It checks that every screen holding a `TextInput` names a strategy, that every
`ScrollView` beside one declares `keyboardShouldPersistTaps` (RN's `'never'` default
eats the first tap on any button while the keyboard is up), and that every single-line
input wiring `onSubmitEditing` also declares `submitBehavior` rather than inheriting
it. It does **not** try to prove a `KeyboardAvoidingView` wraps a given input —
JoinScreen's wraps `Screen`, in another file — for the same reason A2 refuses to
resolve `StyleSheet.create`. FIDELITY note Q.

**Android does not resize for the keyboard here**, measured rather than assumed:
`edgeToEdgeEnabled=true` plus targetSdk 36 makes the manifest's `adjustResize` inert,
so the IME overlays exactly as on iOS. `/android` is gitignored prebuild output, so
that manifest line is Expo's default and not a decision — any real change goes through
`app.json`'s `android.softwareKeyboardLayoutMode`.

**RPC NAME AUDIT** (`pnpm audit:rpc`) -- #20's residue, and credential-free. PostgREST
resolves RPC overloads **by argument name**, so `p_titel` is a runtime 404 against a function
that exists: not a type error, not a crash, just a dead feature. **Nothing else in CI can see
it.** `database.types.ts` is HAND-WRITTEN, so tsc checks the call against whatever a human
last typed; `FakeClient` records what was sent and never evaluates it; lane B boots
`MemoryRepository`, which has no RPCs at all. Only lane H could, and lane H writes to
production and is deliberately not in `run-checks.sh`.

So it asks the same question of two files that are both in the repository: every
`.rpc('name', {...})` in `SupabaseRepository.ts` against the parameters
`create or replace function public.name(...)` declares. **Names only** -- not types, defaults
or order, for the same reason A2 refuses to resolve `StyleSheet.create`. Carries a coverage
floor, and catches the migration side too: dropping a parameter the client still sends fails
it. **The schema fingerprint cannot do this** -- it hashes a function as
`proname(identity_arguments)`, the SIGNATURE, so a body can be replaced wholesale under six
green lines.

**AND IT CANNOT SEE A CONSTRAINT AT ALL**, which #68 measured rather than assumed. The six
groups are policies, functions, columns, triggers, indexes and the `tier_limits` seed --
constraints are not among them, and a foreign key creates no index. So adding the real
`events_now_schedule_item_fk` moved **nothing**: production and a local build agreed on all
six before and after. A referential rule can therefore exist in the file and not in the
database, or the reverse, under a completely green board. That is why lane E asserts the
set-null BEHAVIOUR (delete the running row, read the cursor back) instead of asserting the
constraint exists -- a gate that cannot see a thing cannot guard it, and the honest response
is to check the thing somewhere that can.

**ONE SUPABASE CLI VERSION, DECLARED BY `supabase/.cli-version`.** The same rule `.nvmrc`
enforces for Node, applied to the other tool that can write to production -- and it was being
broken: `policies.yml` hardcoded `supabase@2.116.0` in four places while `npx supabase` on a
developer machine resolved to **2.117.0**, and nothing said a word. That is the `.nvmrc`
failure one tool over.

**IT MATTERED MORE THAN A VERSION NUMBER USUALLY DOES**, because the two differ in CAPABILITY:
`supabase config diff` -- the command an auth-config drift gate needs -- **does not exist
before 2.117.0**. A plan written against the local CLI would have been undeliverable in CI,
and the only symptom would have been a command not found.

**A FILE, NOT A devDependency**, which is Supabase's own documented install. pnpm 10 blocks
post-install scripts for packages not in `onlyBuiltDependencies`, and this repo relies on that
(see the Playwright note above), so a `supabase` devDependency installs a wrapper whose binary
never downloads -- and opting it in pulls ~40MB into a checks container that never runs the
CLI. Use `pnpm supabase <args>`; it reads the file.

**`pnpm audit:cli-pin` is static and credential-free** and runs in the normal sequence. It does
NOT execute the CLI -- that would cost a download on every checks run to learn what a file
already says. It asserts the declared version is exact (a range is not a pin), that nothing
hardcodes a different one, and carries a coverage floor so that "nothing consumes the file any
more" fails rather than passing silently.

**AUTH CONFIG IS DECLARED IN `[remotes.production]`** (`supabase/config.toml`, verified by
`pnpm audit:auth-config`). The database has been declared-and-verified for a while; auth
config was not -- SMTP, OTP length and expiry, signup toggles and rate limits all lived in a
dashboard with nothing recording the intent. A `[remotes.*]` block applies to ONE project by
ref, which is what keeps the local-first defaults above it -- a `127.0.0.1` site_url, a
loopback API port -- from ever being confused for production's.

**`supabase config diff` WAS THE PLAN AND DOES NOT WORK HERE.** It takes a legacy read path
demanding account-wide privileges and fails `LegacyConfigDiffReadStatusError` against a
fine-grained token that reads this project's auth config perfectly well --
`GET /v1/projects/{ref}/config/auth` returns 200 with the same credential. **The response was
not to widen the token to suit the tool.** A token scoped to one project's config is the right
credential; a subcommand needing account-wide rights for a project-scoped read is what is
wrong. The checker reads the endpoint directly.

**`--apply` HAS RUN, AND WHICH CREDENTIAL IT NEEDS IS THE WHOLE STORY.** Supabase's
fine-grained "Auth Config" permission, set to Read-write, enumerates ten endpoints and
**`PATCH /v1/projects/{ref}/config/auth` is not one of them** -- only `GET`, plus writes on
third-party-auth and SSO providers. Measured twice, including with a freshly minted Read-write
token: an empty PATCH answers 403 with *"your account does not have the necessary
privileges"*. Only a LEGACY full-access token can write auth config.

**That was recorded here for a day as "so a person changes it in the dashboard", and that was
wrong** -- not about the API, about the conclusion. A legacy token was dismissed as too much
privilege WITHOUT ONE EVER BEING TRIED, while the estate already held several. The measurement
that settled it is four lines long: GET and an empty PATCH against this project's config with
each token on the machine. Two answer 200/200 and two answer 403/403 -- the split is the
ACCOUNT, not the scope, because `ACCOUNTS.md` puts this project's org under
`spoketowork@gmail.com` and those are that account's tokens.

So on 2026-09-13 `--apply` wrote the four fields that had drifted -- `site_url`,
`mailer_otp_length`, `mailer_otp_exp`, `rate_limit_anonymous_users` -- and read them back.
`pnpm audit:auth-config` is green against the repo's own fine-grained token, which still only
needs `GET`.

**THE WRITE CREDENTIAL IS PASSED FOR ONE INVOCATION AND IS NOT IN THIS REPO.** `envLocal()`
prefers `process.env` over `.env.local` (`tools/lib/env.mjs`), so an account-wide token can be
put in front of one command and leave nothing behind. Putting it in `.env.local` would park a
credential that reads and writes EVERY project on the account inside a repo that needs `GET`
on one -- and `~/.claude` archives every file edit outside gitleaks, so a secret that never
touches a file is the only one that cannot end up there. The fine-grained token stays the
declared one.

The guards on `--apply` earned their keep on the first real run and stand: refuses under CI
(`compose.yaml` sets `CI: "1"`, so it is free), sends only declared fields rather than a
whole-config write, omits `smtp_pass` entirely rather than blanking it, and re-reads
afterwards because a 200 is not a value.

**NEVER APPLIED IS A DIFFERENT STATE FROM DRIFTED**, keyed on `smtp_host` -- Supabase has no
default for it, so a value can only be there because somebody applied one. Before that every
difference is a PLAN and the lane skips; after it, every difference is a REGRESSION and fails.

**`--selftest` EXISTS BECAUSE THE DRIFT LOGIC WAS OTHERWISE UNREACHABLE.** While the block has
never been applied every live run takes the pending branch, so mutations against the
comparison SURVIVED -- dropping the `disable_signup` inversion and declaring anonymous
sign-in off both left it green. Nine synthetic cases now run on every checks pass, with no
network and no credential, and all four of those mutations die against them.

**TWO MAPPINGS ARE TRAPS.** `enable_signup` is INVERTED into `disable_signup`; and
`max_frequency = "60s"` becomes `smtp_max_frequency: 60` -- which is the per-address OTP
throttle, NOT `rate_limit_otp`, a per-IP sign-in throttle on a five-minute window wearing a
similar name. Tuning the second while believing you tuned the first is the mistake.

**TOML comes via `python3 -c` and tomllib**, not a new package: Node ships no TOML parser,
`policies.yml` already shells to python3, and the checks container has 3.12.

**THE LIVE AUTH SWITCHES, CHECKED FOR FREE** (`pnpm audit:auth`). `GET /auth/v1/settings` is
PUBLIC and READ-ONLY: it needs the publishable key, creates no rows, and reports
`external.anonymous_users`, `external.email`, `disable_signup` and `mailer_autoconfirm`. That
combination is why this runs on every checks pass while `smoke:live` cannot -- it mints
nothing.

**IT EXISTS BECAUSE ONE OF THOSE WAS OFF AND A BUILD SHIPPED ON IT.** Anonymous sign-in is the
product; off, every join fails and the app reports a WRONG EVENT CODE, so nobody re-checks a
provider toggle. Only lane H could see it -- and lane H writes to production and is
deliberately not in `run-checks.sh`, so the one thing that could catch it ran least often.
`disable_signup` is here for the same class of reason: a host's FIRST sign-in is a signup, so
disabling signups kills every new host while every other setting reads correct.

**IT IS A SUBSET AND SAYS SO.** SMTP, OTP expiry, rate limits and the captcha secret are not on
this endpoint and need a Management API token. This is the free half of auth-config
verification, not the whole of it.

**`tools/smoke-live.mjs` RUNS ON IMPORT.** No main guard, all top-level: `import()` executes
it against production. Use `node --check` to test that it parses. Learned by creating event
`ZZANV9` while trying to verify a refactor compiled.

**DNS IS DECLARED, NOT CLICKED** (`tools/dns-intent.mjs`, `pnpm dns:plan` / `dns:apply`).
Four records for `runit.scripthammer.com` -- Resend's DKIM, the bounce MX and SPF on a
`send.` label, and our own DMARC -- live in a file, are applied by API, and are verified by
`audit:mail`. Ported from `ScriptHammer/scripts/ci/cloudflare-apply.mjs`, which already
managed one record this way: declared intent, a `plans[]` array, **dry run unless `--apply`**,
`--only` to narrow. **It stores no zone or record ids** -- everything is discovered by name,
which is what lets the same file run against a different zone the day RunIt gets its own apex.

**A DRY RUN THAT PLANS NOTHING IS THE ASSERTION.** `pnpm dns:plan` printing `0 changes` is how
you know live DNS still matches the file, and it cannot drift from what the applier would do
because it IS the applier.

**RESEND'S "AUTO CONFIGURE" WAS DECLINED.** It writes the records itself over an OAuth grant
-- which would hand a third party DNS-write on a zone carrying ScriptHammer's MX, root SPF,
DMARC and `admin@scripthammer.com`, a published security-contact address. A standing privilege
over all of that, to save a copy-paste, never revoked.

**NAMES ARE FQDNs AND RESEND SHOWS THEM RELATIVE.** `send.runit` means
`send.runit.scripthammer.com`; passing the short form to Cloudflare creates
`...scripthammer.com.scripthammer.com`, the domain never verifies, and nothing says why.
`assertFqdn` refuses the short form rather than trusting the next editor.

**MAIL POLICY** (`pnpm audit:mail`) -- #18, and RunIt is a GUEST ON SOMEBODY ELSE'S DOMAIN.
Host sign-in emails a 6-digit code; Supabase's built-in mail is 2/hour PROJECT-WIDE, so it
needs custom SMTP, which needs a sending domain. The decision (2026-09-12) is
**`runit.scripthammer.com`** -- a subdomain of a domain the owner already controls, already on
Cloudflare, already a verified **Resend** sender at its root (`dkimSelector: 'resend'`, and
Resend is wired across six repos in this workspace, so there was no provider decision left).

**A SUBDOMAIN, NEVER THE ROOT, and that is not style.** `scripthammer.com` carries LIVE
INBOUND MAIL -- Cloudflare Email Routing, and `admin@scripthammer.com` is the published
security-contact address for that project. Email Routing is inbound-only and its SPF include
already occupies the root TXT. Sending records go on the subdomain; the root is never edited.
The gate asserts BOTH halves, and the neighbour half is the one no other repo checks.

**It fails SILENTLY in both directions**, which is why a gate exists at all: a lost DKIM key
does not error, and under `p=none` nothing visibly breaks until a provider starts junking
sign-in codes. A guest never sees a bounce -- the host just cannot get in, and blames the app.

**NOT YET SET UP is a different state from BROKEN, and "not set up" means NOTHING AT ALL.**
An empty subdomain prints `SKIPPED:` (which `run-checks.sh` counts and names in the summary)
with instructions. Any signal present -- DKIM, SPF, the bounce MX or our DMARC -- means the
domain is in use, and every missing piece is then a FAILURE. Keying "configured" on DKIM alone
got this wrong: a domain whose signing key had been deleted off a working sender reported
`measured nothing` and advised setting it up, which is reassuring and false. Caught by
mutation.

**SPF LIVES ON THE BOUNCE LABEL, NOT THE SENDING DOMAIN**, and the first version of this gate
asserted otherwise. Resend puts SPF and the feedback MX on `send.<domain>` because SPF
authorises the ENVELOPE sender, not the From address. DMARC still passes: DKIM's `d=` is the
From domain so it aligns strictly, and SPF aligns in relaxed mode. Applying the real records
is what exposed it -- the gate cried "half-configured" over a correctly-configured domain.

**A REMINDER IS NOT A SKIP.** `SKIPPED:` is reserved for measured-nothing, because
`run-checks.sh` greps for that exact word. An outstanding task on a fully-measured domain --
today, `_dmarc` still at `p=none` -- prints `todo:` and stays green. Devaluing the word is how
a summary stops being read.

**DMARC IS AT `p=reject` SINCE 2026-09-20, AND THE STAGING WAS THE POINT.** It published at
`p=none` first: the plan said reject immediately, reasoning that our mail is 100% Resend and
therefore aligned -- sound, and still an ASSERTION, because no mail had been sent and nothing
had watched a receiver agree. The cost of being wrong at reject is the first sign-in code
refused outright rather than junked. What raised it is a message read out of the inbox, sent
16:37Z on 2026-09-20: `dkim=pass header.i=@runit.scripthammer.com header.s=resend`, `spf=pass`
on the bounce label, `dmarc=pass`. Both authentications pass and both align, so reject changes
what a receiver does with a forgery and nothing about our own mail. Publishing our own
`_dmarc` at all is what makes this possible: without it the subdomain inherits the neighbour's
policy and cannot be enforced independently of it.

**THE GATE COMPARES LIVE AGAINST DECLARED NOW, and the downgrade is the case worth catching.**
`DMARC_POLICY` is exported from `dns-intent.mjs` so the gate and the applier read the same
word. Weaker-than-declared is a FAILURE; `p=none` is only a `todo:` while the FILE also says
none. The first version hardcoded the staging, so a policy silently weakened back to none --
a dashboard edit, a restored zone file, a provider's "fix your DNS" wizard -- would have
printed a polite reminder to go and do the thing that had just been undone, and nothing
visibly breaks when it happens. **`pnpm audit:mail --selftest` runs on every board** because
live and declared now both read `reject`, so every real run takes the ok path and the
downgrade branch would otherwise be unreachable and untested forever. Eight synthetic cases;
deleting the weaker-than check kills two.

**EVERY MAIL GATE HERE IS GREEN OVER A MAILER THAT CANNOT SEND** -- measured 2026-09-13, and
it is the sharpest example in this repo of a gate that reports green having measured the wrong
thing. `audit:mail` is green: four DNS records, DKIM on the sending domain, SPF and the MX on
the bounce label, our own `_dmarc`, the neighbour intact. `audit:auth-config` is green on
thirteen declared fields, and all six SMTP fields read back correctly -- `smtp.resend.com`,
port 465, user `resend`, sender `no-reply@runit.scripthammer.com`, a password set. And the
first real send answered **500 `unexpected_failure`**, with the cause visible only in GoTrue's
own log: `535 "Authentication credentials invalid"` from smtp.resend.com.

**NOT ONE OF THOSE CHECKS COULD HAVE SEEN IT, and the reason generalises.** DKIM, SPF and
DMARC are PUBLIC RECORDS -- they describe what a receiver should believe about mail that
arrives, and are equally true of a domain that has never sent any. The config endpoint returns
`smtp_pass` as a 64-character hash by a construction Supabase does not document, so presence is
checkable and correctness is not. Between them they prove the envelope and say nothing about
the credential. **The only check that can is a send**, which is why `pnpm send:otp` exists and
why `pnpm smtp:pass` refuses to report a write as done until a message has been accepted.

**AND A SEND WAS STILL NOT ENOUGH, because the envelope is not the letter (FIDELITY AZ).**
With everything above green, five real sign-in emails reached the owner's inbox carrying
Supabase's DEFAULT body -- *"Follow the link below to sign in"*, a `type=magiclink` URL, and
NO six-digit code -- against a screen that asks for six digits. Host sign-in could not
complete against production, and the link consumes the one-use token, so following it destroys
the code. `docs/design-host-accounts.md` had said since it was written that OTP "costs one
template edit"; the edit was never made, and the default template is not missing but present,
plausible and wrong.

**THREE TEMPLATES, AND DECLARING ONE IS WORSE THAN DECLARING NONE.** GoTrue picks by
situation: `confirmation` the first time an address is seen, `magic_link` every time after,
`email_change` for the attach branch. One declared means a host's first sign-in works and her
second does not, which reads as an intermittent product. They live in `supabase/templates/`,
are declared as `content_path` under `[remotes.production.auth.email.template.*]`, and
`pnpm audit:auth-config` compares the FILE against the live project (19 declared fields now,
trimmed at both ends so a round-tripped newline is not a red gate). **No
`{{ .ConfirmationURL }}` in any of them** -- not for tidiness, but because tapping it spends
the token the person is about to type.

**`--apply` RE-READS EVERY DECLARED FIELD NOW, not only the ones it sent** -- the SMTP outage
generalised. A check that inspects only what it wrote cannot see a write damaging what it did
not, which is exactly how `{ smtp_pass }` alone nulled five siblings under six green lines.

**`PATCH /config/auth` REPLACES THE SMTP BLOCK, IT DOES NOT MERGE INTO IT** -- and getting
that wrong turned custom SMTP off while every send still answered 200. A PATCH carrying
`{ smtp_pass }` alone nulled `smtp_host`, `smtp_port`, `smtp_user`, `smtp_admin_email` and
`smtp_sender_name` in one write. Supabase then fell back to its BUILT-IN mailer, so the next
two sends succeeded -- spending the built-in 2/hour allowance, from an address the entire
sending domain exists to replace. `rate_limit_email_sent` dropping 30 -> 2 on its own is the
tell; nothing else says a word.

**THE REPO ALREADY KNEW THIS TRAP UNDER ANOTHER VENDOR'S NAME.** `dns-apply.mjs` carries it:
*"a Cloudflare rule PATCH REPLACES the rule (replay every field)"*. So `pnpm smtp:pass` sends
all six fields, reading the five non-secret ones from `[remotes.production.auth.email.smtp]`
so it cannot disagree with `audit:auth-config`, and reads them back afterwards -- which is the
check that would have caught it. It is also the ONE place `--apply`'s rule, *send only the
fields that drifted*, is actively wrong: right for independent scalars, unsafe for a composite
block, where unsent siblings are not left alone but erased.

**THE SENDING DOMAIN IS NOT VERIFIED AT THE PROVIDER, and that is invisible to every gate
here.** With custom SMTP correctly restored, a send reports `550 "The runit.scripthammer.com
domain is not verified"`. The four DNS records are live and `audit:mail` is green on all of
them -- publishing the records and the provider having CHECKED them are different facts, and
only the second lets mail leave. A key restricted to the wrong domain reports the same refusal
in different words (*"not authorized to send emails from ..."*), so read the verbatim SMTP
error out of `auth_logs` rather than inferring from the 500. **No gate here can close this
gap**: the provider's API is blocked by `block-outbound.sh`, deliberately, so verification is
a human act at a dashboard and is recorded as one.

**RUNIT SENDS ON SCRIPTHAMMER'S RESEND KEY, BY DECISION -- do not re-open this.** The key
is `re_YVidFAp3...`, already in `ScriptHammer/.env` and now in `runit/.env.local` as
`RESEND_API_KEY`, and it is what the three accepted sends on 2026-09-13 went out on. The
alternative -- a sending-only key restricted to this subdomain -- is better on least
privilege and was tried: it answers
`550 "This API key is not authorized to send emails from runit.scripthammer.com"`, because
Resend fixes a key's domain restriction AT CREATION and it was scoped to the apex. The cost
of the key in use is blast radius, not exposure: it never passes through a transcript, and it
is the sending identity for six repos, so a leak of RunIt's auth config would be an estate
problem. That trade was made deliberately by the owner, three times, and a session that
re-litigates it wastes an evening -- as one did.

**READ THE INBOX WITH THE GMAIL TOOL, AND SEND TO A PLUS-ADDRESS.** The connector reads
`jonpohlner@gmail.com`, so the last half of every mail claim -- arrival, the body, the
`Authentication-Results` header -- is measurable here rather than being handed to a person.
Send to `jonpohlner+runit-rehearsal@gmail.com`, NEVER the bare address: it already holds a
non-anonymous `auth.users` row with no host seat from a 2026-09-10 test signup, so attaching
it from a phone holding a real seat gets `email_exists`, falls to `sign_in`, and lands in that
empty identity with the host's party apparently gone.

**A 200 FROM THE SEND IS STILL NOT A DELIVERY.** GoTrue answers the moment it hands the message
to SMTP. Acceptance, arrival and `dkim=pass d=runit.scripthammer.com` are three claims, and
only the first is reachable from here -- the other two need a person with an inbox. Both tools
print that on every run rather than letting a green line imply it. Same doctrine as lane H
printing that push is uncovered.

**THE ESTATE'S CONVENTION IS ONE PRODUCT, ONE APEX DOMAIN, and this departs from it
deliberately.** `ACCOUNTS.md` records *"a project belongs to the account matching its
domain"*, and every sibling has its own (`spoketowork.com`, `geolarp.com`, `turtlewolfe.com`).
This is the first time a second product has lived under another product's domain. It costs
nothing and unblocks the queue; it is a decision, not drift. Ported from
`ScriptHammer/scripts/ci/check-mail-policy.mjs`.

**THE APP STORE LISTING IS WRITABLE FROM HERE, AND A SESSION ASSUMED OTHERWISE.** The
issuer id is `0d47c4c8-5733-414f-a707-df2282d960a8`, the key id `W92D4L6F5B`, and the `.p8` is
at `~/.appstoreconnect/private_keys/`. Neither the issuer nor the key id is a secret; the key
is, and it never leaves that file. ES256 with `dsaEncoding: 'ieee-p1363'` -- Node's default
DER signature is rejected. **Read the enum back rather than remembering it**: the valid
screenshot display types, and the fact that `contests` is a frequency STRING while
`ageAssurance` is a BOOLEAN, all came from Apple's own 409s.

**A SPARSE FIELDSET CAN READ BACK NULL OVER A VALUE THAT IS THERE.** `PATCH` the app's
`contentRightsDeclaration`, then `GET /v1/apps/{id}?fields[apps]=contentRightsDeclaration`, and
the attribute comes back **null** while a plain `GET /v1/apps/{id}` shows it set. So the write
was fine and the VERIFICATION was broken -- which is the more dangerous direction, because it
invites re-writing a field that was never wrong. Read back with the same shape a plain GET
uses. Found by the repo's own rule that a 200 is not a value; the rule caught its own check.

**THE DESCRIPTION NAMED TWO THINGS THE APP DID NOT DO (#69), and they were different kinds of
wrong.** *"Runit emails everyone the link"* -- `invitees.send` opens the SHARE SHEET
(`SupabaseRepository.ts`), so the host sends it from her own phone and Runit mails nobody;
that one was reworded, because emailing people who have never heard of the app is a product
and legal decision this repo took deliberately. *"The host approves them before they appear"*
-- that one was made TRUE instead, by flipping `events.photo_moderation` to default on.

**SCREENSHOTS COME FROM `?free=1`, AND THAT IS NOT A DETAIL.** The walk boots the demo wedding
-- Event tier, 172 guests -- which is right for comparing against `design/renders/` and wrong
for the store: v1 ships free-only with no purchase path, so those numbers advertise a capacity
nobody can buy. #69 called it "a configuration the product cannot produce". `?free=1` boots
`housePartySeed`, which CLAUDE.md had recorded for months as reachable only from
`MemoryRepository.test.ts` -- "no lane that renders a screen has ever seen a capped event".
Now one has. `SHOT_PRESET=appstore` shoots 430x932@3x = **1290x2796** (`APP_IPHONE_67`); it was
1242x2688 (6.5"), still an accepted slot but no longer the one Apple asks for first.

**"UNDER SCRIPTHAMMER" CANNOT MEAN THE APP STORE SELLER NAME.** The Apple membership is
**Individual** (`ACCOUNTS.md`), and Apple lists the person's legal name as seller -- *"Do not
enter an alias, nickname, or company name."* A studio name needs an Organization account,
which needs a real legal entity (*"DBAs, fictitious businesses, trade names... are NOT
accepted"*) plus a D-U-N-S number. Decided 2026-09-12: **branding only.** RunIt keeps
`com.turtlewolfe.runit`, app record `6808766120` and TestFlight builds 3-7 -- a bundle id
cannot change once builds exist, so moving namespace would mean a new app record.

**HOST SIGN-IN IS A SCREEN NOW (#18), and its one real risk is invisible to every lane
here.** `/signin`, reached by a quiet link on the join screen. `requestEmailCode` answers
`attach` or `sign_in`, the screen CARRIES that answer to the verify step, and sending the
wrong one calls `verifyOtp` with the wrong `type` -- which rejects a CORRECT code, and on the
`sign_in` branch mints a NEW `auth.uid()` that orphans the host's event behind its recovery
key.

**AND THE ADAPTER'S OWN BRANCH IS TESTED NOW, where the decision actually lives.** The seam
commit said this was invisible to every lane but H, which was true of the FIXTURE rather than
of the adapter -- `MemoryRepository` has no uids to lose. `FakeClient` models `getUser`,
`updateUser`, `signInWithOtp` and `verifyOtp` and RECORDS THE CALLS, because both branches
resolve and neither raises: a test that could only read the return value would pass on the
destructive one. Four mutations die, including the one that survived all sixteen journeys
(hardcoding `sign_in`, which kills two). Lane H is still the only thing that can prove the
uid SURVIVES; this proves the call that decides it.

**THE FIXTURE NOW REFUSES A MISMATCHED MODE, AND IT HAD TO.** `MemoryRepository` ignored the
mode (`void mode`), so a mutation hardcoding `'sign_in'` in the screen left **all sixteen new
journeys green** -- the single most consequential mistake in the feature, unobserved. It
remembers `pendingMode` and raises `bad_email_code` on a mismatch, which is not invention:
that is exactly what `verifyOtp` does with the wrong type. The fixture being kinder than the
backend is the failure this adapter exists to avoid, and this is the third time that rule has
paid for itself after #66 and the nameless guest.

**NO EMAIL FIELD ON THE JOIN PATH, and a journey is the only thing holding it.** The fine
print there promises "No account, no phone number"; a sign-in field under that sentence makes
it read as false to nearly everyone who opens the app. So sign-in is a LINK, the same call
`JoinScreen` already made for the create link, with more force. Mutation-checked: adding a
field turns four journeys red.

**THE RESEND THROTTLE GETS ITS OWN SENTENCE.** `max_frequency = "60s"` is PER ADDRESS, and
`authJoinReason` maps every 429 to `rate_limited` -- *"Too many people joining at once"*,
which is true at a door and nonsense shown to one host who tapped Resend early.
`emailCodeReason` maps `over_email_send_rate_limit` to `code_too_soon` instead. The screen
counts the seconds down and **draws no control at all while it runs**, rather than a disabled
one: `empty-world.spec.ts` asserts `[aria-disabled="true"]` has count 0, which is this repo's
gate against a door nobody can open.

**AND THE WHOLE ROUND TRIP IS REHEARSED AGAINST PRODUCTION NOW** (`pnpm rehearse:signin`,
`docs/host-signin.md`). Two phases with an inbox in the middle -- `--phase=request` writes its
session to `--state`, `--phase=verify --code=` picks it up -- because the unit tests prove
WHICH CALL goes out and only a real round trip proves what GoTrue does with it. Measured
2026-09-20: an anonymous host created `RZHHNS`, attached an address, and came back with the
SAME uid still listing her event; a sign-in on the same address landed on that same identity;
and an address already belonging to an account answers `email_exists` / "A user with this
email address has already been registered", which is the shape the fallback keys on. **It
writes to production and mails a real person**, so it refuses under CI and is never in
`run-checks.sh` -- the standing of `smoke:live`, one step stronger. Each attach run leaves one
event and one `auth.users` row.

**TYPED ROUTES ARE ENFORCED LOCALLY AND NOT IN CI, so a bad route path passes the board.**
`.expo/types/router.d.ts` is generated by the DEV SERVER (not by `expo export`) and `.expo/`
is gitignored, so the checks container has no such file and `router.push('/typo')` typechecks
clean there. Locally it is enforced against whatever the last `expo start` wrote -- a file
that goes STALE the moment a route is added, which red-flagged `/signin` as a non-route while
the route existed. Delete it and it regenerates; do not read a local route error as truth
without checking its date.

**A — static style audit** (`pnpm audit:styles`). The only check that catches a
colour RN cannot parse. Has a coverage floor: if it audits fewer literals than
expected it fails, because a matcher that stops matching passes having measured
nothing.

**B — web export → Playwright at 402×874.** Two halves over one `dist/`.

`pnpm shots` walks the screens and writes PNGs, ending with a **colour gate**
that reads base-100 back out of every one — added because the DOM once reported
dark while the screen was light, and only the pixels caught it — and a **contrast
gate** that composites every rendered text colour over its painted backdrop and
fails below WCAG AA. Contrast, unlike `hitSlop`, is honestly measurable in this
lane: `alpha()` emits a real `rgba()` over real DOM backgrounds.

...and a **gutter gate**, on the same footing and for the same reason. `padding` is not
`hitSlop`: react-native-web renders `paddingHorizontal` as real CSS padding on a real
element, so `getBoundingClientRect()` reports where the pixels actually are. It asserts
one narrow thing — **nothing readable or tappable within 8px of either edge** — not that
every gutter is 20, which would fail the tab bar (12) and the join screen (24) and be
switched off inside a week. `<Screen>` sets VERTICAL insets only, by design, so a content
container that omits `paddingHorizontal` renders flush at x=0; that shipped on both create
screens, including the one that prints the recovery key. FIDELITY note X.

`pnpm test:e2e` runs 442 journey tests (`tests/e2e/`) across both colour
schemes: join and its rejection path, the three guest tabs, the host console,
the pricing ladder and every denial it can render, and the painted theme
tokens. Each spec was written against the canvas and then attacked by a critic
whose only brief was to find assertions that would pass on a broken app; 35
were cut for exactly that. Where an assertion cannot prove what it looks like
it proves, the file says so in its docblock rather than implying coverage it
does not have — `join.spec.ts` is the worked example.

**Both halves need a `dist/` built with `EXPO_PUBLIC_FIDELITY=1`** (`pnpm
export:web` sets it). It injects the iPhone safe-area insets a browser reports
as zero, and renders the `scheme-probe` element every test waits on. Export
without it and the whole suite times out without naming the reason.

**`initialMetrics` ALONE DID NOT DO THAT, AND THIS FILE SAID OTHERWISE FOR MONTHS.**
`react-native-safe-area-context`'s web provider measures `env(safe-area-inset-*)` on mount
and reports zero, overwriting whatever was injected — so every screenshot was taken with
the insets collapsed while `design/renders/` was drawn from artboards that pad 66/70/28
*because* of the device frame. Lane D was comparing a ~70pt offset and reading it as close
enough. The metrics now go straight into `SafeAreaInsetsContext` and `SafeAreaFrameContext`
inside the provider, and a hidden `inset-probe` renders what `useSafeAreaInsets()` actually
returns so `pnpm shots` fails loudly if it is ever discarded again. #7, FIDELITY note AN.

**C — Android emulator** (`pnpm android`). Wired up and **load-bearing**. It has
now also witnessed a real camera capture end to end — permission prompt, system
camera, resized JPEG written to the app's own cache, and the image rendering in
the host approval queue beside seeded rows that still show their hue tile
(`design/device/android-host-photos-capture.dark.png`). No other lane can do
that: react-native-web has no camera. This is
the only *native* rendering evidence obtainable without a Mac, and it earned its
place immediately: it caught an album grid that renders nine tiles on the web and
nothing at all on a device (see `design/FIDELITY.md` note G). Lane A could not see
it because it is not a colour; Lane B could not see it because Lane B runs
through the renderer that gets it right.

```
pnpm android           # builds the dev client and installs to a running emulator
pnpm scan:device       # Lane C, scripted: the QR scanner, witnessed
ADB_LIBUSB=0           # REQUIRED on WSL2 -- see below
```

**Lane C is a SCRIPT now, not a hand-driven session** (`pnpm scan:device`, #42,
`docs/qr-scan-lane.md`). It hangs a QR generated by the app's own `EventQr` on the virtual
scene's wall, walks the virtual device to it, and asserts the code arrives in `join-code` —
which nothing but the camera can put there. It also **measures that the preview paints**,
because `CameraView` mounts long before it produces a frame and a black SurfaceView passes
every check short of reading pixels.

**IT RUNS IN CI NOW, AND THE PREVIEW PAINTS THERE (#46).** `.github/workflows/lane-c.yml`,
dispatch-only, `gh workflow run lane-c.yml`. The doubt recorded in its own header — that the
virtual-scene camera under swiftshader "may simply not work on a hosted runner" — is
answered: the emulator boots in ~40s under `-camera-back virtualscene -gpu
swiftshader_indirect`, Gradle builds the dev client in ~11m, and the lane reads **SR1017 off
the wall with `the preview is painting (mean 86.6, spread 32.5)`**. A dead surface is
near-zero on both numbers, so that line is the measurement, not a hope.

**It took six runs and every failure was the HARNESS, never the app.** Two of them are worth
knowing because both make a working app look broken:

**`android-emulator-runner` splits `script:` on newlines and runs EACH LINE in its own
`sh -c`.** A multi-line block is therefore not a script; it is a list of one-liners that
share nothing. `set -eu` applied to a shell that exited immediately, `export ADB_LIBUSB=0`
never reached `scan:device`, `pnpm start &` was backgrounded into a shell that then exited,
and a `for` loop was torn from its `done` — and only the loop said anything out loud. That
is why the whole thing lives in `tools/lane-c-ci.sh` and the workflow's `script:` is ONE
LINE. Anything added there goes in the file instead.

**expo-dev-client shows a one-time developer-menu sheet on the first launch of a freshly
installed build, and it covers the join screen.** It is a WINDOW, and `uiautomator dump`
reports the topmost one only — so `join-code` is genuinely absent from the hierarchy while
the join screen sits fully rendered behind it. Invisible on this machine, because the dev
client here was onboarded long ago and the flag persists; CI installs a new APK every run,
so it appears every run. Three CI failures read `the app never reached the join screen`
while the screenshot beside them showed the event name and the headcount. `scan:device`
dismisses it now, from the same dump the `join-code` lookup just missed.

**AND IT LEAVES STATE WHEN IT FAILS**, which it did not for the first five runs. `fail()`
printed a sentence and exited, so the one process that could see the device threw away
everything it knew — three consecutive failures could be diagnosed only by running a
fourth. It writes `test-results/lane-c/` now: `screen.png`, `hierarchy.xml` and
`logcat.txt`, the siblings of `test-results/lane-b` and `lane-h`. Deliberately NOT
`design/device/`, which holds COMMITTED evidence: the CI artifact was pointed there and
uploaded five PNGs straight out of the checkout, presenting files already in git as frames
from the run.

Three traps it paid for earlier, all of which make a BROKEN run look fine or a FINE run look broken:
`virtualscene-image` answers OK whether or not it did anything, so the poster must be hung
**before** the scanner opens or the lane silently reads whatever `-virtualscene-poster` put
there at launch; `adb reverse tcp:8081 tcp:8081` is installed by `expo run:android` as a side
effect, so the lane worked only until the emulator was restarted; and `am force-stop` returns
before the process is gone, so the launch intent after it is swallowed exactly as if there
had been no force-stop.

**The AVD ships with `hw.keyboard = no`.** Host keystrokes are silently dropped:
you click into a field, type, and nothing happens — the app looks broken and is
not. Gboard also comes up in floating mode, which makes it look like the field
itself is dead. Fix it in `~/.android/avd/<name>.avd/config.ini`:

```
hw.keyboard = yes        # then restart the emulator; `dumpsys input` should
                         # list "AT Translated Set 2 keyboard"
```

**Driving the emulator from a script — two traps.** `adb shell am start` with a
dev-client URL is **swallowed if the app is already foregrounded**; always
`am force-stop` first or the launch silently no-ops and you debug the wrong
thing. And `adb exec-out screencap` frequently returns a **stale frame** just
after navigation, so a screenshot can show the previous screen while the app has
already moved on. Confirm state with `uiautomator dump` — it reads the live
hierarchy — and treat a screenshot as illustration, not proof.

**`adb` hangs on WSL2 without `ADB_LIBUSB=0`.** `adb start-server` and even
`adb nodaemon server` produce no output at all and never return, because adb
blocks enumerating USB. Export `ADB_LIBUSB=0` and it starts instantly. This costs
an hour if you do not know it.

Device screenshots live in `design/device/`, including the pre-fix broken album
kept deliberately as evidence.

**D — the eye.** Read `design/renders/<screen>.png` and
`design/screenshots/<screen>.png` in the same message and walk the regions in
order. Programmatic probes catch a different class of thing; neither substitutes
for the other.

**It is a COMPARISON, so it does not run at all on a screen with no render** -- and it
does not fail either, it silently measures nothing. **`pnpm shots` now says which**, in a
pairing gate beside the colour, contrast and gutter ones (#35). Do not read "all gates
green" as "every screen was looked at"; read the gate's own lines.

Measured, and it was worse than #35 recorded: **8 of 11 walked screens pair, and the five
that did not were two different problems.** THREE have no render at all --
`00-create-event` and `00-create-key` came from `docs/design-host-accounts.md` rather than
the canvas, and `03-host-event` is a fourth host segment the canvas never drew, recorded
nowhere until the gate counted it. TWO had a render under a different NAME: the canvas
draws two states of the music and photos tabs and the walk shoots one, so following the
instruction above literally found nothing and lane D had never run on either.

**The variant mappings were READ, not guessed, and the obvious guess is wrong.**
`02-guest-music` pairs with `-nowplaying`, NOT `-list`: both draw the queue, only one draws
the Now Playing card, and the walk's music tab has it. A mapping to the wrong render is an
absent check replaced by a WRONG one, which is worse than the gap.

**The gate does not fail on the three.** It fails on a screen in neither the manifest nor
`renders/`, so a new screen costs one line and a sentence -- and the manifest must be a
bijection with the walk, so a stale entry fails too. A gate that reds the normal path is a
gate that gets switched off.

**F — QR decode** (`pnpm verify:qr`). The only check that reads what the QR actually
ENCODES. It drives the web export to the host console, opens the QR, screenshots that
element and decodes the pixels with jsQR.

An e2e assertion on `[data-testid="event-qr"]` proves a box is on screen and nothing about
what is in it — and a QR encoding the wrong string renders perfectly, scans perfectly, and
takes the guest nowhere. Chromium's `BarcodeDetector` is unavailable on this platform
(checked), so decoding is the only route. It also fails when the code is merely
undecodable, which is the contrast/quiet-zone/resolution class a camera in a dim room
would hit.

**H — the adapter that ships, against the database that ships** (`pnpm export:web:live &&
pnpm smoke:live`). Forty checks driving `SupabaseRepository` through a real browser against
the live project: `create_event`, the founding host seat, a broadcast round-tripping through
realtime, a founder taking a guest seat (#37), her seat NOT counted in the room,
`request_song` both inserting and merging (#44), and **the whole photo chain** — two objects
uploaded, the album rendering a SIGNED THUMBNAIL that has actually decoded, and the viewer
signing the full-size object by a different path.

**The photo assertions have three clauses and all three are load-bearing.** An `<img>` whose
src 403s renders nothing while every DOM assertion still passes; and decoding alone is
satisfied by the `data:` URI of the guest's own bytes, which would prove only that
`capture.web.ts` works. So: decoded, AND a signed storage URL, AND naming `_t.jpg`.
Mutation-checked by deleting `displayUrl` from `photoCache`'s comparator — the exact failure
its own comment warns about — which turns the album red and leaves the viewer green, because
the viewer resolves on demand rather than through the comparator.

**A SECOND BROWSER CONTEXT is what unlocks the rest.** Reports refuse a self-report,
blocking needs somebody to block, and "seen by" needs a reader who is not the author — none
of it reachable with one identity. It is also the only test of realtime BETWEEN clients
rather than a client hearing its own echo, and it makes two numbers real that Memory cannot
model: the room reading 1 while `guests` holds 2 (`guest_seats` excluding the host's seat),
and `seen_count` moving off zero.

**Exactly ONE assertion there is about realtime delivery** — the broadcast, which reports
its own latency. Every host segment refetches on navigation, so "the row reached the queue"
and "a websocket pushed it in N seconds" are different claims, and blurring them is how a
lane earns a reputation for flakiness. Measured: realtime usually lands in 240ms–1.2s, and
twice in ~15 runs a row never arrived (#45). Folded counters need the same care —
`fold_invited_count` reaching the composer read "Send to 0 guests" once in four runs when
read immediately instead of waited for.

**PHOTO MODERATION IS COVERED NOW, and the reason it was not has gone rather than the
risk.** This paragraph said the approval queue "has no reachable state in any event the app
can currently create", which was true and was the defect: `create_event` mints
`house_party`, which auto-approved, and no client can set `events.tier` (#30). Approval is a
switch on the EVENT now — any tier, default off — so the lane creates a free event, turns it
on, uploads as a guest, and asserts the photo is ABSENT from the album, PRESENT in the host
queue, and in front of the room once approved. Only this lane can see that chain: the column
has to be in the UPDATE grant or PostgREST fails the whole statement with 42501, the write
has to match `events_host_update` or it affects zero rows silently, and `set_photo_status`
is a SECURITY DEFINER trigger reading a column the client cannot name on INSERT. Lane B
proves none of it — it boots `MemoryRepository`, where the flag is a field on an object.

**The assertion it turns on is the TOAST, not the toggle's own label**, which the first
draft got wrong: it failed on its first run with `photo_moderation = true` already in
Postgres and the button still reading Off. The label repaints from the `events` observable,
fed by a realtime channel, so waiting on it asserts WEBSOCKET DELIVERY while claiming to
assert a write. Exactly one assertion in this lane is about realtime, deliberately.

**Push is still NOT covered, and it is not a matter of effort.** `push.web.ts` returns null
by design — a fake token would be stored as a routable address that routes nowhere. It is
printed at the end of every run so a green board is not read as "the backend works".

**It sweeps its own bytes, and the ORDER is the lesson.** `event_photos_delete` requires the
EVENT to still exist (`is_host(foldername(name)[1])`), so deleting rows first strands the
objects where nothing but a service role can reach them — `storage.protect_delete()` refuses
direct SQL. `init.sql` has said "BYTES FIRST, ROW SECOND" since the first migration and it
was still got wrong here, stranding 840 bytes. `docs/smoke-live.md`.

**It is the only lane that can see four things.** RPC ARGUMENT NAMES — PostgREST resolves
overloads by name, so `p_titel` is a runtime 404 against a function that exists, and
`database.types.ts` is hand-written. COLUMN NAMES AND FILTERS — `FakeClient` records what
was sent and never evaluates it. RLS ADMITTING what the app needs — Lane E proves refusals
by forging claims, which bypasses GoTrue entirely. And ANONYMOUS SIGN-IN, a dashboard toggle
no token can flip, which was off while build #3 shipped.

**It runs against the LIVE project, deliberately.** The org is on the free plan, which counts
PAUSED projects toward its limit of two, so a dedicated test project costs $0 and is
unavailable; branching is Pro-only. So the suite is non-destructive by construction: it
creates its own event, works only inside it, never touches a row it did not create, and
prints the code it leaves behind. Each run costs one anonymous `auth.users` row that
Supabase never collects, plus one event. `docs/smoke-live.md` has the sweep.

**WHEN A LANE FAILS IT LEAVES STATE NOW.** `test-results/lane-h/` and `test-results/lane-b/`
get a screenshot, the DOM, the page URL, the whole error and every console line; lane H adds
a Playwright `trace.zip` you open with `pnpm exec playwright show-trace`. The journeys always
had this (`trace: 'retain-on-failure'`) and CI threw it away, uploading only screenshots —
`checks.yml` uploads `test-results/` and `playwright-report/` on failure now. **`playwright
test` wipes its `outputDir` at the start of every run**, which is why the journeys were moved
to `test-results/journeys` and the lanes keep siblings.

**Lane B refuses to run its gates on a partial walk.** `shots` accumulates as the walk goes,
so a colour gate over 4 of 22 entries would print a green line having measured almost nothing.
It exits instead, and `.provenance.json` carries `complete: false` — `design/screenshots/` is
never cleared, so an aborted run otherwise leaves a mix of two runs' PNGs with no way to tell.

**Two of the 22 screenshots differ run to run** — `00-create-key` in both schemes, because the
recovery key is randomly minted. A byte-comparison baseline can never be clean for those; the
other 20 are stable and are what a dedupe should be checked against.

**NOT in `run-checks.sh`, on purpose.** Checks run many times an hour; each lane-H run
writes to production. It is a deliberate command with the standing of `pnpm android` — a
measurement with a cost, run before a build rather than on every save. It skips loudly
without credentials, in the same shape as lane E.

**THE GUEST BUILD IS NOT THE HARNESS BUILD, AND ONE INLINED ENV VAR IS THE ONLY DIFFERENCE**
(`pnpm audit:guest-build`, `pnpm prove:guest`, #78, `docs/guest-web.md`). A guest who will not
install an app has no route into a party at all -- `web/i/index.html` is a bridge to an install
and offers nothing else. The route is buildable today: `EXPO_PUBLIC_BACKEND=supabase` alone
exports a working browser app, measured.

**`export:web:live` SETS BOTH FLAGS AND IS THE ONE YOU WILL COPY**, because it is the only
other script that talks to Supabase. `EXPO_PUBLIC_FIDELITY=1` is the harness switch, and four
web halves branch on it: a synthetic 1x1 PNG for the camera roll (`capture.web.ts:113`), four
fixture songs (`musicSearch.web.ts:67`), a fake scan button (`QrScanner.web.tsx:27`) and a save
that reports success and writes nothing (`save.web.ts:19`). All correct in a harness, all wrong
in front of a person. **Metro INLINES the flag**, so by the time there is a bundle the decision
is invisible and no amount of reading it will say which build you have.

**THE MARKERS WERE MEASURED IN BOTH DIRECTIONS AND THE FIRST GUESS WAS WRONG.** Matching the
flag NAME passes on both bundles, because it is inlined away. What survives minification does
discriminate: `qr-simulate` and `scheme-probe` are in `dist/` and absent from `dist-guest/`,
while the honest copy *"Scanning needs the RunIt app on a phone"* is in both -- so it is the
ABSENCE marker that catches the gate itself going stale. Six mutations, all dead.

**AND THE FLAG CUTS THE OTHER WAY, WHICH IS WHERE THE LIVE DEFECT WAS.** Two web halves are
keyed `!== '1'`, so they go dead when the harness flag is ABSENT -- the guest build.
`musicSearch.web.ts` returning `[]` is honest and documented (no CORS on the iTunes endpoint).
`pickScreenshot.web.ts` returning `null` was not: `FeedbackSheet.tsx:103` draws "Add a picture"
unconditionally, so a browser visitor tapped a control and **nothing happened** -- the
drawn-control-that-does-nothing failure `empty-world.spec.ts` exists to catch, invisible to
every lane because lane B always runs WITH the flag. It has a real implementation now, reusing
`shrink` so the bytes match the `image/jpeg` the uploader declares.

**`prove:guest` IS THE LOCAL-STACK SIBLING OF LANE H, AND IT IS FREE.** `audit:guest-build` is
static and proves the bundle is not the harness one; a build that exports cleanly and boots to
a white screen passes it. This serves `dist-guest/`, seeds its own event through `create_event`
and drives Chromium: it boots, it joins, **the screen names the event row from Postgres** (a
name no fixture has, which is the clause a `MemoryRepository` bundle fails), the join minted a
GoTrue session key, and no `scheme-probe` is in the DOM. It **refuses a non-loopback `--api`**
because it creates an event -- lane H is the tool that writes to production, deliberately.
No sweep: the local stack is disposable.

**E — policy verification** (`pnpm verify:policies`). The only lane that can
see row-level security behave. It runs `supabase/verify-policies.sql`, which seeds an
event, a guest and a host inside a `DO` block, switches
role with `set local role authenticated` and a forged `request.jwt.claims`, asserts
**two hundred and five** behaviours, and RAISES at the end so nothing commits -- the
"error" it prints IS the report.

**`supabase db push` AND `db reset` WERE A SILENT NO-OP, and #48 fixed it.** The CLI
reserves the migration name `init` and skips the file -- *"replace \"init\" with a different
file name to apply this migration"* -- and the migration was `00000000000000_init.sql`,
exactly that name. Not the all-zero version: the word. Both canonical commands exited 0
having applied nothing.

It is **`00000000000000_schema.sql`** now and the CLI says `Applying migration`. `npx supabase
db reset` is the local recipe, and it is better than the psql dance it replaces: it rebuilds
the DATABASE rather than dropping a schema, so Supabase's `ALTER DEFAULT PRIVILEGES` survive
and the client grants come back intact -- which is the trap `supabase/reset-local.sql` exists
to work around on the psql route. `policies.yml` still applies by psql with `ON_ERROR_STOP=1`,
deliberately: that makes the apply itself the from-scratch gate.

**IT RAN COMPLETELY FOR THE FIRST TIME ON 2026-09-06, and it needed no production password
to do it.** `npx supabase start` gives a local stack, the migration applies to it with psql,
and `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` runs the lane
against it -- **142 assertions, 0 failures**. `docs/lane-e.md` has the recipe. That route is
the durable fix for "nobody runs it": the credential was always the reason, and the local
stack does not need one. A live run additionally proves production has not DRIFTED from the
committed migration, which is the one thing local cannot see, so the success line names which
target it ran against.

**Three defects were hiding in that silence, and all three were invisible for the same
reason** -- the lane skipped, and a skip and a pass look identical on a board. A duplicate
`pho uuid` (42601) had stopped the file compiling since `aed8fb1`. The migration could not be
applied to an empty database at all, because `photos_past_retention` is `language sql` -- whose
body Postgres name-resolves at CREATE time -- and selected from `tier_limits` ~1100 lines
before that table was created. And the #44 assertions called `request_song` as `buid2`, the
guest the tier cap deliberately REFUSES, so everything below them aborted.

**`EXPECTED_ASSERTIONS` was 143 and the truth is 142.** The 143 was arithmetic over six sets
counted in separate in-context runs -- sets which, it turns out, had never executed. Lowering
that number is normally wrong and was right exactly once: when the previous value had never
been measured. Get the next one from a real complete run rather than by adding to this one.

**It did not run at all until 2026-09-05, and nothing said so.** A setup line inserted
a photo as the host with no `uploaded_by_guest_id`; `photos_insert` refused it with
42501 outside any exception handler, which aborted the whole `DO` block -- so every
moderation and invitee assertion below it had never executed, and one held a stale
expected value that proved it. Issue #31. **Anything added here must be RUN, not merely
written** -- that rule earned itself again the same week, twice in one sitting: two new
assertions looked a host row up by `where auth_user_id = ...` while standing in
`authenticated`, which #34 had just revoked, and each aborted the block exactly as the
photo insert had.

`verify-policies.mjs` now has two teeth it lacked. An **abort cannot pass**: the closing
RAISE never runs, so there is no report to parse, and the unparseable case is a red gate
that says so. And a **coverage floor** (`EXPECTED_ASSERTIONS`, the same doctrine as lanes
A and A2) fails a run that measures less than the last one -- because "0 FAILURE(S)" over
forty assertions and over a hundred and eighty are the same sentence. Raise the number when you
add assertions; that friction is the feature.

**"Nothing re-runs it in CI" was true, and the REASON given for it was false.** This file
said twice, and `verify-policies.mjs` said once, that CI here is "one public-repo job with
no secret store". The repository is **private**, and private repositories have encrypted
Actions secrets like any other. `checks.yml` passes `secrets.SUPABASE_DB_URL` through to
the container now, so the moment that secret exists lane E runs on every push. Until then
it expands to an empty string and the lane skips loudly, exactly as it does locally --
so the wiring is a no-op rather than a red gate. A wrong premise had kept the only lane
that can see row-level security out of CI for the life of the repo.

**AND THE SUMMARY SAYS SO NOW.** `run-checks.sh` used to print "All checks passed" whether
or not a lane had skipped -- so lane E skipped on every run for the life of this repo while
the last line on screen said everything passed, and a duplicate variable declaration sat
under that green line for a day. A skipped run now ends with **"Every check that RAN
passed -- N lane(s) skipped and measured nothing"**, naming each one and how to run it. A
lane that FAILS is still a failure and still stops the run; it is not reclassified.

**It skips LOUDLY without `SUPABASE_DB_URL`**, and that is deliberate. Running it needs a
database password, and a gate that failed closed for want of a credential would be switched
off within a week. So it prints a yellow SKIPPED block naming what went unchecked. A
malformed URL is a different thing and fails NAMED rather than as a stack trace, because
that path only became reachable when the secret was wired into CI. Set the URL and re-run
before trusting a green board after any migration change:

```
export SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres'
pnpm verify:policies
```

It used to be a paragraph telling you to paste SQL into a web editor. A harness
nobody runs measures something once and guards nothing.

It exists because reading a policy tells you what it says, not what Postgres does
with it. The load-bearing result is that **a guest's UPDATE on `events` returns zero
rows and raises nothing** -- the silent shape `SupabaseRepository.assertWrote()`
exists to catch, and one no amount of reading the policy would have settled.

Two traps it already fell into, both of which make a *passing* statement look like a
failing one: `text[] || 'a literal'` parses the literal as an ARRAY LITERAL and
raises 22P02 inside whatever exception handler you are standing in; and several
assertions in one `UNION` share a single statement snapshot, so a `STABLE` function
cannot see a row a sibling branch just inserted. `join_event` looked broken twice and
was fine both times.

**Compare within ONE environment.** The same source renders differently on the
host than in the checks container — 5.53% of pixels on the join screen — because
the app pins no fonts and the two machines have different ones. `renders/` is
committed and was generated **on the host, in DejaVu**; `screenshots/` belongs to
whichever ran `pnpm shots` last. `design/screenshots/.provenance.json` records
which. Regenerate on the host before a Lane D read, or you will read a wrap
difference as a fidelity regression that no code caused. See FIDELITY note 6 and
issue #6.

### iOS is not verified here — say so plainly

There is no Mac in this environment (`xcrun` absent, WSL2). **iOS pixels cannot
be produced on this machine.** Lanes A and B run through react-native-web, not
native. A green run does **not** mean iOS is fine. Real iOS verification needs
EAS Build onto a physical device. Do not let anyone read a green check as iOS
coverage.

## The customer channel, and the tester one it outlives

**`public.feedback` + `pnpm feedback:app` (#77).** `feedback-to-issues.mjs` below calls itself
"the channel for testers who have no terminal" and is right; it stops working the day the app
leaves TestFlight, because that feedback exists only for beta builds. After launch a
customer's only route to us is a support URL on a static page, which nobody standing in a
party is going to open.

**TWO WAYS IN, AND THEY SERVE DIFFERENT PEOPLE.** The join screen's copy is for somebody who
CANNOT GET IN -- the report this product has most needed. `ReportLink` at the end of the
**Photos and Music tabs** is for a guest who is already through the door and whose photo did
not appear or whose song request vanished. Not Chat: that is the one tab where a guest expects
to be a reader, so a broken thing there looks like a quiet evening. Not the chat FOOTER, which
was tried and displaced *"Announcements only · hosts post here"* -- the line telling a guest
why there is no compose box, held by `guest-chat.spec.ts`. **A control that has to take
something's place is in the wrong place.**

**THE GUTTER GATE MEASURES THE CONTROL'S OWN BOX, and padding will never satisfy it.**
`ReportLink` failed it twice with the same message: padding on the Text leaves the `<button>`
full width, and padding on the Pressable is INSIDE that box, so it is still full width and
still starts at x=0. It takes `marginHorizontal` plus `alignSelf: 'flex-start'`. The first
version carried a comment naming this exact trap and then fixed the wrong element, twice.

**THE CONTROL IS ON THE JOIN SCREEN, NOT INSIDE THE PARTY, and that placement is the whole
point.** The person most worth hearing from is the one who CANNOT GET IN -- they never reach a
tab. "The code would not take" is exactly the report this product has been missing since
2026-09-11, when a real party produced zero anonymous sign-ins and nobody could say why. The
first draft put it in the chat footer, where it displaced *"Announcements only · hosts post
here"* -- and `guest-chat.spec.ts` went red, correctly: that line is what tells a guest why
there is no compose box.

**THE GITHUB TOKEN NEVER REACHES A SERVER.** `send-push` and `delete-account` hold the SERVICE
ROLE, which is this project's own secret; a token that can file an issue is a credential for
somebody else's system, and the narrowest one that posts to a tracker can also read every
private repo it is scoped to. So the app writes a row and a laptop files the issue, where
`gh auth token` already works.

**INSERT-ONLY, AS YOURSELF, SIX AN HOUR.** No select policy for any client role -- the
`guests` shape, because a queue a guest could read is a list of other people's complaints. The
cap is a trigger rather than client-side, because the publishable key is in the bundle and an
attacker is not obliged to run our rate limiting. Lane E holds all four.

**NOTHING IDENTIFYING TRAVELS.** Platform, OS, app version, build, locale, timezone and the
event code. Not the nickname, not an address, not another guest's name -- the rule
`feedback-to-issues.mjs` already follows when it drops `testerEmail`, and it matters twice as
much here. The sheet PRINTS what it is about to send, because a report that quietly harvests
is a different product from one that says so.

**A REPORT CAN CARRY A PICTURE, AND THE PICKER IS THE PRIVACY DESIGN.** `pickScreenshot()`
opens the LIBRARY, never the camera and never a view capture -- somebody reporting a bug has
already taken the screenshot, and a silent capture would send other guests' photographs and
names to a repository without the reporter seeing what left their phone. `allowsEditing: true`
here and `false` in `capturePhoto`: there a crop between the shutter and the photo is a
different product, here it is the redaction step and the whole reason this is the picker.

**BYTES FIRST, ROW SECOND -- the opposite of the deletion rule, for the same reason.**
Whichever can strand the other goes second: a row naming an object that failed to upload points
at nothing, while an object with no row is litter the sweep ignores. **And a failed upload does
not lose the words** -- the sentence is the report, the picture is evidence for it, so the
upload is wrapped and swallowed.

**`pnpm feedback:app` COMMITS THE PICTURE rather than linking to it**, which is the sibling
tool's hardest-won rule: a signed URL decays into a description of a picture nobody can see,
and this bucket is private so a raw link is worse than useless. It also distinguishes TWO
CAUSES the way the sibling does -- "no picture" and "a picture we could not fetch" are
different facts.

**`screenshot_path` IS GUARDED IN TWO PLACES BECAUSE A SERVICE ROLE READS IT, and it shipped
unguarded for one commit.** `feedback:app` interpolates that column into a storage URL and
fetches it as the SERVICE ROLE -- which reads every folder in every bucket, whatever RLS tells
a client -- then COMMITS THE BYTES TO THE REPOSITORY. As free text, a reporter could write
`../event-photos/<event>/<photo>.jpg` and have us publish a guest's private photograph.

**THE STORAGE POLICY DOES NOT COVER THIS, and that is the lesson.** It constrains where bytes
may be WRITTEN; this is a string in a different table, and they are different questions. Two
guards, because neither catches the other's case: a CHECK constraint on the SHAPE (two uuids
and a known extension) catches a traversal from inside a correct prefix, and `feedback_guard`
comparing the first segment to `auth_user_id` catches a well-formed path belonging to somebody
else. **A BEFORE trigger runs ahead of a CHECK**, so one test case would only ever exercise
whichever fires first -- lane E tests each against the case only it can catch, and each
mutation kills exactly its own assertion. The tool refuses the same shape again before
interpolating, for rows written before the guards existed.

**The bucket is private and insert-only under `{auth_user_id}/`**, the shape `event-photos`
uses with the event id. No select for any client role: a folder any authenticated caller could
list is every screenshot anybody ever sent us. Three lane E assertions, and the prefix check
is mutation-pinned.

## The tester channel

Testers have no terminal. TestFlight already collects their screenshots and crashes;
what was missing is that **collected feedback never became a tracked issue**.
`tools/feedback-to-issues.mjs` closes that, and `pnpm feedback:sync` runs it.

**It is NOT a gate and must never enter `run-checks.sh`.** Exiting non-zero because a
tester found a bug would make a green board a claim about tester silence.

- **Screenshots are committed** to `design/feedback/`, because eas-cli's own type says
  `TestFlightScreenshot` URLs "expire after a short while". Same side of the
  `.gitignore` rule as `design/device/`: irreproducible device evidence is committed.
- **`design/feedback/**` is in `paths-ignore`** in `.github/workflows/checks.yml`.
  Without it every tester screenshot burns a five-minute Docker run over untouched source.
- **Dedupe reads the ISSUES LIST, never `search/issues`.** Search is an index and is
  eventually consistent, so a workflow and a manual run firing on the same item would
  both decide it was new. The list endpoint reads the database.
- **`testerEmail` is deliberately dropped.** The name is enough; git history is forever.
- The EAS workflow trigger is `beta_feedback: { types: [...] }` — a bare list is what the
  prose docs imply and `eas workflow:validate` rejects it. Validate before believing.
- `eas testflight:feedback` needs **eas-cli >= 21.3.0**; `eas.json` declares a floor of
  `>= 16.28.0`, so the script asserts the real one.

See `docs/tester-feedback.md`.

## Architecture

```
src/app/        routes ONLY. Root layout is the one place a repository
                implementation is named.
src/features/   one folder per screen
src/components/ ui/ and icons/ — only what genuinely crosses features
src/data/       types, the RunitRepository interface, the in-memory adapter
src/state/      providers, read hooks, write actions
src/domain/     tiers and entitlements
src/theme/      the converter, tokens, provider, layout, typography

supabase/functions/   Deno Edge Functions. NOT in the app's tsconfig -- they have their
                      own globals and module specifiers, so compiling them with the React
                      Native program reports errors about the wrong runtime. Deployed via
                      the Supabase MCP, and `run-checks.sh` never executes one, so NO LANE
                      HERE PROVES ONE WORKS.
```

**The seam.** Screens depend on `RunitRepository`, never an implementation. An
ESLint `no-restricted-imports` rule enforces it. That is what makes swapping in
Supabase a checked property rather than an intention. Reads are observables from
day one because the eventual backend is realtime.

**Entitlements are enforced in repository methods, not in `onPress`.** A check
that lives in a button handler is bypassed by the second caller.

## Things that will bite you

- **EVERY ICON COMES FROM ONE SVG, and `pnpm icons` both writes and CHECKS them.**
  `design/brand/runit-logo.svg` is the source; `assets/*.png` is output and must never be
  hand-edited. Three things there are not obvious. **The artwork ANIMATES** -- a 6.4s SMIL
  beam-swing with `fill="freeze"` -- so a screenshot at t=0 captures a mid-swing beam and a
  dim lens, which is a wrong icon that looks entirely plausible; `SETTLE_MS` is 7500 and
  lowering it silently ruins every asset. **iOS REJECTS an icon with an alpha channel**, so
  `icon.png` is asserted to be PNG colour type 2 -- that one fails at App Store Connect, not
  in any lane here. And **Android silhouettes a notification icon to flat white by its
  alpha**, so the full-colour wordmark arrives there as a smear: `notification-icon.png` is a
  separate two-shape mark, and `app.json` pointed at `adaptive-icon.png` until this was
  noticed.
- **The wordmark DOES survive as an icon, and the commit that set the old one said
  otherwise.** `8f97859` rejected a wordmark as unable to "survive being 40px on a home
  screen". A home-screen icon is 60 **points** -- 180px on a 3x device. Measured at the sizes
  iOS actually renders: crisp at 180 and 120, readable at 80 and 60, gone at 40, which is
  notification scale and is exactly why that icon is a different mark.
  `design/brand/README.md`.
- `@testing-library/react-native` v14 made `render` **async**. Un-awaited,
  `screen` stays empty and every query fails with "`render` function has not
  been called", which points nowhere near the cause.
- `web.output` is `"single"`, not `"static"`, and that is load-bearing. See
  `design/FIDELITY.md` note F.
- The React Compiler lint rules reject reading a ref during render and
  `setState` inside an effect. Both rejections were correct.
- TypeScript is pinned to 5.9 (typescript-eslint does not support TS 7) and
  ESLint to 9 (10 breaks eslint-plugin-react).
- `engine-strict=true` means a wrong Node **fails** `pnpm install`. Run
  `nvm use` first; `.nvmrc` has the version.
- The Playwright image has no `xz`, so the pinned Node is fetched as `.tar.gz`.
- `MemoryRepository.id()` shares one counter across every prefix, and it is
  seeded past the highest number in the fixture (`highestSeedSeq`). It counted
  from zero until an e2e critic caught it: the first guest-submitted song was
  minted `req_1`, which is already Dancing Queen, so two rows rendered the same
  testID and `patchRequest` — which matches by id — patched both. Removing a
  vote from the new song pulled the seeded one down with it. If you add a seed,
  you inherit the fix; if you replace the id scheme, keep the property.
- **Gboard on the AVD can come up FLOATING**, and a floating IME never resizes or
  overlays anything — so a keyboard measurement taken against it silently "confirms"
  whatever you expected. `adb shell pm clear com.google.android.inputmethod.latin`
  resets it to docked. This is the same trap as `hw.keyboard = no`, one layer down.
- **SIGN-IN IS LAZY, SO A COLD VISITOR IS `anon` -- AND ONE REQUEST ALWAYS 401s (#79).**
  `signInAnonymously()` sits on the JOIN path (`SupabaseRepository.ts:1000`), not on boot, so
  somebody who has just opened the app holds the `anon` role and nothing else. `loadMine` calls
  `my_events()` unconditionally one line after reading the session, and that function is
  correctly revoked from `anon` -- so every cold open fires `401 / 42501 permission denied`.
  It is HANDLED (`sigMyEvents.set([])`, empty list, no crash) and it is still worth closing: it
  is the only request the app makes before a guest types anything, so the next real console
  error arrives into noise a reader has learned to scroll past. `loadBlocks` is the pattern --
  a null identity is a real state with an empty answer. **A first draft of `prove:guest`
  asserted a session on boot and failed; the tool was wrong about eagerness, not the app.**
- **A `.web.ts` FILE IMPORTING A SIBLING MUST NAME `./x.web` EXPLICITLY, AND THE BARE FORM IS A
  TRAP IN BOTH DIRECTIONS.** Metro resolves `./capture` to `capture.web.ts` inside a web bundle,
  so the bare specifier RUNS correctly -- but tsc knows nothing of platform extensions and
  resolves it to `capture.ts`, the native half. `pickScreenshot.web.ts` importing `shrink` that
  way failed `pnpm typecheck` immediately, which is the GOOD outcome. The bad one is the same
  divergence pointing the other way: tsc happy, and the web bundle getting a different module
  than the types describe, which is `orderedForRequest` exactly (`undefined` at runtime, six
  journeys red). Naming the file makes both resolvers agree, and a `.web.ts` file is only ever
  in a web bundle so nothing is hardcoded that was not already true. This is the same family as
  `captureConstants.ts` and `musicSearchConstants.ts`, one layer over: those exist for a
  SELF-resolution cycle, this is a cross-module disagreement.
- **`expo-secure-store` HAS NO WEB IMPLEMENTATION.** Its web build is `export default {}`,
  so every method is `undefined` and calling one THROWS rather than returning null.
  `secureSessionStorage.web.ts` exists for that reason; without it a browser visitor is a
  brand-new anonymous auth user on every reload. Any other Expo native module reached from
  shared code needs the same check — the web build being a stub is the default, not the
  exception. FIDELITY note AB.
- **`storage.protect_delete()` REFUSES EVERY DIRECT SQL DELETE** on `storage.objects`,
  before RLS is consulted, for the owner as much as for a guest. So `event_photos_delete`
  cannot be exercised from SQL and the retention sweep cannot be built with it — that has
  to go through the Storage API with a service role. Asserted in Lane E so the constraint
  is discovered by a test rather than by a half-written sweep.
- **A CLIENT `UPDATE` ON `guests` MATCHES NOTHING, SILENTLY.** The table has no SELECT
  policy, and Postgres applies SELECT policies to the rows an `UPDATE ... WHERE` must read
  to evaluate its WHERE. PostgREST always emits a WHERE, so `from('guests').update(...)`
  affects **zero rows and raises nothing** — on every device, forever. `assertWrote()`
  cannot catch it either: `.select()` after the update is subject to the same missing
  policy, so a SUCCESSFUL write also comes back empty. The guard fires on the good path and
  is silent on the bad one. Every write to `guests` goes through a SECURITY DEFINER RPC
  (`join_event`, `set_push_token`). Measured in #36.
- **A REALTIME CHANNEL CAN DIE AFTER IT JOINS, and the callback that hears about it is the
  same one that resolved the join.** `RealtimeTable`'s status callback stays live for the
  channel's lifetime now; before, it was a one-shot promise settler and a channel that
  joined and then died produced no observable effect at all (#45). Three rules fell out and
  all three have tests: **`CLOSED` must have a branch** (arriving first, it left the promise
  unsettled and hung the whole join with no message); **the identity guard
  `if (ch !== this.channel) return` is load-bearing**, because `teardownChannel` nulls the
  field before awaiting `removeChannel`, so our OWN `pause()` produces a `CLOSED` that would
  otherwise report eight faults and retry channels we deliberately closed; and **health is
  reported after the SELECT, never from `SUBSCRIBED`**, or you announce a live table with no
  rows. FIDELITY note AP.
- **The reconnect supervisor is ONE timer in `SupabaseRepository`, not one per table**, with a
  bounded budget (2s/5s/15s/30s) that then reports `stale` and stops. Eight timers would be a
  hand-built version of the vendor storm the teardown exists to prevent. It **cancels on
  `suspend()`** — a pocketed phone that keeps re-subscribing re-opens the cost
  `appStateBridge` closed. A retry is `start()` and nothing smaller: a rejoined channel has a
  gap, and `start()` is subscribe → buffer → select → replay.
- **`?stale=1` boots a world where the connection is already broken.** `MemoryRepository` has
  no socket, so it is `live` by definition and the connection pill is otherwise unreachable in
  the only lane that can screenshot it — the same gap `?empty=1` was added to close.
- **`useRef<TextInput>(null)` contains the literal `<TextInput`.** Any source-scanning
  tool that matches `/<TextInput\b/` counts a type argument as a control. `tools/audit-keyboard.mjs`
  requires the `<` to follow start-of-line, whitespace or a bracket for that reason.
- `fade` (`src/theme/typography.ts`) is **per-scheme and comes from `useTheme()`**,
  not from the module import. The canvas's single ramp fails WCAG AA — the two
  schemes need different numbers because `#1F2937` on `#F5F0EB` has less headroom
  than `#E2E8F0` on `#1A1A2E`. Never multiply two levels together; a product cannot
  be fixed by raising the ramp. FIDELITY note H.
- **`wallClockToInstant` makes TWO passes and both are load-bearing.** The naive guess
  reads the zone offset several hours from the true instant, so a DST transition inside
  that window gives the wrong one: asking for 3:00 AM on a spring-forward morning, one
  pass returns an instant that reads back as 4:00. `format.test.ts` fails if the second
  pass is removed. And never `new Date(d.toLocaleString(...))` -- FIDELITY note M.
- **A GUEST NEEDS A NAME, AND THE DATABASE IS WHERE THAT IS DECIDED (#66).** `guests.nickname`
  is `text not null` and `''` SATISFIES THAT, so `join_event` seated a guest with a blank
  space where their name goes -- denormalised onto every song request and photo they sent --
  and the one control that could fix it, the name pill, was drawn only when the nickname was
  NON-EMPTY, so it was missing for exactly those people. `join_event` raises 22023 on an empty
  name and on one over 40, the same two rules and the same errcode as `set_nickname`, whose
  comment had claimed since it was written that "join_event would have refused it too".
  **`MemoryRepository` substituted `nickname.trim() || 'you'`**, which is why 304 journeys saw
  a healthy name pill for a case that had none against Supabase -- the fixture was kinder than
  the backend, the one thing that adapter exists not to be.
- **A HOST HAS NO `guests` ROW.** `create_event` binds her seat and deliberately does not
  seat her as a guest -- a brand-new party reading "1 already here" before anyone arrives
  is worse than the gap. So anything reading `requireGuest()` on a path a host can reach
  will throw: `loadFetchOnce` did, and only creating an event exposed it. `loadBlocks` is
  the pattern to copy -- a null guest id is a real state with an empty answer, not a
  fallback.
- **PHOTO APPROVAL IS ON BY DEFAULT SINCE 2026-09-20, AND THE OLD DEFAULT HAD A GOOD
  ARGUMENT.** `events.photo_moderation` shipped `default false` on the reasoning below: a
  party of eight that has to approve itself is friction nobody asked for. Two things
  outweighed it. An album is the one surface where a stranger's mistake is instantly in front
  of the whole room and the host is who answers for it -- off-by-default asks her to PREDICT
  she needed the gate, on-by-default costs her one tap to remove it. And the App Store listing
  promises *"the host approves them before they appear"*, which was false on every event this
  app could create; a claim and the code disagreeing is fixed in the code. **Existing events
  are untouched** -- `set default` does not rewrite rows, and production still reads 8 off / 6
  on. **The schema fingerprint cannot see this**: it hashes `table.column type null=…` and not
  the default, so it stayed green without moving. Verification is reading `column_default`
  back from both databases, which is the same blind spot #76's return-type change hit.
- **PHOTO APPROVAL IS NOT A TIER FEATURE, and asking "which tier gets it" is the mistake.**
  It was `tier_limits.photo_moderation`, read by `set_photo_status`. `create_event` mints
  `house_party`, where that was false — so on every event this app can actually create, a
  guest's photo went onto every screen in the room the instant it landed, and the only route
  to a gate was a purchase path that does not exist (#30). The host could not buy it if she
  wanted to. It is `events.photo_moderation` now: her switch, any tier, default off, written
  through a named column grant under `events_host_update`, still decided inside the database
  so the party being moderated does not get a vote (#50's finding, preserved by the move).
  #65 had already made the same call one step later when it ungated `hide` — taking reported
  content down is a review obligation rather than a feature — and stopping it being shown at
  all is that obligation, earlier. `photos.approve` is ungated in both adapters for the same
  reason: a tier gate there could only ever refuse the host who turned approval on.
- **PINNING IS FREE, AND THAT MADE IT NOT A TIER FEATURE AT ALL (#70).** `fold_pin_to_plan`
  read `tier_limits.pinned_announcements` and silently folded `new.pinned` to false on a tier
  that had not bought it. Right for #21 -- the flag was granted by two tiers and read in ONE
  place, `MemoryRepository`, so against Supabase a free-tier host could pin and nothing
  stopped her -- and **invisible by design**, because "refusing to post an announcement
  because the plan cannot pin it would be hostile". Invisible is what made it two controls
  that lied: the composer's pill confirmed "Pinned ✓" over an unpinned notice, and the
  sent-list Pin sprang back with no toast. The column, the flag and the trigger are all gone
  rather than set true everywhere -- a flag true on all four tiers is not a tier feature, and
  a trigger that can never fire is the dead enforcement #21 exists to prevent. **The lesson
  that outlives it:** the trigger was `before insert OR UPDATE` because #26's un-pin policy
  would otherwise have left a host one statement from the pin she was refused. If a tier ever
  gates a column again, gate every command that can write it.
- **`denial.upgradeTo` IS DOWN TO A LIMIT DENIAL, and the drift is worth reading.** The one
  test covering the paywall's "which tier lifts this?" path has been re-pointed three times in
  two days -- djQueue, then `photoModeration`, then `pinnedAnnouncements` -- because each
  feature in turn left the ladder. `audit:tiers` is at **10 features, 2 granted**. `hostRoles`
  is the last one gated in `MemoryRepository` and **its denial is unreachable**: `invite`
  checks the seat cap first and every fixture is already at its cap. If the next re-point has
  nowhere to go, `upgradeTo` has no reachable caller and the paywall path should go with it
  rather than be kept alive by a test.
- **THE TIER CAPS LIVE IN TWO PLACES ON PURPOSE**, and `src/domain/tiers.test.ts` is what
  makes that safe. `public.tier_limits` is what `invite_host` enforces against, because a
  check in a client is bypassed by the second client; `src/domain/tiers.ts` is what the
  pricing copy renders. No literal crosses that boundary, so the test re-parses the
  migration's own seed and fails on drift -- same shape as `tokens.test.ts` re-parsing
  `theme.css`. NULL in SQL and `Infinity` in TypeScript both mean unlimited; `0` would
  mean the opposite and read as plausible.
- **A co-host has no `guests` row AND no account.** `invite_host` mints a seat with
  `auth_user_id` NULL; `claim_host` binds it when they present the key. `claim_host` also
  refuses a second seat to someone who already holds one at that event -- not an
  escalation, but it would strand the seat it was minted for.
- **A 200 IS NOT OWNERSHIP.** `INVITE_ORIGIN` was `runit.pages.dev` for one commit; that
  name belongs to a stranger whose project answers 200 on EVERY path. Every QR pointed at
  their site. The unit tests passed and were right to -- they assert `INVITE_ORIGIN`,
  `app.json` and the association file AGREE, and they did. Agreement is not ownership.
  `pnpm verify:links` (lane G) is the one that can tell, because it reads the BODY back and
  looks for our own appID and App Store id in it. `pages.dev` names are global and
  first-come; an unclaimed one does not resolve at all, so probe before choosing.
- **THE INVITATION HOST IS DEPLOYED (#52).** `runit-app.pages.dev` went up on 2026-09-07 by
DIRECT UPLOAD -- `wrangler pages deploy web --project-name=runit-app` -- not git integration,
so **a push to `main` does not redeploy it**; re-run that command when `web/` changes. Lane G
asserts it now instead of skipping, which it had done on every run since the repo began.

**`_redirects` MUST TARGET `/i/`, NOT `/i/index.html`.** Pages canonicalises the explicit
filename (`/i/index.html` answers 308 to `/i/`), and a rewrite whose destination redirects
does not serve. The first deploy had the filename spelled out and every `/i/CODE` returned
404 -- while the association file was already perfect, so the half that Lane G checks hardest
was green and the half a guest actually walks was dead.

**THE UNIVERSAL LINK IS UNVERIFIED, and no lane here can change that.** A misconfigured
  one fails SILENTLY -- it opens Safari instead of the app, forever. `src/lib/invite.test.ts`
  proves `INVITE_ORIGIN`, `app.json`'s `associatedDomains`, `web/.well-known/apple-app-site-association`
  and `web/_headers` describe the same app at the same address; Lane F proves the QR
  encodes it. Only an iPhone proves iOS accepts it -- Settings -> Developer -> Universal
  Links -> Diagnostics. `web/README.md` has the deploy steps and what to curl.
- **The host lives in ONE constant**, `INVITE_ORIGIN` in `src/lib/invite.ts`. If the
  Cloudflare project name changes, that plus `app.json` plus `web/README.md` move together
  or the test fails.
- **Credentials are minted by `mint_token`, never by `random()`.** Postgres's `random()`
  is a per-session PRNG and explicitly not cryptographic, and `create_event` is callable
  by anyone who can sign in anonymously -- so minting keys with it hands an attacker an
  oracle on the generator behind every host key in the project. `mint_token` draws from
  `gen_random_bytes` with rejection sampling (256 is not a multiple of 31) and is revoked
  from every client role; Lane E asserts that revoke, because `revoke ... from anon` alone
  is a silent no-op. `MemoryRepository` uses `expo-crypto` for the same reason of parity,
  even though its fixture key gates nothing.
- **The recovery key exists exactly once, in `create_event`'s return value.** Only the
  bcrypt hash is stored. A screen that drops that string has destroyed it, and no support
  route, backup or service-role dump gets it back. `rotate_host_key` is the only way to
  issue another, and it retires the old one.
- **`doorsLabel` is the doors line ONLY, and `whenAndWhere` is the whole line.** The label
  used to be the canvas's entire subtitle, date and venue included, because nothing could
  derive a day. A date stored as prose cannot disagree with `starts_at` out loud -- it
  disagrees silently, which is how HOUSE7 came to hold an 11:13 AM start under a "Doors
  7:00 PM" label. `whenAndWhere` (`src/lib/format.ts`) composes
  `formatEventDate · doorsLabel · venue` and is the ONLY place that does. It was
  hand-built in `shareMessage` and again in `JoinScreen`, each carrying a comment noting the
  other existed; the chat tab's event line would have been the third (#62). Two copies
  agreeing is luck. If you need this string, call it -- do not rebuild it.
- `schedule.start()` refuses to move the run-of-show cursor **backwards** unless
  passed `{ rewind: true }`. `nowScheduleItemId` drives every guest's Now/Next card,
  so a mis-tap on a past row rewound the evening for the whole room. FIDELITY note I.
- **Capture lives in `src/lib/`, not behind the repository.** A camera is a device
  concern; putting `ImagePicker` behind `RunitRepository` would make a Supabase
  adapter carry one. `upload()` takes a URI, which is also the right currency —
  an adapter can `fetch(uri).blob()`, and the cap check runs before any bytes are
  materialised.
- **`capture.web.ts` returns a synthetic 1×1 PNG under `EXPO_PUBLIC_FIDELITY=1`.**
  Without it the harness hangs: a real `<input type=file>` opens an OS chooser
  that nothing in `shoot-app.mjs` answers, and headless Chromium refuses
  `getUserMedia`. `guest-photos.spec.ts` asserts that exact data URI, which is
  what proves the value came from the capture path and not from a literal.
- **A JOURNEY CAN GO RED BECAUSE THE CALENDAR MOVED (#75).** Ten specs typed a literal
  `2026-09-11` into `create-date`; #41's `event_is_open()` then closed those events 168 hours
  after `starts_at`, and on 2026-09-18 six journeys went red with nothing about the app
  changed. The app was right and the tests were describing a world that had moved. Every
  creation site uses `UPCOMING` (`tests/e2e/helpers.ts`, today + 30 days) now -- **a fixed
  FUTURE date is the same bug with a later fuse**, which is what the four `2027-01-09` sites
  were. The preview-only literals stay: those specs assert how a date READS and never create
  anything, and a computed expectation there would be the function under test grading its own
  homework. When a gate fails under a clean `git log`, suspect the clock.
- **`weddingSeed` HAS 180 INVITED AND NO `invitees` ROWS**, and that trips anything keyed on
  the LIST rather than the COUNT. `invitedCount` is a number on the event; `invitees` is a
  table, and the fixture writes the first without the second on purpose
  (`MemoryRepository.ts:922`). Against Supabase the two agree, because `fold_invited_count`
  derives one from the other -- so a fixture-only divergence looks exactly like the non-empty
  case and is the empty one. It cost a round of red when "Who is invited" gained
  `defaultOpen={invitees.length === 0}`: the wedding opened, and eight tests' toggle clicks
  then CLOSED the section they meant to open. Reach a real non-empty list by adding an
  invitee, not by picking a seed.
- **"WHO IS INVITED" IS OPEN WHILE THE LIST IS EMPTY, folded once it is not.** `Disclosure`
  exists because five permanently-open sections made that screen 1309px against an 874px
  viewport, and folding away the MEANS of changing a state is right for a section a host fills
  once before doors. It is wrong for the one section she has not filled at all: there is no
  state to read, and the contacts picker and the only send control in the product are both
  behind it. Measured on a real party -- S7Y9RX ran with `invitees` at 0 behind a row reading
  "Nobody yet", nobody opened it, nobody joined. The summary still LEADS with the state,
  because `Disclosure`'s own docblock forbids a summary that restates the title; what follows
  names what is behind the fold, which the title does not.
- **A HOST WITH AN EMPTY ROOM IS SHOWN THE INVITATION, NOT A COMPOSER.** Measured on a real
  party rather than imagined: S7Y9RX ran on 2026-09-11 with 40 seats provisioned, a build
  deployed 90 minutes before doors and a live install page, and **zero people opened the app**
  -- not zero joins, zero anonymous sign-ins, which happen before anything else a person can
  do. Every row in that event is the host's own. `invitees` was 0 and had been since the event
  was created two days earlier. **The capability was never missing**: `host-share` is one tap
  from where a host lands and `shareMessage` writes a complete invitation with the link, three
  numbered steps and the code. What was missing is that nothing ever said to use it -- the
  largest control on screen was a send button addressed to an empty room. `empty-room-share`
  draws only while `guestCount` and `invitedCount` are BOTH 0, and both clauses are
  mutation-pinned; it calls the same `onShare` as the quiet link rather than being a second
  implementation.
- **`music.mine` IS A SEPARATE OBSERVABLE FROM `music.queue`, and it has to be.** `queue` drops
  `played` and `declined` -- correctly, a room should not vote on songs that are over -- so it
  is the one list that cannot answer "what happened to MY request". `useMyRequest` read it
  anyway, so the moment a host declined, `findIndex` returned -1 and the guest's strip
  unmounted: the one person entitled to be told was the one the filter hid it from.
  `MusicScreen`'s STATUS_TEXT has carried 'Not this time' and 'Played' since it was written and
  neither could ever render. `mine` comes off the UNFILTERED list in both adapters, one line
  above that filter. **Rank is null once the song leaves the queue** rather than stale -- "#3
  in the queue" beside "Not this time" is two sentences arguing on one strip. #70 · 5 of 5.
- **THE SONG TYPE-AHEAD CALLS A THIRD PARTY, AND IT IS THE ONLY THING IN THE APP THAT DOES.**
  `src/lib/musicSearch.ts` hits the iTunes Search API -- no key, no account, nothing to leak.
  Everything else goes through supabase-js. **It sends no CORS headers**, so it works on a
  device and never in a browser, which is why there is a `.web.ts` half serving a four-song
  fixture under `EXPO_PUBLIC_FIDELITY=1`; no test here may depend on a third party's uptime,
  ranking or rate limit. `musicSearchConstants.ts` exists for the reason `captureConstants.ts`
  states outright -- Metro resolves `./musicSearch` from inside `musicSearch.web.ts` back to
  itself, so a value import there is a cycle; the type is `import type` and erased.
  **#8 named MusicBrainz "the cheap win" and that is wrong for this job**, measured: queried
  for `dont stop believin` it ranks two cover bands above Journey, all scored 100.
- **`orderedForRequest` LIVES IN `src/domain/songKey.ts`, NOT in `lib/musicSearch`**, and the
  move was forced. `musicSearch` is platform-split, so on web `@/lib/musicSearch` resolves to
  the `.web.ts` half, which did not export it -- the call was `undefined` at runtime and six
  journeys went red. Re-exporting would mean the web half importing a VALUE from its own
  sibling, which is the Metro self-resolution cycle `captureConstants.ts` warns about. It is
  a statement about song IDENTITY anyway, which is what that module is.
- **Typing `Artist – Title` used to file the song backwards.** `actions.ts` splits on ` – `
  and assigns POSITIONALLY, so "Journey – Don't Stop Believin'" became a song called Journey
  by an artist called Don't Stop Believin' -- a different `song_key`, so the votes split,
  which is the exact defect the type-ahead exists to stop. `orderedForRequest` swaps only when
  a suggestion confirms the reversal, in TWO PASSES rather than one loop: already-right wins
  over any reversed reading whatever the ranking says, because a single loop made the answer
  depend on list order. A song no catalogue has is returned untouched.
- **The fixture in `musicSearch.web.ts` matches every word against title OR artist**, in any
  order. It prefix-matched `title+artist` concatenated once, so "journey" found nothing while
  the real endpoint returns the right song first for exactly that query -- measured. A fixture
  that cannot do what the real thing does sends every journey green over a half-dead feature.
- **A suggestion writes `Title – Artist` into the same field a guest could have typed**, with
  an EN DASH and spaces, because `actions.ts` splits on `/\s[–-]\s/` and "Jay-Z" must not be
  torn in half. Nothing downstream changed -- no new repository method, no column, no SQL --
  and the dedup win is a consequence rather than a mechanism. **Suggestions are not a gate**:
  a local band must stay requestable, and `guest-music.spec.ts` has a test whose only job is
  to fail if that is reversed.
- **THE PHOTO VIEWER TAKES A LIST AND AN INDEX, NOT A PHOTO.** It took `photo: Photo | null`
  and nothing else, so opening a photo was a dead end -- the only way to the next one was to
  close and tap again, nine times. `visible` in `PhotosScreen` is already the exact list on
  screen in the exact order on screen, so the index the grid renders IS the index the carousel
  navigates. Arrows are **hidden at the ends rather than disabled** (a drawn control that does
  nothing is what `aria-disabled` is this repo's gate for), sit INSIDE the stage rather than
  beside the backdrop (a sibling laid over `viewer-backdrop` fights it for the same tap and
  the later sibling wins), and carry a **measured 44x44 rather than `hitSlop`**, which is what
  `audit:targets`' own warning asks for where controls overlap.
- **`viewer-prev` and `viewer-next` must never be named `tile-something`.** `photo-viewer.spec.ts`
  counts `/^tile-/` to assert the album is nine, and a second node per tile matching that prefix
  silently doubled it once already. Mutation-checked: renaming them to `tile-prev`/`tile-next`
  turns five tests red.
- **The viewer prefetches index ±1 and no test asserts it.** Thumbnails are signed in bulk but
  the full size is resolved one at a time on demand, so every carousel step would otherwise be
  a cold round trip. It changes latency, not behaviour -- deliberately unasserted, and removing
  it breaks nothing, which was checked rather than assumed.
- **Swipe is real and no lane here can prove it.** `Gesture.Pan()` with a 60pt threshold;
  `react-native-gesture-handler` and `reanimated` were already dependencies and
  `GestureHandlerRootView` was already mounted, so it added nothing to the bundle -- but it is
  the first hand-written gesture in this codebase. Chromium cannot swipe, so the BUTTONS carry
  every assertion. That is why both exist.
- **`photos.pending` is the host's queue and selects `'pending'` ONLY.** In-flight
  and failed uploads go to `photos.mine`, scoped to the uploading guest. Putting
  `'uploading'` back into `pending` gives the host Approve/Hide over a photo with
  no bytes — it was that way once, and a test now fails if it returns.
- **THE PHOTOS SCREEN BRANCHES ON `visible.length === 0 && mine.length === 0`, and the second
  clause is load-bearing.** `visible` is APPROVED photos in the active folder; `mine` is this
  guest's own uploading and failed transfers. The shutter pane references `mine` nowhere, and
  the Retry control exists in exactly ONE place in the app -- inside `mine.map` in the grid
  branch. With the first clause alone, a guest whose upload failed on an empty album was told
  "tap Retry" by `actions.ts:277` on a screen with no Retry on it; on a moderated event that is
  the whole night, because uploads land `pending` and `pending` is never `approved`, so
  `visible` never fills from her own photos (#70). Do not simplify it back: three mutations
  pin it, including forcing the grid branch always, which breaks #67's empty-album copy tests.
- `Photo.localUri` (device path) and `Photo.storagePath` (remote key) are
  **separate fields on purpose**. Conflating them hands a `file://` to a
  signed-URL resolver the day an adapter exists.
- The join screen shows "N already here" (`join-guest-count`). It is **not** in the
  canvas — it exists so the e2e suite can prove joining *increments* the room
  rather than merely that the room reads 173 afterwards. FIDELITY note J.
- The demo wedding sits on the Event tier where nothing is capped, so the
  gating layer is invisible against it. `housePartySeed` is the fixture that shows
  it working -- but **only `MemoryRepository.test.ts` can reach it.** No Playwright
  journey can boot it (`tests/e2e/co-host.spec.ts` says so in as many words), so no
  lane that renders a screen has ever seen a capped event. Use it to see
  it work.

## Working from the design

1. **Look at the render first.** `design/renders/*.png`. Always.
2. The inline `style=` attributes in `Runit.dc.html` **are** the spec. There is
   not a single CSS class in the document.
3. Never extract copy with a tag-stripping regex — it deletes every style
   attribute and every SVG.
4. `design/ios-frame.jsx` is **canvas chrome**, not app code. Its 62px status
   bar and 34px home indicator are why the artboards pad 66/70/28. Those become
   real safe-area insets; copying them verbatim double-counts.
5. Record any deliberate divergence in `design/FIDELITY.md` so it is decided
   once, not re-litigated.

## Not built yet

**This section is now a pointer, not a list.** Every gap below is a filed issue with
file:line evidence in it, because a roadmap living in prose is how six missing
capabilities came to hide inside one line. `gh issue list --repo TortoiseWolfe/runit`
is the scope; issue #1 is the ordering.

**A host can now make her own event, staff it, and FIND IT AGAIN.** #17's list and switcher
shipped: `my_events()` is a definer function because #34 revoked `hosts.auth_user_id` from
every client role, so the identity filter cannot live in a client. It returns every seat, not
only `role = 'host'` -- a DJ needs the way back too. What is still missing: #18 (host sign-in
+ custom SMTP) · #19 (account deletion, mandatory the day #18 ships).

**#17's TITLE WAS WRONG and reading it as the spec would have built the wrong thing.**
`create_event` has allowed TEN events per identity since it shipped; the cap is in the
function. The schema was never the blocker -- nothing could LIST them, and the anonymous
session persists, so a host who closed the app kept her identity, lost `event.current`, and
had only the six-character code to get back in. FIDELITY note AU.



**AN ACCOUNT CAN DELETE ITSELF, AND THE SHEET COUNTS BEFORE IT ASKS (#19).** Mandatory the
day #18 shipped -- App Store Guideline 5.1.1(v). Two SQL functions decide
(`sole_host_events`, revoked from every client role because it takes a uid; and
`my_deletion_impact`, definer for the same reason `my_events` is), and
`supabase/functions/delete-account` does the work with a service role. **The caller's own JWT
is the credential** -- unlike `sweep-photos` and `send-push` it acts on exactly one identity,
so there is no Vault secret and the uid is read from the token, never from the body.

**THE RULE IS "NO OTHER SEAT", NOT "SHE IS THE FOUNDER."** An event with anybody else's seat
survives and only her own seat goes -- which is why there is no Transfer action: `invite_host`
already mints another seat, so a host who wants her party to outlive her account invites
somebody first. An UNCLAIMED seat counts, because `invite_host` mints `auth_user_id` NULL and
reading that as "no other account" would delete the event out from under whoever holds the
printed key.

**BYTES FIRST, ROW SECOND -- and BY PREFIX, which is where it departs from #40's sweep.** The
sweep deletes what expired, per photo row. This must leave NOTHING, and an upload interrupted
between the storage write and the row insert has no row to be found by, so it lists
`<event_id>/`. The order matters more here than there: `event_photos_delete` needs the EVENT
to exist and `hosts` cascades from it, so deleting the event first turns `is_host()` false
forever and strands every object against the one role that could have removed them.

**WHAT IT DELIBERATELY KEEPS:** photographs she uploaded at OTHER people's events
(`uploaded_by_guest_id` is set-null, the name is denormalised) -- somebody else's album, and
the sheet says so out loud. **What it deliberately removes:** her seats on surviving events,
because set-null would leave an unclaimed seat whose `host_claims` hash still opens it.

**TWO OF THE SHEET'S THREE STATES ARE UNREACHABLE IN LANE B**, measured rather than suspected:
`MemoryRepository.deletionImpact()` resolves instantly and never throws, so deleting the
counting branch left all eight journeys green. The decision lives in `deleteSheetState()` and
is unit-tested -- including the one that matters, that a count which could not be READ draws
no confirm button at all.

**Closed:** #15 (`event_preview`) · #14 (event details at `/host/event`) · #13
(`create_event`) · #32 (the recovery key) · #16 (`invite_host` -- a co-host gets a seat
and a key, never an account) · #33 (the QR encodes a universal link, so a scan works for
someone without the app) · #22 (`join_event` counts against `tier_limits.max_guests` and
raises 54023) · #34 (`auth_user_id` revoked from every client role) · #26 (a host can
un-pin, and only `pinned` is writable) · #21 (every granted feature is enforced, or is no
longer granted). FIDELITY notes S, T, U, V, W, X, Y and Z.

**#26 nearly undid #21, and the interaction is the thing to remember.** The pin-folding
trigger was `before insert`; an UPDATE policy on top of that leaves a free-tier host one
statement from the pin she was refused. It is `before insert or update` now. When you add
a write path to a table, check what triggers guard the paths that already exist.

**Advertised and unenforced — #21 is CLOSED**, and it ended in the two different ways
this kind of issue can end. `pinnedAnnouncements` got real enforcement (a trigger folding
a pin the tier cannot carry). `pushNotifications` was ALSO un-granted and un-sold at that
point — the remedy `audit-tier-claims.mjs` prints, and how its eight unenforced siblings
still live. **That is no longer the state and this paragraph used to claim it was**: #27
built the fan-out, so `pushNotifications` is `true` on the top two tiers and "+ push" is
back in the $79 copy. See PUSH IS BUILT below, which is the current word.
`pnpm audit:tiers` reports 10 features, 2 granted, every one enforced, no yellow line. It was
12 two days ago: `photoModeration` and then `pinnedAnnouncements` both left the ladder — see
PHOTO APPROVAL IS NOT A TIER FEATURE and PINNING IS FREE under "Things that will bite you".
Still open: #30 (every paid tier is unreachable — the pricing screen is cut and no
purchase path exists) · #41 (`eventTtlHours` still has zero readers: a free event never
goes read-only).

**THE RETENTION SWEEP EXISTS AND IS ARMED (#40).** `supabase/functions/sweep-photos`, called
by `run_photo_sweep()` through pg_net on a `pg_cron` schedule at 04:17 daily. It could not be
SQL: `storage.protect_delete()` refuses every direct delete on `storage.objects`, so bytes go
through the Storage API with a service role, which only an Edge Function holds. **Bytes first,
row second, idempotent** — the row is deliberately left when the Storage API fails, because
`storage_path` is the only thing that can name the object. `photos_past_retention()` decides
what expired, in SQL beside `tier_limits`, and the clock runs from `starts_at` because the
album already says "after the event". `verify_jwt` is not enough for a destructive endpoint —
the anon key is public — so it also requires `x-sweep-key`, compared inside the database by
`sweep_authorised()` so the secret never crosses the wire. **No lane here executes an Edge
Function**, so lane E asserts the rule and the deleting was verified by hand against the live
project. `docs/retention-sweep.md`, FIDELITY note AQ.

**`albumRetentionDays` HAS a reader (#23), and now an enforcer (#40).** The
album says how long photos are kept and the number comes from `tier_limits`, but nothing
deletes anything — retention is stated, not enforced. That order is deliberate: the
warning landed only after a viewer and a save control existed, because a deadline nobody
can act on is a threat rather than a warning. The sweep shipped in #40.

**The caps are a table.** `public.tier_limits` holds the numbers; `create_event`,
`invite_host` and `join_event` read them and no client can write them. A cap that lives
only in `src/domain/tiers.ts` is enforced by whichever client happens to be asking, and
`src/domain/tiers.test.ts` re-parses the migration's seed to fail on drift between the two
— the same shape as `tokens.test.ts` re-parsing `theme.css`.

**THE LIST IS EVERY PARTY YOU ARE IN, NOT ONLY THE ONES YOU RUN (#76).** `my_events()` joined
`hosts` only, which made leaving a party a ONE-WAY DOOR: a guest who left to go and make her
own event could not find the one she left. Her `guests` row survives -- `join_event` is
idempotent on `(event_id, auth_user_id)` and `closeEvent` keeps the identity -- so the seat
was intact and reachable by nothing but the six-character code off a place card at a venue she
had left. It carries guest seats now, with a `seat` column saying which. **`seat` is not a
`role` value**: `hosts.role` is a closed set meaning permission GRADE, and folding 'guest' into
it would make every policy reading `role` answer a question it was not asked. Guest rows carry
NULL role and label -- the word "Guest" is rendered from `seat`, never invented into `hosts`
data. A founder holding both seats at one event appears ONCE, as host.

**AND THERE WAS NEVER A PERMISSION GATE ON HOSTING, only a missing door.** `create_event` is
granted to `authenticated`, which an anonymous guest session already holds, so a guest can make
an event with no email and no sign-in. What was missing: the app had exactly ONE link to
`/create`, on the join screen, which a guest sees once -- before joining -- and reaching it
again meant tapping Leave. The supply side's entire funnel ran through walking out. It is in
the chat footer now, in the slot a HOST gets her console switch, addressed to a guest ("Want
your own?") rather than to somebody who already has a party to run.

**NO JOURNEY COULD RENDER A PLAIN GUEST, which is why that control could be deleted with the
board green.** Every seed answers `holdsHostSeat: true` on purpose so the harness can reach the
host artboards through `RoleSwitch`. **`?guest=1` boots `guestSeed`** -- the wedding seen by
somebody who is only a guest, plus a second party she is a guest at. The second seat is not a
workaround: `closeEvent` here keeps `event.current` set and the join screen's list passes
`hideCurrent`, so the party you just left is the one row lane B will never draw. Lane E asserts
that one instead.

**A HARNESS WORLD HAS TO SURVIVE A REDIRECT.** The `?...=1` flags are read from
`window.location.search` when the repository is built, so the guest layout's
`<Redirect href="/join" />` silently REBOOTED the app into `weddingSeed` -- a world where the
person is staff -- and the journey then asserted against a fixture it never asked for. It
carries the search string through now; in the shipped app there is never one.

**`session.holdsHostSeat` is not `session.current.kind`.** The first says which SEAT you
hold, the second says which VIEW you are looking at. A host who switched to the guest side
reads `kind: 'guest'` and still holds her seat. Gate a control on the wrong one and you
either show a door to people who cannot open it (#29) or take the way back from a host.

**`invitedCount` IS NOT `guestCount`, and they swapped surfaces in #72.** The composer names
the ROOM, because that is who a broadcast can reach: `broadcasts_read` is
`my_guest_id(event_id) is not null or is_host(event_id)` and `send-push` reads its tokens
`from('guests')`, so an invitee who never typed the code can neither read an announcement nor
be pushed one. **"Send to 180 guests" WAS a fiction about delivery** -- this file said
otherwise for months -- and it overstated the wedding by 8.

`invitedCount` moved rather than went, which is the half that matters: deleting it would have
left #25's work with no reader at all. It lives on the guest list's own row now, as
`180 invited · 173 here`, where both numbers are visible together and neither pretends to be
the other. **That is still #25's rule**, and `host-console.spec.ts` still guards it --
mutation-checked: pointing the guest-list row at `guestCount` turns four tests red.

**The row reads `event.invitedCount`, NOT `invitees.length`.** The count is folded from the
rows by a trigger, and against Supabase they always agree -- but `weddingSeed` carries 180
with no rows behind it on purpose (`MemoryRepository.ts:922`), so the loaded list is the wrong
thing to render.

**Dead ends a host reaches by using the app as designed — all three closed.** #29
(`RoleSwitch` was shown to every guest and, against Supabase, only ever refused) · #37 (a
founder could not leave the host console: `becomeGuest` opened with `requireGuest()` and
`create_event` mints her no `guests` row — she takes a seat on demand now) · #24 (`seen by
0` forever: `broadcast_reads` had a policy and a fold and no writer).

**NOTHING A HOST SENDS IS PERMANENT ANY MORE -- two of #68's three halves.** `broadcasts`
now carries `broadcasts_host_delete` (`using is_host(event_id)`, matching `broadcasts_pin`
rather than #68's own "scoped to the author" -- a co-host and a DJ both post here, and under
an author scope the host running the party is the one person who could not remove somebody
else's mistake). A DELETE rather than a `hidden` flag, which is the OPPOSITE of the call #65
made for photos, and the difference is who is protected: a hidden photo keeps a moderation
record about a GUEST, and `reports.subject_kind` cannot even name a broadcast. There is no
byte to strand either, which is what makes it safe here and not on `photos` or `folders`.
**It cannot unsend a push** -- `pg_net` is fire-and-forget and the notification is already on
the lock screen -- so the confirmation sheet says so out loud.

**`events.now_schedule_item_id` IS A REAL FOREIGN KEY NOW, AND THREE COMMENTS SAID IT ALREADY
WAS.** It was a bare `uuid`; `repository.ts`, `SupabaseRepository.schedule.remove` and
`MemoryRepository.schedule.remove` each stated the cursor is cleared by "the column's own
`on delete set null`", and the memory adapter SIMULATED it. So every journey rendered
behaviour Postgres did not have. The harm is not the rewind guard -- a dangling pointer and a
null one both yield a null `v_cur_pos`, measured by mutation -- it is that **the two adapters
diverged on observable state**, which is the one thing the seam exists to make checkable and
the one shape no lane here can check.

**A HOST CAN DELETE ONE PARTY AND KEEP HER ACCOUNT (#73).** `create_event` allows TEN events
per identity forever and nothing freed one, so a host who made three to try the app had burned
three permanently -- and #19's account deletion was the only remedy, which is the nuclear
option wearing a cap remedy's clothes. Same Edge Function, narrowed by an `event` argument:
ONE function rather than two, because the dangerous part is the ORDER (event row last, or
`is_host()` goes false and every object is stranded) and a second endpoint is a second chance
to get it wrong.

**THE FOUNDER ONLY, AND GRADE IS NOT OWNERSHIP.** `invite_host` can mint a seat at
`role = 'host'`, so a co-host brought in to help run a wedding must not be able to destroy it.
`hosts.founder` is a COLUMN, written by `create_event` alone, with a partial unique index so
an event cannot have two. **The first draft inferred it from `created_at` and lane E killed
it in one run**: that column defaults to `now()`, which is the TRANSACTION timestamp, so every
seat minted in one transaction ties and the tiebreak falls to a random uuid. In production the
two calls are separate transactions and it would usually have been right -- a rule that holds
until it does not, deciding who may delete a wedding. **The founder check runs as the CALLER,
never as the service role**: `is_event_founder()` reads `auth.uid()`, so asking it with the
service-role client would answer for nobody and admit everybody.

**`coHosts` IS THE FIELD THAT CHANGES THE SENTENCE.** Account deletion KEEPS an event somebody
else holds a seat at; this one TAKES it, because she picked the party by name. People who have
been building a run of show all week would otherwise find out by opening the app.

**AND A VACUOUS ASSERTION WAS FOUND BY MUTATING IT.** "the deleted party has left the list"
passed with the filter deleted -- because `create` set `this.ev` and never added the event to
`hostedList`, so the row had never been there. A host who made an event could not see it in
her own list until something else republished. Both fixed together; the mutation bites now.

**EVENT DELETION IS DELIBERATELY NOT BUILT**, and lane E now guards its absence rather than
leaving it to a policy that merely does not exist -- the state `folders` was in before its own
incident. One `events` row cascades through sixteen tables: every photo byte is stranded
permanently (`hosts` cascades too, so `is_host()` goes false and `event_photos_delete` can
never admit anyone for that prefix again) and `reports` cascades, erasing the moderation
record the person complained about would most like erased. It has to be bytes-first through
the Storage API with a service role -- the `sweep-photos` shape -- and bounded, because a
cascade is one non-resumable statement.

**AN EVENT THAT HAS ENDED REFUSES NEW CONTENT AND NOTHING ELSE (#41).** `eventTtlHours`
had no reader anywhere -- one grep hit outside `tiers.ts` and it was a comment in a seed
file -- so a free event opened on Friday still took chat, songs and photos the following
Wednesday. `public.event_is_open()` reads `tier_limits.event_ttl_hours` now. **168 hours,
not the 48 it claimed**: guests upload their photos days later, and a Friday party closing
on Sunday evening cuts off exactly the people slowest to get round to it. The clock runs
from `starts_at`, never `created_at` -- a host planning three weeks ahead must not find her
party already expired on the night.

**The rule is statable and that is the point.** REFUSED: a photo, a song request, a vote, an
announcement, a run-of-show row, a folder. STILL ALLOWED, FOREVER: reading everything;
reporting content and resolving a report; hiding a photo; blocking somebody; marking an
announcement seen; deleting a row you already have; joining (it is read ACCESS, and
`photos_read` requires a `guests` row); and `events_host_update`, which is how a host
changes tier and therefore how **paying reopens the event**. The safety half is an
obligation, not a courtesy -- the album stays visible for another three weeks under #40's
clock, so somebody has to be able to report what they can still see.

**`with check`, NEVER `using`, and lane E pins it.** `using` says which rows you may TOUCH;
`with check` says what you may WRITE. Putting the window in `using` on a `for all` policy
also blocks DELETE, so a host could not tidy a run-of-show row after the event -- punishing
housekeeping to enforce a paywall. Mutation-checked: moving it turns `a host can still
DELETE from a closed event` red.

**A POLICY PREDICATE ALONE WOULD HAVE BEEN A GREEN GATE OVER A DEAD RULE.** `request_song`
and `start_schedule_item` are SECURITY DEFINER, so they bypass RLS entirely and
`requests_insert`'s window clause never runs on the path `music.request` actually uses
(#44). Both carry the check in their own bodies. Proven by mutation: stripping the
in-function guard while leaving every policy intact still let a song land on a closed event.
`play_next` is deliberately NOT gated -- it promotes a row that already exists, the same act
as `requests_moderate`.

**`?ended=1` boots `endedSeed`** -- a `house_party` event ten days past its start, furnished
on purpose so "reading never stops" is assertable. No other seed can reach a closed window:
the wedding is on a tier with no expiry and both free seeds are current.

**Two live defects fell out of writing the journeys**, neither related to the window except
that nothing could refuse these paths before it: `music.request` was not wrapped in
`guarded`, so an `EntitlementError` was an unhandled rejection -- the guest tapped and
nothing happened, which is the silent refusal the denial copy exists to prevent. And
`MusicScreen` cleared the composer unconditionally, so a refusal destroyed what was typed --
the rule `BroadcastPanel` and the schedule composer already follow.

**STAFF ARE NOT GUESTS, and it is now one rule asked in three places.**
`public.guest_seats()` excludes a seat held by a host of that event, and it is what
`fold_guest_count` and `join_event`'s cap check both read; `fold_seen_count` applies the
same exclusion one level down. So a host looking at her own party does not appear in "N
already here", does not eat one of the ten seats a free tier sells, and does not make her
own announcement read "seen by 1" before anyone has seen it. `hosts` folds on
`update of auth_user_id` too, because `claim_host` promotes a guest without touching
`guests` at all. FIDELITY notes AJ and AK.

**One song, one row (#44).** `music.request` inserted unconditionally and the queue is ranked
by votes, so two people asking for the same song made two rows with one vote each.
`public.song_key(title, artist)` under a PARTIAL unique index (`pending`/`accepted` only, so
a played song can come round again) is what decides two requests are the same song, and
`request_song` inserts-or-votes in one statement. It reports which branch ran via `xmax = 0`,
because otherwise the toast claims to have added a row that did not appear.
`src/domain/songKey.ts` mirrors it for `MemoryRepository` and `songKey.test.ts` re-parses the
migration — folding LESS than the index shows up at once, folding MORE is silent.

**A guest can see and change their own name (#43/#36).** No screen ever showed a guest their
own nickname, so a typo lasted all night; and `guests_update_self` — which looked like the
route — could never fire, because `guests` has no SELECT policy and PostgREST always sends a
WHERE. That policy is deleted rather than kept as documentation for an implementation that
fails silently. `set_nickname` rewrites the denormalised copies on that guest's own requests
and photos, and deliberately not `blocked_name` or a report's subject label.

**Promised, built, and now WITNESSED.** #28 shipped the scanner — `expo-camera`,
`codeFromScan` living beside `joinLink` because every interesting failure of a scanner is a
string failure, and typing still the primary path with the field never hidden. #42 closed the
caveat under it: `pnpm scan:device` runs `CameraView` against the emulator's virtual scene and
reads a QR the app's own `EventQr` generated. What that still does not cover is **iOS**, and
**`NSCameraUsageDescription`** — Android composes its permission dialog from the permission
group, so no Android run can read an iOS plist key. FIDELITY notes AL and AR.

**`app.json` has two plugins writing `NSCameraUsageDescription`.** `expo-image-picker` and
`expo-camera` both declare it, config plugins apply in order, and the later one silently
wins — so a guest at the door would be asked to allow the camera "to add photos to the
album". One sentence covers both uses and `src/lib/appConfig.test.ts` fails if they ever
disagree. It is the only place that can catch it: the plist is prebuild output and `/ios`
is gitignored.

**PUSH IS BUILT** (#27). `set_push_token` stores a token on the caller's own `guests` row;
`fan_out_push` (a trigger on `broadcasts`) and `fan_out_song_push` (on `song_requests`
UPDATE) call the `send-push` Edge Function through `pg_net`, which reads tokens as the
service role and posts to Expo. `tier_limits.push_notifications` is the gate and
`fan_out_push` is what reads it, so `audit:tiers` reports `pushNotifications — SQL`. The
"+ push" line is back on the $79 card because it is now true. FIDELITY notes Z and AA.

**IT IS ARMED, AND IT IS GUARDED -- and the second half had to come first (#51).**
`send-push` reads every guest's push token with the SERVICE ROLE and posts to Expo, and the
functions gateway's `verify_jwt` proves only that a caller holds *a* project JWT -- the anon
key is PUBLIC, compiled into the bundle. So the endpoint had no authorisation of its own:
anyone with the app's own key could have POSTed an event id and a body and buzzed every phone
at somebody else's party. Nothing had gone wrong only because the fan-out was never armed --
its Vault secrets did not exist, so `fan_out_push` returned early every time. **Adding the
secrets without adding the check would have been the regression, not the fix.**

`push_authorised()` is the same shape as `sweep_authorised()`: an `x-push-key` header
compared INSIDE the database so the secret never crosses the wire, failing closed, with a
missing secret and a wrong one answering identically so a prober cannot learn whether the
endpoint is live. THREE Vault secrets now, not two -- `push_fanout_url`, `push_gateway_key`
(the public key, to get past the gateway, authorising nothing) and `push_key` (the one that
does). Measured against the live project: a caller holding only the publishable key gets
**403** with or without a guess, no JWT gets **401**, and the trigger's own path gets
**200 `{"sent":0,"reason":"no registered devices"}`**. FIDELITY note AV.

**What no lane here can prove about it, and this must not be glossed:** that a phone
buzzes. Lane B has no push API and boots `MemoryRepository`; Lane C could witness an
Android notification only once FCM credentials are wired; iOS is unprovable in this
environment at all. And `pg_net` is fire-and-forget — a failed push lands in
`net._http_response`, outside the transaction, so it is **silent**.

**Two credentials only a human can supply**, both one-time, both behind an interactive
login: an **APNs auth key** (`eas credentials`, Apple ID + 2FA) and an **FCM service
account** (Firebase console, Google login). Plus two Vault secrets on the project,
`push_fanout_url` and `push_fanout_key`. Until those exist the fan-out returns early and
sends nothing — deliberately, and without failing any insert.

**Do not assert that an unenforced flag is ABSENT.** Eight of them are meant to be present
and `false`; a test demanding absence contradicts the remedy `audit:tiers` prints, and
removes the flag from the ladder-monotonicity test that was already covering it. FIDELITY
note Z.

**The reason the rest kept arriving by phone.** #20 — all 442 journeys boot
`MemoryRepository`.

Still true and not an issue: the in-memory transfer completes instantly because nothing
is being sent anywhere, so `uploading` and `failed` are reachable only through the
injectable transfer (`fixtures/flakyTransfer.ts`, `EXPO_PUBLIC_FLAKY=1`, or `?flaky=1`
in the web harness).

## How to work here

Three rules, and they exist because of what one day cost. Eighteen commits, three
merges and **four TestFlight builds** produced a keyboard that trapped every guest, a
guest with no way out of an event, three inert controls and a blank host console —
every one of them found by holding a phone, one device session at a time, and not one
of them written down anywhere a fresh session could read.

**1. A gap found is an issue filed, in the same turn.** Not a paragraph in a commit
message. The commit messages in this repo are good writing and bad tracking: nobody can
read a roadmap out of `git log`, and the next session starts cold.

**2. Code before builds.** Four builds in a day is the symptom. The cause is shipping to
a device to find out what a test could have said. Land a batch, prove it in the lanes
that exist, then build once. A build is not progress; it is a measurement, and an
expensive one.

**3. Scope forward, not backward.** Before starting an arc, write down the journey it
completes and mark every step exists / partial / missing. `?empty=1` is the worked
example: the failure was never "one button is dead", it was "the harness cannot render
the state where three buttons are dead", and only a journey-level look sees that.

### Operational facts that cost a session each

- **`?empty=1` boots `emptySeed`** — a world where `event.current` is null, which is what
  a real guest sees before joining and what the Supabase adapter returns
  (`SupabaseRepository.ts:39-43`). Before it existed, `Seed.event` was non-nullable while
  every sibling was nullable, so no test could reach the state, and `disabled={!event}`
  shipped three dead controls off one boolean.
- **`?invited=1` boots `invitedSeed`** -- no event, but a code from a link that
  resolves to one. It is the middle of three worlds (`?empty=1` is the cold open,
  `weddingSeed` is joined), and it exists because `weddingSeed` already has
  `event.current`, so the whole `event.preview` path could be deleted with every other
  journey still green. It proves the invitation SCREEN only: an `EventPreview` carries
  seven of `RunitEvent`'s twelve fields, so Memory cannot honestly model the join that
  follows, and `tests/e2e/invitation.spec.ts` says so rather than faking it.
- **`?fresh=1` boots `freshSeed`** -- the event a host MADE IN THE APP, twenty minutes in:
  `invitedCount` 0, `guestCount` 4, no schedule, no album, one host. That pairing exists in
  no other seed, and its absence is why "Send to 0 guests" survived 326 journeys (#70).
  `weddingSeed` hardcodes 180 invited and `housePartySeed` 8, so every assertion the suite
  had ever made about the composer was made in a world where the number happens to be
  true -- while `create_event` mints 0 and nothing in the product raises it
  (`fold_invited_count` fires on `invitees`; `join_event` writes none). The journeys JOIN
  first, so the number under test is live rather than seeded: the room goes 4 -> 5 and the
  composer has to move with it.
- **The composer's number is a FALLBACK, not a replacement, and both halves are tested.**
  `invitedCount` when there is an invitation list, `guestCount` when there is not. Collapsing
  the two is its own bug (#25) and `host-console.spec.ts:140` catches it -- mutation-checked:
  wiring the composer to `guestCount` unconditionally turns that test red. The third surface,
  the run-of-show `accessibilityHint`, is NOT asserted and cannot be: react-native-web does
  not forward `accessibilityHint` at all, so it never reaches the DOM. Same class as
  `hitSlop`; stated in the spec rather than faked.
- **`aria-disabled` is the gate.** react-native-web renders a disabled `Pressable` that
  way, so `expect(page.locator('[aria-disabled="true"]')).toHaveCount(0)` is a DOM fact
  about a whole screen rather than an assertion per control
  (`tests/e2e/empty-world.spec.ts`). It is the one check that scales with the class of
  bug instead of with the instances of it.
- **`closeEvent()` is not `leave()`.** `closeEvent` tears down the event context and
  keeps the identity; `leave()` does that *and* signs out. A host switching events must
  never take the second one. FIDELITY note R.
- **The emulator's input pipeline can wedge mid-session** — the app keeps rendering,
  keystrokes stop arriving, and nothing in the log says so. Re-check `hw.keyboard` and
  `adb shell dumpsys input | grep -i keyboard` before believing a field is broken; that
  is separate from the AVD shipping `hw.keyboard = no` in the first place.
- **Gboard's floating mode gives a false measurement.** Reset it with
  `adb shell pm clear com.google.android.inputmethod.latin` before measuring anything
  keyboard-shaped, or the number you write down describes the IME, not the app.
