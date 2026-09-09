-- Wipe a LOCAL Supabase back to "before the migration", so the migration can be applied
-- from scratch. Never point this at anything but 127.0.0.1.
--
--   docker exec -i supabase_db_runit psql -U postgres -v ON_ERROR_STOP=1 \
--     < supabase/reset-local.sql
--
-- WHY THE DEFAULT PRIVILEGES ARE RESTORED, and it is the whole reason this file exists
-- rather than three lines in a doc. `00000000000000_schema.sql` contains NO table grants at
-- all: it relies on Supabase's `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated`, which is attached to the SCHEMA -- so `drop schema public cascade`
-- destroys it, and every table the migration then creates arrives with no client grant.
--
-- That fails in two different ways and the second is worse. Lane E aborts early with
-- `permission denied for table events`, which at least says something. But the REVOKE
-- assertions -- "my_events is revoked from anon", and eight like it -- would PASS
-- trivially, because there was never a grant to revoke. A reset that quietly makes
-- assertions vacuous is exactly the failure this repo keeps filing issues about, and the
-- recipe in docs/lane-e.md had it for an hour before a run caught it.
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
  loop execute format('drop policy if exists %I on storage.objects', r.policyname); end loop;
end $$;

drop schema if exists public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all   on schema public to postgres, service_role;

-- The three ALTER DEFAULT PRIVILEGES statements a stock Supabase project ships, restored
-- for the schema that was just recreated. Without these the migration's own revokes have
-- nothing to bite on.
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
