# 008 — plan

1. **Migration** (the one monolithic file): replace `attach_guest_list` with the
   three-argument form, `p_member_ids uuid[] default null`, filtering
   `m.list_id = p_list_id and (p_member_ids is null or m.id = any(p_member_ids))`. Drop the
   two-argument signature. Same grants (`authenticated` only).
2. **Lane E**: subset attach, foreign member id ignored, non-host refused; raise
   `EXPECTED_ASSERTIONS`; run against a reset local stack.
3. **Repository seam**: `guestLists.members(listId)` (a read, an observable like the rest)
   and `attachGuestList(listId, memberIds?)`; Supabase sends `p_member_ids` only when given;
   Memory filters and refuses the same cases. Unit tests in both adapters, `FakeClient`
   recording the argument.
4. **UI**: `GuestListSheet` (5-file component) opened by the existing `+ <List> (N)` buttons in
   `EventDetailsPanel.tsx`; switches all on; "already invited" text for matches; the count on
   the confirm button. `audit:targets`, the gutter gate and `audit:feedback` stay green.
5. **Journeys**: switch one off → N-1 land, list unchanged; reattach shows "already invited";
   zero on → no confirm button.
6. **Docs**: CLAUDE.md (the four questions, one paragraph), FIDELITY note.
7. **Board**, merge, push, deploy web, apply the migration delta to production, read back.
