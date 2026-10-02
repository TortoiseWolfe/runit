# 002 — A host chooses her plan, free during the beta

Status: SHIPPED 2026-10-02 (approved, built, proven on production the same evening). No
wireframe: the surface is one row and one sheet on an existing panel, drawn below in text.

## Problem
Every event a host creates is `house_party`: 10 guests, 1 host, 100 photos, 1 folder.
`events.tier` is outside every client grant and `event.setTier` throws against Supabase, so
the only way a real wedding has ever been possible is a service-role `UPDATE` run by the
developer per event (`docs/runbook-tier-bump.md`). That is not a product; it is a person.
The pricing screen was cut (#30) because it showed prices with no purchase path, and the
purchase path (StoreKit, receipts, review) is days away and does not exist in a browser.

## User stories
- As the host who created an event, I can see which plan it is on and what that plan holds.
- As that host, during the beta I can change the plan to any of the four, for free, without
  asking anyone.
- As a co-host, DJ or planner, I can see the plan and cannot change it (same rule as
  deleting the event: the seat that created it decides).
- As the owner, I can close the beta with one setting; after that the same control refuses
  with a reason until a purchase path exists.

## Requirements
1. The Event panel shows a **Plan** row: the current plan's name and its guest, host and
   photo caps, read from `src/domain/tiers.ts` (never a literal).
2. A **Change plan** control on that row opens a sheet listing the four plans with their
   caps and one **Choose** per plan (none for the current one). No prices anywhere. It is
   drawn for any host seat, the way Delete is: the client has no field that tells a founder
   from a co-host, so the database decides and a co-host gets a sentence, not silence.
3. Choosing calls one server function, `set_event_tier(p_event, p_tier)`, SECURITY
   DEFINER: refuses a non-founder (42501), an unknown tier (22023), and a closed beta
   (55000, `plan_not_for_sale`). `events.tier` stays outside every column grant.
4. The beta switch is a row, `app_settings.beta_open`, writable by nobody but the service
   role. The sheet's copy says "Free during the beta".
5. On success the row repaints from the `events` observable (the comparator compares `tier`)
   and a toast confirms the plan. On refusal the toast says why; nothing else changes.
6. `MemoryRepository` refuses exactly what the backend refuses: a non-founder, an unknown
   tier. The fixture must not be kinder than the backend.

## Acceptance criteria
- A founder on `?fresh=1` sees "House party · 10 guests", changes to Event, sees
  "Event · 300 guests" without a reload.
- A guest's view of the same panel has no Change plan control.
- Lane E: founder sets the tier; guest and non-member are refused 42501; an unknown tier is
  refused; with `beta_open = false` the founder is refused 55000.
- `audit:rpc` sees the new call's argument names on the function.

## Out of scope
Prices, purchases, receipts, App Store products (#30 stays open for the purchase path).
Downgrade reconciliation: a plan below current usage applies to new joins and uploads only,
which is what every cap already does.
