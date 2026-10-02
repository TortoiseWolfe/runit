# Raising an event's tier (there is no purchase path, #30)

**SUPERSEDED WHILE THE BETA IS OPEN (spec 002, 2026-10-02).** The host does this herself:
Event panel → Change plan → Choose. `set_event_tier` runs founder-only, server-side, free while
`app_settings.beta_open` is true. What follows is the fallback for a closed beta, or for an
event whose founder cannot be reached.

A free event (`house_party`) holds 10 guests, 100 photos, 1 folder, 30-day photos.
`events.tier` is not client-writable, so this is a production SQL step, run by the owner
with the legacy Supabase token passed for ONE invocation (see CLAUDE.md), through
`POST /v1/projects/{ref}/database/query`.

1. Host creates the event in the app; note its six-character code.
2. Run, substituting the code:

   update public.events set tier = 'event' where code = 'XXXXXX' returning code, name, tier;

   `event` = 300 guests, 5 hosts, 10 folders, 365-day retention, push on.
   Use `'venue'` (3000 guests) above 300. Read the row back: a 0-row result means a wrong
   code, and no error is raised.
3. Only then does the host send invitations.

Also decide photo approval for the event (`events.photo_moderation`, default on).
