-- Runit: the whole schema, in one file.
--
-- WORKSPACE CONVENTION: one monolithic migration, never a chain of them. Editing
-- this file and re-applying to a fresh database is the workflow; there is no
-- incremental history to replay.
--
-- ------------------------------------------------------------------------
-- THREE DECISIONS THIS FILE ENCODES, EACH LOAD-BEARING
-- ------------------------------------------------------------------------
--
-- 1. THE EVENT TYPE IS A VARIABLE. Runit is a generic event companion --
--    wedding, birthday, corporate. So folder names, role labels and event names
--    are FREE TEXT, never enums. There is no "Ceremony" column and no
--    wedding-shaped anything. The only enumerations here are permission grades
--    and lifecycle states, which are genuinely closed sets.
--
-- 2. CLIENT-ONLY FIELDS DO NOT EXIST HERE. `Photo` in TypeScript carries
--    `localUri`, `progress` and `failureReason`. All three are per-DEVICE
--    transient state: where the bytes sit in this phone's cache, how far this
--    phone's upload has got, why this phone's attempt failed. Putting them in a
--    shared table would broadcast one guest's cache path to the room and let a
--    second device "resume" a transfer it is not performing. Only `storage_path`
--    -- a bucket key every device resolves the same way -- is shared.
--
-- 3. REALTIME IS SUBSCRIBED PER-RECORD, NOT PER-VOTE. Supabase bills and limits
--    per DELIVERED message: one change x N subscribers = N messages, against a
--    500/sec ceiling on Pro, and the documented breach behaviour is disconnecting
--    everyone. So votes land in `song_votes` and a trigger folds them into
--    `song_requests.vote_count`; clients subscribe to `song_requests` only. Sixty
--    guests voting on six songs is six messages per subscriber, not sixty.
--    If that is still too many at scale, the next step is a debounced aggregate
--    broadcast -- but it is a schema decision, not a runtime knob, which is why
--    the vote table is separate from the count from day one.

-- ========================================================================
-- EVENTS
-- ========================================================================

create table public.events (
  id                   uuid primary key default gen_random_uuid(),
  -- What a guest types to join. Case-insensitive in practice: join_event()
  -- upper-cases before comparing, so 'sr1017' and ' SR1017 ' both work.
  code                 text not null unique,
  name                 text not null,
  venue                text not null,
  starts_at            timestamptz not null,
  -- IANA zone of the VENUE. Times render in the event's zone, never the phone's
  -- -- a guest in the barn reads the same time as the sign on the door.
  timezone             text not null default 'UTC',
  doors_label          text not null default '',
  tier                 text not null default 'house_party'
                         check (tier in ('house_party','party','event','venue')),
  active_folder_id     uuid,
  now_schedule_item_id uuid,
  -- Maintained by trigger from `guests`, like every other count here. Stored
  -- rather than derived because the "{n} here" pill is read on every render.
  guest_count          integer not null default 0,
  -- What a host ADDRESSES, which is a different number from who is present.
  invited_count        integer not null default 0,
  created_at           timestamptz not null default now()
);

-- ========================================================================
-- PEOPLE
-- ========================================================================

create table public.guests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  -- The anonymous auth user. One guest row per signed-in identity per event.
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  nickname     text not null,
  created_at   timestamptz not null default now(),
  unique (event_id, auth_user_id)
);

create table public.hosts (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  -- The permission GRADE -- a genuinely closed set.
  role         text not null check (role in ('host','planner','dj')),
  -- The human label printed beside the name: "Bride", "Planner", "DJ",
  -- "Best Man", "Head of Ops". FREE TEXT. This is the field that makes the
  -- event type a variable rather than a wedding with the words changed.
  role_label   text not null,
  created_at   timestamptz not null default now()
);

-- ========================================================================
-- CHAT + RUN OF SHOW
-- ========================================================================

