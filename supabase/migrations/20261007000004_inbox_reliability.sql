-- Надёжность очереди разбора.
--
-- #13 идемпотентность: Telegram повторяет апдейт при таймауте вебхука, а update_id нигде
--     не запоминался — пользователь получал два «Разбираю…» и две записи (трата дважды).
-- #11 failed был тупиком: ни кнопки «повторить», ни способа вернуть строку в pending.
-- #8  needs_review жил вечно: вопросы никто не переспрашивал.
-- #10 очередь была невидимой и неотменяемой: за неделю сна Mac'а копились десятки записей.

-- ---------- #13 ----------

create table public.tg_updates (
  update_id bigint primary key,
  seen_at timestamptz not null default now()
);
alter table public.tg_updates enable row level security;

-- true — апдейт новый и его надо обработать; false — он уже был.
create function public.record_update(p_update_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_update_id is null then return true; end if;  -- нет id — обрабатываем как обычно
  insert into public.tg_updates (update_id) values (p_update_id);
  return true;
exception when unique_violation then
  return false;
end $$;

create function public.purge_tg_updates(p_now timestamptz default now()) returns int
language sql security definer set search_path = public as $$
  with d as (delete from public.tg_updates where seen_at < p_now - interval '2 days' returning 1)
  select count(*)::int from d;
$$;

-- ---------- #11 ----------

create function public.retry_inbox(p_user uuid, p_inbox uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.inbox
     set status = 'pending', attempts = 0, error = null, notified_at = null, claimed_at = null
   where id = p_inbox and user_id = p_user and status = 'failed';
  return found;
end $$;

-- ---------- #10 ----------

alter table public.inbox add column review_pinged_at timestamptz;
alter table public.users add column queue_warned_at timestamptz;

-- Отмена: строка больше не попадёт воркеру, но и не исчезает — видно, что её отменили.
create function public.cancel_inbox(p_user uuid, p_inbox uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
begin
  select result into r from public.inbox
   where id = p_inbox and user_id = p_user and status in ('pending', 'needs_review', 'failed')
   for update;
  if not found then return false; end if;
  -- вопросы снимаем, чтобы воркер не считал их открытыми и не переспрашивал
  if jsonb_typeof(r -> 'pending_review') = 'array' then
    r := jsonb_set(r, '{pending_review}', (
      select coalesce(jsonb_agg(e || '{"resolved": true}'::jsonb), '[]'::jsonb)
        from jsonb_array_elements(r -> 'pending_review') e));
  end if;
  update public.inbox
     set status = 'done',
         result = r || '{"cancelled": true}'::jsonb,
         notified_at = now()
   where id = p_inbox;
  return true;
end $$;

create function public.inbox_queue(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'waiting', count(*) filter (where status in ('pending', 'processing')),
    'needs_review', count(*) filter (where status = 'needs_review'),
    'failed', count(*) filter (where status = 'failed'),
    'oldest', min(created_at) filter (where status in ('pending', 'processing')))
    from public.inbox where user_id = p_user;
$$;

-- ---------- #8: переспросить незакрытые уточнения ----------

create function public.stale_reviews(p_now timestamptz default now())
returns table (inbox_id uuid, user_id uuid, chat_id bigint, pending int, sample text)
language sql stable security definer set search_path = public as $$
  select q.* from (
    select i.id, i.user_id, coalesce(i.reply_chat_id, u.tg_id),
           (select count(*)::int from jsonb_array_elements(i.result -> 'pending_review') e
             where not (e ? 'forced_kind')),
           (select e -> 'item' ->> 'source_text' from jsonb_array_elements(i.result -> 'pending_review') e
             where not (e ? 'forced_kind') limit 1)
      from public.inbox i
      join public.users u on u.id = i.user_id
     where i.status = 'needs_review'
       and jsonb_typeof(i.result -> 'pending_review') = 'array'
       and i.created_at < p_now - interval '3 hours'
       and (i.review_pinged_at is null or i.review_pinged_at < p_now - interval '20 hours')
       and u.is_allowed and u.onboarded_at is not null
     order by i.created_at
     limit 50
  ) q(inbox_id, user_id, chat_id, pending, sample)
  where q.pending > 0;
$$;

create function public.mark_review_pinged(p_inbox uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.inbox set review_pinged_at = now() where id = any(p_inbox);
$$;

-- ---------- #10: сказать, что ИИ спит и сколько накопилось ----------

create function public.sleeping_queues(p_now timestamptz default now())
returns table (user_id uuid, chat_id bigint, queued int, oldest_hours int)
language sql stable security definer set search_path = public as $$
  select q.* from (
    select u.id, coalesce(max(i.reply_chat_id), u.tg_id), count(*)::int,
           floor(extract(epoch from (p_now - min(i.created_at))) / 3600)::int
      from public.inbox i
      join public.users u on u.id = i.user_id
     where i.status in ('pending', 'processing')
       and u.is_allowed and u.onboarded_at is not null
       and (u.queue_warned_at is null or u.queue_warned_at < p_now - interval '12 hours')
     group by u.id, u.tg_id
     limit 50
  ) q(user_id, chat_id, queued, oldest_hours)
  where q.oldest_hours >= 6;
$$;

create function public.mark_queue_warned(p_users uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.users set queue_warned_at = now() where id = any(p_users);
$$;

revoke execute on function
  public.record_update(bigint), public.purge_tg_updates(timestamptz),
  public.retry_inbox(uuid, uuid), public.cancel_inbox(uuid, uuid), public.inbox_queue(uuid),
  public.stale_reviews(timestamptz), public.mark_review_pinged(uuid[]),
  public.sleeping_queues(timestamptz), public.mark_queue_warned(uuid[])
  from public, anon, authenticated;
