# 001 — Plan

## What the code already does
- `photos_read` (schema.sql:1561) already lets a guest SELECT rows where
  `uploaded_by_guest_id = my_guest_id(event_id)`, and the storage SELECT policy mirrors it.
  **No schema change is needed.**
- `SupabaseRepository.recompute()` (~line 486) builds `photos` from `tPhotos.all()`. That
  set already contains the guest's own pending rows. They are then filtered out of
  `sigApproved` and shown only to hosts via `sigPending`.
- `photos.mine` (`sigMine`, line 506) is fed only from `UploadOverlay`: in-flight and failed
  transfers, which are dropped the moment the row lands.

## Change
1. `SupabaseRepository.recompute()`: `sigMine` = overlay rows + rows from `photos` where
   `status === 'pending'` and `uploadedByGuestId === myGuestId`, de-duplicated against
   overlay ids, ordered as MemoryRepository's `mine` orders.
2. `MemoryRepository`: same rule in `sigMine`. Keep the fixture aligned.
3. `PhotosScreen`: the existing `mine.map` renders them. Add the "Waiting for host" mark to
   the tile for `status === 'pending'`. Do not create a second list.
4. Copy: first-upload toast (`actions.ts:281`) and the album's rule line.
5. Remove the "real gap" docblock at `PhotosScreen.tsx:72-86`, replace with the rule.

## Risks
- **Host also has pending rows.** A host's `myGuestId` is null, so the filter yields nothing
  for hosts. Add a test.
- **Overlay/row duplicate** during the settle window (row arrived, overlay not yet dropped):
  de-dupe by id or the tile flashes twice.
- **Comparator:** `cPhotos` compares named fields, and a missed field means a realtime
  UPDATE (approve) is never published. Status is compared; verify with an approve test.
- **Signed thumbnail for own pending photo:** storage SELECT already permits it; verify the
  signed URL resolves.

## Verification
Unit tests for both adapters (mutation-check the filter), a lane B journey (upload, mark
visible, second context does not see it, approve removes mark), lane H against the live
project with two contexts. Never claim done on lane B alone: it boots MemoryRepository.
