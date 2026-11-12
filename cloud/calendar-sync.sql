begin;
alter table public.moa_reviews add column if not exists source_indices jsonb;
alter table public.moa_exports add column if not exists source_user_id uuid;
alter table public.moa_exports add column if not exists event_ids jsonb not null default '[]';
create table if not exists public.moa_sync_jobs(
 user_id uuid not null references auth.users(id) on delete cascade,
 analysis_id uuid not null references public.moa_analyses(id) on delete cascade,
 requested_at timestamptz not null default now(), next_due timestamptz not null default now(),
 error text, attempts integer not null default 0,
 primary key(user_id,analysis_id)
);
alter table public.moa_sync_jobs enable row level security;
revoke all on public.moa_sync_jobs from anon,authenticated;
grant all on public.moa_sync_jobs to service_role;
grant select on public.moa_sync_jobs to authenticated;
drop policy if exists own_sync_jobs on public.moa_sync_jobs;
create policy own_sync_jobs on public.moa_sync_jobs for select to authenticated using(user_id=(select auth.uid()));
commit;