create table public.broadcasts (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete cascade,
  author_host_id    uuid references public.hosts(id) on delete set null,
  -- Denormalised so a deleted host does not blank the history.
  author_name       text not null,
  author_role_label text not null,
  kind              text not null default 'announcement'
                      check (kind in ('announcement','schedule_started')),
  body              text not null,
  pinned            boolean not null default false,
  -- Real, not fabricated: 0 until someone actually reads it.
  seen_count        integer not null default 0,
  created_at        timestamptz not null default now()
);

create table public.broadcast_reads (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  guest_id     uuid not null references public.guests(id) on delete cascade,
  read_at      timestamptz not null default now(),
  primary key (broadcast_id, guest_id)
);

create table public.schedule_items (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  position   integer not null,
  -- Wall-clock label, e.g. '8:00 PM'. Null renders as 'TBD'. Deliberately a
  -- LABEL and not a timestamp: a schedule board shows what the sign says.
  time_label text,
  title      text not null,
  place      text not null default '',
  started_at timestamptz,
  unique (event_id, position) deferrable initially deferred
);

-- ========================================================================
-- MUSIC
-- ========================================================================

create table public.song_requests (
  id                     uuid primary key default gen_random_uuid(),
  event_id               uuid not null references public.events(id) on delete cascade,
  title                  text not null,
  artist                 text not null default '',
  requested_by_guest_id  uuid references public.guests(id) on delete set null,
  requested_by_name      text not null,
  status                 text not null default 'pending'
                           check (status in ('pending','accepted','played','declined')),
  -- Folded from song_votes by trigger. Clients subscribe HERE, not to the votes.
  vote_count             integer not null default 0,
  created_at             timestamptz not null default now()
);

create table public.song_votes (
  request_id uuid not null references public.song_requests(id) on delete cascade,
  guest_id   uuid not null references public.guests(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One vote per guest per song. Idempotency is enforced by the key, not by
  -- application code, so a double-tap cannot double-count.
  primary key (request_id, guest_id)
);

create table public.now_playing (
  event_id        uuid primary key references public.events(id) on delete cascade,
  title           text not null,
  artist          text not null default '',
  from_request_id uuid references public.song_requests(id) on delete set null,
  started_at      timestamptz
);

-- ========================================================================
-- PHOTOS
-- ========================================================================

create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  -- FREE TEXT. "Getting ready" is seed data for one wedding, not a schema.
  name        text not null,
  position    integer not null default 0,
  -- APPROVED photos only, matching what the folder chip shows.
  photo_count integer not null default 0
);

create table public.photos (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references public.events(id) on delete cascade,
  folder_id             uuid not null references public.folders(id) on delete cascade,
  uploaded_by_guest_id  uuid references public.guests(id) on delete set null,
  uploaded_by_name      text not null,
  -- 'uploading' and 'failed' are CLIENT-SIDE states and never reach this table;
  -- a row exists here only once its bytes do. See decision 2 at the top.
  status                text not null default 'pending'
                          check (status in ('pending','approved','hidden')),
  -- Hue in degrees 0-359. Stored instead of a colour so the placeholder tile
  -- survives a re-theme and a light/dark switch with no data change.
  hue                   integer not null default 0 check (hue between 0 and 359),
  -- The bucket key. NOT the device path -- see decision 2.
  storage_path          text,
  created_at            timestamptz not null default now()
);

create index on public.photos (event_id, folder_id, status);
create index on public.song_requests (event_id, status, vote_count desc);
create index on public.broadcasts (event_id, created_at);
create index on public.guests (event_id, auth_user_id);

-- ========================================================================
-- DERIVED COUNTS -- maintained by trigger, never by application code
-- ========================================================================
--
-- Every count the UI reads is folded here rather than incremented by a caller.
-- A count maintained in application code drifts the moment a second caller
-- exists, and this app already has two (the guest app and the host console).

create or replace function public.fold_vote_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.song_requests r
     set vote_count = (select count(*) from public.song_votes v where v.request_id = r.id)
   where r.id = coalesce(new.request_id, old.request_id);
  return null;
