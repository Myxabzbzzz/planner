-- Привычки (Pro): заморозка серии и статистика.
--
-- Заморозка — «пропустил день, но серию не теряю». Замороженный день держит цепочку,
-- но не засчитывается выполненным: недельная цель, итоги и «N подряд» честные.
-- Поэтому заморозки — отдельная таблица, а не строка в habit_logs: всё, что считает
-- отметки, остаётся как было; меняется только подсчёт серии.
-- Заморозить можно день за последнюю неделю, не больше двух в месяц на привычку.

create table public.habit_freezes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique (habit_id, date)
);
alter table public.habit_freezes enable row level security;

-- Серия: дни подряд, заканчивающиеся сегодня или вчера. Замороженные дни цепочку держат,
-- но в число не входят.
create or replace function public.habit_streak(p_habit uuid, p_today date) returns int
language sql stable security definer set search_path = public as $$
  with days as (
    select l.date, true as done from public.habit_logs l where l.habit_id = p_habit and l.date <= p_today
    union all
    select f.date, false from public.habit_freezes f
     where f.habit_id = p_habit and f.date <= p_today
       and not exists (select 1 from public.habit_logs l where l.habit_id = p_habit and l.date = f.date)),
  d as (
    select done, (p_today - date) - (row_number() over (order by date desc) - 1)::int as gap from days),
  head as (select min(gap) as g from d)
  select coalesce((select (count(*) filter (where d.done))::int from d, head where head.g <= 1 and d.gap = head.g), 0);
$$;

-- 'ok' | 'bad_date' | 'done' (день и так отмечен) | 'already' | 'limit' | 'not_found'
create function public.freeze_habit_day(p_user uuid, p_habit uuid, p_date date) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_today date;
begin
  select (now() at time zone u.tz)::date into v_today
    from public.habits h join public.users u on u.id = h.user_id
   where h.id = p_habit and h.user_id = p_user and h.archived_at is null;
  if not found then return 'not_found'; end if;
  if p_date is null or p_date > v_today or p_date < v_today - 7 then return 'bad_date'; end if;
  if exists (select 1 from public.habit_logs where habit_id = p_habit and date = p_date) then return 'done'; end if;
  if exists (select 1 from public.habit_freezes where habit_id = p_habit and date = p_date) then return 'already'; end if;
  if (select count(*) from public.habit_freezes
       where habit_id = p_habit and date_trunc('month', date) = date_trunc('month', p_date)) >= 2 then
    return 'limit';
  end if;
  insert into public.habit_freezes (user_id, habit_id, date) values (p_user, p_habit, p_date);
  return 'ok';
end $$;

create function public.unfreeze_habit_day(p_user uuid, p_habit uuid, p_date date) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.habit_freezes where user_id = p_user and habit_id = p_habit and date = p_date;
  return found;
end $$;

-- api_habits из 20261004000006 без изменений, кроме флага frozen у дня.
create or replace function public.api_habits(p_user uuid, p_weeks int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_from date;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 12 then
    raise exception 'bad weeks';
  end if;
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  v_from := v_today - (p_weeks * 7 - 1);
  return jsonb_build_object('habits', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id,
             'name', h.name,
             'target_per_week', h.target_per_week,
             'days', (select jsonb_agg(jsonb_build_object('date', d::date::text,
                                                          'done', exists (select 1 from public.habit_logs l
                                                                           where l.habit_id = h.id and l.date = d::date),
                                                          'frozen', exists (select 1 from public.habit_freezes f
                                                                             where f.habit_id = h.id and f.date = d::date))
                                       order by d)
                        from generate_series(v_from::timestamp, v_today::timestamp, interval '1 day') d),
             'streak', public.habit_streak(h.id, v_today),
             'done_today', exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = v_today))
           order by h.created_at)
      from public.habits h
     where h.user_id = p_user and h.archived_at is null), '[]'::jsonb));
end $$;

-- Статистика одной привычки: лучшая серия, выполнение за 30 и 90 дней, по дням недели.
create function public.api_habit_stats(p_user uuid, p_habit uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  h public.habits;
  v_today date;
  v_done30 int;
  v_best int;
begin
  select * into h from public.habits where id = p_habit and user_id = p_user;
  if not found then return null; end if;
  select (now() at time zone tz)::date into v_today from public.users where id = p_user;
  select count(*) into v_done30 from public.habit_logs where habit_id = p_habit and date > v_today - 30 and date <= v_today;
  with days as (
    select l.date, true as done from public.habit_logs l where l.habit_id = p_habit and l.date <= v_today
    union all
    select f.date, false from public.habit_freezes f
     where f.habit_id = p_habit and f.date <= v_today
       and not exists (select 1 from public.habit_logs l where l.habit_id = p_habit and l.date = f.date)),
  g as (select done, date - (row_number() over (order by date))::int as grp from days)
  select coalesce(max(c), 0) into v_best from (select count(*) filter (where done) as c from g group by grp) s;
  return jsonb_build_object(
    'streak', public.habit_streak(p_habit, v_today),
    'best_streak', v_best,
    'done_30', v_done30,
    -- цель «3 раза в неделю» за 30 дней — это ~13 раз, а не 30
    'rate_30', least(round(v_done30 / greatest(h.target_per_week * 30 / 7.0, 1) * 100), 100),
    'done_90', (select count(*) from public.habit_logs where habit_id = p_habit and date > v_today - 90 and date <= v_today),
    'total', (select count(*) from public.habit_logs where habit_id = p_habit),
    -- пн…вс за последние 12 недель
    'by_weekday', (select jsonb_agg(coalesce(c.n, 0) order by w.dow)
                     from generate_series(1, 7) w(dow)
                     left join (select extract(isodow from date)::int as dow, count(*) as n
                                  from public.habit_logs
                                 where habit_id = p_habit and date > v_today - 84 and date <= v_today
                                 group by 1) c on c.dow = w.dow),
    'freezes_left', greatest(2 - (select count(*) from public.habit_freezes
                                   where habit_id = p_habit
                                     and date_trunc('month', date) = date_trunc('month', v_today))::int, 0));
end $$;

revoke execute on function public.freeze_habit_day(uuid, uuid, date), public.unfreeze_habit_day(uuid, uuid, date),
  public.api_habit_stats(uuid, uuid)
  from public, anon, authenticated;
