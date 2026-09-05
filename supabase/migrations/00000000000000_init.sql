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

-- THE INVITATION, which is the half of joining that came before joining.
--
-- events_read admits members only, so until this existed a guest arriving from a
-- link or a QR saw the literal fallback 'An event', no date and no venue -- an
-- invitation that could not show the invitation. Reported from a phone as "who set
-- the date and where".
--
-- WHAT IT DOES TO THE ORACLE. The comment on events_read already concedes that
-- join_event is an oracle on a code: a uuid on a hit, unknown_code on a miss. This
-- does not create that exposure, it widens what a hit RETURNS -- from a bare uuid
-- to a name, a venue and a time. It is bounded by the same thing: `authenticated`
-- only, so every call sits behind a session and therefore behind the anonymous
-- sign-in rate limit. Never grant this to `anon`.
--
-- WHAT IT DELIBERATELY WITHHOLDS: tier, guest_count, invited_count,
-- active_folder_id, now_schedule_item_id. The join screen promises "guests can't
-- see each other", and a headcount for an event you have not joined is the first
-- crack in that. The projection is the enforcement -- there is no policy here to
-- lean on, because SECURITY DEFINER bypasses them all.
--
-- A MISS RETURNS ZERO ROWS AND RAISES NOTHING, unlike join_event's P0002. There a
-- wrong code is a failed action a person must be told about; here it is a code that
-- names no event, which is an ordinary answer to an ordinary question.
create or replace function public.event_preview(p_code text)
returns table (
  id          uuid,
  code        text,
  name        text,
  venue       text,
  starts_at   timestamptz,
  timezone    text,
  doors_label text
)
language sql stable security definer set search_path = public as $$
  select e.id, e.code, e.name, e.venue, e.starts_at, e.timezone, e.doors_label
    from public.events e
   where upper(e.code) = upper(btrim(p_code))
$$;

revoke execute on function public.event_preview(text) from public, anon;
grant  execute on function public.event_preview(text) to authenticated;

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

-- SPLIT BY COMMAND, and the reason is a bug that shipped.
--
-- This was `for all`, and FOR ALL INCLUDES DELETE. Combined with
-- `photos.folder_id ... on delete cascade` below, one SDK call --
-- `.from('folders').delete()` -- destroyed every photo row under a folder and left every
-- byte in the bucket. Proven against the live database: 3 rows in, folder deleted, 0 rows
-- out, 0 rows still knowing where the bytes were.
--
-- Those objects are then UNREACHABLE FOREVER, because event_photos_select can only reach
-- an object by joining back through public.photos on storage_path. Photographs of
-- identifiable people, invisible and permanent. No UI ever did this; it needed only the
-- client library, and claim_host hands a real person that capability.
create policy folders_insert on public.folders for insert
  with check (public.is_host(event_id));
create policy folders_update on public.folders for update
  using (public.is_host(event_id)) with check (public.is_host(event_id));

-- DELETE is granted to NOBODY, matching how `photos` already works: no DELETE policy for
-- anyone, and `hide` is an audit trail rather than a removal. `photo_count` is
-- trigger-maintained over APPROVED photos, so an emptied folder already reads as empty
-- without deleting anything.
--
-- THE ORDER, for whoever eventually writes real deletion: BYTES FIRST, ROW SECOND, and
-- idempotent, because it will be interrupted. Deleting the row first strands the object,
-- since storage_path is the only thing that can name it. That rule holds for a host
-- action, a takedown and a retention sweep alike -- and a sweep must run as SERVICE ROLE
-- rather than by widening event_photos_delete, which would dissolve the invariant that
-- only a host removes bytes.

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
--
-- AND IT MUST NAME THE ROLES TOO -- the half this file got wrong for a year. Supabase
-- ships `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated`,
-- so a new function arrives with NAMED grants as well as the PUBLIC one. Revoking only
-- `public` deletes the entry that was doing the least work and leaves
-- `anon=X/postgres | authenticated=X/postgres` in proacl, still reachable over
-- /rest/v1/rpc/. The security advisor flagged five functions this way, including two
-- trigger functions that should never have been callable at all. The end state to check
-- for is `postgres=X/postgres | service_role=X/postgres` and nothing else:
--
--   select proname, array_to_string(proacl, ' | ') from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = '<name>';
--
-- Revoking EXECUTE from a TRIGGER function does not stop the trigger -- EXECUTE is
-- checked at CREATE TRIGGER time against the table owner, never at fire time against
-- the caller. Verified for stamp_block_name and stamp_report_resolver specifically,
-- after the revoke, not assumed from the note above.

