# 002 — plan

- **SQL** (`supabase/migrations/00000000000000_schema.sql`, after the `tier_limits` seed):
  `app_settings` (key, value jsonb) seeded `beta_open = true`, no client policy;
  `beta_open()` STABLE reader; `set_event_tier(uuid, text)` SECURITY DEFINER, founder-only
  via `is_event_founder`, tier validated against `tier_limits`, refuses 55000 when the beta
  is closed. Revoke from public/anon, grant to authenticated.
- **Lane E** (`supabase/verify-policies.sql`): five assertions, floor raised after a real run.
- **Seam** (`src/data/repository.ts`): `event.setTier` docblock stops saying dev-only.
  `SupabaseRepository.event.setTier` calls the RPC. `MemoryRepository.event.setTier` refuses
  a non-founder and an unknown tier.
- **Actions** (`src/state/actions.ts`): a guarded `changePlan(tier)` mapping 55000 to a
  sentence, next to `setPhotoModeration`.
- **UI** (`src/features/host/EventDetailsPanel.tsx` + `src/features/host/PlanSheet.tsx`):
  the Plan row and the sheet. Founder-only control from `session`.
- **Tests**: unit for the adapter call and the Memory refusals; `tests/e2e/choose-plan.spec.ts`.
- **Docs**: CLAUDE.md "#30" paragraph and the `setTier`-throws note; `runbook-tier-bump.md`
  marked superseded during the beta.
- **Ship**: board green → deploy web → apply the narrow delta to production (table, function,
  grants) with the legacy token for one invocation → read `beta_open()` back.
