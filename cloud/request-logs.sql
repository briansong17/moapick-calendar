begin;
create table if not exists public.moa_request_logs (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),route text not null,method text not null,
 status integer not null,duration_ms integer not null,build text not null,steps jsonb not null default '[]'
);
create index if not exists moa_request_logs_owner_time on public.moa_request_logs(user_id,created_at desc);
alter table public.moa_request_logs enable row level security;
revoke all on public.moa_request_logs from anon,authenticated;
grant select on public.moa_request_logs to authenticated;
grant all on public.moa_request_logs to service_role;
create policy own_request_logs on public.moa_request_logs for select to authenticated using(user_id=(select auth.uid()));
commit;
