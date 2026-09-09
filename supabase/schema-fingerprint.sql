select 'policies' as kind, count(*)::int as n,
       md5(coalesce(string_agg(x, e'\n' order by x), '')) as fingerprint
  from (select schemaname||'.'||tablename||'.'||policyname||' '||cmd||' '||
               coalesce(qual,'')||' | '||coalesce(with_check,'') as x
          from pg_policies where schemaname in ('public','storage')) p
union all
select 'functions', count(*)::int, md5(coalesce(string_agg(x, e'\n' order by x), ''))
  from (select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as x
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public') f
union all
select 'columns', count(*)::int, md5(coalesce(string_agg(x, e'\n' order by x), ''))
  from (select table_name||'.'||column_name||' '||data_type||' null='||is_nullable as x
          from information_schema.columns where table_schema = 'public') c
union all
select 'triggers', count(*)::int, md5(coalesce(string_agg(x, e'\n' order by x), ''))
  from (select event_object_table||'.'||trigger_name||' '||event_manipulation||' '||action_timing as x
          from information_schema.triggers where trigger_schema = 'public') t
union all
select 'indexes', count(*)::int, md5(coalesce(string_agg(x, e'\n' order by x), ''))
  from (select indexname||' '||indexdef as x from pg_indexes where schemaname = 'public') i
union all
select 'tier_limits', count(*)::int, md5(coalesce(string_agg(x, e'\n' order by x), ''))
  from (select tier||'|'||coalesce(max_guests::text,'-')||'|'||coalesce(max_hosts::text,'-')||'|'||
               coalesce(max_photos::text,'-')||'|'||coalesce(max_folders::text,'-')||'|'||host_roles||'|'||
               pinned_announcements||'|'||push_notifications||'|'||coalesce(album_retention_days::text,'-')||'|'||photo_moderation as x
          from public.tier_limits) tl
order by 1;
