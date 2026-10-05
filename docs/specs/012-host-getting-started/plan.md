# 012 — Plan

## Where it lives
- `src/features/host/HostStartCard.tsx` (new): pure presentation. Props are the three done
  flags, the three actions and `onHide`. It decides nothing it is not handed.
- `src/features/host/hostStart.ts` (new): `hostStartItems({ invitedCount, guestCount,
  broadcasts, scheduleRows })` returns the three items with `done` set, plus `firstOpen`. Pure
  and unit-tested, the same split as `deleteSheetState()` and `viewerControls`.
- `BroadcastPanel.tsx`: replace the `empty-room-share` block with `<HostStartCard>`; pass
  `onShare`, a focus action for `broadcast-draft`, and one for the run-of-show field.
- Reads: `useEvent()` for the two counts, `useFeed()` for broadcasts, `useSchedule()` for rows.
  No new repository method and no SQL.

## Hiding
A per-event flag on the device. Native: `expo-secure-store` (already a dependency). Web:
`localStorage`, wrapped in try/catch because a private window can refuse it. A small
`src/lib/hints.ts` with a `.web.ts` half, since `expo-secure-store` has no web build
(CLAUDE.md, FIDELITY AB). Key: `host-start-hidden:<eventId>`.

## Seeds
`?fresh=1` already gives 0 invited, no broadcasts and no schedule, so no new seed is needed.
`weddingSeed` is the all-done case.

## Risks
- Journeys that click `empty-room-share` keep working only if the testID moves with the
  button (requirement 4). Grep `tests/e2e` for it before deleting the old block.
- `invitedCount` on `weddingSeed` is 180 with no rows; the rule keys on the COUNT, so this is
  correct there (CLAUDE.md, "weddingSeed has 180 invited and no invitees rows").
