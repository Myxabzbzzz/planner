create function public.resolve_time(p_user uuid, p_inbox uuid, p_idx int, p_choice text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  entry jsonb;
  v_kind text;
  v_time text;
begin
  if p_idx < 0 or p_choice is null or p_choice !~ '^(([01][0-9]|2[0-3])[0-5][0-9]|none|drop)$' then
    return false;
  end if;
  select result into r from public.inbox
   where id = p_inbox and user_id = p_user and status in ('needs_review', 'pending')
   for update;
  if not found then return false; end if;
  entry := r -> 'pending_review' -> p_idx;
  if entry is null or entry ? 'forced_kind' then return false; end if;
  if p_choice = 'drop' then
    v_kind := 'drop';
  elsif p_choice = 'none' then
    v_kind := 'task';
  else
    v_kind := 'event';
    v_time := substr(p_choice, 1, 2) || ':' || substr(p_choice, 3, 2);
  end if;
  r := jsonb_set(r, array['pending_review', p_idx::text, 'forced_kind'], to_jsonb(v_kind));
  if v_time is not null then
    r := jsonb_set(r, array['pending_review', p_idx::text, 'forced_time'], to_jsonb(v_time));
  end if;
  update public.inbox set result = r, status = 'pending', attempts = 0 where id = p_inbox;
  insert into public.corrections (user_id, inbox_id, before, after)
  values (p_user, p_inbox, entry, jsonb_build_object('kind', v_kind, 'time', v_time));
  return true;
end $$;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('shortcut_file')),
  chat_id bigint not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index jobs_pending_idx on public.jobs (created_at) where status = 'pending';
alter table public.jobs enable row level security;

create function public.claim_job() returns setof public.jobs
language sql security definer set search_path = public as $$
  update public.jobs j
     set status = 'processing', claimed_at = now(), attempts = j.attempts + 1
   where j.id = (select id from public.jobs
                  where status = 'pending'
                  order by created_at
                  for update skip locked
                  limit 1)
  returning j.*;
$$;

create or replace function public.reclaim_stuck() returns int
language sql security definer set search_path = public as $$
  with r as (
    update public.inbox
       set status = case when attempts >= 3 then 'failed' else 'pending' end,
           error  = case when attempts >= 3 then 'stuck: too many attempts' else error end
     where status = 'processing' and claimed_at < now() - interval '5 minutes'
    returning 1),
  j as (
    update public.jobs
       set status = case when attempts >= 3 then 'failed' else 'pending' end,
           error  = case when attempts >= 3 then 'stuck: too many attempts' else error end
     where status = 'processing' and claimed_at < now() - interval '5 minutes'
    returning 1)
  select ((select count(*) from r) + (select count(*) from j))::int;
$$;

revoke execute on function public.resolve_time(uuid, uuid, int, text), public.claim_job(), public.reclaim_stuck()
  from public, anon, authenticated;
