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
  n int; g1 uuid; g2 uuid;
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
  values (eid, huid, 'Riley', 'host', 'Bride');

  -- A second guest, and a SECOND EVENT with its own photo. The second event is not
  -- decoration: it is the only way to test that a report cannot reach across events,
  -- which is the check no INSERT policy could have made.
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
  values (buid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now());
  insert into auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
  values (cuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now()),
         (nuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',null,true,now(),now());
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
                       case when who = (select id from public.hosts where auth_user_id = huid)
                            then 'PASS' else 'FAIL' end, coalesce(who::text,'null'));

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

  select count(*) into fails from unnest(out) x where x like 'FAIL%';
  raise exception using message =
    format('%s FAILURE(S). %s', fails, array_to_string(out, E'\n  '));
end $$;