revoke execute on function public.fold_vote_count()  from public, anon, authenticated;
revoke execute on function public.fold_guest_count() from public, anon, authenticated;
revoke execute on function public.fold_seen_count()  from public, anon, authenticated;
revoke execute on function public.fold_photo_count() from public, anon, authenticated;

revoke execute on function public.my_guest_id(uuid)                  from public, anon;
revoke execute on function public.is_host(uuid)                      from public, anon;
revoke execute on function public.join_event(text, text)             from public, anon;
revoke execute on function public.play_next(uuid)                    from public, anon;
revoke execute on function public.start_schedule_item(uuid, boolean) from public, anon;

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
grant  update (active_folder_id, name, venue, starts_at, timezone, doors_label)
  on public.events to authenticated;

create policy events_host_update on public.events for update
  using (public.is_host(id)) with check (public.is_host(id));

-- The five columns beyond active_folder_id are the event's DESCRIPTION, and a host
-- has to be able to correct them: the first draft granted none of them, so an event
-- was immutable from the moment the seed SQL ran. Reported from a phone as "who set
-- the date and where" -- the answer being "whoever ran the SQL, once".
--
-- `tier` and `code` are still not here, for the reasons above, and
-- verify-policies.sql asserts a host gets 42501 on each. Those two assertions are
-- what makes this grant a decision rather than a drift.
--
-- starts_at and timezone move together or not at all. A time without its zone is
-- not a time -- see FIDELITY note M, and src/lib/format.ts, which converts venue
-- wall-clock to an instant rather than trusting the phone.
--
-- `events` is in the realtime publication and events_read admits every joined
-- guest, so an edit here repaints the venue on every phone in the room within a
-- second. That is the intended behaviour and worth knowing before typing.

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

revoke execute on function public.claim_host(text, text) from public, anon;
grant  execute on function public.claim_host(text, text) to authenticated;

