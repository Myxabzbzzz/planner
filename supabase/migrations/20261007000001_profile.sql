-- Профиль: сводка по всему аккаунту для мини-аппа. Только факты —
-- уровни, прогресс и награды считает клиент (miniapp/src/gamify.ts), чтобы правила
-- можно было покрыть тестами без базы.
--
-- «Активный день» — день, в который что-то произошло: закрыта задача или встреча,
-- записана операция, добавлена заметка или отмечена привычка.
-- Серия активных дней не обрывается до конца текущего дня: если сегодня пусто,
-- считаем цепочку, которая заканчивается вчера.

-- Все дни, в которые пользователь что-то сделал. Отдельная функция, чтобы
-- считать и общее число активных дней, и серию, не дублируя union.
create function public.activity_days(p_user uuid, p_tz text)
returns table (day date)
language sql stable security definer set search_path = public as $$
  select distinct d from (
    select (done_at at time zone p_tz)::date as d
      from public.items where user_id = p_user and done_at is not null
    union all
    select occurred_at from public.transactions where user_id = p_user
    union all
    select (created_at at time zone p_tz)::date
      from public.notes where user_id = p_user
    union all
    select l.date from public.habit_logs l where l.user_id = p_user
  ) s
  where d is not null;
$$;

create function public.api_profile(p_user uuid, p_months int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_name text;
  v_since date;
  v_today date;
  v_week_start date;
  v_streak int;
  v_active int;
  v_last date;
  v_anchor date;
begin
  if p_months is null or p_months < 1 or p_months > 12 then
    raise exception 'bad months';
  end if;
  select tz, base_currency, name, (created_at at time zone tz)::date
    into v_tz, v_cur, v_name, v_since
    from public.users where id = p_user;
  if not found then return null; end if;

  v_today := (now() at time zone v_tz)::date;
  v_week_start := date_trunc('week', v_today::timestamp)::date;

  select count(*), max(day) into v_active, v_last
    from public.activity_days(p_user, v_tz) where day <= v_today;

  -- Серия не обрывается до конца текущего дня: если сегодня пусто, цепочку
  -- якорим на вчера. Длина серии — позиция первого разрыва при счёте назад.
  v_anchor := case when v_last = v_today then v_today
                   when v_last = v_today - 1 then v_today - 1 end;
  if v_anchor is null then
    v_streak := 0;
  else
    with numbered as (
      select day, (row_number() over (order by day desc) - 1)::int as rn
        from public.activity_days(p_user, v_tz)
       where day <= v_anchor
    )
    select coalesce((select min(rn) from numbered where v_anchor - day <> rn),
                    (select count(*)::int from numbered))
      into v_streak;
  end if;

  return jsonb_build_object(
    'name', v_name,
    'tz', v_tz,
    'base_currency', v_cur,
    'since', v_since::text,
    'days_known', (v_today - v_since) + 1,
    'active_days', v_active,
    'active_streak', v_streak,

    'tasks', jsonb_build_object(
      'open', (select count(*) from public.items
                where user_id = p_user and kind = 'task' and done_at is null),
      'overdue', (select count(*) from public.items
                   where user_id = p_user and kind = 'task' and done_at is null
                     and due_at is not null and (due_at at time zone v_tz)::date < v_today),
      'done_total', (select count(*) from public.items
                      where user_id = p_user and kind = 'task' and done_at is not null),
      'done_30d', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is not null
                      and (done_at at time zone v_tz)::date > v_today - 30),
      'created_30d', (select count(*) from public.items
                       where user_id = p_user and kind = 'task'
                         and (created_at at time zone v_tz)::date > v_today - 30)),

    'events', jsonb_build_object(
      'total', (select count(*) from public.items where user_id = p_user and kind = 'event'),
      'done_total', (select count(*) from public.items
                      where user_id = p_user and kind = 'event' and done_at is not null),
      'next_7d', (select count(*) from public.items
                   where user_id = p_user and kind = 'event' and done_at is null
                     and (starts_at at time zone v_tz)::date between v_today and v_today + 7)),

    'habits', jsonb_build_object(
      'active', (select count(*) from public.habits
                  where user_id = p_user and archived_at is null),
      'best_streak', coalesce((select max(public.habit_streak(h.id, v_today))
                                 from public.habits h
                                where h.user_id = p_user and h.archived_at is null), 0),
      'logs_total', (select count(*) from public.habit_logs where user_id = p_user),
      'week_done', (select count(*) from public.habit_logs l
                      join public.habits h on h.id = l.habit_id
                     where l.user_id = p_user and h.archived_at is null
                       and l.date between v_week_start and v_today),
      'week_target', coalesce((select sum(target_per_week) from public.habits
                                where user_id = p_user and archived_at is null), 0)),

    'notes', jsonb_build_object(
      'total', (select count(*) from public.notes where user_id = p_user),
      'thoughts', (select count(*) from public.notes where user_id = p_user and kind = 'thought'),
      'journals', (select count(*) from public.notes where user_id = p_user and kind = 'journal'),
      'd30', (select count(*) from public.notes
               where user_id = p_user and (created_at at time zone v_tz)::date > v_today - 30)),

    -- Сколько раз ИИ разобрал запись сам, а сколько пришлось уточнять.
    'captures', jsonb_build_object(
      'total', (select count(*) from public.inbox where user_id = p_user),
      'done', (select count(*) from public.inbox where user_id = p_user and status = 'done'),
      'needs_review', (select count(*) from public.inbox where user_id = p_user and status = 'needs_review'),
      'failed', (select count(*) from public.inbox where user_id = p_user and status = 'failed')),

    'money', jsonb_build_object(
      'limit', (select monthly_limit from public.budgets
                 where user_id = p_user and category_id is null),
      'months', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(m.start, 'YYYY-MM'),
                 'expense', coalesce((select sum(amount_base) from public.transactions
                                       where user_id = p_user and type = 'expense'
                                         and occurred_at >= m.start::date
                                         and occurred_at < (m.start + interval '1 month')::date), 0),
                 'income', coalesce((select sum(amount_base) from public.transactions
                                      where user_id = p_user and type = 'income'
                                        and occurred_at >= m.start::date
                                        and occurred_at < (m.start + interval '1 month')::date), 0))
                 order by m.start)
          from generate_series(
                 date_trunc('month', v_today::timestamp) - ((p_months - 1) || ' month')::interval,
                 date_trunc('month', v_today::timestamp),
                 interval '1 month') m(start)), '[]'::jsonb)),

    -- 12 недель: сколько задач закрыто и сколько появилось.
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', w.start::date::text,
               'done', (select count(*) from public.items
                         where user_id = p_user and kind = 'task' and done_at is not null
                           and (done_at at time zone v_tz)::date >= w.start::date
                           and (done_at at time zone v_tz)::date < (w.start + interval '7 day')::date),
               'created', (select count(*) from public.items
                            where user_id = p_user and kind = 'task'
                              and (created_at at time zone v_tz)::date >= w.start::date
                              and (created_at at time zone v_tz)::date < (w.start + interval '7 day')::date))
               order by w.start)
        from generate_series(
               date_trunc('week', v_today::timestamp) - interval '11 week',
               date_trunc('week', v_today::timestamp),
               interval '1 week') w(start)), '[]'::jsonb),

    -- 84 дня: сколько привычек отмечено из сколько активных.
    'heat', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d::date::text,
               'done', (select count(*) from public.habit_logs l
                          join public.habits h on h.id = l.habit_id
                         where l.user_id = p_user and h.archived_at is null and l.date = d::date))
               order by d)
        from generate_series((v_today - 83)::timestamp, v_today::timestamp, interval '1 day') d), '[]'::jsonb),
    'heat_total', (select count(*) from public.habits where user_id = p_user and archived_at is null)
  );
end $$;

revoke execute on function public.activity_days(uuid, text), public.api_profile(uuid, int)
  from public, anon, authenticated;
