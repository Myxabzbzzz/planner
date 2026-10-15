-- Повторяющиеся дела и встречи (Pro): «каждый понедельник созвон», «10-го оплатить ЖКУ».
--
-- Правило живёт отдельно, а в списках лежит обычная задача или встреча — ближайший
-- экземпляр. Поэтому напоминания, «сделано», правка и календарь работают как всегда.
-- Новый экземпляр появляется, когда наступил день предыдущего: в день созвона уже
-- виден следующий. Пока Pro нет, новые не создаются; вернулся Pro — повтор продолжится
-- с ближайшей даты, пропущенные дни задним числом не досоздаются.

create table public.recurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('task', 'event')),
  title text not null,
  with_whom text,
  -- null — задача без времени
  at_time text check (at_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  freq text not null check (freq in ('daily', 'weekdays', 'weekly', 'monthly')),
  -- первая дата: от неё берутся день недели (weekly) и число месяца (monthly)
  anchor date not null,
  -- дата последнего созданного экземпляра
  last_on date not null,
  stopped_at timestamptz,
  -- из какого сообщения создан повтор: «Отменить» под ответом бота ставит его на паузу,
  -- а повторный разбор сообщения удаляет вместе с остальными записями
  inbox_id uuid references public.inbox(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (kind <> 'event' or at_time is not null)
);
alter table public.recurrences enable row level security;
create index recurrences_active_idx on public.recurrences (user_id) where stopped_at is null;

alter table public.items add column recurrence_id uuid references public.recurrences(id) on delete set null;

-- Ближайшая дата строго после p_after по правилу. 31-е число в коротком месяце — последний день.
create function public._next_occurrence(p_freq text, p_anchor date, p_after date) returns date
language plpgsql immutable as $$
declare
  d date;
  v_month date;
  v_dom int := extract(day from p_anchor)::int;
begin
  case p_freq
    when 'daily' then
      return p_after + 1;
    when 'weekdays' then
      d := p_after + 1;
      while extract(isodow from d) > 5 loop d := d + 1; end loop;
      return d;
    when 'weekly' then
      return p_after + 1 + ((extract(isodow from p_anchor)::int - extract(isodow from p_after + 1)::int + 7) % 7);
    when 'monthly' then
      v_month := date_trunc('month', p_after)::date;
      loop
        d := v_month + (least(v_dom, extract(day from (v_month + interval '1 month - 1 day'))::int) - 1);
        if d > p_after then return d; end if;
        v_month := (v_month + interval '1 month')::date;
      end loop;
    else
      raise exception 'bad freq';
  end case;
end $$;

create function public._spawn_occurrence(r public.recurrences, p_day date, p_tz text, p_inbox uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if r.kind = 'event' then
    insert into public.items (user_id, kind, title, starts_at, with_whom, recurrence_id, inbox_id)
    values (r.user_id, 'event', r.title, (p_day + r.at_time::time) at time zone p_tz, r.with_whom, r.id, p_inbox)
    returning id into v_id;
  else
    insert into public.items (user_id, kind, title, due_at, due_has_time, recurrence_id, inbox_id)
    values (r.user_id, 'task', r.title, (p_day + coalesce(r.at_time, '23:59')::time) at time zone p_tz,
            r.at_time is not null, r.id, p_inbox)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Создаёт правило и первый экземпляр; возвращает id экземпляра, как create_task/create_event.
-- Pro проверяет API: функция одна и та же для ручного ввода и для разбора ИИ.
create function public.create_recurrence(p_user uuid, p_kind text, p_title text, p_date date, p_time text,
                                         p_with_whom text, p_freq text, p_inbox uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_first date;
  r public.recurrences;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  if p_kind not in ('task', 'event') then raise exception 'bad kind'; end if;
  if p_freq is null or p_freq not in ('daily', 'weekdays', 'weekly', 'monthly') then raise exception 'bad freq'; end if;
  if p_title is null or p_date is null then raise exception 'bad recurrence'; end if;
  if p_kind = 'event' and p_time is null then raise exception 'event needs time'; end if;
  perform public._check_title(p_title);
  perform public._check_time(p_time);
  perform public._check_date(p_date, v_tz);
  if p_with_whom is not null and length(btrim(p_with_whom)) > 200 then raise exception 'bad with_whom'; end if;
  -- «по будням» с субботы начинается с понедельника
  v_first := public._next_occurrence(p_freq, p_date, p_date - 1);
  insert into public.recurrences (user_id, kind, title, with_whom, at_time, freq, anchor, last_on, inbox_id)
  values (p_user, p_kind, btrim(p_title),
          case when p_kind = 'event' then nullif(btrim(coalesce(p_with_whom, '')), '') end,
          p_time, p_freq, p_date, v_first, p_inbox)
  returning * into r;
  return public._spawn_occurrence(r, v_first, v_tz, p_inbox);
end $$;

-- Раз в минуту из notify. Возвращает, сколько экземпляров создано.
create function public.spawn_recurrences(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  rec record;
  r public.recurrences;
  v_next date;
  v_count int := 0;
begin
  for rec in
    select rr.id, u.tz, (p_now at time zone u.tz)::date as today
      from public.recurrences rr join public.users u on u.id = rr.user_id
     where rr.stopped_at is null and u.is_allowed and u.pro_until > p_now
       and rr.last_on <= (p_now at time zone u.tz)::date
       -- запись отменили кнопкой «Отменить» — пока её не вернули, повтор стоит
       and not exists (select 1 from public.inbox i
                        where i.id = rr.inbox_id and coalesce((i.result ->> 'deleted')::boolean, false))
       for update of rr skip locked
  loop
    select * into r from public.recurrences where id = rec.id;
    -- после паузы — с ближайшей даты, а не россыпь пропущенных
    v_next := public._next_occurrence(r.freq, r.anchor, greatest(r.last_on, rec.today - 1));
    perform public._spawn_occurrence(r, v_next, rec.tz);
    update public.recurrences set last_on = v_next where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Остановить повтор. Уже созданные экземпляры остаются — их можно отметить или удалить как обычно.
create function public.stop_recurrence(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.recurrences set stopped_at = now()
   where id = p_id and user_id = p_user and stopped_at is null;
  return found;
end $$;

-- Пометка для списков: {id, freq} у живого повтора, иначе null.
create function public._repeat_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'freq', r.freq)
    from public.recurrences r where r.id = p_id and r.stopped_at is null;
$$;

-- Ниже — читатели задач и встреч из 20261009000002 и 20261008000003 без изменений, кроме поля repeat.

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
                             else to_char(t.done_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI') end,
             'repeat', public._repeat_json(t.recurrence_id))
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

create or replace function public.api_events(p_user uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'bad range';
  end if;
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  return jsonb_build_object('days', coalesce((
    select jsonb_agg(jsonb_build_object('date', d.day::text, 'events', d.events) order by d.day)
      from (select (i.starts_at at time zone v_tz)::date as day,
                   jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title,
                                                'time', to_char(i.starts_at at time zone v_tz, 'HH24:MI'),
                                                'with_whom', i.with_whom,
                                                'done', i.done_at is not null,
                                                'repeat', public._repeat_json(i.recurrence_id)) order by i.starts_at) as events
              from public.items i
             where i.user_id = p_user and i.kind = 'event' and i.deleted_at is null
               and (i.starts_at at time zone v_tz)::date between p_from and p_to
             group by 1) d), '[]'::jsonb));
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
                                          'done', done_at is not null,
                                          'repeat', public._repeat_json(recurrence_id))
                       order by starts_at)
        from public.items
       where user_id = p_user and kind = 'event' and deleted_at is null
         and (starts_at at time zone v_tz)::date = v_today), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title,
                                          'due', to_char(t.due_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
                                          'due_has_time', t.due_has_time,
                                          'overdue', public.is_overdue(t.due_at, v_tz, now(), t.due_has_time),
                                          'repeat', public._repeat_json(t.recurrence_id))
                       order by t.due_at)
        from (select id, title, due_at, due_has_time, recurrence_id from public.items
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

revoke execute on function public._next_occurrence(text, date, date), public._spawn_occurrence(public.recurrences, date, text, uuid),
  public.create_recurrence(uuid, text, text, date, text, text, text, uuid), public.spawn_recurrences(timestamptz),
  public.stop_recurrence(uuid, uuid), public._repeat_json(uuid)
  from public, anon, authenticated;
