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

  ------------------------------------------------------- FOLDERS CANNOT BE DELETED
  -- Regression guard for a bug that shipped: folders_write was `for all`, which includes
  -- DELETE, and photos.folder_id cascades from folders. One SDK call destroyed every
  -- photo row under a folder and stranded every byte in the bucket, unreachable forever
  -- because storage_path was the only thing that could name it.
  insert into public.photos (event_id, folder_id, uploaded_by_name, status, hue, storage_path)
  values (eid, fid, 'Ada', 'approved', 42, eid || '/orphan-guard.jpg');

  delete from public.folders where id = fid;
  get diagnostics n = row_count;
  out := out || format('%s host DELETE on folders affects %s rows (want 0)',
                       case when n = 0 then 'PASS' else 'FAIL' end, n);

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
  out := out || format('%s reporter_name is derived server-side (got %s, want Ada)',
                       case when rname = 'Ada' then 'PASS' else 'FAIL' end, coalesce(rname,'null'));
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

  select count(*) into fails from unnest(out) x where x like 'FAIL%';
  raise exception using message =
    format('%s FAILURE(S). %s', fails, array_to_string(out, E'\n  '));
end $$;
