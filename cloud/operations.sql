begin;
alter table public.moa_request_logs add column if not exists device_id uuid;
alter table public.moa_request_logs add column if not exists kind text;
alter table public.moa_request_logs add column if not exists browser text;
alter table public.moa_request_logs add column if not exists phase text not null default 'complete';
create table if not exists public.moa_devices(
 user_id uuid not null references auth.users(id) on delete cascade,device_id uuid not null,
 last_seen timestamptz not null,kind text not null,browser text not null,view text not null,
 events jsonb not null default '[]',primary key(user_id,device_id)
);
alter table public.moa_devices enable row level security;
revoke all on public.moa_devices from anon,authenticated;
grant all on public.moa_devices to service_role;
create index if not exists moa_devices_seen on public.moa_devices(last_seen desc);
commit;
