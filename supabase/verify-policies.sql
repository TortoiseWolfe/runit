-- Executable proof that the row-level security the adapter depends on behaves as
-- SupabaseRepository.ts claims it does.
--
-- WHY THIS EXISTS. Reading a policy tells you what it says; it does not tell you
-- what Postgres does with it. Three of the behaviours below are things no amount
-- of reading would have settled -- most importantly that a guest's UPDATE on
-- `events` returns ZERO ROWS AND NO ERROR, which is the failure shape the whole
-- assertWrote() helper exists to catch.
--
-- HOW TO RUN. Paste into the SQL editor, or via the Supabase MCP execute_sql.
-- It runs entirely inside a DO block and ends by RAISING, so nothing is committed
-- even on success -- the "error" it prints IS the report.
--
-- A THIRD TRAP, and the worst kind: for some time this file DID NOT RUN AT ALL past
-- its folders section. A setup line inserted a photo as the host with no
-- uploaded_by_guest_id, `photos_insert` refused it with 42501 outside any exception
-- handler, and the whole DO block aborted -- so every moderation and invitee assertion
-- below it had never once executed, and one of them held a stale expected value that
-- proved it. Lane E skips without SUPABASE_DB_URL, so a green board said nothing.
-- Anything added here must be RUN, not merely written.
--
-- TWO TRAPS THIS FILE ALREADY FELL INTO, kept as comments so nobody repeats them:
--
--   1. `text[] || 'a literal'` makes Postgres parse the literal as an ARRAY
--      LITERAL and fail with 22P02, inside whatever exception handler you are
--      standing in -- which then reports 22P02 as though the statement under test
--      had raised it. Every append below goes through format().
--
--   2. Putting several assertions in one UNION means they all share one statement
--      snapshot, so a STABLE function cannot see a row a sibling branch inserted.
--      join_event() looked broken and was not. Each step here is its own statement.

do $$
declare
  guid uuid := '11111111-1111-1111-1111-111111111111';
  huid uuid := '44444444-4444-4444-4444-444444444444';
  eid  uuid := '22222222-2222-2222-2222-222222222222';
  fid  uuid := '33333333-3333-3333-3333-333333333333';
  f2   uuid := '55555555-5555-5555-5555-555555555555';
  n int; g1 uuid; g2 uuid; hid uuid;
  -- moderation fixtures
  buid uuid := '66666666-6666-6666-6666-666666666666';
  eid2 uuid := '77777777-7777-7777-7777-777777777777';
  fid2 uuid := '88888888-8888-8888-8888-888888888888';
  p2   uuid := '99999999-9999-9999-9999-999999999999';
  gb uuid; pho uuid; rep1 uuid; rep2 uuid; who uuid; lbl text; rname text;
  -- create_event fixtures: a founder with no seat anywhere, and the phone she buys next.
  cuid uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  nuid uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  ce record; kold text; knew text;
  -- invite_host fixtures: the DJ who gets a seat but never an account.
  muid uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  iv record;
  -- cap fixtures: a fresh event, the guest who holds a seat, and the one who arrives late.
  auid  uuid := 'cccccccc-0000-0000-0000-000000000002';
  buid2 uuid := 'cccccccc-0000-0000-0000-000000000003';
  ce2 record; pin boolean; gcap uuid; filler uuid; i int; bc uuid;
  -- #37 fixtures: the second count, and the seat a guest is promoted into.
  m int; hst uuid;
  out text[] := '{}';
  fails int := 0;

