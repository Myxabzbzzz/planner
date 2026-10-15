-- Подписка на календарь (Pro): встречи и дела в календаре iPhone и Google.
--
-- У каждого своя секретная ссылка на файл .ics; календарь сам перечитывает её раз в
-- несколько часов. Ссылка отдельная от токена записи с iPhone: утечёт одна — вторая цела.
-- Сбросить ссылку можно в мини-приложении. Без Pro лента отдаёт одну запись «подписка —
-- функция Pro», а не ошибку: календарь не должен ругаться, человек должен понять почему.

alter table public.users
  add column calendar_token text unique not null default encode(extensions.gen_random_bytes(24), 'hex');

-- Окно: месяц назад и полгода вперёд — хватает, и файл не растёт годами.
create function public.calendar_feed(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u public.users;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return null; end if;
  select * into u from public.users where calendar_token = p_token and is_allowed;
  if not found then return null; end if;
  return jsonb_build_object(
    'pro', coalesce(u.pro_until > now(), false),
    'tz', u.tz,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'title', i.title, 'with_whom', i.with_whom, 'done', i.done_at is not null,
               'starts_at', to_char(i.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
               'ends_at', to_char((i.starts_at + make_interval(mins => coalesce(i.duration_min, 60))) at time zone 'UTC',
                                  'YYYYMMDD"T"HH24MISS"Z"'))
             order by i.starts_at)
        from public.items i
       where i.user_id = u.id and i.kind = 'event' and i.deleted_at is null
         and i.starts_at between now() - interval '30 days' and now() + interval '183 days'), '[]'::jsonb),
    -- дела — только несделанные и со сроком; без времени — на весь день
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'title', i.title, 'has_time', i.due_has_time,
               'date', to_char(i.due_at at time zone u.tz, 'YYYYMMDD'),
               'next_date', to_char((i.due_at at time zone u.tz)::date + 1, 'YYYYMMDD'),
               'due_at', to_char(i.due_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
               'due_end', to_char((i.due_at + interval '15 minutes') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'))
             order by i.due_at)
        from public.items i
       where i.user_id = u.id and i.kind = 'task' and i.deleted_at is null and i.done_at is null
         and i.due_at between now() - interval '30 days' and now() + interval '183 days'), '[]'::jsonb));
end $$;

create function public.api_calendar(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('token', calendar_token) from public.users where id = p_user;
$$;

-- Ссылка утекла — новая; старая сразу перестаёт работать.
create function public.reset_calendar_token(p_user uuid) returns jsonb
language sql security definer set search_path = public as $$
  update public.users set calendar_token = encode(extensions.gen_random_bytes(24), 'hex')
   where id = p_user
  returning jsonb_build_object('token', calendar_token);
$$;

revoke execute on function public.calendar_feed(text), public.api_calendar(uuid), public.reset_calendar_token(uuid)
  from public, anon, authenticated;
