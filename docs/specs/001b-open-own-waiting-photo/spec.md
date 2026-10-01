# 001b — A guest can open their own waiting photo full size

Status: APPROVED by the owner 2026-10-01. Follow-up to spec 001 (`docs/specs/001-own-pending-photos/`), issue #97.

## Problem
Since spec 001 a guest sees their own photo in the album straight away, marked "Waiting for
host". But the tile does nothing when tapped. `PhotoViewer` is given the approved list
(`visible`) and an index, and waiting tiles come from `photos.mine`, so there is no way to look
at your own photo full size while it waits. Approved tiles open; yours don't, which reads as broken.

## User stories
- As a guest, I can tap my waiting photo and see it full size, still marked as waiting.
- As a guest, I can swipe from my waiting photos on into the room's approved photos in this folder.
- As a guest, I am never offered actions that make no sense for a photo only I can see.

## Requirements
1. A waiting tile (own, `pending`, in the active folder) opens the full-size viewer, like an
   approved tile does.
2. The viewer's list is the folder's grid order: own waiting photos first (as in spec 001
   req 1), then the approved photos. "N of M" counts both.
3. On a waiting photo the viewer shows the "Waiting for host" mark, and does NOT show Save or
   Report. The room can't see the photo, so reporting it is meaningless, and Save stays off until
   the photo is in the album (#97: these controls must not appear on a photo the room cannot see).
   On approved photos Save and Report are unchanged.
4. The viewer follows the photo, not the index. If the host approves it while it is open, the mark
   disappears and the viewer stays on the same photo. If the host hides it while it is open, the
   viewer moves to the next photo, or closes if there is none. It never silently shows a different photo.
5. Sending and failed tiles keep their current behaviour (progress, Retry); they do not open the viewer.
6. Only the uploader ever reaches their waiting photo in the viewer (nothing here widens RLS
   `photos_read`).

## Acceptance criteria
- On a moderated event a guest uploads, taps the waiting tile, and sees it full size with the
  mark, "1 of M", and no Save or Report.
- Swiping on reaches the approved photos, where Save and Report appear.
- Approve while open: the mark goes, same photo stays. Hide while open: next photo or close.
- MemoryRepository and SupabaseRepository behave identically.

## Out of scope
A host releasing a photo from the album view (an open owner question in #104). Layout changes
to the Photos screen (spec 002). Opening sending or failed transfers.
