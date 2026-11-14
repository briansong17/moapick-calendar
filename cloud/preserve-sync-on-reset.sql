begin;
create or replace function public.moa_reset_test_history(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.moa_preferences where user_id=p_user and test_user) then raise exception 'test mode required'; end if;
 update public.moa_preferences set history_reset_at=now(),generation=gen_random_uuid() where user_id=p_user;
 delete from public.moa_test_posts where user_id=p_user;
 delete from public.moa_test_accounts where user_id=p_user;
 -- Preserve accepted Google registration/deletion jobs across history resets.
end $$;
revoke all on function public.moa_reset_test_history(uuid) from public,anon,authenticated;
grant execute on function public.moa_reset_test_history(uuid) to service_role;
commit;

select position('delete from public.moa_sync_jobs' in lower(pg_get_functiondef('public.moa_reset_test_history(uuid)'::regprocedure)))=0 as preserves_calendar_jobs;
