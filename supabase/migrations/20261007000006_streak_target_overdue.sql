-- #27 habit_streak делал по запросу на каждый день серии (цикл `while exists`), а вызывается
--     он для каждой привычки в summary_habits, api_habits, api_profile и digest_weekly.
--     Переписан в один оконный запрос: у подряд идущих дней разница
--     (p_today - date) - номер_строки постоянна, поэтому серия — это строки с тем же
--     значением, что у самой свежей отметки (и только если она сегодня или вчера).
--
-- #18 target_per_week хранился, редактировался и не использовался нигде: везде было
--     жёсткое `/7`. Теперь цель и прогресс недели отдаются в сводки.
--
-- #28 «Просрочено» сравнивалось по дате, а не по времени: задача «до 10:00» в 18:00
--     того же дня просроченной не считалась. Локальные 23:59 остаются «срок без времени».

create or replace function public.habit_streak(p_habit uuid, p_today date) returns int
language sql stable security definer set search_path = public as $$
  with d as (
    select (p_today - l.date) - (row_number() over (order by l.date desc) - 1)::int as gap
      from public.habit_logs l
     where l.habit_id = p_habit and l.date <= p_today),
  head as (select min(gap) as g from d)
  select coalesce((select count(*)::int from d, head where head.g <= 1 and d.gap = head.g), 0);
$$;

create or replace function public.is_overdue(p_due timestamptz, p_tz text, p_now timestamptz) returns boolean
language sql immutable as $$
  select case
           when p_due is null then false
           -- 23:59 по месту — это «срок без времени», сравниваем по дате
           when to_char(p_due at time zone p_tz, 'HH24:MI') = '23:59'
             then (p_due at time zone p_tz)::date < (p_now at time zone p_tz)::date
           else p_due < p_now
         end;
$$;

create or replace function public.summary_today(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_today date;
  v_week_start date;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  v_week_start := v_today - (extract(isodow from v_today)::int - 1);
  return jsonb_build_object(
    'base_currency', v_cur,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'time', to_char(starts_at at time zone v_tz, 'HH24:MI'),
                                          'date', v_today::text, 'with_whom', with_whom,
                                          'done', done_at is not null)
                       order by starts_at)
        from public.items
       where user_id = p_user and kind = 'event' and (starts_at at time zone v_tz)::date = v_today), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title,
                                          'due', to_char(t.due_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
                                          'overdue', public.is_overdue(t.due_at, v_tz, now()))
                       order by t.due_at)
        from (select id, title, due_at from public.items
               where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                 and (due_at at time zone v_tz)::date <= v_today
               order by due_at
               limit 20) t), '[]'::jsonb),
    'tasks_more', greatest((
      select count(*) from public.items
       where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
         and (due_at at time zone v_tz)::date <= v_today) - 20, 0),
    'spent_today', coalesce((
      select sum(amount_base) from public.transactions
       where user_id = p_user and type = 'expense' and occurred_at = v_today), 0),
    'month_spent', coalesce((
      select sum(amount_base) from public.transactions
       where user_id = p_user and type = 'expense'
         and occurred_at >= date_trunc('month', v_today)::date
         and occurred_at < (date_trunc('month', v_today) + interval '1 month')::date), 0),
    'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null),
    'habits', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name,
                                          'target_per_week', h.target_per_week,
                                          'week_done', (select count(*) from public.habit_logs l
                                                         where l.habit_id = h.id
                                                           and l.date between v_week_start and v_today),
                                          'done', exists (select 1 from public.habit_logs l
                                                           where l.habit_id = h.id and l.date = v_today))
                       order by h.created_at)
        from public.habits h
       where h.user_id = p_user and h.archived_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public.summary_tasks(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  return jsonb_build_object('total', (select count(*) from public.items
                                       where user_id = p_user and kind = 'task' and done_at is null),
                            'tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'title', t.title,
             'due', case when t.due_at is null then null else to_char(t.due_at at time zone v_tz, 'DD.MM') end,
             'overdue', public.is_overdue(t.due_at, v_tz, now()))
           order by t.due_at nulls last, t.created_at)
      from (select id, title, due_at, created_at from public.items
             where user_id = p_user and kind = 'task' and done_at is null
             order by due_at nulls last, created_at
             limit 20) t), '[]'::jsonb));