begin
  -- Every assertion records a PASS/FAIL line rather than aborting, so one run
  -- reports everything that is wrong instead of only the first thing.
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
  values (guid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now()),
         (huid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','h@example.test',false,now(),now());
  insert into public.events (id, code, name, venue, starts_at, timezone, tier, invited_count)
  values (eid,'TEST01','Verify','Barn',now(),'America/New_York','event',10);
  insert into public.folders (id,event_id,name,position) values (fid,eid,'Main',0),(f2,eid,'Second',1);
  insert into public.hosts (event_id, auth_user_id, display_name, role, role_label)
  values (eid, huid, 'Riley', 'host', 'Bride')
  -- CAPTURED HERE, as the owner, because #34 revoked `auth_user_id` from every client
  -- role. The assertion further down used to look this id up by `where auth_user_id =
  -- huid` while standing in `authenticated`, and after #34 that raises 42501 -- aborting
  -- the whole block, which is the exact failure mode this file's header warns about.
  -- The schema was right and the test was wrong.
  returning id into hid;

  -- A second guest, and a SECOND EVENT with its own photo. The second event is not
  -- decoration: it is the only way to test that a report cannot reach across events,
  -- which is the check no INSERT policy could have made.
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
  values (buid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now());
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
  values (cuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now()),
         (nuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now()),
         (muid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now()),
         (auid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now()),
         (buid2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now());
  insert into public.events (id, code, name, venue, starts_at, timezone, tier, invited_count)
  values (eid2,'TEST02','Other','Hall',now(),'America/New_York','event',10);
  insert into public.folders (id,event_id,name,position) values (fid2,eid2,'Main',0);
  insert into public.photos (id,event_id,folder_id,uploaded_by_name,status)
  values (p2,eid2,fid2,'Stranger','approved');

  ------------------------------------------------------------------ AS A GUEST
  perform set_config('request.jwt.claims', json_build_object('sub',guid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  g1 := public.join_event('  test01 ', ' Ada ');
  g2 := public.join_event('TEST01', 'Renamed');
  out := out || format('%s join_event upcases and trims its code', case when g1 is not null then 'PASS' else 'FAIL' end);
  out := out || format('%s join_event is idempotent -- a reinstall reuses the seat', case when g1 = g2 then 'PASS' else 'FAIL' end);

  select count(*) into n from public.events;
  out := out || format('%s events readable once joined (got %s, want 1)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from public.guests;
  out := out || format('%s guests returns nothing at all (got %s, want 0)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  out := out || format('%s my_guest_id is the only route to your own id', case when public.my_guest_id(eid) = g1 then 'PASS' else 'FAIL' end);
  out := out || format('%s is_host is false for a plain guest', case when public.is_host(eid) = false then 'PASS' else 'FAIL' end);

  begin
    perform public.join_event('NOPE99','Ada');
    out := out || format('FAIL unknown code raised nothing');
  exception when others then
    out := out || format('%s unknown code raises %s, which is what the adapter matches on', case when sqlstate = 'P0002' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- THE IMPORTANT ONE. Not an error -- zero rows and silence.
  update public.events set active_folder_id = f2 where id = eid;
  get diagnostics n = row_count;
  out := out || format('%s guest UPDATE on events affects %s rows and raises nothing (the silent shape)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- The SAME silent shape on a column the grant now reaches. Worth its own line
  -- because the two fail differently: `name` is granted, so the POLICY refuses it and
  -- the result is zero rows; `tier` is not granted, so the GRANT refuses it and the
  -- result is 42501. One table, two refusals, and only one of them is loud.
  update public.events set name = 'Hijacked' where id = eid;
  get diagnostics n = row_count;
  out := out || format('%s guest UPDATE of events.name affects %s rows and raises nothing (want 0)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  ------------------------------------------------------- THE INVITATION (#15)
  -- event_preview is the only read into `events` that does not require membership, so
  -- these run BEFORE the second event is joined and while this guest is a member of
  -- TEST01 only. A preview of TEST02 is the load-bearing case: a non-member gets the
  -- name, which is the entire point, and events_read would have given nothing.
  select count(*) into n from public.event_preview('TEST02');
  out := out || format('%s event_preview returns a NON-MEMBER their invitation (got %s, want 1)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  select name into lbl from public.event_preview('  test02 ');
  out := out || format('%s event_preview upcases and trims its code (got %L)', case when lbl = 'Other' then 'PASS' else 'FAIL' end, lbl);

  -- A miss is zero rows, NOT the P0002 join_event raises. A code that names no event is
  -- an ordinary answer here, and the client renders its fallback rather than a toast.
  begin
    select count(*) into n from public.event_preview('NOPE99');
    out := out || format('%s event_preview misses with %s rows and no exception', case when n = 0 then 'PASS' else 'FAIL' end, n);
  exception when others then
    out := out || format('FAIL event_preview raised on a miss: %s %s', sqlstate, sqlerrm);
  end;

  -- THE PROJECTION IS THE ENFORCEMENT. SECURITY DEFINER bypasses every policy, so the
  -- only thing keeping a headcount out of an invitation is the column list. If someone
  -- widens it to `select e.*`, this is what stops it reaching a phone.
  --
  -- READ FROM pg_proc, NOT information_schema.columns. The obvious version of this
  -- check queried information_schema for a table named 'event_preview' and got zero
  -- rows -- because a function is not a table, so it found nothing, subtracted nothing
  -- and reported PASS. An assertion that passes having measured nothing is worse than
  -- no assertion, so this counts the OUT parameters, which is where a `returns table`
  -- signature actually lives.
  select count(*) into n from pg_proc pr
   where pr.pronamespace = 'public'::regnamespace and pr.proname = 'event_preview';
  out := out || format('%s event_preview exists to be inspected at all (got %s, want 1)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  select count(*) into n
    from pg_proc pr, unnest(pr.proargnames) as arg
   where pr.pronamespace = 'public'::regnamespace and pr.proname = 'event_preview'
     and arg in ('tier','guest_count','invited_count','active_folder_id','now_schedule_item_id');
  out := out || format('%s event_preview withholds tier and every count (leaked %s, want 0)', case when n = 0 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.photos (id,event_id,folder_id,uploaded_by_guest_id,uploaded_by_name,status,hue,storage_path)
    values (gen_random_uuid(), eid, fid, public.my_guest_id(eid), 'Ada', 'pending', 120, eid||'/own.jpg');
    out := out || format('PASS guest may insert a photo as themselves');
  exception when others then
    out := out || format('FAIL guest could not insert own photo: %s %s', sqlstate, sqlerrm);
  end;

  begin
    insert into public.photos (id,event_id,folder_id,uploaded_by_guest_id,uploaded_by_name,status,hue,storage_path)
    values (gen_random_uuid(), eid, fid, gen_random_uuid(), 'NotAda', 'pending', 9, eid||'/other.jpg');
    out := out || format('FAIL guest inserted a photo attributed to someone else');
  exception when others then
    out := out || format('%s guest cannot insert as another guest (%s)', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  ------------------------------------------------------------------- AS A HOST
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',huid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  out := out || format('%s is_host is true for the bound host row', case when public.is_host(eid) then 'PASS' else 'FAIL' end);

  update public.events set active_folder_id = f2 where id = eid;
  get diagnostics n = row_count;
  out := out || format('%s host UPDATE of active_folder_id affects %s rows (want 1)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  begin
    update public.events set tier = 'venue' where id = eid;
    out := out || format('FAIL host changed tier -- the column grant is not holding');
  exception when others then
    out := out || format('%s host cannot change tier, column grant holds (%s)', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  ------------------------------------------------- THE EVENT'S OWN DETAILS (#14)
  -- The five columns beyond active_folder_id. Until this grant existed an event was
  -- immutable from the moment the seed ran -- reported from a phone as "who set the
  -- date and where". All five in ONE statement, because that is how the adapter sends
  -- them and because a named-column grant fails the WHOLE statement on one stray key.
  update public.events
     set name = 'Verify, renamed', venue = 'The other barn',
         starts_at = now() + interval '1 day', timezone = 'Europe/London',
         doors_label = 'Doors 8:00 PM'
   where id = eid;
  get diagnostics n = row_count;
  out := out || format('%s host UPDATE of name/venue/starts_at/timezone/doors_label affects %s rows (want 1)', case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- NEW, and it should have existed all along: init.sql names code-hijacking as half
  -- the reason the column grant exists, and nothing asserted it. `code` is the join
  -- credential -- a host who could rewrite it could point their own event's code at
  -- somebody else's guests.
  begin
    update public.events set code = 'STOLEN' where id = eid;
    out := out || format('FAIL host rewrote the join code -- the column grant is not holding');
  exception when others then
    out := out || format('%s host cannot change code, column grant holds (%s)', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- The cursor stays out too. It is written only inside start_schedule_item(), which
  -- carries the would_rewind guard; a grant here would be a second route around it.
  begin
    update public.events set now_schedule_item_id = null where id = eid;
    out := out || format('FAIL host wrote the run-of-show cursor directly, bypassing the rewind guard');
  exception when others then
    out := out || format('%s host cannot write now_schedule_item_id directly (%s)', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  ------------------------------------------------------- FOLDERS CANNOT BE DELETED
  -- Regression guard for a bug that shipped: folders_write was `for all`, which includes
  -- DELETE, and photos.folder_id cascades from folders. One SDK call destroyed every
  -- photo row under a folder and stranded every byte in the bucket, unreachable forever
  -- because storage_path was the only thing that could name it.
  --
  -- THIS FILE DID NOT RUN, AND THAT IS THE FINDING. A setup line stood here inserting a
  -- photo as the HOST with no uploaded_by_guest_id. `photos_insert` checks
  -- `uploaded_by_guest_id = my_guest_id(event_id)`, and a host who never joined has no
  -- guests row -- so it raised 42501, outside any exception handler, and aborted the
  -- whole DO block. Every assertion below it had never executed once. Lane E skips
  -- without SUPABASE_DB_URL, so nothing said so.
  --
  -- It was also redundant: the guest inserted a photo under this same folder further up,
  -- which is the row the count below actually finds. Had the insert ever worked, the
  -- count would have been 2 and this assertion would have FAILED. Removing it is the fix.
  delete from public.folders where id = fid;
  get diagnostics n = row_count;
  out := out || format('%s host DELETE on folders affects %s rows (want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- The guest's own.jpg, inserted before the role switch. One row, still nameable.
  select count(*) into n from public.photos where folder_id = fid;
  out := out || format('%s the photo row survives, so its bytes stay nameable (%s)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  insert into public.folders (id, event_id, name, position)
  values (gen_random_uuid(), eid, 'Added by host', 9);
  get diagnostics n = row_count;
  out := out || format('%s a host can still ADD a folder (%s)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  ------------------------------------------------------------------ THE GUEST LIST
  -- invitees holds OTHER PEOPLE'S email addresses, uploaded by a host before those
  -- people have consented to anything. It is the strictest table here, and these
  -- assertions are what make "hosts only" a checked property rather than a comment.
  insert into public.invitees (event_id, email, display_name)
  values (eid, 'sam@example.test', 'Sam');
  out := out || format('PASS a host can add an invitee');

  select invited_count into n from public.events where id = eid;
  out := out || format('%s invited_count folds from the list (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.invitees (event_id, email) values (eid, 'SAM@example.test');
    out := out || format('FAIL the same address in another case was accepted');
  exception when unique_violation then
    out := out || format('PASS one address per event, case-insensitively');
  end;

  -- #25. THE DELETE ARM OF THE FOLD, which had never executed: `after insert or delete`
  -- has only ever been exercised on insert, so half that trigger was unverified.
  -- Removing someone strands nothing -- no bytes hang off an invitee -- which is why
  -- DELETE is granted here and on no other table.
  delete from public.invitees where event_id = eid and lower(email) = 'sam@example.test';
  get diagnostics n = row_count;
  out := out || format('%s a host can delete an invitee (%s row, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);
  select invited_count into n from public.events where id = eid;
  out := out || format('%s and the count folds back DOWN (%s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Re-add one so the column-grant assertions below have a row to work on.
  insert into public.invitees (event_id, email, display_name)
  values (eid, 'sam@example.test', 'Sam');

  -- THE COLUMN GRANT, which this table never had. A policy says WHO may write; without a
  -- grant a host could also rewrite `email` (re-pointing an invitation at a different
  -- person) or `joined_guest_id` (claiming an arrival that never happened).
  update public.invitees set display_name = 'Samantha'
   where event_id = eid and lower(email) = 'sam@example.test';
  get diagnostics n = row_count;
  out := out || format('%s a host can correct a display name (%s row, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);
  begin
    update public.invitees set invited_at = now() where event_id = eid;
    out := out || format('FAIL a client marked someone as invited, and nothing sends');
  exception when others then
    -- `invited_at` is the flag separating "on the list" from "was emailed". Nothing may
    -- set it until something actually sends -- least of all a client, which cannot.
    out := out || format('%s a client cannot set invited_at (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;
  begin
    update public.invitees set joined_guest_id = gen_random_uuid() where event_id = eid;
    out := out || format('FAIL a host forged an arrival');
  exception when others then
    out := out || format('%s a client cannot forge joined_guest_id (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- CROSS-EVENT ISOLATION. `is_host(event_id)` scopes all four policies, and nothing had
  -- ever tested that the scoping actually holds. TEST02 belongs to nobody here.
  select count(*) into n from public.invitees i where i.event_id = eid2;
  out := out || format('%s a host reads %s invitees of an event that is not theirs (want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- Back to the guest identity to prove the list is invisible to them.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',guid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.invitees;
  out := out || format('%s a guest sees %s invitees (want 0 -- the list is not readable)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.invitees (event_id, email) values (eid, 'sneaky@example.test');
    out := out || format('FAIL a guest added someone to the list');
  exception when others then
    out := out || format('%s a guest cannot add an invitee (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  ------------------------------------------------------- MODERATION (guideline 1.2)
  -- Bo joins and uploads; Ada is the one who reports. Two distinct guests, because
  -- "a guest sees only their OWN reports" is not testable with one.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',buid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  gb := public.join_event('TEST01', 'Bo');
  insert into public.photos (event_id, folder_id, uploaded_by_guest_id, uploaded_by_name, status)
  values (eid, fid, gb, 'Bo', 'approved') returning id into pho;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',guid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  rep1 := public.file_report(eid, 'photo', pho, 'nudity', 'not ok');
  out := out || format('%s a guest can file a report', case when rep1 is not null then 'PASS' else 'FAIL' end);

  rep2 := public.file_report(eid, 'photo', pho, 'nudity', 'again');
  out := out || format('%s re-reporting the same thing is a no-op, not an error (got %s)',
                       case when rep2 is null then 'PASS' else 'FAIL' end, coalesce(rep2::text,'null'));

  select reporter_name, subject_label into rname, lbl from public.reports where id = rep1;
  -- 'Renamed', not 'Ada', and the difference is the assertion. This guest joined twice
  -- --  once as Ada, once as Renamed -- to prove join_event is idempotent, and the second
  -- join updated the nickname on the same row. So the CURRENT nickname is Renamed, and
  -- file_report reading it off the guests row is exactly the server-side derivation this
  -- line is testing. It expected 'Ada' until this file first ran to completion, because
  -- an abort further up meant it had never executed.
  out := out || format('%s reporter_name is derived server-side, from the guest row as it stands now (got %s, want Renamed)',
                       case when rname = 'Renamed' then 'PASS' else 'FAIL' end, coalesce(rname,'null'));
  out := out || format('%s subject_label is derived server-side (got %s)',
                       case when lbl = 'Photo from Bo' then 'PASS' else 'FAIL' end, coalesce(lbl,'null'));

  begin
    perform public.file_report(eid, 'photo', p2, 'spam', '');
    out := out || 'FAIL a report reached a photo in ANOTHER event';
  exception when others then
    out := out || format('%s a report cannot name a subject outside its event (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  begin
    perform public.file_report(eid, 'guest', g1, 'spam', '');
    out := out || 'FAIL a guest reported themselves';
  exception when others then
    out := out || format('%s a guest cannot report themselves (%s)',
                         case when sqlstate = '22023' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  begin
    insert into public.reports (event_id, reporter_guest_id, reporter_name, subject_kind,
                                subject_photo_id, subject_label, reason)
    values (eid, g1, 'Somebody Else', 'photo', pho, 'forged', 'hate');
    out := out || 'FAIL a guest inserted a report directly, bypassing file_report';
  exception when others then
    out := out || format('%s reports cannot be inserted directly (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- Blocks
  insert into public.guest_blocks (event_id, blocker_guest_id, blocked_guest_id)
  values (eid, g1, gb);
  select count(*) into n from public.guest_blocks;
  out := out || format('%s a guest sees their own block (got %s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  begin
    insert into public.guest_blocks (event_id, blocker_guest_id, blocked_guest_id)
    values (eid, g1, g1);
    out := out || 'FAIL a guest blocked themselves';
  exception when others then
    out := out || format('%s a guest cannot block themselves (%s)',
                         case when sqlstate in ('23514','42501') then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- Bo's side: cannot see Ada's report, cannot see Ada's block.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',buid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.reports;
  out := out || format('%s a guest cannot read another guest''s report (got %s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from public.guest_blocks;
  out := out || format('%s blocks are private to the blocker (got %s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- ==================================================================
  -- STORAGE (#10) -- the three policies nothing had ever asserted
  -- ==================================================================
  --
  -- `event_photos_select` has been correct since the migration landed and had NEVER been
  -- exercised by anything. It is what keeps a photo awaiting approval unreadable to the
  -- room, so the photo read-back rests entirely on it.
  --
  -- Objects are inserted directly as the OWNER here. Only `bucket_id` and `name` matter;
  -- everything else on storage.objects is nullable or defaulted.
  execute 'reset role';
  insert into public.photos (id, event_id, folder_id, uploaded_by_guest_id, uploaded_by_name,
                             status, hue, storage_path, thumb_path)
  values (gen_random_uuid(), eid, fid, gb, 'Bo', 'approved', 11,
          eid || '/appr.jpg', eid || '/appr_t.jpg'),
         (gen_random_uuid(), eid, fid, g1, 'Renamed', 'pending', 12,
          eid || '/pend.jpg', eid || '/pend_t.jpg');
  insert into storage.objects (bucket_id, name) values
    ('event-photos', eid || '/appr.jpg'), ('event-photos', eid || '/appr_t.jpg'),
    ('event-photos', eid || '/pend.jpg'), ('event-photos', eid || '/pend_t.jpg');

  -- The guest who UPLOADED the pending one (g1 is Renamed's seat).
  perform set_config('request.jwt.claims', json_build_object('sub',guid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from storage.objects o where o.name = eid || '/appr.jpg';
  out := out || format('%s a guest can read an APPROVED photo object (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);
  -- THE THUMBNAIL, which only the widened policy admits. Before it, the 400px object
  -- every screen actually renders was unreadable to everyone, including its uploader.
  select count(*) into n from storage.objects o where o.name = eid || '/appr_t.jpg';
  out := out || format('%s ...and its THUMBNAIL (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from storage.objects o where o.name = eid || '/pend.jpg';
  out := out || format('%s a guest can read their OWN pending photo (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- A DIFFERENT guest. Approval is what admits the room, and it gates both objects.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',buid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from storage.objects o where o.name = eid || '/pend.jpg';
  out := out || format('%s another guest CANNOT read a pending photo (%s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from storage.objects o where o.name = eid || '/pend_t.jpg';
  out := out || format('%s nor its thumbnail -- approval gates BOTH objects (%s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',huid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from storage.objects o where o.name like eid || '/%';
  out := out || format('%s a host reads every object in her event (%s, want 4)',
                       case when n = 4 then 'PASS' else 'FAIL' end, n);

  -- DELETE IS BLOCKED FOR EVERYONE AT THE SQL LAYER, before RLS is consulted --
  -- `storage.protect_delete()` raises 42501 on any direct delete. That is worth asserting
  -- because it settles how the retention sweep must eventually be built: through the
  -- Storage API with a service role, never with SQL.
  begin
    delete from storage.objects where name = eid || '/appr.jpg';
    out := out || format('FAIL a direct SQL delete removed bytes');
  exception when others then
    out := out || format('%s not even a host deletes bytes in SQL -- storage.protect_delete (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;
  execute 'reset role';

  -- The host's queue, and the audit trail.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',huid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.reports;
  out := out || format('%s a host reads the whole report queue (got %s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  select count(*) into n from public.guest_blocks;
  out := out || format('%s not even a host reads blocks (got %s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  begin
    update public.reports set reason = 'spam' where id = rep1;
    out := out || 'FAIL a host rewrote the reason on a report';
  exception when others then
    out := out || format('%s a host cannot edit the evidence (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  update public.reports set resolved_at = now(), resolution = 'removed' where id = rep1;
  select resolved_by_host_id into who from public.reports where id = rep1;
  out := out || format('%s resolving stamps the acting host from auth.uid() (got %s)',
                       case when who = hid then 'PASS' else 'FAIL' end,
                       coalesce(who::text,'null'));

  -- And the guest still cannot close their own complaint.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',guid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.reports set resolved_at = null, resolution = null where id = rep1;
  get diagnostics n = row_count;
  out := out || format('%s a guest resolving affects zero rows, silently (got %s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  --------------------------------------------- MAKING AN EVENT (#13, #32)
  -- A fresh identity, because the whole claim is that somebody with no seat anywhere
  -- can bring an event into existence and be its host without a key changing hands.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select * into ce from public.create_event(
    'Ruth''s 40th', now() + interval '3 days', 'America/New_York', 'The garden', 'Doors 7:00 PM', 'Ruth');

  out := out || format('%s create_event mints a code off the safe alphabet (%s)',
                       case when ce.code ~ '^[A-HJ-NP-Z2-9]{6}$' then 'PASS' else 'FAIL' end, ce.code);
  out := out || format('%s the founder is host immediately, with no key changing hands',
                       case when public.is_host(ce.event_id) then 'PASS' else 'FAIL' end);

  -- An event with no folder refuses every upload, and folders_insert needs is_host --
  -- which is not true until one statement later. So it has to happen inside the RPC.
  select count(*) into n from public.events e
   where e.id = ce.event_id and e.active_folder_id is not null;
  out := out || format('%s a new event arrives with an active folder (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  select e.tier into lbl from public.events e where e.id = ce.event_id;
  out := out || format('%s a new event is house_party, not a tier nobody paid for (%s)',
                       case when lbl = 'house_party' then 'PASS' else 'FAIL' end, lbl);

  -- THE KEY EXISTS ONLY IN THE RETURN VALUE. If this ever finds a row, the plaintext is
  -- sitting in the database and every backup and support session hands over the event.
  select count(*) into n from public.host_claims hc
   where hc.host_id = ce.host_id and hc.secret_hash = upper(replace(ce.host_key,'-',''));
  out := out || format('%s only the bcrypt hash is stored, never the key itself (%s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- THE RECOVERY, which is the whole reason a key is minted for someone who did not need
  -- one to get in. auth.uid() is an anonymous session in a keystore on one phone, and an
  -- Android reinstall wipes it. A DIFFERENT uid presenting the key is exactly "new phone".
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',nuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  out := out || format('%s a new phone is not the host until it presents the key',
                       case when public.is_host(ce.event_id) = false then 'PASS' else 'FAIL' end);

  who := public.claim_host(ce.code, ce.host_key);
  out := out || format('%s the recovery key gets her back into her own event (%s)',
                       case when who = ce.host_id then 'PASS' else 'FAIL' end, coalesce(who::text,'null'));

  -- Typed off a note in a dim room: dashes and case are presentation, not credential.
  who := public.claim_host(lower(ce.code), lower(replace(ce.host_key,'-',' ')));
  out := out || format('%s the key survives lower case and spaces',
                       case when who = ce.host_id then 'PASS' else 'FAIL' end);

  -- ROTATION, for the note that got lost or shown to the wrong person.
  kold := ce.host_key;
  knew := public.rotate_host_key(ce.event_id);
  out := out || format('%s rotate_host_key issues a new one (%s)',
                       case when knew ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'
                            then 'PASS' else 'FAIL' end, knew);
  out := out || format('%s and it is not the old one',
                       case when knew <> kold then 'PASS' else 'FAIL' end);

  -- THE HALF THAT MAKES ROTATION MEAN ANYTHING. A rotation that leaves the old key
  -- working is a rotation in name only, and it is the failure someone would discover
  -- after handing the old note to the wrong person.
  begin
    perform public.claim_host(ce.code, kold);
    out := out || format('FAIL the OLD key still opens the event after rotation');
  exception when others then
    out := out || format('%s the old key stops working once rotated (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- CREDENTIALS COME FROM A CSPRNG, and the minting function is not reachable over HTTP.
  --
  -- Both halves matter. `random()` minted these until a security review caught it, and
  -- create_event is callable by anyone who can sign in anonymously -- so an attacker
  -- could have asked for keys in a loop and read the PRNG's output stream directly,
  -- which against a pooled connection is somebody else's session state.
  --
  -- The revoke is asserted rather than assumed because this file's own GRANTS section
  -- documents the trap: `revoke ... from anon` alone is a silent no-op, since Supabase
  -- ships ALTER DEFAULT PRIVILEGES granting EXECUTE to anon and authenticated. A
  -- mint_token a client can call is an oracle on the generator behind every key here.
  begin
    perform public.mint_token(12);
    out := out || format('FAIL a client can call mint_token -- the key generator is an oracle');
  exception when others then
    out := out || format('%s mint_token is not callable by a client (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- A stranger holding neither key can do neither thing.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',guid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.rotate_host_key(ce.event_id);
    out := out || format('FAIL a stranger rotated somebody else''s host key');
  exception when others then
    out := out || format('%s only a host of that event can rotate its key (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  ------------------------------------------------ INVITING A CO-HOST (#16)
  -- SHE IS ON THE NEW PHONE NOW. The recovery assertions above rebound her seat to
  -- `nuid`, which is the whole point of them -- so `cuid` is a stranger to this event
  -- from here on, and using it would test the wrong person. The event is still
  -- house_party, which create_event made it.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',nuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  -- THE FREE TIER INCLUDES ONE HOST, and its own featureLines say so. She is that host,
  -- so there is no room -- which is a coherent ladder, not a bug, and the point of
  -- asserting it is that the cap is enforced by POSTGRES rather than by the client that
  -- would otherwise be trusted to count its own seats.
  begin
    perform public.invite_host(ce.event_id, 'DJ Marco', 'dj', 'DJ');
    out := out || format('FAIL a house_party host minted a second seat');
  exception when others then
    out := out || format('%s the free tier stops at one host (%s)',
                         case when sqlstate = '54023' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- Move to the tier whose headline is "5 hosts with roles". Service role, because
  -- `tier` is outside the column grant -- which is exactly what a purchase path would
  -- have to do, and why #30 blocks the paid tiers being reachable at all.
  execute 'reset role';
  update public.events set tier = 'event' where id = ce.event_id;
  perform set_config('request.jwt.claims', json_build_object('sub',nuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select * into iv from public.invite_host(ce.event_id, '  DJ Marco  ', 'dj', '');
  out := out || format('%s invite_host returns a key off the safe alphabet (%s)',
                       case when iv.host_key ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'
                            then 'PASS' else 'FAIL' end, iv.host_key);

  select h.role_label into lbl from public.hosts h where h.id = iv.host_id;
  out := out || format('%s an empty role_label falls back to the role name (%s)',
                       case when lbl = 'DJ' then 'PASS' else 'FAIL' end, lbl);

  -- NOBODY HOLDS THE SEAT YET. auth_user_id stays null until the key is presented, which
  -- is what makes an invitation an invitation rather than an assignment.
  --
  -- READ AS THE OWNER, because #34 revoked `auth_user_id` from `authenticated` and that
  -- includes hosts. This is a claim about the ROW, not about what a client may see -- the
  -- permission itself is asserted further down, from both a guest and a host. Leaving it
  -- under `set local role authenticated` raised 42501 and aborted the block.
  execute 'reset role';
  select count(*) into n from public.hosts h
   where h.id = iv.host_id and h.auth_user_id is null;
  out := out || format('%s the seat is unclaimed until someone presents the key (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);
  perform set_config('request.jwt.claims', json_build_object('sub',nuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.host_claims hc
   where hc.host_id = iv.host_id and hc.secret_hash = upper(replace(iv.host_key,'-',''));
  out := out || format('%s only the hash is stored for a co-host too (%s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- ONE SEAT PER PERSON. The founder holding the DJ's key must not be able to take his
  -- seat as well: it would strand the seat, and nothing on screen would say why.
  begin
    perform public.claim_host(ce.code, iv.host_key);
    out := out || format('FAIL the founder collected the co-host seat, stranding it');
  exception when others then
    out := out || format('%s one seat per person per event (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- THE DJ REDEEMS IT, with no account and a key typed off a note.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',muid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  out := out || format('%s a person holding no key is not a host',
                       case when public.is_host(ce.event_id) = false then 'PASS' else 'FAIL' end);
  who := public.claim_host(ce.code, lower(replace(iv.host_key,'-',' ')));
  out := out || format('%s the DJ redeems his key with no account (%s)',
                       case when who = iv.host_id then 'PASS' else 'FAIL' end, coalesce(who::text,'null'));
  out := out || format('%s and is a host of the event afterwards',
                       case when public.is_host(ce.event_id) then 'PASS' else 'FAIL' end);

  -- ONLY A HOST INVITES. Not a guest, not a stranger holding the event code.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',guid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.invite_host(ce.event_id, 'Gatecrasher', 'host', '');
    out := out || format('FAIL a non-host minted a seat');
  exception when others then
    out := out || format('%s only a host of that event can invite (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- THE CAPS ARE A TABLE, READABLE AND NOT WRITABLE. They are duplicated in
  -- src/domain/tiers.ts because two consumers need them and no literal crosses that
  -- boundary; src/domain/tiers.test.ts re-parses this migration and fails on drift.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',nuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.tier_limits;
  out := out || format('%s tier_limits is readable by a client (%s, want 4)',
                       case when n = 4 then 'PASS' else 'FAIL' end, n);
  begin
    update public.tier_limits set max_hosts = 99 where tier = 'house_party';
    out := out || format('FAIL a client rewrote the pricing caps');
  exception when others then
    out := out || format('%s nobody rewrites the caps from a client (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  ------------------------------------- CAPS AND FLAGS THE SERVER ENFORCES (#22, #21, #34)
  -- A fresh event of its own, so nothing above is entangled with what follows.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select * into ce2 from public.create_event('Capped', now() + interval '1 day', 'UTC', 'The flat', '', 'Ruth');

  -- #21. PINNING DEGRADES, IT DOES NOT REFUSE. MemoryRepository has always said why:
  -- "Refusing to post an announcement because the plan cannot PIN it would be hostile."
  -- The server now agrees, via a BEFORE INSERT trigger rather than a policy -- a policy
  -- can only permit or deny a whole row, and denying the row loses the announcement.
  insert into public.broadcasts (event_id, author_host_id, author_name, author_role_label, kind, body, pinned)
  values (ce2.event_id, ce2.host_id, 'Ruth', 'Host', 'announcement', 'free tier tries to pin', true)
  returning pinned into pin;
  out := out || format('%s a house_party pin is degraded, not refused (pinned=%s, want false)',
                       case when pin = false then 'PASS' else 'FAIL' end, pin);
  select count(*) into n from public.broadcasts where event_id = ce2.event_id;
  out := out || format('%s and the announcement still went out (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  execute 'reset role';
  update public.events set tier = 'event' where id = ce2.event_id;
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.broadcasts (event_id, author_host_id, author_name, author_role_label, kind, body, pinned)
  values (ce2.event_id, ce2.host_id, 'Ruth', 'Host', 'announcement', 'paid tier pins', true)
  returning id, pinned into bc, pin;
  out := out || format('%s an event-tier pin sticks (pinned=%s, want true)',
                       case when pin = true then 'PASS' else 'FAIL' end, pin);

  -- #26. Un-pinning. `broadcasts` carried a SELECT policy and an INSERT policy and
  -- nothing else, so a notice that stopped being true two hours in sat above the feed
  -- for the rest of the night and no control anywhere could move it.
  update public.broadcasts set pinned = false where id = bc;
  get diagnostics n = row_count;
  select b.pinned into pin from public.broadcasts b where b.id = bc;
  out := out || format('%s a host can UN-PIN (%s row, pinned=%s; want 1, false)',
                       case when n = 1 and pin = false then 'PASS' else 'FAIL' end, n, pin);

  -- ...and only `pinned`. An announcement is a thing that was SAID; a host who can edit
  -- the body of one guests have already read can rewrite history silently.
  begin
    update public.broadcasts set body = 'rewritten' where id = bc;
    out := out || format('FAIL a host rewrote the body of a sent announcement');
  exception when others then
    out := out || format('%s a host cannot rewrite a sent announcement, column grant holds (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- THE TRAP #26 WOULD HAVE SET FOR #21. With an insert-only fold trigger, the UPDATE
  -- policy added just above would leave a free-tier host one statement away from the pin
  -- she was refused: insert (folded to false), then set pinned = true with nothing in the
  -- path to fold it again. The cap would have been undone by the feature that came after
  -- it, silently, with every gate still green. The trigger is `before insert OR UPDATE`.
  execute 'reset role';
  update public.events set tier = 'house_party' where id = ce2.event_id;
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  update public.broadcasts set pinned = true where id = bc;
  select b.pinned into pin from public.broadcasts b where b.id = bc;
  out := out || format('%s a free-tier host cannot pin via UPDATE either (pinned=%s, want false)',
                       case when pin = false then 'PASS' else 'FAIL' end, pin);
  execute 'reset role';
  update public.events set tier = 'event' where id = ce2.event_id;
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  -- #34. A guest needs a host's NAME, ROLE and LABEL. auth_user_id is not theirs to see,
  -- and `toHost` dropping it client-side was never the control -- PostgREST answers
  -- whatever the grant allows.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',auid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  gcap := public.join_event(ce2.code, 'Ada');
  select h.display_name into lbl from public.hosts h where h.event_id = ce2.event_id limit 1;
  out := out || format('%s a guest still reads a host name (%s)',
                       case when lbl = 'Ruth' then 'PASS' else 'FAIL' end, coalesce(lbl,'null'));

  -- #26's other half, and the one no amount of reading the policy would settle: a guest's
  -- UPDATE returns ZERO ROWS AND RAISES NOTHING. That silent shape is exactly what
  -- `SupabaseRepository.assertWrote()` exists to catch, and the un-pin control is the
  -- newest caller of it.
  update public.broadcasts set pinned = true where id = bc;
  get diagnostics n = row_count;
  select b.pinned into pin from public.broadcasts b where b.id = bc;
  out := out || format('%s a guest pinning affects %s rows and raises nothing, pinned=%s (want 0, false)',
                       case when n = 0 and pin = false then 'PASS' else 'FAIL' end, n, pin);
  begin
    perform h.auth_user_id from public.hosts h where h.event_id = ce2.event_id limit 1;
    out := out || format('FAIL a guest read auth_user_id off hosts');
  exception when others then
    out := out || format('%s a guest cannot read auth_user_id (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- AND NEITHER CAN A HOST, because the revoke names the ROLE `authenticated` and a host
  -- is one. That is stronger than the issue asked for, and it is deliberate: nothing on
  -- the client has ever needed the column (`SupabaseRepository.ts:526` selects named
  -- columns; `toHost` discards it), so leaving it readable to hosts would grant a
  -- capability with no caller. This assertion is here because the property SURPRISED this
  -- file -- an earlier line looked the founding host up by `where auth_user_id = huid`
  -- while standing in `authenticated`, and the 42501 aborted the whole block.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform h.auth_user_id from public.hosts h where h.event_id = ce2.event_id limit 1;
    out := out || format('FAIL a HOST read auth_user_id off hosts');
  exception when others then
    out := out || format('%s not even a host reads auth_user_id (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- #22. The cap join_event never had. Fill the room as service role; Ada holds one seat.
  execute 'reset role';
  update public.events set tier = 'house_party' where id = ce2.event_id;
  for i in 1..9 loop
    filler := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
    values (filler,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now());
    insert into public.guests (event_id, auth_user_id, nickname) values (ce2.event_id, filler, 'Filler ' || i);
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub',buid2,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.join_event(ce2.code, 'Bo');
    out := out || format('FAIL an 11th guest joined a 10-guest event');
  exception when others then
    out := out || format('%s the 11th guest is refused with %s, which the adapter maps to event_full',
                         case when sqlstate = '54023' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- THE ONE THAT MATTERS MORE. join_event is idempotent on (event_id, auth_user_id) and
  -- that is why the session is persisted: a reinstall must land on the same row. A cap
  -- that refused a REJOIN would lock out the people already in the room.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',auid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    out := out || format('%s a guest already seated can rejoin a FULL event',
                         case when public.join_event(ce2.code, 'Ada') = gcap then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format('FAIL a rejoin at a full event was refused (%s) -- a reinstall locks them out', sqlstate);
  end;

  -- ==================================================================
  -- STAFF ARE NOT GUESTS (#37)
  -- ==================================================================
  -- The room is FULL from the block above -- 10 of 10 on house_party -- which is the only
  -- state where these mean anything. `cuid` made this event and holds ce2.host_id; she has
  -- no `guests` row, because `create_event` deliberately mints none. That gap is what made
  -- `becomeGuest` raise and left a founder with no door out of her own console.
  execute 'reset role';
  select e.guest_count into n from public.events e where e.id = ce2.event_id;
  out := out || format('%s the room is full before the host walks in (guest_count=%s, want 10)',
                       case when n = 10 then 'PASS' else 'FAIL' end, n);

  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    -- ITS CONTROL IS BO, four assertions down: the same call, the same full event, a
    -- 54023. Without that pair this would pass just as happily against a join_event that
    -- had no cap at all -- which is what a mutation of `guest_seats` alone cannot show,
    -- because the host's exemption lives in join_event's guard rather than in the count.
    hst := public.join_event(ce2.code, 'Ruth');
    out := out || format('%s a host takes a seat at her OWN full event', case when hst is not null then 'PASS' else 'FAIL' end);
  exception when others then
    out := out || format('FAIL a founder was refused a seat at her own event (%s) -- she is stranded in the console', sqlstate);
  end;

  execute 'reset role';
  select e.guest_count into n from public.events e where e.id = ce2.event_id;
  select count(*) into m from public.guests g where g.event_id = ce2.event_id;
  out := out || format('%s her seat is not a guest arriving (guest_count=%s over %s rows, want 10 over 11)',
                       case when n = 10 and m = 11 then 'PASS' else 'FAIL' end, n, m);

  -- THE ONE THAT MATTERS MOST HERE. A bypass that let the host in could just as easily
  -- have let the eleventh guest in -- `guest_seats` is subtracting a row, and if it
  -- subtracted the wrong one the cap would have quietly grown by a seat per host.
  perform set_config('request.jwt.claims', json_build_object('sub',buid2,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.join_event(ce2.code, 'Bo');
    out := out || format('FAIL an 11th guest joined after the host sat down');
  exception when others then
    out := out || format('%s the cap still refuses a stranger with the host seated (%s)',
                         case when sqlstate = '54023' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  begin
    perform public.guest_seats(ce2.event_id);
    out := out || format('FAIL guest_seats is callable by a client');
  exception when others then
    -- Not a secret, but it answers a headcount for ANY event id, and `event_preview`
    -- deliberately withholds exactly that. A revoke from `anon` alone would be a silent
    -- no-op here, which is the same trap #34 fell into.
    out := out || format('%s guest_seats is revoked from authenticated (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- A GUEST PROMOTED TO STAFF STOPS COUNTING, and a trigger on `guests` alone cannot see
  -- it: `claim_host` binds `auth_user_id` on a seat that already exists, so no row is
  -- inserted or deleted anywhere. Without `hosts_fold_guests` the stored count is simply
  -- wrong from that moment until the next arrival.
  execute 'reset role';
  insert into public.hosts (event_id, auth_user_id, display_name, role, role_label)
       values (ce2.event_id, null, 'Ada', 'dj', 'DJ') returning id into hst;
  select e.guest_count into n from public.events e where e.id = ce2.event_id;
  update public.hosts set auth_user_id = auid where id = hst;
  select e.guest_count into m from public.events e where e.id = ce2.event_id;
  out := out || format('%s binding a host seat to someone already seated drops the count (%s -> %s, want 10 -> 9)',
                       case when n = 10 and m = 9 then 'PASS' else 'FAIL' end, n, m);

  update public.hosts set auth_user_id = null where id = hst;
  select e.guest_count into n from public.events e where e.id = ce2.event_id;
  out := out || format('%s and unbinding it puts her back in the room (%s, want 10)',
                       case when n = 10 then 'PASS' else 'FAIL' end, n);

  -- Cleaned up rather than left standing: the sections below count hosts and read this
  -- event's headcount, and an extra unclaimed seat plus the founder's guest row would
  -- make those assertions describe a fixture this block invented.
  delete from public.hosts where id = hst;
  delete from public.guests where event_id = ce2.event_id and auth_user_id = cuid;

  -- ==================================================================
  -- PUSH (#27)
  -- ==================================================================
  -- ce2 is back on the `event` tier here, which is the one that carries push.
  execute 'reset role';
  update public.events set tier = 'event' where id = ce2.event_id;
  perform set_config('request.jwt.claims', json_build_object('sub',auid,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  perform public.set_push_token(ce2.event_id, '  ExponentPushToken[ADA]  ');
  execute 'reset role';
  select g.push_token into lbl from public.guests g where g.id = gcap;
  out := out || format('%s set_push_token stores a trimmed token (%s)',
                       case when lbl = 'ExponentPushToken[ADA]' then 'PASS' else 'FAIL' end,
                       coalesce(lbl,'null'));

  -- THE ONE THAT MATTERS. A token is a routable address for somebody's device. `guests`
  -- has no SELECT policy and this is the assertion that keeps it that way now that the
  -- table holds something worth stealing.
  perform set_config('request.jwt.claims', json_build_object('sub',buid2,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.guests;
  out := out || format('%s a guest reads %s rows from guests, so no token is readable (want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  -- ...and cannot write over somebody else's, because the RPC scopes to auth.uid().
  perform public.set_push_token(ce2.event_id, 'ExponentPushToken[BO]');
  execute 'reset role';
  select g.push_token into lbl from public.guests g where g.id = gcap;
  out := out || format('%s another guest''s call did not overwrite it (%s)',
                       case when lbl = 'ExponentPushToken[ADA]' then 'PASS' else 'FAIL' end,
                       coalesce(lbl,'null'));

  -- A HOST HAS NO `guests` ROW, and the app calls this on open. It must be a quiet no-op
  -- or the console breaks for the founder of every event -- the same trap `loadFetchOnce`
  -- fell into with requireGuest().
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.set_push_token(ce2.event_id, 'ExponentPushToken[HOST]');
    out := out || format('PASS a host calling set_push_token is a no-op, not an error');
  exception when others then
    out := out || format('FAIL set_push_token raised for a host with no guests row (%s)', sqlstate);
  end;

  -- Clearing is the off switch, and it is the same call rather than a second one.
  perform set_config('request.jwt.claims', json_build_object('sub',auid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_push_token(ce2.event_id, null);
  execute 'reset role';
  select g.push_token into lbl from public.guests g where g.id = gcap;
  out := out || format('%s a null clears the token (%s)',
                       case when lbl is null then 'PASS' else 'FAIL' end, coalesce(lbl,'null'));

  -- The fan-out must NEVER cost the host her announcement. Secrets are absent here, which
  -- is the state before anyone wires credentials, and the insert must still land.
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.broadcasts (event_id, author_host_id, author_name, author_role_label, kind, body, pinned)
    values (ce2.event_id, ce2.host_id, 'Ruth', 'Host', 'announcement', 'Push is wired', false);
    out := out || format('PASS an announcement lands even with the push secrets absent');
  exception when others then
    out := out || format('FAIL the fan-out broke the INSERT (%s)', sqlstate);
  end;

  -- Both triggers exist, and the song one is on UPDATE rather than INSERT -- a request is
  -- accepted by being updated, so an insert-side trigger would notify nobody, ever.
  execute 'reset role';
  select count(*) into n from pg_trigger
   where tgrelid = 'public.broadcasts'::regclass and tgname = 'broadcasts_fan_out_push';
  out := out || format('%s the room fan-out is on broadcasts (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);
  select count(*) into n from pg_trigger
   where tgrelid = 'public.song_requests'::regclass and tgname = 'song_requests_fan_out_push'
     and (tgtype & 16) <> 0;
  out := out || format('%s the song fan-out is on song_requests UPDATE (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- The tier gate lives in the table, not in a client.
  select tl.push_notifications::text into lbl from public.tier_limits tl where tl.tier = 'house_party';
  out := out || format('%s house_party does not carry push (%s)',
                       case when lbl = 'false' then 'PASS' else 'FAIL' end, lbl);
  select tl.push_notifications::text into lbl from public.tier_limits tl where tl.tier = 'event';
  out := out || format('%s the event tier does (%s)',
                       case when lbl = 'true' then 'PASS' else 'FAIL' end, lbl);

  -- Neither fan-out is callable by a client. They hold a Vault secret and address every
  -- device in the room; a reachable one is a spam cannon with a service key.
  perform set_config('request.jwt.claims', json_build_object('sub',auid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.fan_out_push();
    out := out || format('FAIL a client can call fan_out_push');
  exception when others then
    out := out || format('%s fan_out_push is not callable by a client (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;
  begin
    perform public.fan_out_song_push();
    out := out || format('FAIL a client can call fan_out_song_push');
  exception when others then
    out := out || format('%s fan_out_song_push is not callable by a client (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;
  execute 'reset role';

  -- ==================================================================
  -- SEEN BY N (#24)
  -- ==================================================================
  -- `broadcast_reads` had a policy and a fold trigger and NO WRITER for the whole life of
  -- this schema, so `seen_count` summed an empty table and every announcement read
  -- "seen by 0" forever. `chat.markRead()` writes it now, and these are the two halves no
  -- client-side test can see: that the policy admits a guest's OWN read and refuses one
  -- forged for somebody else, and that the fold does not count staff.
  execute 'reset role';
  insert into public.broadcasts (event_id, author_host_id, author_name, author_role_label, kind, body)
       values (ce2.event_id, ce2.host_id, 'Ruth', 'Host', 'announcement', 'seen-by fixture')
    returning id into bc;

  perform set_config('request.jwt.claims', json_build_object('sub',auid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.broadcast_reads (broadcast_id, guest_id) values (bc, gcap);
  execute 'reset role';
  select b.seen_count into n from public.broadcasts b where b.id = bc;
  out := out || format('%s a guest reading an announcement moves seen_count (%s, want 1)',
                       case when n = 1 then 'PASS' else 'FAIL' end, n);

  -- FORGING SOMEBODY ELSE'S READ. `reads_own` checks the row's guest_id against
  -- my_guest_id() for that broadcast's event, so this is a WITH CHECK violation and
  -- raises -- unlike a refused UPDATE, which returns zero rows and says nothing.
  perform set_config('request.jwt.claims', json_build_object('sub',buid2,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.broadcast_reads (broadcast_id, guest_id) values (bc, gcap);
    out := out || format('FAIL a guest marked an announcement read AS SOMEBODY ELSE');
  exception when others then
    out := out || format('%s a read cannot be filed under another guest (%s)',
                         case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- STAFF ARE NOT READERS, which is `guest_seats` one level down. The host takes a seat at
  -- her own event -- the thing #37 makes possible -- and reads her own announcement. The
  -- row is stored; it is simply not counted, because "seen by 1" the moment its author
  -- looks at it is the same lie as a brand-new party reading "1 already here".
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',cuid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  hst := public.join_event(ce2.code, 'Ruth');
  insert into public.broadcast_reads (broadcast_id, guest_id) values (bc, hst);
  execute 'reset role';
  select b.seen_count into n from public.broadcasts b where b.id = bc;
  select count(*) into m from public.broadcast_reads r where r.broadcast_id = bc;
  out := out || format('%s the host reading her own announcement is stored and not counted (seen_count=%s over %s rows, want 1 over 2)',
                       case when n = 1 and m = 2 then 'PASS' else 'FAIL' end, n, m);

  -- ...and the fold is a recount, not an increment, so removing a read puts it back.
  delete from public.broadcast_reads where broadcast_id = bc and guest_id = gcap;
  select b.seen_count into n from public.broadcasts b where b.id = bc;
  out := out || format('%s and taking a read away recounts rather than decrements (%s, want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

  delete from public.guests where event_id = ce2.event_id and auth_user_id = cuid;

  select count(*) into fails from unnest(out) x where x like 'FAIL%';
  raise exception using message =
    format('%s FAILURE(S). %s', fails, array_to_string(out, E'\n  '));
end $$;
