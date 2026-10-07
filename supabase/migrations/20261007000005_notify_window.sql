-- #14 Задачи со сроком никогда не напоминали: due_reminders выбирал только kind = 'event',
--     а items.remind_before_min для задач заполнялся дефолтом 30 и не использовался.
--     Теперь: задача с реальным временем — за remind_before_min до срока, как встреча;
--     задача без времени (локальные 23:59 = «до пятницы») — утром дня срока, в 09:00.
--
-- #15 Дайджесты терялись при любом простое: условие `local_ts::time >= '21:30'` без верхней
--     границы + «текущая локальная дата» внутри digest_daily давали пустые «Итоги дня»
--     за новый день в 00:30, а итоги прошедшего исчезали. Недельный при простое с вечера
--     воскресенья пропадал на всю неделю.
--     Теперь: вечернее окно 21:30–23:59 плюс утренний догон (до 09:00 — за вчера,
--     в понедельник до 12:00 — за прошедшее воскресенье), и день дайджеста передаётся
--     в digest_daily/digest_weekly явным параметром.

-- ---------- #14 ----------

drop function public.due_reminders(timestamptz);
create function public.due_reminders(p_now timestamptz default now())
returns table (item_id uuid, chat_id bigint, kind text, title text, local_time text, minutes_left int)
language sql stable security definer set search_path = public as $$
  select c.id, c.tg_id, c.kind, c.title,
         case when c.kind = 'task' and c.hhmm = '23:59' then null else c.hhmm end,
         greatest(1, ceil(extract(epoch from (c.at - p_now)) / 60))::int
    from (
      select i.id, u.tg_id, i.kind, i.title, u.tz, i.remind_before_min,
             coalesce(i.starts_at, i.due_at) as at,
             to_char(coalesce(i.starts_at, i.due_at) at time zone u.tz, 'HH24:MI') as hhmm,
             (p_now at time zone u.tz) as local_now
        from public.items i
        join public.users u on u.id = i.user_id
       where i.reminded_at is null and i.done_at is null
         and coalesce(i.starts_at, i.due_at) is not null
         and u.is_allowed and u.onboarded_at is not null and u.notify_reminders
    ) c
   where case
           when c.kind = 'task' and c.hhmm = '23:59'
             then (c.at at time zone c.tz)::date = c.local_now::date and c.local_now::time >= time '09:00'
           else c.at > p_now and c.at - make_interval(mins => c.remind_before_min) <= p_now
         end
   order by c.at
   limit 200;
$$;

-- ---------- #15 ----------

drop function public.due_digests(timestamptz);
create function public.due_digests(p_now timestamptz default now())
returns table (user_id uuid, chat_id bigint, kind text, local_date date)
language sql stable security definer set search_path = public as $$
  with u as (
    select id, tg_id, (p_now at time zone tz) as local_ts,
           notify_daily, notify_weekly, last_daily_on, last_weekly_on
      from public.users
     where is_allowed and onboarded_at is not null)
  select u.id, u.tg_id, 'daily'::text, d.day
    from u, lateral (select case
             when u.local_ts::time between time '21:30' and time '23:59:59' then u.local_ts::date
             when u.local_ts::time < time '09:00' then u.local_ts::date - 1  -- догон за вчера
           end as day) d
   where u.notify_daily and d.day is not null
     and (u.last_daily_on is null or u.last_daily_on < d.day)
  union all
  select u.id, u.tg_id, 'weekly'::text, w.day
    from u, lateral (select case
             when extract(isodow from u.local_ts) = 7
                  and u.local_ts::time between time '21:30' and time '23:59:59' then u.local_ts::date
             when extract(isodow from u.local_ts) = 1
                  and u.local_ts::time < time '12:00' then u.local_ts::date - 1  -- догон за воскресенье
           end as day) w
   where u.notify_weekly and w.day is not null
     and (u.last_weekly_on is null or u.last_weekly_on < w.day)
   order by 1, 3;
$$;

