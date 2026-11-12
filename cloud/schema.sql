-- Moa cloud schema. Run only in the dedicated Moa Calendar project.
-- Clients have read access through RLS; mutations go through the authenticated server.
begin;
create table if not exists public.moa_accounts (
  username text primary key check (username ~ '^[a-z0-9._]{1,30}$'),
  phase text not null default 'initial', cursor text not null default '',
  queue jsonb not null default '[]', next_cursor text, processed integer not null default 0,
  seen jsonb not null default '[]', reason text, error text,
  next_due timestamptz not null default now(), last_checked timestamptz
);
create table if not exists public.moa_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null references public.moa_accounts(username),
  enabled boolean not null default true,
  primary key(user_id,username)
);
create table if not exists public.moa_analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  account text references public.moa_accounts(username), hash text not null,
  status text not null, metadata jsonb not null, result jsonb, usage jsonb, error text,
  created_at timestamptz not null default now(),
  check ((owner_id is not null and account is null) or (owner_id is null and account is not null))
);
create index if not exists moa_analysis_hash on public.moa_analyses(hash);
create index if not exists moa_analysis_owner on public.moa_analyses(owner_id,created_at desc);
create index if not exists moa_analysis_account on public.moa_analyses(account,created_at desc);
create table if not exists public.moa_posts (
  id text primary key, username text not null references public.moa_accounts(username),
  hash text not null, payload jsonb not null, status text not null default 'pending',
  analysis_id uuid references public.moa_analyses(id) on delete set null,
  attempts integer not null default 0, error text, updated_at timestamptz not null default now()
);
create table if not exists public.moa_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null references public.moa_analyses(id) on delete cascade,
  events jsonb not null, primary key(user_id,analysis_id)
);
create table if not exists public.moa_google (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted text not null, updated_at timestamptz not null default now()
);
create table if not exists public.moa_exports (
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null references public.moa_analyses(id) on delete cascade,
  calendar_id text not null, fingerprint text not null, status text not null,
  links jsonb not null default '[]', primary key(user_id,analysis_id,calendar_id)
);
create table if not exists public.moa_oauth (
  state_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  encrypted text not null, expires_at timestamptz not null
);
create table if not exists public.moa_limits (
  bucket text primary key, count integer not null, expires_at timestamptz not null
);
create table if not exists public.moa_locks (
  name text primary key, owner uuid not null, expires_at timestamptz not null
);
-- Explicit grants: new tables are not automatically exposed in this project.
revoke all on public.moa_accounts,public.moa_subscriptions,public.moa_analyses,public.moa_posts,
  public.moa_reviews,public.moa_google,public.moa_exports,public.moa_oauth,
  public.moa_limits,public.moa_locks from anon,authenticated;
grant all on public.moa_accounts,public.moa_subscriptions,public.moa_analyses,public.moa_posts,
  public.moa_reviews,public.moa_google,public.moa_exports,public.moa_oauth,
  public.moa_limits,public.moa_locks to service_role;
grant select on public.moa_accounts,public.moa_subscriptions,public.moa_analyses,
  public.moa_reviews,public.moa_exports to authenticated;
alter table public.moa_accounts enable row level security;
alter table public.moa_subscriptions enable row level security;
alter table public.moa_analyses enable row level security;
alter table public.moa_posts enable row level security;
alter table public.moa_reviews enable row level security;
alter table public.moa_google enable row level security;
alter table public.moa_exports enable row level security;
alter table public.moa_oauth enable row level security;
alter table public.moa_limits enable row level security;
alter table public.moa_locks enable row level security;
drop policy if exists own_subscriptions on public.moa_subscriptions;
create policy own_subscriptions on public.moa_subscriptions for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists subscribed_accounts on public.moa_accounts;
create policy subscribed_accounts on public.moa_accounts for select to authenticated using(exists(
  select 1 from public.moa_subscriptions s where s.username=moa_accounts.username and s.user_id=(select auth.uid())));
drop policy if exists visible_analyses on public.moa_analyses;
create policy visible_analyses on public.moa_analyses for select to authenticated using(
  owner_id=(select auth.uid()) or (owner_id is null and exists(select 1 from public.moa_subscriptions s
    where s.username=moa_analyses.account and s.user_id=(select auth.uid()))));
drop policy if exists own_reviews on public.moa_reviews;
create policy own_reviews on public.moa_reviews for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists own_exports on public.moa_exports;
create policy own_exports on public.moa_exports for select to authenticated using(user_id=(select auth.uid()));
-- No client policy/grants for raw media payloads, tokens, OAuth states, rate limits or locks.

create or replace function public.moa_take_limit(p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_limit<1 or p_limit>1000 or p_seconds<1 or p_seconds>86400 then raise exception 'invalid limit'; end if;
  insert into public.moa_limits(bucket,count,expires_at) values(p_bucket,1,now()+make_interval(secs=>p_seconds))
  on conflict(bucket) do update set count=case when public.moa_limits.expires_at<=now() then 1 else public.moa_limits.count+1 end,
    expires_at=case when public.moa_limits.expires_at<=now() then excluded.expires_at else public.moa_limits.expires_at end
  returning count into n;
  return n<=p_limit;
end $$;
create or replace function public.moa_claim_lock(p_name text,p_owner uuid,p_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_seconds<1 or p_seconds>600 then raise exception 'invalid duration'; end if;
  insert into public.moa_locks(name,owner,expires_at) values(p_name,p_owner,now()+make_interval(secs=>p_seconds))
  on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at
    where public.moa_locks.expires_at<=now();
  get diagnostics n=row_count;return n=1;
end $$;
revoke all on function public.moa_take_limit(text,integer,integer) from public,anon,authenticated;
revoke all on function public.moa_claim_lock(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.moa_take_limit(text,integer,integer) to service_role;
grant execute on function public.moa_claim_lock(text,uuid,integer) to service_role;
commit;