end $$;

create trigger song_votes_fold
  after insert or delete on public.song_votes
  for each row execute function public.fold_vote_count();

create or replace function public.fold_guest_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.events e
     set guest_count = (select count(*) from public.guests g where g.event_id = e.id)
   where e.id = coalesce(new.event_id, old.event_id);
  return null;
end $$;

create trigger guests_fold
  after insert or delete on public.guests
  for each row execute function public.fold_guest_count();

create or replace function public.fold_seen_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.broadcasts b
     set seen_count = (select count(*) from public.broadcast_reads r where r.broadcast_id = b.id)
   where b.id = coalesce(new.broadcast_id, old.broadcast_id);
  return null;
end $$;

create trigger broadcast_reads_fold
  after insert or delete on public.broadcast_reads
  for each row execute function public.fold_seen_count();

-- APPROVED photos only, matching what the folder chip claims.
create or replace function public.fold_photo_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.folders f
     set photo_count = (select count(*) from public.photos p
                         where p.folder_id = f.id and p.status = 'approved')
   where f.id in (coalesce(new.folder_id, old.folder_id), coalesce(old.folder_id, new.folder_id));
  return null;
end $$;

create trigger photos_fold
  after insert or update of status, folder_id or delete on public.photos
  for each row execute function public.fold_photo_count();

-- ========================================================================
-- IDENTITY
-- ========================================================================

