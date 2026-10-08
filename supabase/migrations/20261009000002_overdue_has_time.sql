-- «Просрочено» должно смотреть на флаг, а не на 23:59.
--
-- items.due_has_time появился, и задачу ровно на 23:59 теперь поставить можно,
-- но is_overdue по-прежнему считала такое время признаком «срока без времени».
-- Следствие: настоящий дедлайн 23:59 становился просроченным только на следующий
-- день — ровно то, от чего уходили, вводя флаг.
--
-- Старая трёхаргументная версия остаётся: её зовут места, где флага нет под рукой,
-- и там прежнее соглашение — честная страховка.

create or replace function public.is_overdue(
  p_due timestamptz, p_tz text, p_now timestamptz, p_has_time boolean
) returns boolean
language sql immutable as $$
  select case
           when p_due is null then false
           -- срок без времени истекает в конце своего дня, а не в момент
           when not coalesce(p_has_time, false)
             then (p_due at time zone p_tz)::date < (p_now at time zone p_tz)::date
           else p_due < p_now
         end;
$$;

-- Три функции чтения, которые отдают клиенту поле overdue.
create or replace function public.api_tasks(p_user uuid, p_filter text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_total int;
begin
  if p_filter is null or p_filter not in ('today', 'upcoming', 'nodue', 'done') then
    raise exception 'bad filter';
  end if;
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;

  select count(*) into v_total
    from public.items i
   where i.user_id = p_user and i.kind = 'task' and i.deleted_at is null
     and case p_filter
           when 'today' then i.done_at is null and i.due_at is not null
             and (i.due_at at time zone v_tz)::date <= v_today
           when 'upcoming' then i.done_at is null and i.due_at is not null
             and (i.due_at at time zone v_tz)::date > v_today
           when 'nodue' then i.done_at is null and i.due_at is null
           else i.done_at is not null
         end;

  return jsonb_build_object('total', v_total, 'tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id,
             'title', t.title,
             'due', case when t.due_at is null then null
                         else to_char(t.due_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI') end,
             'due_has_time', t.due_has_time,
             'overdue', t.done_at is null and public.is_overdue(t.due_at, v_tz, now(), t.due_has_time),
             'done_at', case when t.done_at is null then null
                             else to_char(t.done_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI') end)
           order by t.ord)
      from (select i.*,
                   row_number() over (order by
                     case when p_filter = 'done' then i.done_at end desc nulls last,
                     i.due_at nulls last, i.created_at) as ord
              from public.items i
             where i.user_id = p_user and i.kind = 'task' and i.deleted_at is null
               and case p_filter
                     when 'today' then i.done_at is null and i.due_at is not null
                       and (i.due_at at time zone v_tz)::date <= v_today
                     when 'upcoming' then i.done_at is null and i.due_at is not null
                       and (i.due_at at time zone v_tz)::date > v_today
                     when 'nodue' then i.done_at is null and i.due_at is null
                     else i.done_at is not null
                   end
             order by ord
             limit 100) t), '[]'::jsonb));
end $$;


-- Остальные читатели поля overdue. Тела взяты из 20261008000003_reads.sql
-- без изменений, кроме передачи флага — чтобы «просрочено» значило одно и то же
-- в миниаппе, в боте и в ответах на вопросы.

create or replace function public.summary_tasks(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  return jsonb_build_object('total', (select count(*) from public.items
                                       where user_id = p_user and kind = 'task' and done_at is null
                                         and deleted_at is null),
                            'tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'title', t.title,
             'due', case when t.due_at is null then null else to_char(t.due_at at time zone v_tz, 'DD.MM') end,
             'due_has_time', t.due_has_time,
             'overdue', public.is_overdue(t.due_at, v_tz, now(), t.due_has_time))
           order by t.due_at nulls last, t.created_at)
      from (select id, title, due_at, due_has_time, created_at from public.items
             where user_id = p_user and kind = 'task' and done_at is null and deleted_at is null
             order by due_at nulls last, created_at
             limit 20) t), '[]'::jsonb));