-- ========================================================================
-- CREATING AN EVENT -- the supply side, which did not exist
-- ========================================================================
--
-- Until this, every event, host, host key and folder in existence came from a human
-- running seed-events.sql with the database password. `events` and `hosts` have no
-- INSERT policy for anyone, deliberately, so a client cannot assemble an event out of
-- separate writes -- and it should not be able to. An event is not one row: it is a
-- row, a folder, an active_folder_id pointing at that folder, a host seat bound to a
-- person, and a credential. Four of those five are refused to `authenticated`, and an
-- event missing any of them is broken in a way that shows up much later. So this is one
-- transaction or it is nothing.
--
-- THE FOUNDER NEEDS NO KEY TO GET IN. Her seat is bound to auth.uid() here, in the same
-- statement that makes the event. The key exists for a DIFFERENT problem: auth.uid() is
-- an anonymous session in a keystore on one phone, and an Android reinstall wipes it.
-- Without a key she loses her own event permanently -- while it keeps running, with her
-- guests in it and nobody able to broadcast, approve a photo, or answer a report.
-- claim_host() already REBINDS rather than refuses, for exactly this reason; it simply
-- had no way to be given a key. Now it does.
--
-- THE PLAINTEXT IS RETURNED ONCE. Only the bcrypt hash is stored, so this return value
-- is the single moment it exists anywhere outside the caller's screen. Show it and mean
-- it.
--
-- NEW EVENTS ARE `house_party`, the column default, and that is honest rather than
-- stingy: there is no purchase path (#30), so any other tier would be giving the ladder
-- away and leaving the entitlement layer permanently unexercised in production. The UI
-- should say which plan it is rather than let a host discover the cap at ten guests.
create or replace function public.create_event(
  p_name        text,
  p_starts_at   timestamptz,
  p_timezone    text,
  p_venue       text default '',
  p_doors_label text default '',
  p_host_name   text default 'Host'
)
returns table (event_id uuid, code text, host_id uuid, host_key text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  -- No 0/O and no 1/I/L. A guest types this off a place card in a dim room, and a host
  -- reads the key off a note. Same alphabet for both, for the same reason.
  k_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  k_len      constant int  := length(k_alphabet);
  v_event  uuid;
  v_folder uuid;
  v_host   uuid;
  v_code   text;
  v_key    text;
  v_owned  int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'event_needs_a_name' using errcode = '22023';
  end if;

  if coalesce(btrim(p_timezone), '') = '' then
    raise exception 'event_needs_a_timezone' using errcode = '22023';
  end if;

  -- A cap, because this is an INSERT reachable by anyone who can sign in anonymously,
  -- and anonymous sign-in is one HTTP call. The rate limit bounds how fast identities
  -- appear; nothing else bounds how many events one identity makes. Ten is generous for
  -- the planner this is built for and small enough that a script is not worth writing.
  select count(*) into v_owned
    from public.hosts h
   where h.auth_user_id = auth.uid() and h.role = 'host';
  if v_owned >= 10 then
    raise exception 'too_many_events' using errcode = '54023';
  end if;

  -- Mint a code, retrying on collision rather than trusting 31^6. `code` is UNIQUE, so
  -- the database is the arbiter and the loop is just how we ask again.
  for i in 1..10 loop
    v_code := (select string_agg(substr(k_alphabet, 1 + floor(random() * k_len)::int, 1), '' order by g)
                 from generate_series(1, 6) g);
    begin
      insert into public.events (code, name, venue, starts_at, timezone, doors_label)
      values (v_code, btrim(p_name), coalesce(btrim(p_venue), ''), p_starts_at,
              btrim(p_timezone), coalesce(btrim(p_doors_label), ''))
      returning id into v_event;
      exit;
    exception when unique_violation then
      v_event := null;
    end;
  end loop;

  if v_event is null then
    raise exception 'could_not_mint_a_code' using errcode = '40001';
  end if;

  -- AN EVENT WITH NO FOLDER REFUSES EVERY UPLOAD. `activeFolderId` maps a null column to
  -- '', which matches no folder, so upload() is refused rather than filing bytes
  -- somewhere wrong. Creating the event without this would ship a party where the camera
  -- silently does nothing -- and folders_insert requires is_host, which is not true for
  -- one more statement, so it has to happen in here.
  insert into public.folders (event_id, name, position)
  values (v_event, 'All photos', 0)
  returning id into v_folder;

  update public.events set active_folder_id = v_folder where id = v_event;

  insert into public.hosts (event_id, auth_user_id, display_name, role, role_label)
  values (v_event, auth.uid(), coalesce(nullif(btrim(p_host_name), ''), 'Host'), 'host', 'Host')
  returning id into v_host;

  v_key := (select string_agg(substr(k_alphabet, 1 + floor(random() * k_len)::int, 1), '' order by g)
              from generate_series(1, 12) g);

  -- The hash is over the UNGROUPED upper-case form, which is what claim_host()
  -- canonicalises its input to. The dashes below are presentation only.
  insert into public.host_claims (host_id, secret_hash)
  values (v_host, extensions.crypt(v_key, extensions.gen_salt('bf')));

  return query select v_event, v_code, v_host,
                      substr(v_key,1,4) || '-' || substr(v_key,5,4) || '-' || substr(v_key,9,4);
end $$;

revoke execute on function public.create_event(text, timestamptz, text, text, text, text)
  from public, anon;
grant  execute on function public.create_event(text, timestamptz, text, text, text, text)
  to authenticated;

-- Rotating the key, for the host who lost the note or showed it to the wrong person.
--
-- Scoped to the CALLER'S OWN SEAT. A host cannot rotate a co-host's key -- that would be
-- a way to take a seat away from someone rather than to recover your own, and the two
-- want different words on the button. `claimed_at` resets because the new key has not
-- been used yet, which is what makes it readable as "issued, not yet redeemed".
create or replace function public.rotate_host_key(p_event uuid)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  k_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  k_len      constant int  := length(k_alphabet);
  v_host uuid;
  v_key  text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select h.id into v_host from public.hosts h
   where h.event_id = p_event and h.auth_user_id = auth.uid()
   limit 1;
  if v_host is null then
    raise exception 'not_a_host' using errcode = '42501';
  end if;

  v_key := (select string_agg(substr(k_alphabet, 1 + floor(random() * k_len)::int, 1), '' order by g)
              from generate_series(1, 12) g);

  insert into public.host_claims (host_id, secret_hash)
  values (v_host, extensions.crypt(v_key, extensions.gen_salt('bf')))
  on conflict (host_id) do update
    set secret_hash = excluded.secret_hash, claimed_at = null;

  return substr(v_key,1,4) || '-' || substr(v_key,5,4) || '-' || substr(v_key,9,4);
end $$;

revoke execute on function public.rotate_host_key(uuid) from public, anon;
grant  execute on function public.rotate_host_key(uuid) to authenticated;

-- ========================================================================
-- THE GUEST LIST -- the first personal data beyond a chosen nickname
-- ========================================================================
--
-- WHOSE DATA THIS IS, AND WHY IT IS DIFFERENT. Every other record here is something a
-- person typed about themselves. This is a HOST uploading OTHER PEOPLE'S email addresses,
-- before those people have consented to anything or heard of Runit. That makes it
-- third-party data: the host has the relationship, Runit holds it on their behalf. It
-- gets the strictest treatment in this schema for exactly that reason.

create table public.invitees (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  email           text not null,
  -- Optional, purely so an invite can say "Hi Sam" rather than "Hello". Never required.
  display_name    text,
  -- NULL until an invite is actually sent, so "on the list" and "was emailed" stay
  -- distinguishable. A host who imports forty addresses and sends none has invited nobody.
  invited_at      timestamptz,
  -- Set when this invitee joins, so a host can see who arrived without the app ever
  -- matching a nickname back to an address in application code.
  joined_guest_id uuid references public.guests(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- One invite per address per event. Case-insensitive, because Sam@x.com and sam@x.com are
-- one person and double-emailing them is the fastest way to look broken.
create unique index invitees_event_email on public.invitees (event_id, lower(email));
create index on public.invitees (event_id, invited_at);

alter table public.invitees enable row level security;

-- HOSTS ONLY, ALL FOUR COMMANDS. No guest-facing policy of any kind: this table IS the
-- guest list, and "guests can't see each other" would be a dead letter if any guest could
-- read it. A guest cannot even discover their own row.
--
-- DELETE *is* granted here, unlike folders and photos, and the difference is that no bytes
-- hang off an invitee. Removing someone strands nothing -- there is no second system
-- holding an object only this row could name. That was the entire reason folders lost
-- DELETE, and it does not apply.
create policy invitees_host_read on public.invitees for select
  using (public.is_host(event_id));
create policy invitees_host_insert on public.invitees for insert
  with check (public.is_host(event_id));
create policy invitees_host_update on public.invitees for update
  using (public.is_host(event_id)) with check (public.is_host(event_id));
create policy invitees_host_delete on public.invitees for delete
  using (public.is_host(event_id));

-- `invited_count` stops being a fixture constant.
--
-- It has been readable since day one -- the host console renders "Send to 180 guests" from
-- it -- and writable by nobody: no interface method, no adapter code, no column grant. It
-- is now folded from this table like every other count here, so the number a host sees is
-- the number of people they actually put on the list.
--
-- Counting ROWS rather than sent invites, deliberately: it is "what a host ADDRESSES",
-- which is what the column's own comment has said since the beginning. Someone imported
-- but not yet emailed is still someone you are expecting.
create or replace function public.fold_invited_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.events e
     set invited_count = (select count(*) from public.invitees i where i.event_id = e.id)
   where e.id = coalesce(new.event_id, old.event_id);
  return null;
end $$;

create trigger invitees_fold
  after insert or delete on public.invitees
  for each row execute function public.fold_invited_count();

revoke execute on function public.fold_invited_count() from public, anon, authenticated;

-- ========================================================================
-- MODERATION -- App Review Guideline 1.2
-- ========================================================================
--
-- Guideline 1.2 asks four things of any app carrying user-generated content, and
-- Runit carries three kinds of it: photographs, song request text, and nicknames.
--
--   1. A method for filtering objectionable material.  ALREADY PRESENT -- photos
--      land 'pending' and a host approves or hides them (photos_moderate), and a
--      host accepts or declines every song request (requests_moderate).
--   2. A mechanism to report offensive content.        THIS SECTION.
--   3. The ability to block abusive users.             THIS SECTION.
--   4. Published contact information.                  ALREADY PRESENT -- the
--      support page in the runit-legal repo, linked from the App Store listing.
--
-- Two and three are what this section adds. They are the two that block Add for
-- Review, and neither had any server-side route at all: a report method with no
-- table behind it would have been a button that did nothing, which is worse than
-- an absent one because it tells a guest their concern was recorded.

-- A composite key so a block can be constrained to ONE EVENT.
--
-- `references public.guests(id)` alone would let a row name a blocker from one event
-- and a blocked guest from another -- the FKs would both pass and the pair would be
-- meaningless. Postgres cannot express "same event_id" in a CHECK (it cannot see
-- another row), so the constraint has to travel through the foreign key itself, and
-- that needs a unique key on the pair being referenced.
alter table public.guests add constraint guests_id_event_key unique (id, event_id);

-- ------------------------------------------------------------------------
-- REPORTS
-- ------------------------------------------------------------------------
--
-- POLYMORPHIC, and deliberately so. Three separate report tables would need three
-- policies, three observables and three host queues, and the host's question is one
-- question -- "what has been flagged?" -- asked across all of it. The discriminator
-- plus a CHECK gives one queue without giving up referential integrity: each subject
-- keeps its own real foreign key, so a report cannot name a photo that never existed.
create table public.reports (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events(id) on delete cascade,
  -- NULL once the reporter leaves. The report OUTLIVES them on purpose: a host must
  -- still be able to act on a flagged photo after the person who flagged it has gone.
  reporter_guest_id   uuid references public.guests(id) on delete set null,
  -- DENORMALISED, and not for speed. `guests` has NO select policy at all -- a host
  -- cannot read that table, by design, so a host CANNOT JOIN to find out who filed a
  -- report. The name has to travel with the row or the queue renders anonymous. Same
  -- reason `broadcasts.author_name` and `photos.uploaded_by_name` exist.
  reporter_name       text not null,
  subject_kind        text not null
                        check (subject_kind in ('photo','song_request','guest')),
  subject_photo_id    uuid references public.photos(id)        on delete cascade,
  subject_request_id  uuid references public.song_requests(id) on delete cascade,
  subject_guest_id    uuid references public.guests(id)        on delete cascade,
  -- A CLOSED SET, and the words are the ones Apple's own reviewers look for. Free text
  -- alone would make the host queue unsortable and give a reviewer nothing to see.
  reason              text not null
                        check (reason in ('nudity','harassment','violence',
                                          'hate','spam','other')),
  -- The reporter's own words, optional. Never required -- demanding an explanation
  -- before someone can flag a photograph of themselves is a reason not to flag it.
  note                text not null default '',
  -- What the host sees in the queue: "Photo from Sam", "September -- Earth, Wind & Fire",
  -- a nickname. Same reason as reporter_name -- a photo row is readable by a host, but a
  -- song request's requester and a reported guest's nickname both live behind `guests`.
  -- Derived SERVER-SIDE in file_report(), never supplied by the client.
  subject_label       text not null,
  resolved_at         timestamptz,
  resolution          text check (resolution in ('removed','blocked','dismissed')),
  resolved_by_host_id uuid references public.hosts(id) on delete set null,
  created_at          timestamptz not null default now(),

  -- Exactly one subject, and it must be the one the discriminator names.
  constraint reports_one_subject check (
       (subject_kind = 'photo'
          and subject_photo_id   is not null
          and subject_request_id is null and subject_guest_id is null)
    or (subject_kind = 'song_request'
          and subject_request_id is not null
          and subject_photo_id   is null and subject_guest_id is null)
    or (subject_kind = 'guest'
          and subject_guest_id   is not null
          and subject_photo_id   is null and subject_request_id is null)
  ),
  -- Resolved means resolved SOMEHOW. A timestamp with no outcome is a row that says
  -- a host looked and refuses to say what they did.
  constraint reports_resolution_paired check (
    (resolved_at is null and resolution is null)
      or (resolved_at is not null and resolution is not null)
  )
);

-- ONE REPORT PER PERSON PER THING. Without this a single guest can file the same
-- complaint two hundred times and bury every other flag in the host's queue -- the
-- report mechanism becomes its own abuse vector. Re-reporting is a no-op, not an error.
create unique index reports_one_per_reporter on public.reports (
  reporter_guest_id,
  subject_kind,
  coalesce(subject_photo_id, subject_request_id, subject_guest_id)
);

-- The host queue's own access path: open reports for this event, oldest first.
create index on public.reports (event_id, resolved_at, created_at);

-- ------------------------------------------------------------------------
-- BLOCKS
-- ------------------------------------------------------------------------
--
-- WHY THIS IS NOT ENFORCED IN RLS, which is the obvious place to reach for.
--
-- A block is a VIEWER PREFERENCE, not a permission. Two things follow, and both
-- argue against a policy:
--
--   `folders.photo_count` is trigger-maintained over approved photos and is ONE
--   NUMBER FOR THE ROOM. If blocks filtered `photos_read`, the count would keep
--   saying 40 while a blocker's album showed 37, and no trigger can fix that --
--   the count would have to become per-viewer, which is not a count.
--
--   The host must go on seeing everything. Moderation is the host's job and a
--   guest's block cannot be allowed to hide evidence from it. An RLS branch that
--   said "unless you are a host" on every hot policy is more surface, evaluated on
--   every row read, to express something the client already knows.
--
-- So the rows live here -- server-side, so a block survives a reinstall, which
-- matters because the anonymous identity persists in the keychain -- and the
-- REPOSITORY applies them. Both adapters filter in one place behind the interface,
-- which is exactly the seam that stops each screen growing its own copy.
create table public.guest_blocks (
  event_id         uuid not null references public.events(id) on delete cascade,
  blocker_guest_id uuid not null,
  blocked_guest_id uuid not null,
  -- Denormalised for the third time in this file, and for the third identical reason:
  -- `guests` has no select policy, so the blocker cannot look up who they blocked. A
  -- "Blocked people" screen that lists UUIDs is a screen nobody can use to unblock the
  -- right person. Stamped by trigger, not sent -- see stamp_block_name() below.
  blocked_name     text not null default '',
  created_at       timestamptz not null default now(),
  primary key (blocker_guest_id, blocked_guest_id),
  constraint guest_blocks_not_self check (blocker_guest_id <> blocked_guest_id),
  foreign key (blocker_guest_id, event_id)
    references public.guests (id, event_id) on delete cascade,
  foreign key (blocked_guest_id, event_id)
    references public.guests (id, event_id) on delete cascade
);

alter table public.reports      enable row level security;
alter table public.guest_blocks enable row level security;

-- NO INSERT POLICY. Reports arrive only through file_report() below, the same way
-- guests arrive only through join_event(). A `with check (reporter_guest_id =
-- my_guest_id(event_id))` policy looks sufficient and is not, for two reasons that a
-- policy structurally cannot reach:
--
--   IT CANNOT DERIVE THE DENORMALISED FIELDS. reporter_name and subject_label would be
--   whatever the client sent. A guest could file a report captioned as somebody else.
--
--   IT CANNOT SEE THE SUBJECT'S EVENT. `subject_photo_id references photos(id)` does not
--   constrain the photo to THIS event, and the policy only checks the reporter. So a
--   guest of event A could file a report against a photo in event B: reporter check
--   passes, foreign key passes, and A's host gets a queue entry pointing at a row they
--   are not allowed to read. The composite key trick used on guest_blocks is not
--   available here, because the subject is polymorphic across three tables.

-- Your own reports, plus everything if you are a host. A guest seeing their own row
-- back is what lets the UI say "Reported" instead of re-offering the button; a guest
-- seeing ANOTHER guest's report would turn the queue into a gossip feed.
create policy reports_read on public.reports for select
  using (reporter_guest_id = public.my_guest_id(event_id) or public.is_host(event_id));

create policy reports_host_resolve on public.reports for update
  using (public.is_host(event_id)) with check (public.is_host(event_id));

-- NO DELETE POLICY, for anyone -- the same mechanism folders and photos use, and for a
-- related reason. A resolved report is the audit trail that says a human looked, which is
-- the half of Guideline 1.2 that "timely responses to concerns" actually asks for. It is
-- worth nothing if the person being complained about can erase it.

-- Blocks are private to the blocker. Not even a host reads them: a host has no action
-- to take on one, and publishing "who is avoiding whom" at a wedding is its own harm.
create policy blocks_own on public.guest_blocks for select
  using (blocker_guest_id = public.my_guest_id(event_id));
create policy blocks_insert on public.guest_blocks for insert
  with check (blocker_guest_id = public.my_guest_id(event_id));
-- DELETE *is* granted, unlike folders and photos, for the invitees reason: no bytes
-- hang off a block. Unblocking has to work, and it strands nothing.
create policy blocks_delete on public.guest_blocks for delete
  using (blocker_guest_id = public.my_guest_id(event_id));

-- A policy says WHO may write, never WHICH COLUMNS -- the same gap `events` had. A host
-- resolving a report must not be able to rewrite the `reason` or the reporter's `note`,
-- because that is editing the evidence to match the verdict.
revoke update on public.reports      from authenticated, anon;
-- `resolved_by_host_id` is deliberately NOT here. It is stamped by the trigger below from
-- auth.uid(), so one host cannot sign another host's name to a decision.
grant  update (resolved_at, resolution) on public.reports to authenticated;

-- Nothing updates a block: you make one or you remove it.
revoke update on public.guest_blocks from authenticated, anon;

-- The host console's open-report badge has to move without a refresh, for the same
-- reason the photo approvals badge does. `guest_blocks` is NOT published: the only
-- device that cares made the change itself.
alter publication supabase_realtime add table public.reports;

-- ------------------------------------------------------------------------
-- FILING A REPORT -- the only route in
-- ------------------------------------------------------------------------
--
-- SECURITY DEFINER for the same reason join_event is: it has to read rows the caller
-- cannot. It derives the reporter's name and the subject's label from the real rows,
-- and it refuses a subject that is not in this event -- the check no INSERT policy can
-- make, because the subject is polymorphic across three tables and a foreign key only
-- knows the id.
--
-- Returns the new report's id, or NULL when this guest had already reported this exact
-- subject. NULL is a SUCCESS, not a failure: the caller has nothing left to do, and
-- raising here would make a double-tap look like a broken button.
create or replace function public.file_report(
  p_event_id   uuid,
  p_kind       text,
  p_subject_id uuid,
  p_reason     text,
  p_note       text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_guest_id uuid;
  v_name     text;
  v_label    text;
  v_id       uuid;
begin
  v_guest_id := public.my_guest_id(p_event_id);
  if v_guest_id is null then
    raise exception 'not_in_event' using errcode = '42501';
  end if;
  select g.nickname into v_name from public.guests g where g.id = v_guest_id;

  -- Each branch filters on event_id as well as id. That predicate IS the cross-event
  -- check: a subject from another event simply selects no row and v_label stays null.
  if p_kind = 'photo' then
    select 'Photo from ' || p.uploaded_by_name into v_label
      from public.photos p
     where p.id = p_subject_id and p.event_id = p_event_id;
  elsif p_kind = 'song_request' then
    select r.title || case when r.artist = '' then '' else ' -- ' || r.artist end
      into v_label
      from public.song_requests r
     where r.id = p_subject_id and r.event_id = p_event_id;
  elsif p_kind = 'guest' then
    -- Reporting yourself is not a thing. It is not harmful, but it is certainly a
    -- mistake, and letting it through puts noise in a queue a host has to read.
    if p_subject_id = v_guest_id then
      raise exception 'cannot_report_self' using errcode = '22023';
    end if;
    select g.nickname into v_label
      from public.guests g
     where g.id = p_subject_id and g.event_id = p_event_id;
  else
    raise exception 'bad_subject_kind' using errcode = '22023';
  end if;

  if v_label is null then
    raise exception 'subject_not_in_event' using errcode = '42501';
  end if;

  insert into public.reports (
    event_id, reporter_guest_id, reporter_name, subject_kind,
    subject_photo_id, subject_request_id, subject_guest_id,
    subject_label, reason, note
  ) values (
    p_event_id, v_guest_id, v_name, p_kind,
    case when p_kind = 'photo'        then p_subject_id end,
    case when p_kind = 'song_request' then p_subject_id end,
    case when p_kind = 'guest'        then p_subject_id end,
    v_label, p_reason, coalesce(p_note, '')
  )
  on conflict (reporter_guest_id, subject_kind,
               coalesce(subject_photo_id, subject_request_id, subject_guest_id))
    do nothing
  returning id into v_id;

  return v_id;
end $$;

-- WHO resolved it is stamped here, never sent. The column grant above withholds
-- `resolved_by_host_id` precisely so this is the only writer: an audit trail whose
-- signature the signer picks is not an audit trail.
create or replace function public.stamp_report_resolver() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.resolved_at is not null then
    select h.id into new.resolved_by_host_id
      from public.hosts h
     where h.event_id = new.event_id and h.auth_user_id = auth.uid();
  else
    new.resolved_by_host_id := null;
  end if;
  return new;
end $$;

create trigger reports_stamp_resolver
  before update on public.reports
  for each row execute function public.stamp_report_resolver();

revoke execute on function public.file_report(uuid, text, uuid, text, text) from public, anon;
revoke execute on function public.stamp_report_resolver()                   from public, anon, authenticated;
grant  execute on function public.file_report(uuid, text, uuid, text, text) to authenticated;

-- The blocked person's name, resolved from the real row rather than trusted from the
-- client. A block is a direct INSERT (its policy can express everything that matters,
-- unlike reports), so a trigger is the cheap way to keep the label honest.
create or replace function public.stamp_block_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select g.nickname into new.blocked_name
    from public.guests g where g.id = new.blocked_guest_id;
  return new;
end $$;

create trigger guest_blocks_stamp_name
  before insert on public.guest_blocks
  for each row execute function public.stamp_block_name();

revoke execute on function public.stamp_block_name() from public, anon, authenticated;
