# 008 — Pick who from a saved list comes to this event

Status: SPEC ONLY (2026-10-03). Wireframe: `design/wireframes/2026-10-03-pick-from-a-list.html`.
No code until after the first wedding beta.

## Problem
Attaching a saved list is all or nothing. `attach_guest_list(p_event_id, p_list_id)` copies
every member into `invitees`; the only way to leave somebody out is to remove them from the
event afterwards, one row at a time, and nothing shows who is on a list before it lands.

The owner's case: his Family list should not include his roommate, but at Thanksgiving she is
his co-host. Should she be on the list and toggled on, added outside the list, or both?

## The decision: four questions, four controls
| Question | Control | Changes |
|---|---|---|
| Who **belongs** to this group? | the saved list | the list, for every future event |
| Who from the list is **coming this time**? | a switch per member, at attach | this event only (subtractive) |
| Who is coming who is **not on the list**? | the one-off add (exists) | this event only (additive) |
| What does somebody **do** here? | the co-host seat, `invite_host` (exists) | a role, with its own key |

**None stands in for another.** A "usually off" member on Family is rejected: the list would
stop meaning "family" and start meaning "people I might invite", and every event would begin
with switching her off again. The roommate is invited by a one-off add and made co-host in the
co-host section; if she comes to most things she gets her own small list ("Household"),
attached beside Family. A list never grants a role and a role never edits a list.

## User stories
- As a host, when I tap a saved list I see its members before anyone is added.
- As a host, I can switch off the members who are not coming to this event, and the list
  itself is untouched.
- As a host, I can still add somebody who is on no list, and make anybody a co-host, exactly as
  today.

## Requirements
1. Tapping `+ <List> (N)` opens a sheet listing the list's members (name, else phone or
   email), each with a switch, **all on**.
2. A member already on this event's invitees (matched as the unique indexes match: lower
   email, `phone_key`) shows **"already invited"** as text, not a switch: a control that can
   only do nothing is not drawn (the `aria-disabled` gate, `empty-world.spec.ts`).
3. The confirm button says the count that will land: "Add 5 to this party". With zero
   switched on it is not drawn; Cancel always is.
4. `attach_guest_list(p_event_id uuid, p_list_id uuid, p_member_ids uuid[] default null)`:
   null attaches every member (old callers unchanged); otherwise only members of THAT list
   whose ids are in the array. The two-argument function is DROPPED in the same migration:
   PostgREST resolves overloads by argument name, and two candidates is an ambiguity.
5. Switching a member off never writes to `guest_lists` or `guest_list_members`.
6. Members are read through the existing owner RLS (`guest_list_members_own`); no new grant.
7. `MemoryRepository` mirrors the filter and refuses what the backend refuses (not your list,
   not a host of this event). The fixture must not be kinder than the backend.

8. **The saved lists come FIRST in "Who is invited"**, above the address field, and the
   empty-state line names them: "Nobody yet. Add your Family list (7), or add people below."
   Measured 2026-10-03: on the owner's phone the section read "Nobody yet" over an email
   field, and a list button (when the build draws one) sits below "+ Add from contacts" --
   the one thing he came to do was the last thing on the screen.

## Out of scope
- A screen that edits a list's membership (add, rename, delete members).
- Pushing list edits into events that already attached the list.
- A per-member "default off" flag (rejected above).
- Optional, later: "Make co-host" beside an invitee, prefilling the co-host name. It would
  still mint a key; it is still a role.

## Acceptance criteria
- On a fresh event with a saved list of 6, switching one off and confirming adds 5 invitees;
  the list still has 6 members.
- Attaching the same list again shows those 5 as "already invited" and offers only the 6th.
- Lane E: a host attaches a subset of her own list; a member id from somebody else's list in
  `p_member_ids` adds nothing; a non-host is refused 42501.
- `audit:rpc` passes with the new parameter; no two-argument overload remains.
