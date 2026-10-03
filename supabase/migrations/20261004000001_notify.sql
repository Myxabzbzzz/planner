alter table public.users
  add column notify_reminders boolean not null default true,
  add column notify_daily boolean not null default true,
  add column notify_weekly boolean not null default true,
  add column last_daily_on date,
  add column last_weekly_on date;

create function public.due_reminders(p_now timestamptz default now())
returns table(item_id uuid, chat_id bigint, title text, local_time text, minutes_left int)
language sql stable security definer set search_path = public as $$
  select i.id, u.tg_id, i.title,
         to_char(i.starts_at at time zone u.tz, 'HH24:MI'),
         greatest(1, ceil(extract(epoch from (i.starts_at - p_now)) / 60))::int
    from public.items i
    join public.users u on u.id = i.user_id
   where i.kind = 'event' and i.reminded_at is null and i.done_at is null
     and i.starts_at > p_now
     and i.starts_at - make_interval(mins => i.remind_before_min) <= p_now
     and u.is_allowed and u.onboarded_at is not null and u.notify_reminders
   order by i.starts_at
   limit 200;
$$;

create function public.mark_reminded(p_items uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.items set reminded_at = now() where id = any(p_items);
$$;

create function public.due_digests(p_now timestamptz default now())
returns table(user_id uuid, chat_id bigint, kind text)
language sql stable security definer set search_path = public as $$
  with u as (
    select id, tg_id, (p_now at time zone tz) as local_ts,
           notify_daily, notify_weekly, last_daily_on, last_weekly_on
      from public.users
     where is_allowed and onboarded_at is not null)
  select id, tg_id, 'daily'::text from u
   where notify_daily and local_ts::time >= time '21:30'
     and (last_daily_on is null or last_daily_on < local_ts::date)
  union all
  select id, tg_id, 'weekly'::text from u
   where notify_weekly and local_ts::time >= time '21:30' and extract(isodow from local_ts) = 7
     and (last_weekly_on is null or last_weekly_on < local_ts::date)
  order by 1, 3;
$$;

create function public.mark_digest(p_user uuid, p_kind text, p_on date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'daily' then
    update public.users set last_daily_on = p_on where id = p_user;
  elsif p_kind = 'weekly' then
    update public.users set last_weekly_on = p_on where id = p_user;
  else
    raise exception 'bad kind';
  end if;
end $$;

create function public.digest_daily(p_user uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_day date;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_day := (p_now at time zone v_tz)::date;
  return jsonb_build_object(
    'date', v_day::text,
    'base_currency', v_cur,
    'tasks_done', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is not null
                      and (done_at at time zone v_tz)::date = v_day),
    'events_done', (select count(*) from public.items
                     where user_id = p_user and kind = 'event' and (starts_at at time zone v_tz)::date = v_day
                       and (done_at is not null or starts_at <= p_now)),
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

create function public.digest_weekly(p_user uuid, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_day date;
  v_from date;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_day := (p_now at time zone v_tz)::date;
  v_from := v_day - (extract(isodow from v_day)::int - 1);
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
                       and (done_at is not null or starts_at <= p_now)),
    'habits', coalesce((select jsonb_agg(jsonb_build_object(
                                 'name', h.name,
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

create function public.set_item_done(p_user uuid, p_item uuid, p_done boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.items
     set done_at = case when p_done then coalesce(done_at, now()) else null end
   where id = p_item and user_id = p_user and kind in ('task', 'event');
  return found;
end $$;

create function public.set_habit_today(p_user uuid, p_habit uuid, p_done boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_today date;
begin
  if not exists (select 1 from public.habits where id = p_habit and user_id = p_user and archived_at is null) then
    return false;
  end if;
  select (now() at time zone tz)::date into v_today from public.users where id = p_user;
  if p_done then
    insert into public.habit_logs (user_id, habit_id, date) values (p_user, p_habit, v_today)
    on conflict (habit_id, date) do nothing;
  else
    delete from public.habit_logs where habit_id = p_habit and date = v_today;
  end if;
  return true;
end $$;

create function public.set_notify(p_user uuid, p_kind text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('reminders', 'daily', 'weekly') then
    raise exception 'bad kind';
  end if;
  update public.users
     set notify_reminders = case when p_kind = 'reminders' then p_on else notify_reminders end,
         notify_daily = case when p_kind = 'daily' then p_on else notify_daily end,
         notify_weekly = case when p_kind = 'weekly' then p_on else notify_weekly end
   where id = p_user;
end $$;

create or replace function public.summary_settings(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tz', u.tz,
    'base_currency', u.base_currency,
    'limit', (select monthly_limit from public.budgets b where b.user_id = u.id and b.category_id is null),
    'capture_token', u.capture_token,
    'notify_reminders', u.notify_reminders,
    'notify_daily', u.notify_daily,
    'notify_weekly', u.notify_weekly)
    from public.users u where u.id = p_user;
$$;

create or replace function public.summary_today(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_today date;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object(
    'base_currency', v_cur,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'time', to_char(starts_at at time zone v_tz, 'HH24:MI'),
                                          'done', done_at is not null)
                       order by starts_at)
        from public.items
       where user_id = p_user and kind = 'event' and (starts_at at time zone v_tz)::date = v_today), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title,
                                          'overdue', (t.due_at at time zone v_tz)::date < v_today)
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
                                          'done', exists (select 1 from public.habit_logs l
                                                           where l.habit_id = h.id and l.date = v_today))
                       order by h.created_at)
        from public.habits h
       where h.user_id = p_user and h.archived_at is null), '[]'::jsonb)
  );
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
                                                'done', i.done_at is not null) order by i.starts_at) as events
              from public.items i
             where i.user_id = p_user and i.kind = 'event'
               and (i.starts_at at time zone v_tz)::date between p_from and p_to
             group by 1) d), '[]'::jsonb));
end $$;

revoke execute on function
  public.due_reminders(timestamptz), public.mark_reminded(uuid[]), public.due_digests(timestamptz),
  public.mark_digest(uuid, text, date), public.digest_daily(uuid, timestamptz), public.digest_weekly(uuid, timestamptz),
  public.set_item_done(uuid, uuid, boolean), public.set_habit_today(uuid, uuid, boolean),
  public.set_notify(uuid, text, boolean), public.summary_settings(uuid), public.summary_today(uuid),
  public.api_events(uuid, date, date)
  from public, anon, authenticated;

select cron.schedule('notify', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