end $$;

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
       where user_id = p_user and kind = 'event' and deleted_at is null
         and (starts_at at time zone v_tz)::date = v_today), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title,
                                          'due', to_char(t.due_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
                                          'due_has_time', t.due_has_time,
                                          'overdue', public.is_overdue(t.due_at, v_tz, now(), t.due_has_time))
                       order by t.due_at)
        from (select id, title, due_at, due_has_time from public.items
               where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                 and deleted_at is null
                 and (due_at at time zone v_tz)::date <= v_today
               order by due_at
               limit 20) t), '[]'::jsonb),
    'tasks_more', greatest((
      select count(*) from public.items
       where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
         and deleted_at is null
         and (due_at at time zone v_tz)::date <= v_today) - 20, 0),
    'spent_today', coalesce((
      select sum(amount_base) from public.transactions
       where user_id = p_user and type = 'expense' and deleted_at is null and occurred_at = v_today), 0),
    'month_spent', coalesce((
      select sum(amount_base) from public.transactions
       where user_id = p_user and type = 'expense' and deleted_at is null
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

create or replace function public.summary_money(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_start date;
  v_end date;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_start := date_trunc('month', (now() at time zone v_tz)::date)::date;
  v_end := (v_start + interval '1 month')::date;
  return jsonb_build_object(
    'base_currency', v_cur,
    'month', to_char(v_start, 'MM.YYYY'),
    'expense', coalesce((select sum(amount_base) from public.transactions
                          where user_id = p_user and type = 'expense' and deleted_at is null
                            and occurred_at >= v_start and occurred_at < v_end), 0),
    'income', coalesce((select sum(amount_base) from public.transactions
                         where user_id = p_user and type = 'income' and deleted_at is null
                           and occurred_at >= v_start and occurred_at < v_end), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount) order by s.amount desc)
        from (select coalesce(c.name, 'другое') as name, sum(t.amount_base) as amount
                from public.transactions t
                left join public.categories c on c.id = t.category_id
               where t.user_id = p_user and t.type = 'expense' and t.deleted_at is null
                 and t.occurred_at >= v_start and t.occurred_at < v_end
               group by 1) s), '[]'::jsonb),
    'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null)
  );
end $$;

create or replace function public.digest_daily(p_user uuid, p_day date default null, p_now timestamptz default now())
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
  v_end := least(p_now, ((v_day + 1)::timestamp) at time zone v_tz);
  return jsonb_build_object(
    'date', v_day::text,
    'base_currency', v_cur,
    'tasks_done', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is not null and deleted_at is null
                      and (done_at at time zone v_tz)::date = v_day),
    'events_done', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and deleted_at is null
                       and (starts_at at time zone v_tz)::date = v_day
                       and done_at is not null),
    'events_past', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and deleted_at is null
                       and (starts_at at time zone v_tz)::date = v_day
                       and done_at is null and starts_at <= v_end),
    'tasks_left', coalesce((select jsonb_agg(t.title order by t.due_at)
                              from (select title, due_at from public.items
                                     where user_id = p_user and kind = 'task' and done_at is null
                                       and due_at is not null and deleted_at is null
                                       and (due_at at time zone v_tz)::date <= v_day
                                     order by due_at limit 5) t), '[]'::jsonb),
    'tasks_left_more', greatest((select count(*) from public.items
                                  where user_id = p_user and kind = 'task' and done_at is null
                                    and due_at is not null and deleted_at is null
                                    and (due_at at time zone v_tz)::date <= v_day) - 5, 0),
    'spent', coalesce((select sum(amount_base) from public.transactions
                        where user_id = p_user and type = 'expense' and deleted_at is null
                          and occurred_at = v_day), 0),
    'month_spent', coalesce((select sum(amount_base) from public.transactions
                              where user_id = p_user and type = 'expense' and deleted_at is null
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
                                            and deleted_at is null
                                            and (starts_at at time zone v_tz)::date = v_day + 1
                                          order by starts_at limit 5) e), '[]'::jsonb),
    'tomorrow_tasks', (select count(*) from public.items
                        where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                          and deleted_at is null
                          and (due_at at time zone v_tz)::date = v_day + 1)
  );
end $$;

