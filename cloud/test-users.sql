begin;
create table if not exists public.moa_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 test_user boolean not null default false,history_reset_at timestamptz,
 generation uuid not null default gen_random_uuid()
);
create table if not exists public.moa_test_accounts (like public.moa_accounts including defaults);
alter table public.moa_test_accounts add column if not exists user_id uuid not null references auth.users(id) on delete cascade;
alter table public.moa_test_accounts add primary key(user_id,username);
create table if not exists public.moa_test_posts (like public.moa_posts including defaults);
alter table public.moa_test_posts add column if not exists user_id uuid not null references auth.users(id) on delete cascade;
alter table public.moa_test_posts add primary key(user_id,id);
alter table public.moa_preferences enable row level security;
alter table public.moa_test_accounts enable row level security;
alter table public.moa_test_posts enable row level security;
revoke all on public.moa_preferences,public.moa_test_accounts,public.moa_test_posts from anon,authenticated;
grant all on public.moa_preferences,public.moa_test_accounts,public.moa_test_posts to service_role;
grant select on public.moa_preferences,public.moa_test_accounts to authenticated;
create policy own_preferences on public.moa_preferences for select to authenticated using(user_id=(select auth.uid()));
create policy own_test_accounts on public.moa_test_accounts for select to authenticated using(user_id=(select auth.uid()));
create or replace function public.moa_reset_test_history(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.moa_preferences where user_id=p_user and test_user) then raise exception 'test mode required'; end if;
 update public.moa_preferences set history_reset_at=now(),generation=gen_random_uuid() where user_id=p_user;
 delete from public.moa_test_posts where user_id=p_user;
 delete from public.moa_test_accounts where user_id=p_user;
 delete from public.moa_sync_jobs where user_id=p_user;
end $$;
revoke all on function public.moa_reset_test_history(uuid) from public,anon,authenticated;
grant execute on function public.moa_reset_test_history(uuid) to service_role;
commit;
