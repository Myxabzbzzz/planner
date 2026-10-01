create extension if not exists pgcrypto with schema extensions;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  tg_id bigint unique not null,
  tg_username text,
  name text not null default '',
  tz text not null default 'Europe/Moscow',
  base_currency text check (base_currency ~ '^[A-Z]{3}$'),
  capture_token text unique not null default encode(extensions.gen_random_bytes(32), 'hex'),
  is_allowed boolean not null default false,
  is_admin boolean not null default false,
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);
create index users_tg_username_idx on public.users (tg_username);

create table public.invites (
  username text primary key,
  created_at timestamptz not null default now()
);

create table public.inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('voice', 'text', 'miniapp', 'shortcut')),
  text text,
  audio_ref text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'needs_review')),
  attempts int not null default 0,
  result jsonb not null default '{}'::jsonb,
  error text,
  reply_chat_id bigint,
  reply_message_id bigint,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  check (text is not null or audio_ref is not null)
);
create index inbox_pending_idx on public.inbox (created_at) where status = 'pending';

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  inbox_id uuid references public.inbox(id) on delete set null,
  kind text not null check (kind in ('task', 'event')),
  title text not null,
  notes text,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  done_at timestamptz,
  starts_at timestamptz,
  duration_min int check (duration_min is null or duration_min > 0),
  with_whom text,
  remind_before_min int not null default 30,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind <> 'event' or starts_at is not null)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('expense', 'income')),
  is_default boolean not null default false,
  unique (user_id, type, name)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  inbox_id uuid references public.inbox(id) on delete set null,
  type text not null check (type in ('expense', 'income')),
  amount_base numeric(18,2) not null check (amount_base > 0),
  base_currency text not null,
  amount_orig numeric(18,2),
  currency_orig text,
  fx_rate numeric(20,8),
  fx_date date,
  fx_source text,
  category_id uuid references public.categories(id) on delete set null,
  comment text not null default '',
  occurred_at date not null default current_date,
  created_at timestamptz not null default now(),
  check ((amount_orig is null) = (currency_orig is null))
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  monthly_limit numeric(18,2) not null check (monthly_limit > 0),
  unique nulls not distinct (user_id, category_id)
);

create table public.fx_rates (
  date date primary key,
  base text not null default 'USD',
  rates jsonb not null,
  source text not null,
  fetched_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  inbox_id uuid references public.inbox(id) on delete set null,
  kind text not null check (kind in ('thought', 'journal')),
  text text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  target_per_week int not null default 7 check (target_per_week between 1 and 7),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  inbox_id uuid references public.inbox(id) on delete set null,
  unique (habit_id, date)
);

create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  inbox_id uuid references public.inbox(id) on delete cascade,
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);

create table public.worker_heartbeat (
  worker_id text primary key,
  seen_at timestamptz not null default now()
);

-- RLS: каждый видит только свои строки; invites/worker_heartbeat — только service_role
alter table public.users enable row level security;
alter table public.invites enable row level security;
alter table public.fx_rates enable row level security;
alter table public.worker_heartbeat enable row level security;

create policy own_user on public.users for select to authenticated using (id = auth.uid());
create policy read_rates on public.fx_rates for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['inbox','items','categories','transactions','budgets','notes','habits','habit_logs','corrections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- RPC
create function public.onboard_user(p_user_id uuid, p_currency text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.users
     set base_currency = upper(p_currency), onboarded_at = now()
   where id = p_user_id and onboarded_at is null;
  if not found then
    raise exception 'user % not found or already onboarded', p_user_id;
  end if;
  insert into public.categories (user_id, name, type, is_default)
  select p_user_id, v.n, v.t, true
    from (values ('еда','expense'), ('кафе','expense'), ('такси/транспорт','expense'),
                 ('дом','expense'), ('связь','expense'), ('подписки','expense'),
                 ('развлечения','expense'), ('здоровье','expense'), ('другое','expense'),
                 ('зарплата','income'), ('другое','income')) as v(n, t)
  on conflict do nothing;
end $$;

create function public.claim_inbox() returns setof public.inbox
language sql security definer set search_path = public as $$
  update public.inbox i
     set status = 'processing', claimed_at = now(), attempts = i.attempts + 1
   where i.id = (select id from public.inbox
                  where status = 'pending'
                  order by created_at
                  for update skip locked
                  limit 1)
  returning i.*;
$$;

create function public.reclaim_stuck() returns int
language sql security definer set search_path = public as $$
  with r as (
    update public.inbox
       set status = case when attempts >= 3 then 'failed' else 'pending' end,
           error  = case when attempts >= 3 then 'stuck: too many attempts' else error end
     where status = 'processing' and claimed_at < now() - interval '5 minutes'
    returning 1)
  select count(*)::int from r;
$$;

create function public.worker_online() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.worker_heartbeat where seen_at > now() - interval '2 minutes');
$$;

create function public.resolve_review(p_user uuid, p_inbox uuid, p_idx int, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  entry jsonb;
begin
  select result into r from public.inbox
   where id = p_inbox and user_id = p_user and status in ('needs_review', 'pending')
   for update;
  if not found then return false; end if;
  entry := r -> 'pending_review' -> p_idx;
  if entry is null or entry ? 'forced_kind' then return false; end if;
  r := jsonb_set(r, array['pending_review', p_idx::text, 'forced_kind'], to_jsonb(p_kind));
  update public.inbox set result = r, status = 'pending', attempts = 0 where id = p_inbox;
  insert into public.corrections (user_id, inbox_id, before, after)
  values (p_user, p_inbox, entry, jsonb_build_object('kind', p_kind));
  return true;
end $$;

create function public.delete_inbox_records(p_user uuid, p_inbox uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  c int;
begin
  delete from public.items where user_id = p_user and inbox_id = p_inbox; get diagnostics c = row_count; n := n + c;
  delete from public.transactions where user_id = p_user and inbox_id = p_inbox; get diagnostics c = row_count; n := n + c;
  delete from public.notes where user_id = p_user and inbox_id = p_inbox; get diagnostics c = row_count; n := n + c;
  delete from public.habit_logs where user_id = p_user and inbox_id = p_inbox; get diagnostics c = row_count; n := n + c;
  update public.inbox set result = result || '{"deleted": true}'::jsonb where id = p_inbox and user_id = p_user;
  return n;
end $$;

revoke execute on function public.onboard_user(uuid, text), public.claim_inbox(), public.reclaim_stuck(),
  public.worker_online(), public.resolve_review(uuid, uuid, int, text), public.delete_inbox_records(uuid, uuid)
  from public, anon, authenticated;