-- Дайджест считается за конкретный день, а не «за сегодня»: иначе догон врёт.
drop function public.digest_daily(uuid, timestamptz);
create function public.digest_daily(p_user uuid, p_day date default null, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_day date;
  v_end timestamptz;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_day := coalesce(p_day, (p_now at time zone v_tz)::date);
  -- «встреча прошла» считаем по концу того дня, за который делаем сводку
  v_end := least(p_now, ((v_day + 1)::timestamp) at time zone v_tz);
  return jsonb_build_object(
    'date', v_day::text,
    'base_currency', v_cur,
    'tasks_done', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is not null
                      and (done_at at time zone v_tz)::date = v_day),
    'events_done', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and (starts_at at time zone v_tz)::date = v_day
                       and done_at is not null),
    'events_past', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and (starts_at at time zone v_tz)::date = v_day
                       and done_at is null and starts_at <= v_end),
    'tasks_left', coalesce((select jsonb_agg(t.title order by t.due_at)
                              from (select title, due_at from public.items
                                     where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                                       and (due_at at time zone v_tz)::date <= v_day
                                     order by due_at limit 5) t), '[]'::jsonb),
    'tasks_left_more', greatest((select count(*) from public.items
                                  where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                                    and (due_at at time zone v_tz)::date <= v_day) - 5, 0),
    'spent', coalesce((select sum(amount_base) from public.transactions
                        where user_id = p_user and type = 'expense' and occurred_at = v_day), 0),
    'month_spent', coalesce((select sum(amount_base) from public.transactions
                              where user_id = p_user and type = 'expense'
                                and occurred_at >= date_trunc('month', v_day)::date
                                and occurred_at < (date_trunc('month', v_day) + interval '1 month')::date), 0),
    'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null),
    'habits', coalesce((select jsonb_agg(jsonb_build_object(
                                 'name', h.name,
                                 'done', exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = v_day))
                               order by h.created_at)
                          from public.habits h where h.user_id = p_user and h.archived_at is null), '[]'::jsonb),
    'tomorrow_events', coalesce((select jsonb_agg(jsonb_build_object('time', to_char(e.starts_at at time zone v_tz, 'HH24:MI'),
                                                                      'title', e.title) order by e.starts_at)
                                   from (select title, starts_at from public.items
                                          where user_id = p_user and kind = 'event' and done_at is null
                                            and (starts_at at time zone v_tz)::date = v_day + 1
                                          order by starts_at limit 5) e), '[]'::jsonb),
    'tomorrow_tasks', (select count(*) from public.items
                        where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                          and (due_at at time zone v_tz)::date = v_day + 1)
  );
end $$;

drop function public.digest_weekly(uuid, timestamptz);
create function public.digest_weekly(p_user uuid, p_day date default null, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_day date;
  v_from date;
  v_end timestamptz;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_day := coalesce(p_day, (p_now at time zone v_tz)::date);
  v_from := v_day - (extract(isodow from v_day)::int - 1);
  v_end := least(p_now, ((v_day + 1)::timestamp) at time zone v_tz);
  return jsonb_build_object(
    'from', v_from::text,
    'to', v_day::text,
    'base_currency', v_cur,
    'expense', coalesce((select sum(amount_base) from public.transactions
                          where user_id = p_user and type = 'expense' and occurred_at between v_from and v_day), 0),
    'prev_expense', coalesce((select sum(amount_base) from public.transactions
                               where user_id = p_user and type = 'expense' and occurred_at between v_from - 7 and v_from - 1), 0),
    'income', coalesce((select sum(amount_base) from public.transactions
                         where user_id = p_user and type = 'income' and occurred_at between v_from and v_day), 0),
    'top_categories', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount) order by s.amount desc)
                                  from (select coalesce(c.name, 'другое') as name, sum(t.amount_base) as amount
                                          from public.transactions t left join public.categories c on c.id = t.category_id
                                         where t.user_id = p_user and t.type = 'expense' and t.occurred_at between v_from and v_day
                                         group by 1 order by 2 desc limit 3) s), '[]'::jsonb),
    'tasks_done', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is not null
                      and (done_at at time zone v_tz)::date between v_from and v_day),
    'events_done', (select count(*) from public.items
                     where user_id = p_user and kind = 'event'
                       and (starts_at at time zone v_tz)::date between v_from and v_day
                       and done_at is not null),
    'events_past', (select count(*) from public.items
                     where user_id = p_user and kind = 'event'
                       and (starts_at at time zone v_tz)::date between v_from and v_day
                       and done_at is null and starts_at <= v_end),
    -- #18: неделя считается против цели привычки, а не против жёсткой семёрки
    'habits', coalesce((select jsonb_agg(jsonb_build_object(
                                 'name', h.name,
                                 'target', h.target_per_week,
                                 'done_days', (select count(*) from public.habit_logs l
                                                where l.habit_id = h.id and l.date between v_from and v_day),
                                 'streak', public.habit_streak(h.id, v_day))
                               order by h.created_at)
                          from public.habits h where h.user_id = p_user and h.archived_at is null), '[]'::jsonb),
    'next_events', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and done_at is null
                       and (starts_at at time zone v_tz)::date between v_day + 1 and v_day + 7),
    'next_tasks', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                      and (due_at at time zone v_tz)::date between v_day + 1 and v_day + 7)
  );
end $$;

revoke execute on function
  public.due_reminders(timestamptz), public.due_digests(timestamptz),
  public.digest_daily(uuid, date, timestamptz), public.digest_weekly(uuid, date, timestamptz)
  from public, anon, authenticated;
