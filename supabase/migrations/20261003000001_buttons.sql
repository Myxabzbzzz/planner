alter table public.users add column pending_action text check (pending_action in ('limit'));

create function public.habit_streak(p_habit uuid, p_today date) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  d date := p_today;
  n int := 0;
begin
  if not exists (select 1 from public.habit_logs where habit_id = p_habit and date = d) then
    d := d - 1;
  end if;
  while exists (select 1 from public.habit_logs where habit_id = p_habit and date = d) loop
    n := n + 1;
    d := d - 1;
  end loop;
  return n;
end $$;

create function public.summary_today(p_user uuid) returns jsonb
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
      select jsonb_agg(jsonb_build_object('title', title, 'time', to_char(starts_at at time zone v_tz, 'HH24:MI'))
                       order by starts_at)
        from public.items
       where user_id = p_user and kind = 'event' and (starts_at at time zone v_tz)::date = v_today), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'title', title,
                                          'overdue', (due_at at time zone v_tz)::date < v_today)
                       order by due_at)
        from public.items
       where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
         and (due_at at time zone v_tz)::date <= v_today), '[]'::jsonb),
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

create function public.summary_tasks(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object('tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'title', t.title,
             'due', case when t.due_at is null then null else to_char(t.due_at at time zone v_tz, 'DD.MM') end,
             'overdue', t.due_at is not null and (t.due_at at time zone v_tz)::date < v_today)
           order by t.due_at nulls last, t.created_at)
      from (select id, title, due_at, created_at from public.items
             where user_id = p_user and kind = 'task' and done_at is null
             order by due_at nulls last, created_at
             limit 20) t), '[]'::jsonb));
end $$;

create function public.summary_money(p_user uuid) returns jsonb
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
                          where user_id = p_user and type = 'expense'
                            and occurred_at >= v_start and occurred_at < v_end), 0),
    'income', coalesce((select sum(amount_base) from public.transactions
                         where user_id = p_user and type = 'income'
                           and occurred_at >= v_start and occurred_at < v_end), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount) order by s.amount desc)
        from (select coalesce(c.name, 'другое') as name, sum(t.amount_base) as amount
                from public.transactions t
                left join public.categories c on c.id = t.category_id
               where t.user_id = p_user and t.type = 'expense'
                 and t.occurred_at >= v_start and t.occurred_at < v_end
               group by 1) s), '[]'::jsonb),
    'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null)
  );
end $$;

create function public.summary_habits(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object('habits', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id,
             'name', h.name,
             'week', (select jsonb_agg(exists (select 1 from public.habit_logs l
                                                where l.habit_id = h.id and l.date = d::date) order by d)
                        from generate_series((v_today - 6)::timestamp, v_today::timestamp, interval '1 day') d),
             'done_today', exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = v_today),
             'streak', public.habit_streak(h.id, v_today))
           order by h.created_at)
      from public.habits h
     where h.user_id = p_user and h.archived_at is null), '[]'::jsonb));
end $$;

create function public.summary_settings(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tz', u.tz,
    'base_currency', u.base_currency,
    'limit', (select monthly_limit from public.budgets b where b.user_id = u.id and b.category_id is null),
    'capture_token', u.capture_token)
    from public.users u where u.id = p_user;
$$;

create function public.complete_task(p_user uuid, p_item uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.items set done_at = now()
   where id = p_item and user_id = p_user and kind = 'task' and done_at is null;
  return found;
end $$;

create function public.log_habit(p_user uuid, p_habit uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
begin
  select tz into v_tz from public.users where id = p_user;
  if not exists (select 1 from public.habits where id = p_habit and user_id = p_user and archived_at is null) then
    return false;
  end if;
  insert into public.habit_logs (user_id, habit_id, date)
  values (p_user, p_habit, (now() at time zone v_tz)::date)
  on conflict (habit_id, date) do nothing;
  return true;
end $$;

create function public.set_tz(p_user uuid, p_tz text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = p_tz) then
    return false;
  end if;
  update public.users set tz = p_tz where id = p_user;
  return found;
end $$;

create function public.set_limit(p_user uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.budgets where user_id = p_user and category_id is null;
  if p_amount > 0 then
    insert into public.budgets (user_id, category_id, monthly_limit) values (p_user, null, p_amount);
  end if;
end $$;

create function public.rotate_capture_token(p_user uuid) returns text
language sql security definer set search_path = public as $$
  update public.users set capture_token = encode(extensions.gen_random_bytes(32), 'hex')
   where id = p_user
  returning capture_token;
$$;

revoke execute on function
  public.habit_streak(uuid, date), public.summary_today(uuid), public.summary_tasks(uuid),
  public.summary_money(uuid), public.summary_habits(uuid), public.summary_settings(uuid),
  public.complete_task(uuid, uuid), public.log_habit(uuid, uuid), public.set_tz(uuid, text),
  public.set_limit(uuid, numeric), public.rotate_capture_token(uuid)
  from public, anon, authenticated;
