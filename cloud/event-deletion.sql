begin;
create table if not exists public.moa_event_deletions(
 user_id uuid not null references auth.users(id) on delete cascade,
 analysis_id uuid not null references public.moa_analyses(id) on delete cascade,
 event_index integer not null check(event_index between 0 and 99),
 created_at timestamptz not null default now(),
 primary key(user_id,analysis_id,event_index)
);
alter table public.moa_event_deletions enable row level security;
revoke all on public.moa_event_deletions from anon,authenticated;
grant all on public.moa_event_deletions to service_role;
grant select on public.moa_event_deletions to authenticated;
drop policy if exists own_event_deletions on public.moa_event_deletions;
create policy own_event_deletions on public.moa_event_deletions for select to authenticated using(user_id=(select auth.uid()));
commit;