-- The guest row for the caller, or null. Every policy below leans on this.
create or replace function public.my_guest_id(p_event uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select g.id from public.guests g
   where g.event_id = p_event and g.auth_user_id = auth.uid()
   limit 1
$$;

create or replace function public.is_host(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hosts h
                  where h.event_id = p_event and h.auth_user_id = auth.uid())
$$;

-- JOINING. SECURITY DEFINER because a guest must be able to create their own row
-- and find an event by code WITHOUT being able to read the guests table or list
-- events -- see the RLS section. Returns the guest id; idempotent, so a reinstall
-- that reuses the persisted session lands on the same row rather than a second
-- seat. That is the whole reason the session is persisted.
create or replace function public.join_event(p_code text, p_nickname text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_event uuid;
  v_guest uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select id into v_event from public.events
   where upper(code) = upper(btrim(p_code));

  -- The canvas set joined=true unconditionally and could not represent a wrong
  -- code. This can, and the client surfaces it as "That code doesn't match an event."
  if v_event is null then
    raise exception 'unknown_code' using errcode = 'P0002';
  end if;

  insert into public.guests (event_id, auth_user_id, nickname)
       values (v_event, auth.uid(), btrim(p_nickname))
  on conflict (event_id, auth_user_id)
    do update set nickname = excluded.nickname
    returning id into v_guest;

  return v_guest;
end $$;

-- ========================================================================
-- HOST ACTIONS -- the guards live here, not in a button handler
-- ========================================================================

-- Refuses to walk the run-of-show cursor BACKWARDS unless told to. The cursor is
-- not host-private state: every guest's Now/Next card derives from it, so a slip
-- onto a past row rewinds the evening for the whole room and posts a second
-- "is starting" broadcast to all of them. Mirrors ScheduleError('would_rewind').
create or replace function public.start_schedule_item(p_item uuid, p_rewind boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event uuid; v_pos int; v_cur_pos int; v_title text; v_place text;
  v_host_name text; v_host_label text; v_host_id uuid;
begin
  select s.event_id, s.position, s.title, s.place
    into v_event, v_pos, v_title, v_place
    from public.schedule_items s where s.id = p_item;
  if v_event is null then return; end if;

  if not public.is_host(v_event) then
    raise exception 'not_a_host' using errcode = '42501';
  end if;

  select s.position into v_cur_pos
    from public.schedule_items s
    join public.events e on e.now_schedule_item_id = s.id
   where e.id = v_event;

  if not p_rewind and v_cur_pos is not null and v_pos < v_cur_pos then
    raise exception 'would_rewind' using errcode = 'P0001';
  end if;

  update public.schedule_items set started_at = now() where id = p_item;
  update public.events set now_schedule_item_id = p_item where id = v_event;

  select h.id, h.display_name, h.role_label into v_host_id, v_host_name, v_host_label
    from public.hosts h where h.event_id = v_event and h.auth_user_id = auth.uid() limit 1;

  insert into public.broadcasts (event_id, author_host_id, author_name, author_role_label, kind, body)
  values (v_event, v_host_id, coalesce(v_host_name,'Host'), coalesce(v_host_label,''),
          'schedule_started', v_title || ' is starting · ' || v_place);
end $$;

-- Promotes the top accepted request. One function so "what plays next" has a
-- single definition rather than one per client.
create or replace function public.play_next(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_title text; v_artist text;
begin
  if not public.is_host(p_event) then
    raise exception 'not_a_host' using errcode = '42501';
  end if;

  select id, title, artist into v_id, v_title, v_artist
    from public.song_requests
   where event_id = p_event and status = 'accepted'
   order by vote_count desc, created_at asc
   limit 1;
  if v_id is null then return; end if;

  update public.song_requests set status = 'played' where id = v_id;
  insert into public.now_playing (event_id, title, artist, from_request_id, started_at)
       values (p_event, v_title, v_artist, v_id, now())
  on conflict (event_id) do update
     set title = excluded.title, artist = excluded.artist,
         from_request_id = excluded.from_request_id, started_at = excluded.started_at;
end $$;

-- ========================================================================
-- ROW LEVEL SECURITY
-- ========================================================================
--
-- Two promises the product makes, enforced here rather than asserted in a doc:
--   1. "guests can't see each other" -- the join screen says so in as many words.
--      There is NO select policy on `guests`. Not a restrictive one: none. A
--      guest cannot enumerate the room, count it, or find a nickname.
--   2. A photo is invisible until a host approves it -- except to the person who
--      took it, who must still see their own pending upload.

alter table public.events          enable row level security;
alter table public.guests          enable row level security;
alter table public.hosts           enable row level security;
alter table public.broadcasts      enable row level security;
alter table public.broadcast_reads enable row level security;
alter table public.schedule_items  enable row level security;
alter table public.song_requests   enable row level security;
alter table public.song_votes      enable row level security;
alter table public.now_playing     enable row level security;
alter table public.folders         enable row level security;
alter table public.photos          enable row level security;

-- An event is readable once you are in it. Discovery is via join_event() only,
-- which is SECURITY DEFINER, so the events table cannot be LISTED. That is not
-- the same as a code being unguessable: join_event is an oracle -- a uuid on a
-- hit, `unknown_code` on a miss. What bounds guessing is the GRANTS section at
-- the foot of this file, which puts every call behind a session and therefore
-- behind the anonymous sign-in rate limit. Codes are still short; treat the
-- limit as the control and prove it by rehearsal.
create policy events_read on public.events for select
  using (public.my_guest_id(id) is not null or public.is_host(id));

-- guests: NO select policy, deliberately. Insert goes through join_event().
create policy guests_update_self on public.guests for update
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- Hosts are public within the event: their names are printed on every broadcast.
create policy hosts_read on public.hosts for select
  using (public.my_guest_id(event_id) is not null or public.is_host(event_id));

create policy broadcasts_read on public.broadcasts for select
  using (public.my_guest_id(event_id) is not null or public.is_host(event_id));
create policy broadcasts_write on public.broadcasts for insert
  with check (public.is_host(event_id));

create policy reads_own on public.broadcast_reads for all
  using (guest_id = public.my_guest_id(
           (select event_id from public.broadcasts where id = broadcast_id)))
  with check (guest_id = public.my_guest_id(
           (select event_id from public.broadcasts where id = broadcast_id)));

create policy schedule_read on public.schedule_items for select
  using (public.my_guest_id(event_id) is not null or public.is_host(event_id));
create policy schedule_write on public.schedule_items for all
  using (public.is_host(event_id)) with check (public.is_host(event_id));

create policy requests_read on public.song_requests for select
  using (public.my_guest_id(event_id) is not null or public.is_host(event_id));
-- A guest may add a request, but only in their own name.
create policy requests_insert on public.song_requests for insert
  with check (requested_by_guest_id = public.my_guest_id(event_id));
-- Only a host may accept, decline or mark played.
create policy requests_moderate on public.song_requests for update
  using (public.is_host(event_id)) with check (public.is_host(event_id));

-- Votes are readable so a guest can see which songs they voted for. Writable
-- only as themselves -- the primary key already stops a double count.
create policy votes_read on public.song_votes for select
  using (guest_id = public.my_guest_id(
           (select event_id from public.song_requests where id = request_id)));
create policy votes_write on public.song_votes for all
  using (guest_id = public.my_guest_id(
           (select event_id from public.song_requests where id = request_id)))
  with check (guest_id = public.my_guest_id(
           (select event_id from public.song_requests where id = request_id)));

create policy now_playing_read on public.now_playing for select
  using (public.my_guest_id(event_id) is not null or public.is_host(event_id));

create policy folders_read on public.folders for select
  using (public.my_guest_id(event_id) is not null or public.is_host(event_id));
create policy folders_write on public.folders for all
  using (public.is_host(event_id)) with check (public.is_host(event_id));

-- THE ONE THAT MATTERS. Approved photos to everyone in the event; a guest's OWN
-- pending upload to that guest; everything to a host, who has to moderate it.
-- 'hidden' is visible to hosts only -- hide is an audit trail, not a delete.
create policy photos_read on public.photos for select
  using (
    (status = 'approved' and public.my_guest_id(event_id) is not null)
    or (uploaded_by_guest_id = public.my_guest_id(event_id))
    or public.is_host(event_id)
  );
create policy photos_insert on public.photos for insert
  with check (uploaded_by_guest_id = public.my_guest_id(event_id));
create policy photos_moderate on public.photos for update
  using (public.is_host(event_id)) with check (public.is_host(event_id));

-- ========================================================================
-- REALTIME
-- ========================================================================
-- song_votes is NOT published: clients watch song_requests, so sixty guests
-- voting on six songs is six messages each, not sixty. See decision 3.

alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.broadcasts;
alter publication supabase_realtime add table public.schedule_items;
alter publication supabase_realtime add table public.song_requests;
alter publication supabase_realtime add table public.now_playing;
alter publication supabase_realtime add table public.folders;
alter publication supabase_realtime add table public.photos;


-- ========================================================================
-- GRANTS -- the part Postgres gets wrong by default
-- ========================================================================
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and PostgREST exposes
-- everything in `public` as an RPC. So each SECURITY DEFINER helper above was
-- silently published at /rest/v1/rpc/<name>, callable with no session at all.
-- The Supabase security advisor flagged all nine; the stub Postgres this file
-- was first verified against could not, because it has no PostgREST and no
-- anon/authenticated roles.
--
-- REVOKE MUST NAME `public`, NOT THE ROLE. `revoke ... from anon` removes anon's
-- own grant and leaves the PUBLIC grant standing, which anon still inherits --
-- the statement succeeds and changes nothing. Read it back in pg_proc.proacl:
-- the PUBLIC entry is `=X/postgres`, with an EMPTY grantee.

revoke execute on function public.fold_vote_count()  from public;
revoke execute on function public.fold_guest_count() from public;
revoke execute on function public.fold_seen_count()  from public;
revoke execute on function public.fold_photo_count() from public;

revoke execute on function public.my_guest_id(uuid)                  from public;
revoke execute on function public.is_host(uuid)                      from public;
revoke execute on function public.join_event(text, text)             from public;
revoke execute on function public.play_next(uuid)                    from public;
revoke execute on function public.start_schedule_item(uuid, boolean) from public;

-- The four fold_* functions get NOTHING back. They are trigger functions and
-- nothing should reach them over HTTP. This does not stop the triggers: EXECUTE
-- is checked at CREATE TRIGGER time against the table owner, never at fire time
-- against the caller. Verified on this database, not assumed -- a scratch table
-- whose trigger function had EXECUTE revoked from PUBLIC still folded its count
-- for a caller running as `authenticated`.

-- The five that ARE the app's API get an explicit grant to `authenticated`.
-- That is the role a Supabase ANONYMOUS session carries (with is_anonymous=true);
-- `anon` is the role for a request with no session, and nothing here needs it.
--
-- my_guest_id and is_host must stay executable by `authenticated` even though
-- they read as internal: every RLS policy above calls them, and a policy is
-- evaluated as the QUERYING role. Revoking here hardens nothing and breaks
-- every select in the app.
grant execute on function public.my_guest_id(uuid)                  to authenticated;
grant execute on function public.is_host(uuid)                      to authenticated;
grant execute on function public.join_event(text, text)             to authenticated;
grant execute on function public.play_next(uuid)                    to authenticated;
grant execute on function public.start_schedule_item(uuid, boolean) to authenticated;

-- ========================================================================
-- WRITE PATHS -- the ones the first pass left with no server-side route
-- ========================================================================
--
-- RLS denies by default, so a method with no matching policy does not fail loudly: it
-- affects ZERO ROWS and raises nothing. Mapping every RunitRepository method against a
-- policy found four such silent holes. These close the two that v1 needs.

-- events UPDATE, for event.setActiveFolder().
--
-- A policy says WHO may write; it cannot say WHICH COLUMNS. Supabase grants
-- `authenticated` blanket UPDATE on every table in `public`, so a bare policy here would
-- also let any host rewrite `tier` (bypassing billing the day billing exists) and `code`
-- (hijacking another event's join code). Column grants are the other half of the tool.
revoke update on public.events from authenticated, anon;
grant  update (active_folder_id) on public.events to authenticated;

create policy events_host_update on public.events for update
  using (public.is_host(id)) with check (public.is_host(id));

-- `now_schedule_item_id` is deliberately NOT granted. It is written only inside
-- start_schedule_item(), which carries the would_rewind guard. Granting it here would
-- open a second route to the cursor that skips that guard -- the same "a check in a
-- button handler is bypassed by the second caller" failure the interface was shaped
-- to avoid.

-- ========================================================================
-- STORAGE -- photo bytes had nowhere to go at all
-- ========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- PRIVATE. A public bucket serves every photo -- including ones still waiting on host
-- approval -- to anyone holding the URL, which is the exact promise photos_read exists
-- to keep. Clients get signed URLs.

-- Object path is `{event_id}/{photo_id}.jpg`, so (storage.foldername(name))[1] is the
-- event id. INSERT can only check that prefix: bytes are uploaded BEFORE the photos row
-- exists, so there is nothing to join to yet.
create policy event_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-photos'
    and public.my_guest_id(((storage.foldername(name))[1])::uuid) is not null
  );

-- SELECT mirrors public.photos.photos_read exactly, by joining on storage_path. Photo ids
-- are uuids and so unguessable, but "unguessable" is not an access control -- a pending
-- photo must be unreadable to the room even by someone who learns its path.
create policy event_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'event-photos'
    and exists (
      select 1 from public.photos p
       where p.storage_path = storage.objects.name
         and (
              (p.status = 'approved' and public.my_guest_id(p.event_id) is not null)
           or  p.uploaded_by_guest_id = public.my_guest_id(p.event_id)
           or  public.is_host(p.event_id)
         )
    )
  );

-- Only a host removes bytes. `hide` is an audit trail rather than a delete
-- (photos.status = 'hidden'), so this is for genuine removal: a takedown, or the
-- retention sweep.
create policy event_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-photos'
    and public.is_host(((storage.foldername(name))[1])::uuid)
  );

-- ========================================================================
-- STILL OPEN, DELIBERATELY -- written down rather than left implied
-- ========================================================================
--
-- * `hosts` has no INSERT policy, so hosts.invite() cannot add anyone. The free tier
--   allows exactly one host, so v1 does not need it. Bootstrap is one service-role insert.
-- * No tier cap is enforced here. join_event() does not check maxGuests, despite
--   src/data/supabase/README.md requiring server-side enforcement. Client-only checks are
--   what that README forbids, so this is a real debt, not a decision.
-- * `broadcast_reads` has a policy AND a fold trigger, but nothing in RunitRepository ever
--   marks a broadcast read -- so seen_count folds a table nobody writes to and stays 0.
--   Either add chat.markRead(), or stop rendering the count. "Seen by 0" under every
--   announcement is worse than no number.

-- ========================================================================
-- HOST CLAIM -- the missing half of join_event
-- ========================================================================
--
-- A host is whoever matches `hosts.auth_user_id = auth.uid()`, and Runit has no
-- sign-in, only anonymous auth. So without this there is no way for a PERSON to become
-- the host of an event: the row has to be bound by hand with a service-role update.
-- That is not a product, and it leaves half the app -- Broadcast, DJ queue, Photo
-- approvals -- unreachable to anyone who did not write the SQL, App Review included.

create table public.host_claims (
  host_id     uuid primary key references public.hosts(id) on delete cascade,
  -- A BCRYPT HASH, never the key. The table is unreachable by any client, but a hash
  -- also means a service-role dump, a backup, or a support session does not hand
  -- anyone the ability to take over an event.
  secret_hash text not null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.host_claims enable row level security;

-- NO POLICIES. Not restrictive ones: none, exactly like `guests`. Nothing a client
-- sends reaches this table -- reads come back empty, writes affect zero rows. The only
-- ways in are claim_host() below and the service role.

create or replace function public.claim_host(p_code text, p_secret text)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_event uuid;
  v_host  uuid;
  v_key   text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- The key is PRINTED grouped -- XV24-HJ78-DBAB -- because that is how a person reads
  -- it off a note and types it on a phone. The dashes are presentation, not credential.
  -- Canonicalise here so the client never has to know the format and nobody is locked
  -- out of their own event for typing a dash, a space, or the wrong case.
  v_key := upper(regexp_replace(coalesce(p_secret, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_key = '' then
    raise exception 'bad_host_key' using errcode = '42501';
  end if;

  select id into v_event from public.events where upper(code) = upper(btrim(p_code));
  if v_event is null then
    raise exception 'unknown_code' using errcode = 'P0002';
  end if;

  -- crypt() re-derives with the salt stored inside the hash, so this compares without
  -- ever holding the key. Bcrypt's cost is also the online brute-force defence: every
  -- attempt is deliberately slow, and the caller already needed a session to get here.
  select hc.host_id into v_host
    from public.host_claims hc
    join public.hosts h on h.id = hc.host_id
   where h.event_id = v_event
     and hc.secret_hash = extensions.crypt(v_key, hc.secret_hash)
   limit 1;

  if v_host is null then
    -- Deliberately distinct from unknown_code. The event code is ALREADY an oracle via
    -- join_event, so collapsing the two hides nothing from an attacker while costing a
    -- real person the ability to tell a typo in the code from a typo in the key.
    raise exception 'bad_host_key' using errcode = '42501';
  end if;

  -- REBIND rather than refuse when already claimed. The KEY is the credential, not the
  -- anonymous identity -- and that identity is not durable: an Android reinstall wipes
  -- the keystore, so a host who reinstalled would otherwise be locked out of their own
  -- event with no recovery. Rebinding costs the previous device its host access, which
  -- is the right outcome when someone presents the key.
  update public.hosts set auth_user_id = auth.uid() where id = v_host;
  update public.host_claims set claimed_at = now() where host_id = v_host;

  return v_host;
end $$;

revoke execute on function public.claim_host(text, text) from public;
grant  execute on function public.claim_host(text, text) to authenticated;
