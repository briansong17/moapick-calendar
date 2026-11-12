begin;
create table if not exists public.moa_sessions (
 id text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 encrypted text not null,created_at timestamptz not null default now(),expires_at timestamptz not null
);
alter table public.moa_sessions enable row level security;
revoke all on public.moa_sessions from anon,authenticated;
grant all on public.moa_sessions to service_role;
create index if not exists moa_sessions_expiry on public.moa_sessions(expires_at);
commit;
