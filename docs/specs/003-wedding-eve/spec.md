# 003 — Three things the owner asked for the night before a real wedding

Status: SHIPPED 2026-10-02/03. Directed in session by the owner while the planner's beta
was being set up; each is one surface and one sentence, so this is the record rather than a
design.

## 1. The code and the recovery key can be copied, not only read
The created screen printed a twelve-character key and a button reading "I have written it
down". *"Why are we screenshotting it instead of giving them a copy button?"* — no reason.
Each value has a **Copy** beside it (`created-code-copy`, `created-key-copy`), is selectable
for a long press, and the toast names what was copied. A clipboard that refuses is said out
loud. `create-copy.spec.ts` grants Chromium the clipboard and asserts what landed on it.

## 2. Photo approval is OFF by default
On since 2026-09-20 (the album is the one surface where a stranger's mistake is instantly in
front of the room). The owner reversed it: a host mid-event has no hands free to approve.
`create_event` mints `photo_moderation = false`; the Event panel switch is unchanged; existing
rows untouched. The App Store listing's *"the host approves them before they appear"* is a
claim again and must be reworded (#69's rule, pointing the other way).

## 3. Approve all
*"It's not a bulk approve either, is it?"* It was not. `photos.approveAll()` is one UPDATE
filtered on `event_id` and `status = 'pending'` — `status` is the one column the grant
carries, `photos_moderate` admits hosts — and the count is read back off the rows, never
assumed. The button (`approve-all`) is drawn only while more than one photo waits: over one
it is the same tap as the row, over none it is a door that does not open. The toast carries
the count. `approve-all.spec.ts` empties the wedding seed's queue.

## Not changed
The per-photo Approve and Hide; the moderation policy; the store listing text (the owner's
words to choose).