end $$;

create or replace function public.summary_habits(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_week_start date;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  v_week_start := v_today - (extract(isodow from v_today)::int - 1);
  return jsonb_build_object('habits', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id,
             'name', h.name,
             'target_per_week', h.target_per_week,
             'week', (select jsonb_agg(exists (select 1 from public.habit_logs l
                                                where l.habit_id = h.id and l.date = d::date) order by d)
                        from generate_series((v_today - 6)::timestamp, v_today::timestamp, interval '1 day') d),
             -- прогресс считаем по календарной неделе (с понедельника), как её видит человек
             'week_done', (select count(*) from public.habit_logs l
                            where l.habit_id = h.id and l.date between v_week_start and v_today),
             'done_today', exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = v_today),
             'streak', public.habit_streak(h.id, v_today))
           order by h.created_at)
      from public.habits h
     where h.user_id = p_user and h.archived_at is null), '[]'::jsonb));
end $$;

create or replace function public.api_tasks(p_user uuid, p_filter text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
begin
  if p_filter is null or p_filter not in ('today', 'upcoming', 'nodue', 'done') then
    raise exception 'bad filter';
  end if;
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object('tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id,
             'title', t.title,
             'due', case when t.due_at is null then null else to_char(t.due_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI') end,
             'overdue', t.done_at is null and public.is_overdue(t.due_at, v_tz, now()),
             'done_at', case when t.done_at is null then null else to_char(t.done_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI') end)
           order by t.ord)
      from (select i.*,
                   row_number() over (order by
                     case when p_filter = 'done' then i.done_at end desc nulls last,
                     i.due_at nulls last, i.created_at) as ord
              from public.items i
             where i.user_id = p_user and i.kind = 'task'
               and case p_filter
                     when 'today' then i.done_at is null and i.due_at is not null and (i.due_at at time zone v_tz)::date <= v_today
                     when 'upcoming' then i.done_at is null and i.due_at is not null and (i.due_at at time zone v_tz)::date > v_today
                     when 'nodue' then i.done_at is null and i.due_at is null
                     else i.done_at is not null
                   end
             order by ord
             limit 100) t), '[]'::jsonb));
end $$;

revoke execute on function
  public.habit_streak(uuid, date), public.is_overdue(timestamptz, text, timestamptz),
  public.summary_today(uuid), public.summary_tasks(uuid), public.summary_habits(uuid),
  public.api_tasks(uuid, text)
  from public, anon, authenticated;

-- #28 (продолжение): ответ бота «что не сделано» тоже считал просрочку по дате
create or replace function public.ask_open_tasks(p_user uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_day date;
  v_result jsonb;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_day := (p_now at time zone v_tz)::date;
  with pending as (
    select title, due_at, created_at,
           case when due_at is null then 'no_due'
                when public.is_overdue(due_at, v_tz, p_now) then 'overdue'
                when (due_at at time zone v_tz)::date <= v_day then 'today'
                else 'later' end as bucket
      from public.items
     where user_id = p_user and kind = 'task' and done_at is null
  ), ranked as (
    select *, case bucket when 'overdue' then 0 when 'today' then 1 when 'later' then 2 else 3 end as ord
      from pending
  )
  select jsonb_build_object(
    'overdue', (select count(*) from ranked where bucket = 'overdue'),
    'today', (select count(*) from ranked where bucket = 'today'),
    'later', (select count(*) from ranked where bucket = 'later'),
    'no_due', (select count(*) from ranked where bucket = 'no_due'),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                                'title', r.title, 'bucket', r.bucket,
                                'due', to_char(r.due_at at time zone v_tz, 'YYYY-MM-DD'))
                              order by r.ord, r.due_at, r.created_at)
                         from (select * from ranked order by ord, due_at, created_at limit 10) r), '[]'::jsonb))
    into v_result;
  return v_result;
end $$;

revoke execute on function public.ask_open_tasks(uuid, timestamptz) from public, anon, authenticated;