create or replace function public.digest_weekly(p_user uuid, p_day date default null, p_now timestamptz default now())
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
                          where user_id = p_user and type = 'expense' and deleted_at is null
                            and occurred_at between v_from and v_day), 0),
    'prev_expense', coalesce((select sum(amount_base) from public.transactions
                               where user_id = p_user and type = 'expense' and deleted_at is null
                                 and occurred_at between v_from - 7 and v_from - 1), 0),
    'income', coalesce((select sum(amount_base) from public.transactions
                         where user_id = p_user and type = 'income' and deleted_at is null
                           and occurred_at between v_from and v_day), 0),
    'top_categories', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount) order by s.amount desc)
                                  from (select coalesce(c.name, 'другое') as name, sum(t.amount_base) as amount
                                          from public.transactions t left join public.categories c on c.id = t.category_id
                                         where t.user_id = p_user and t.type = 'expense' and t.deleted_at is null
                                           and t.occurred_at between v_from and v_day
                                         group by 1 order by 2 desc limit 3) s), '[]'::jsonb),
    'tasks_done', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is not null and deleted_at is null
                      and (done_at at time zone v_tz)::date between v_from and v_day),
    'events_done', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and deleted_at is null
                       and (starts_at at time zone v_tz)::date between v_from and v_day
                       and done_at is not null),
    'events_past', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and deleted_at is null
                       and (starts_at at time zone v_tz)::date between v_from and v_day
                       and done_at is null and starts_at <= v_end),
    'habits', coalesce((select jsonb_agg(jsonb_build_object(
                                 'name', h.name,
                                 'target', h.target_per_week,
                                 'done_days', (select count(*) from public.habit_logs l
                                                where l.habit_id = h.id and l.date between v_from and v_day),
                                 'streak', public.habit_streak(h.id, v_day))
                               order by h.created_at)
                          from public.habits h where h.user_id = p_user and h.archived_at is null), '[]'::jsonb),
    'next_events', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and done_at is null and deleted_at is null
                       and (starts_at at time zone v_tz)::date between v_day + 1 and v_day + 7),
    'next_tasks', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                      and deleted_at is null
                      and (due_at at time zone v_tz)::date between v_day + 1 and v_day + 7)
  );
end $$;

-- #32: напоминания больше не гадают по 23:59, а читают флаг.
create or replace function public.due_reminders(p_now timestamptz default now())
returns table(item_id uuid, chat_id bigint, kind text, title text, local_time text, minutes_left int)
language sql stable security definer set search_path = public as $$
  select c.id, c.tg_id, c.kind, c.title,
         case when c.kind = 'task' and not c.has_time then null else c.hhmm end,
         greatest(1, ceil(extract(epoch from (c.at - p_now)) / 60))::int
    from (
      select i.id, u.tg_id, i.kind, i.title, u.tz, i.remind_before_min,
             coalesce(i.starts_at, i.due_at) as at,
             to_char(coalesce(i.starts_at, i.due_at) at time zone u.tz, 'HH24:MI') as hhmm,
             i.due_has_time as has_time,
             (p_now at time zone u.tz) as local_now
        from public.items i
        join public.users u on u.id = i.user_id
       where i.reminded_at is null and i.done_at is null and i.deleted_at is null
         and coalesce(i.starts_at, i.due_at) is not null
         and u.is_allowed and u.onboarded_at is not null and u.notify_reminders
    ) c
   where case
           when c.kind = 'task' and not c.has_time
             then (c.at at time zone c.tz)::date = c.local_now::date and c.local_now::time >= time '09:00'
           else c.at > p_now and c.at - make_interval(mins => c.remind_before_min) <= p_now
         end
   order by c.at
   limit 200;
$$;

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
    select title, due_at, due_has_time, created_at,
           case when due_at is null then 'no_due'
                when public.is_overdue(due_at, v_tz, p_now, due_has_time) then 'overdue'
                when (due_at at time zone v_tz)::date <= v_day then 'today'
                else 'later' end as bucket
      from public.items
     where user_id = p_user and kind = 'task' and done_at is null and deleted_at is null
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

create or replace function public.ask_sum(p_user uuid, p_type text, p_from date, p_to date, p_category uuid default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('total', coalesce(sum(amount_base), 0), 'count', count(*))
    from public.transactions
   where user_id = p_user and type = p_type and deleted_at is null
     and (p_from is null or occurred_at >= p_from)
     and (p_to is null or occurred_at < p_to)
     and (p_category is null or category_id = p_category)
$$;

revoke execute on function public.is_overdue(timestamptz, text, timestamptz, boolean)
  from public, anon, authenticated;
