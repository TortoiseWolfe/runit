-- Seeds the two events Runit needs to exist in the world: one real party, and one
-- permanent demo for App Review.
--
-- NOT a migration. The workspace convention is a single monolithic schema migration;
-- this is DATA, and it is separate so re-applying the schema never silently recreates
-- or clobbers a live event. Run it with the Supabase MCP, or psql as service role --
-- it bypasses RLS deliberately, because `events` and `hosts` have no INSERT policy for
-- anyone (that is the schema's decision, not an oversight).
--
-- IDEMPOTENT. Every insert is ON CONFLICT DO NOTHING keyed on the natural key, so
-- running it twice is safe and running it after the party does not reset anything.
--
-- CODES avoid 0/O and 1/I/L. A guest types this off a place card in a dim room.

-- ========================================================================
-- 1. THE PARTY
-- ========================================================================
--
-- TIER IS 'event', NOT 'house_party', and that is deliberate. Ten guests fits the free
-- tier exactly -- it is literally named "House party, up to 10" -- but that tier sets
-- photoModeration:false and djQueue:false, which switches off two of the three host
-- screens. A beta that cannot exercise photo approvals or the DJ queue is not testing
-- the app. Tier is a plain column and there is no billing, so this costs nothing.
--
-- Name, venue, date and doors are now EDITABLE IN THE APP -- /host/event, issue #14.
-- The column grant reaches name, venue, starts_at, timezone and doors_label, so a host
-- corrects their own event rather than asking whoever has the database password.
--
-- STARTS_AT IS A REAL EVENING, not `now() + interval`. It used to be `now() + 7 days`,
-- which put HOUSE7's start at whatever second this file happened to run -- 11:13 AM on
-- the live project -- underneath a doors_label reading "Doors 7:00 PM". The two had
-- always disagreed and nothing rendered starts_at, so nothing showed it. The invitation
-- now derives its date from starts_at and `+ Add to calendar` exports it, so a made-up
-- time becomes a wrong calendar entry on a guest's phone.
--
-- Anchored to the NEXT Friday at 19:00 New York time, so re-running this never seeds an
-- event in the past. `date_trunc` + the day arithmetic keeps it a real wall-clock 7pm
-- across DST rather than a fixed UTC offset that drifts by an hour twice a year.

insert into public.events (code, name, venue, starts_at, timezone, doors_label, tier, invited_count)
values ('HOUSE7', 'House Party', 'The living room',
        ((date_trunc('day', (now() at time zone 'America/New_York'))
          + ((((5 - extract(isodow from (now() at time zone 'America/New_York'))::int + 6) % 7) + 1) * interval '1 day')
          + interval '19 hours') at time zone 'America/New_York'),
        'America/New_York', 'Doors 7:00 PM', 'event', 10)
on conflict (code) do nothing;

-- ========================================================================
-- 2. THE APP REVIEW DEMO
-- ========================================================================
--
-- SEPARATE FROM THE PARTY on purpose. A reviewer poking at a live event would post
-- broadcasts to real guests' phones. And it must not expire: the free tier carries
-- eventTtlHours 48, which would end a demo mid-review and show a reviewer exactly what
-- a broken app looks like.

insert into public.events (code, name, venue, starts_at, timezone, doors_label, tier, invited_count)
-- The demo stays in the PAST -- a reviewer should land mid-event, with a run of show
-- already under way -- but at a believable 6:30 PM rather than two hours ago whenever
-- the file ran. Yesterday evening, in the venue's zone.
values ('DEMO42', 'Demo Event', 'Riverside Hall',
        ((date_trunc('day', (now() at time zone 'America/New_York'))
          - interval '1 day' + interval '18 hours 30 minutes') at time zone 'America/New_York'),
        'America/New_York', 'Doors 6:30 PM', 'event', 40)
on conflict (code) do nothing;

-- ========================================================================
-- FOLDERS -- an event with none refuses every upload
-- ========================================================================
--
-- activeFolderId maps a null column to '', which matches no folder, so upload() is
-- refused rather than filing bytes somewhere wrong. Every event needs at least one.

insert into public.folders (event_id, name, position)
select e.id, f.name, f.position
from public.events e
cross join (values ('Everyone', 0), ('The good camera', 1)) as f(name, position)
where e.code in ('HOUSE7', 'DEMO42')
  and not exists (select 1 from public.folders x where x.event_id = e.id and x.name = f.name);

update public.events e
   set active_folder_id = (select f.id from public.folders f
                            where f.event_id = e.id order by f.position limit 1)
 where e.code in ('HOUSE7', 'DEMO42') and e.active_folder_id is null;

-- ========================================================================
-- RUN OF SHOW
-- ========================================================================

insert into public.schedule_items (event_id, position, time_label, title, place)
select e.id, s.position, s.time_label, s.title, s.place
from public.events e
cross join (values
  (1, '7:00 PM', 'Doors',        'Front porch'),
  (2, '7:30 PM', 'Food',         'Kitchen'),
  (3, '8:30 PM', 'Music starts', 'Living room'),
  (4, '10:00 PM','Cake',         'Kitchen')
) as s(position, time_label, title, place)
where e.code in ('HOUSE7', 'DEMO42')
  and not exists (select 1 from public.schedule_items x
                   where x.event_id = e.id and x.position = s.position);

-- ========================================================================
-- DEMO CONTENT -- for the reviewer only
-- ========================================================================
--
-- The party starts empty on purpose: its content should be the guests'. The demo needs
-- something on every screen, because a reviewer who joins and sees three empty tabs
-- cannot tell a working app from a broken one.
--
-- author_name and author_role_label are supplied directly. They are denormalised and
-- NOT NULL precisely so history survives a host being deleted, which also means a
-- broadcast can exist before any host row does.

insert into public.broadcasts (event_id, author_name, author_role_label, kind, body, pinned)
select e.id, b.who, b.label, 'announcement', b.body, b.pinned
from public.events e
cross join (values
  ('Riley', 'Host', 'Welcome! Grab a drink and add your song to the queue.', true),
  ('Riley', 'Host', 'Photos you take here land in the shared album once approved.', false)
) as b(who, label, body, pinned)
where e.code = 'DEMO42'
  and not exists (select 1 from public.broadcasts x where x.event_id = e.id and x.body = b.body);

-- requested_by_guest_id stays null: these are seeded, not requested by a real guest.
-- The FK is nullable and requested_by_name is what the UI renders.
insert into public.song_requests (event_id, title, artist, requested_by_name, status, vote_count)
select e.id, r.title, r.artist, r.who, r.status, 0
from public.events e
cross join (values
  ('September',        'Earth, Wind & Fire', 'Sam',   'accepted'),
  ('Dancing Queen',    'ABBA',               'Devon', 'pending'),
  ('Superstition',     'Stevie Wonder',      'Alex',  'pending')
) as r(title, artist, who, status)
where e.code = 'DEMO42'
  and not exists (select 1 from public.song_requests x where x.event_id = e.id and x.title = r.title);

-- storage_path stays NULL. These rows have no bytes and never will -- the hue tile is
-- their permanent rendering, exactly as in the in-memory wedding fixture. hue is
-- degrees 0-359; storing it rather than a colour keeps the tile correct across a
-- light/dark switch with no data change.
insert into public.photos (event_id, folder_id, uploaded_by_name, status, hue)
select e.id,
       (select f.id from public.folders f where f.event_id = e.id order by f.position limit 1),
       p.who, p.status, p.hue
from public.events e
cross join (values
  ('Sam',   'approved', 24),
  ('Devon', 'approved', 152),
  ('Alex',  'pending',  287)
) as p(who, status, hue)
where e.code = 'DEMO42'
  and (select count(*) from public.photos x where x.event_id = e.id) = 0;

select code, name, tier, guest_count,
       (select count(*) from public.folders f where f.event_id = e.id) as folders,
       (select count(*) from public.schedule_items s where s.event_id = e.id) as schedule,
       (select count(*) from public.broadcasts b where b.event_id = e.id) as broadcasts,
       (select count(*) from public.song_requests r where r.event_id = e.id) as songs,
       (select count(*) from public.photos p where p.event_id = e.id) as photos,
       active_folder_id is not null as has_active_folder
from public.events e where code in ('HOUSE7','DEMO42') order by code;

-- ========================================================================
-- HOST ROWS AND THEIR CLAIM KEYS
-- ========================================================================
--
-- `hosts` has no INSERT policy for anyone, so this is the only route. Each host gets a
-- key whose BCRYPT HASH is stored; the plaintext is returned once, here, and never
-- again -- rotate by re-running rather than trying to recover it.
--
-- ONE STATEMENT PER EVENT, DELIBERATELY. A single statement generating keys for both
-- produced THE SAME KEY for each: the string-building subquery does not reference the
-- outer row, so Postgres hoists it to an InitPlan and evaluates it once. That would
-- have meant the App Review demo key opening the real party. Obviously-correct beats
-- clever for a credential.

insert into public.hosts (event_id, display_name, role, role_label)
select e.id, case when e.code = 'DEMO42' then 'Riley' else 'Host' end, 'host', 'Host'
from public.events e
where e.code in ('HOUSE7','DEMO42')
  and not exists (select 1 from public.hosts h where h.event_id = e.id);

-- Then, once per event (repeat with the other code):
--
--   with s as (
--     select (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
--                                      1 + floor(random() * 31)::int, 1), '' order by g)
--               from generate_series(1,12) g) as secret,
--            h.id as host_id
--     from public.hosts h join public.events e on e.id = h.event_id
--     where e.code = 'HOUSE7'
--   ), w as (
--     insert into public.host_claims (host_id, secret_hash)
--     select host_id, extensions.crypt(secret, extensions.gen_salt('bf')) from s
--     on conflict (host_id) do update
--       set secret_hash = excluded.secret_hash, claimed_at = null
--     returning host_id
--   )
--   select substr(secret,1,4)||'-'||substr(secret,5,4)||'-'||substr(secret,9,4) as host_key
--   from s join w on w.host_id = s.host_id;
--
-- The hash is over the UNGROUPED, upper-case form; claim_host() canonicalises input the
-- same way, so the dashes shown above are cosmetic and typing them is optional.
