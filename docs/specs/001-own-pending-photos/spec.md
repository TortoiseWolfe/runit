# 001 — A guest sees their own photo before it is approved

Status: DRAFT, awaiting owner review. Wireframe: runit-wireframes (section 2).

## Problem
On an event with photo approval on (the default since 2026-09-20), a guest's upload lands
`pending` and is invisible to the room until a host approves it. The guest gets one toast,
then no trace of the photo. Checking the album minutes later, it looks as if the upload
failed. `PhotosScreen.tsx` documents this as "a real gap".

## User stories
- As a guest, after I take a photo I see it in the album straight away, marked as waiting,
  so I know it was received.
- As a guest, no other guest can see my waiting photo.
- As a host, nothing changes: the approval queue and the room's album work as before.

## Requirements
1. A guest's own `pending` photos appear in their album grid, in the folder they were filed
   into, ahead of approved photos, marked "Waiting for host".
2. Only the uploader sees them. Other guests never do (RLS `photos_read` already enforces
   this; this feature must not widen it).
3. When the host approves, the tile loses its mark and joins the album order. When the host
   hides it, it disappears from the guest's grid.
4. Photo states shown to the uploader: sending, waiting for host, in the album, failed
   (tap to retry). Existing sending and failed behaviour is unchanged.
5. On events with approval off, no tile is ever marked waiting.
6. The first-upload toast states the rule once: "Only you can see this until a host approves it."

## Acceptance criteria
- A guest uploads on a moderated event, reloads the app, and still sees the photo, marked.
- A second guest's album does not contain it. The host queue still contains it.
- Approve: mark removed on the uploader's device without a reload. Hide: tile removed.
- The viewer opens a waiting photo full size for its uploader.
- Works in MemoryRepository and SupabaseRepository identically (the fixture must not be
  kinder than the backend).

## Out of scope
Layout changes to the Photos screen (spec 002), the host approval UI, push notifications.
