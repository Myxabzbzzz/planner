create function public.api_me(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'tz', tz, 'base_currency', base_currency)
    from public.users where id = p_user;
$$;

create function public.api_tasks(p_user uuid, p_filter text) returns jsonb
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
             'overdue', t.done_at is null and t.due_at is not null and (t.due_at at time zone v_tz)::date < v_today,
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

create function public.api_events(p_user uuid, p_from date, p_to date) returns jsonb
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
                                                'with_whom', i.with_whom) order by i.starts_at) as events
              from public.items i
             where i.user_id = p_user and i.kind = 'event'
               and (i.starts_at at time zone v_tz)::date between p_from and p_to
             group by 1) d), '[]'::jsonb));
end $$;

create function public.api_money(p_user uuid, p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur text;
  v_start date;
  v_end date;
begin
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'bad month';
  end if;
  select base_currency into v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month')::date;
  return jsonb_build_object(
    'base_currency', v_cur,
    'month', p_month,
    'expense', coalesce((select sum(amount_base) from public.transactions
                          where user_id = p_user and type = 'expense' and occurred_at >= v_start and occurred_at < v_end), 0),
    'income', coalesce((select sum(amount_base) from public.transactions
                         where user_id = p_user and type = 'income' and occurred_at >= v_start and occurred_at < v_end), 0),
    'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount) order by s.amount desc)
        from (select coalesce(c.name, 'другое') as name, sum(t.amount_base) as amount
                from public.transactions t left join public.categories c on c.id = t.category_id
               where t.user_id = p_user and t.type = 'expense' and t.occurred_at >= v_start and t.occurred_at < v_end
               group by 1) s), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', s.day::text, 'expense', s.amount) order by s.day)
        from (select occurred_at as day, sum(amount_base) as amount
                from public.transactions
               where user_id = p_user and type = 'expense' and occurred_at >= v_start and occurred_at < v_end
               group by 1) s), '[]'::jsonb),
    'operations', coalesce((
      select jsonb_agg(o.obj order by o.occurred_at desc, o.created_at desc)
        from (select t.occurred_at, t.created_at, jsonb_build_object(
                       'id', t.id, 'date', t.occurred_at::text, 'type', t.type, 'title', t.comment,
                       'amount', t.amount_base, 'category', coalesce(c.name, 'другое'),
                       'orig', case when t.currency_orig is null then null else jsonb_build_object(
                                 'amount', t.amount_orig, 'currency', t.currency_orig,
                                 'rate', t.fx_rate, 'rate_date', t.fx_date::text) end) as obj
                from public.transactions t left join public.categories c on c.id = t.category_id
               where t.user_id = p_user and t.occurred_at >= v_start and t.occurred_at < v_end
               order by t.occurred_at desc, t.created_at desc
               limit 200) o), '[]'::jsonb)
  );
end $$;

create function public.api_habits(p_user uuid, p_weeks int) returns jsonb
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
             'days', (select jsonb_agg(jsonb_build_object('date', d::date::text,
                                                          'done', exists (select 1 from public.habit_logs l
                                                                           where l.habit_id = h.id and l.date = d::date))
                                       order by d)
                        from generate_series(v_from::timestamp, v_today::timestamp, interval '1 day') d),
             'streak', public.habit_streak(h.id, v_today),
             'done_today', exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = v_today))
           order by h.created_at)
      from public.habits h
     where h.user_id = p_user and h.archived_at is null), '[]'::jsonb));
end $$;

create function public.api_notes(p_user uuid, p_q text, p_before text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_pat text;
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
  v_next text;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  if p_q is not null and length(p_q) > 0 then
    v_pat := '%' || replace(replace(replace(left(p_q, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if p_before is not null and length(p_before) > 0 then
    begin
      v_ts := split_part(p_before, '~', 1)::timestamptz;
      v_id := split_part(p_before, '~', 2)::uuid;
    exception when others then
      raise exception 'bad cursor';
    end;
  end if;
  with page as (
    select n.*, row_number() over (order by n.created_at desc, n.id desc) as rn
      from (select * from public.notes
             where user_id = p_user
               and (v_pat is null or text ilike v_pat)
               and (v_ts is null or (created_at, id) < (v_ts, v_id))
             order by created_at desc, id desc
             limit 31) n
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'text', text,
                                      'created_at', to_char(created_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'))
                   order by rn) filter (where rn <= 30), '[]'::jsonb),
         (select created_at::text || '~' || id::text from page where rn = 30
            and exists (select 1 from page where rn = 31))
    into v_rows, v_next
    from page;
  return jsonb_build_object('notes', v_rows, 'next_before', v_next);
end $$;

revoke execute on function
  public.api_me(uuid), public.api_tasks(uuid, text), public.api_events(uuid, date, date),
  public.api_money(uuid, text), public.api_habits(uuid, int), public.api_notes(uuid, text, text)
  from public, anon, authenticated;
