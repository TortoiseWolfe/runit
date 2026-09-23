# Code review — 2026-09-23

Systematic review (`/code-review`): security, performance, code quality, test coverage.
Findings are fixed in this tree unless listed under **Remaining**, where each carries the
reason it was not. Verification: 729 unit tests, lane E **253/253** against a database rebuilt
from the edited migration, the Docker board green.

**The schema changes below are in `supabase/migrations/00000000000000_schema.sql` and proven
locally. Production has NOT been changed** — applying the delta to the live project is a
deliberate act with the standing of `pnpm smoke:live`, not part of a review.

## Security — fixed

| Finding | Where | Fix |
|---|---|---|
| A photo row could name bytes in **another event**; the armed 04:17 sweep deletes what rows name (forge a row at a victim's path, back-date your own event, their album is gone) | `schema.sql` photos | `photos_path_under_own_event` + `photos_path_shape` CHECKs; `photos_moderate` now grants `update (status)` only |
| `song_requests` direct insert could arrive `accepted` with `vote_count 99999` (past moderation, first in `play_next`) | `schema.sql` | INSERT column grant limited to what `request_song` writes; `requests_guard` trigger (30/hour per guest, name from the seat) |
| Any host seat could post a broadcast as the founder with a fake `seen_count`/`created_at` | `schema.sql` | `broadcasts_author` trigger stamps the caller's own seat, `seen_count 0`, `now()`; 60/hour per seat; INSERT column grant |
| `feedback.created_at` was client-writable, so the 6/hour cap could be back-dated past | `schema.sql` | INSERT column grant; `feedback_guard` stamps `created_at := now()`; `context` capped at 4 KB |
| A report could name **any** event and the filer printed that event's **join code** (the admission credential) into a public issue | `schema.sql`, `tools/app-feedback-to-issues.mjs` | policy requires membership; the issue names the event uuid, never the code |
| Report text went raw into a public issue: forged dedupe marker → re-filed hourly forever; `@mentions` notify strangers; pipes break the table; a 65 KB body 422s and kills the hourly run | `tools/app-feedback-to-issues.mjs` | trailing-marker match only; words in a code fence with `<!--`/fence breakers defused; cells escaped; bounded; a refused row is skipped and named; `--selftest` (7 cases) runs on every board |
| Only the 200 **oldest** rows were read and rows are never deleted — from the 201st report nothing was ever filed | `tools/app-feedback-to-issues.mjs` | newest-first paging until a page is entirely already-filed |
| `uploaded_by_name` was in the photo insert grant, so a guest could file a photo under another guest's name and a report would blame them | `schema.sql` `set_photo_status` | name taken from the `guests` row |
| `invitees.invited_at`/`joined_guest_id` protected on UPDATE only | `schema.sql` | INSERT column grant |
| `max_photos`/`max_folders` enforced only in the client | `schema.sql` | `photos_cap` / `folders_cap` BEFORE INSERT triggers (54023) |
| Operator runbook minted host keys with `random()` | `supabase/seed-events.sql` | `public.mint_token(12)` |
| Feedback screenshot path minted with the global `crypto.randomUUID()`, absent on Hermes → screenshots silently dropped on device | `SupabaseRepository.ts` | `Crypto.randomUUID()` from expo-crypto |
| `delete-account`: `{"limit":"x"}` is NaN, the file loop never runs, the event row is deleted with every byte stranded; an upper-case uuid passed the founder check and listed an empty prefix | `supabase/functions/delete-account` | `Number.isFinite` guard; uuid validated and lower-cased |
| `.ics` escaped `;` as `'\;'`, which is `;` in JavaScript | `src/lib/invite.ts` | `'\;'`; the test carried the same no-op and was corrected |
| `decodeURIComponent` on a malformed `%` sequence stopped the bridge page's script | `web/i/index.html` | try/catch |
| App root served with no framing/sniffing headers while the web session sits in localStorage | `web/_headers` | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` |
| Schema comments claimed code-guessing is bounded by the anonymous sign-in rate limit (it caps identities, not calls) | `schema.sql` | claim corrected; see Remaining |
| Workflow comment and lane E doc still said the repository is private | `.github/workflows/checks.yml`, `docs/lane-e.md` | corrected |

Verified clean: no secrets in the tree or in 434 commits of history; no XSS sinks; every child process uses argument arrays; every edge function authorises beyond the gateway JWT; the historical `design/feedback/*.jpg` in public history is a 1.3 KB synthetic gradient from the proof run, nobody's photo.

## Performance — fixed

| Finding | Where | Fix |
|---|---|---|
| **Bug:** the `events` comparator omitted `photoModeration`, so a realtime UPDATE flipping only that column was never published — the host's own "Approve photos" toggle did not repaint | `SupabaseRepository.ts` | field added; a test emits an UPDATE per mapped column and asserts publication (11 cases, mutation-checked) |
| `sigHosts` cloned every row, defeating `shallowArrayEqual` — the console chrome re-rendered on every realtime message | `SupabaseRepository.ts` | no clone; `RowCache.reconcile` already returns stable objects |
| `new Intl.DateTimeFormat` per call, per row (chat bubbles, run of show, approvals) | `src/lib/format.ts` | one formatter per (shape, zone) |
| `alpha`/`albumTileColor`/`pendingPhotoColor`/`mix` recomputed per render over a tiny input space; `buttonInk` ran two OKLab conversions per primary-button render (per keystroke) | `src/theme/oklch.ts`, `buttonInk.ts` | memoised |
| `ToastProvider` handed `{ toast, show }` to every `use*Actions` consumer, re-rendering every screen twice per toast | `src/state/ToastProvider.tsx` | two contexts; `useToastState()` for `<Toast>` only (test mutation-checked) |
| `select('*')` on events to read one id; a linear scan over all photos to find one | `SupabaseRepository.ts` | `select('id')`; `tPhotos.get(id)` |

## Code quality — fixed

- 7 lint warnings, all dead code: unused imports/vars in `SupabaseRepository.ts`, `DjQueuePanel.tsx`, `invite.test.ts`, `guest-becomes-host.spec.ts`, `dns-apply.mjs`, `make-icons.mjs`; `Array<T>` in `depth.test.ts`.
- Linter disables (3), TODO/FIXME (0 real), stubs (0), skipped tests (0), commented-out code (0): nothing to fix.
- `supabase/templates/confirmation.html` ≡ `magic_link.html` is **deliberate** (GoTrue picks by situation; both must show the code) and was unguarded — now pinned by `src/lib/authTemplates.test.ts`, which also asserts no template carries `{{ .ConfirmationURL }}`.

## Test coverage — added

`denials.test.ts` (4), `authTemplates.test.ts` (4), `appStateBridge.test.ts` (6, mutation-checked), `feedbackPrivacy.test.ts` (5, mutation-checked), `ToastProvider.test.tsx` (2, mutation-checked), the events-comparator suite (11, mutation-checked), 13 lane E assertions (two mutation-checked), the filer `--selftest` (7). Unit suite 702 → **729**; lane E 240 → **253**.

Untested by choice: `push.ts`, `share.ts`, `contacts.ts`, `pickScreenshot.ts` (native device modules, no meaningful unit seam); `repository.ts` (types); `hooks.ts`/`actions.ts` (covered by 540 journeys); `client.ts` (a module-level env guard).

## Remaining — deliberately not changed here

| Finding | Why not in a review |
|---|---|
| #89 — Code guessing is unbounded per identity (`join_event`/`event_preview`; ~8.9e8 codes; a hit returns a name, venue and time) | Needs a miss-counting table and a throttle rule — a schema design, not a fix. The false claim that it *was* bounded is corrected. |
| #90 — Any host seat can move `starts_at` back and expire the album early | With the path constraint the sweep can no longer reach a *victim's* bytes; what remains is an insider on her own party. Restricting date edits to the founder is a product rule. |
| #91 — Realtime snapshot reads have no `limit`; `max_rows = 1000` truncates silently past 1000 photos on paid tiers; hidden/played/resolved rows are downloaded and discarded; `loadFetchOnce` makes 7 reads after each invitee write (#95) | Pagination through a realtime replay is an architecture change. |
| #92 — `recompute` runs synchronously per realtime message over all 8 tables; `sigReports`/`sigMine` rebuild objects each time | A microtask coalesce touches the reconnect path 700 tests lean on; measure first. |
| #93 — Seven lists render with `.map` inside a `ScrollView` (photos up to 1000, requests uncapped) | FlatList rewrites change layout, `onLayout` read-tracking in Chat, and lane D pairs. |
| #94 — `SignedUrls` gives a batch one expiry, so the album flashes to tiles hourly | Behaviour, not correctness. |
| #96 — Feedback bucket uploads uncapped per identity; objects without a row never cleaned | Storage policies cannot count cheaply; needs a sweep. |
| TestFlight screenshots still committed to the public repo | #87 — the owner's call. |
