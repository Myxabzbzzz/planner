-- План 5: ИИ-вопросы — агрегаты для ответов бота. Вызывает только воркер (service_role).
-- Даты p_from/p_to — локальные даты пользователя, p_to исключительно, null — без границы.

create function public.ask_sum(p_user uuid, p_type text, p_from date, p_to date, p_category uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('total', coalesce(sum(amount_base), 0), 'count', count(*))
    from public.transactions
   where user_id = p_user and type = p_type
     and (p_from is null or occurred_at >= p_from)
     and (p_to is null or occurred_at < p_to)
     and (p_category is null or category_id = p_category)
$$;

create function public.ask_top_categories(p_user uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with by_cat as (
    select coalesce(c.name, 'без категории') as name, sum(t.amount_base) as amount
      from public.transactions t
      left join public.categories c on c.id = t.category_id
     where t.user_id = p_user and t.type = 'expense'
       and (p_from is null or t.occurred_at >= p_from)
       and (p_to is null or t.occurred_at < p_to)
     group by 1
  ), top as (
    select name, amount from by_cat order by amount desc, name limit 5
  )
  select jsonb_build_object(
    'total', coalesce((select sum(amount) from by_cat), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'amount', amount) order by amount desc, name)
                         from top), '[]'::jsonb),
    'other', coalesce((select sum(amount) from by_cat), 0) - coalesce((select sum(amount) from top), 0))
$$;

create function public.ask_limit_left(p_user uuid, p_category uuid default null, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_day date;
  v_from date;
  v_to date;
begin
  select (p_now at time zone tz)::date into v_day from public.users where id = p_user;
  if not found then return null; end if;
  v_from := date_trunc('month', v_day)::date;
  v_to := (v_from + interval '1 month')::date;
  return jsonb_build_object(
    'month', to_char(v_from, 'YYYY-MM'),
    'limit', (select monthly_limit from public.budgets
               where user_id = p_user and category_id is not distinct from p_category),
    'spent', coalesce((select sum(amount_base) from public.transactions
                        where user_id = p_user and type = 'expense'
                          and occurred_at >= v_from and occurred_at < v_to
                          and (p_category is null or category_id = p_category)), 0),
    'days_left', v_to - v_day);
end $$;

create function public.ask_agenda(p_user uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                                 'day', to_char(e.starts_at at time zone v_tz, 'YYYY-MM-DD'),
                                 'time', to_char(e.starts_at at time zone v_tz, 'HH24:MI'),
                                 'title', e.title, 'with_whom', e.with_whom, 'done', e.done_at is not null)
                               order by e.starts_at)
                          from (select title, starts_at, with_whom, done_at from public.items
                                 where user_id = p_user and kind = 'event'
                                   and (p_from is null or (starts_at at time zone v_tz)::date >= p_from)
                                   and (p_to is null or (starts_at at time zone v_tz)::date < p_to)
                                 order by starts_at limit 20) e), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'done', t.done_at is not null)
                                        order by t.due_at)
                         from (select title, due_at, done_at from public.items
                                where user_id = p_user and kind = 'task' and due_at is not null
                                  and (p_from is null or (due_at at time zone v_tz)::date >= p_from)
                                  and (p_to is null or (due_at at time zone v_tz)::date < p_to)
                                order by due_at limit 20) t), '[]'::jsonb));
end $$;

create function public.ask_open_tasks(p_user uuid, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
                when (due_at at time zone v_tz)::date < v_day then 'overdue'
                when (due_at at time zone v_tz)::date = v_day then 'today'
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

create function public.ask_find_event(p_user uuid, p_query text, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_pat text;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_pat := '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_build_object(
    'future', coalesce((select jsonb_agg(jsonb_build_object(
                                 'day', to_char(e.starts_at at time zone v_tz, 'YYYY-MM-DD'),
                                 'time', to_char(e.starts_at at time zone v_tz, 'HH24:MI'),
                                 'title', e.title, 'with_whom', e.with_whom) order by e.starts_at)
                          from (select title, starts_at, with_whom from public.items
                                 where user_id = p_user and kind = 'event'
                                   and (title ilike v_pat or with_whom ilike v_pat)
                                   and starts_at >= p_now and starts_at < p_now + interval '30 days'
                                 order by starts_at limit 3) e), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(jsonb_build_object(
                               'day', to_char(e.starts_at at time zone v_tz, 'YYYY-MM-DD'),
                               'time', to_char(e.starts_at at time zone v_tz, 'HH24:MI'),
                               'title', e.title, 'with_whom', e.with_whom) order by e.starts_at desc)
                        from (select title, starts_at, with_whom from public.items
                               where user_id = p_user and kind = 'event'
                                 and (title ilike v_pat or with_whom ilike v_pat)
                                 and starts_at < p_now and starts_at >= p_now - interval '30 days'
                               order by starts_at desc limit 3) e), '[]'::jsonb));
end $$;

revoke execute on function
  public.ask_sum(uuid, text, date, date, uuid), public.ask_top_categories(uuid, date, date),
  public.ask_limit_left(uuid, uuid, timestamptz), public.ask_agenda(uuid, date, date),
  public.ask_open_tasks(uuid, timestamptz), public.ask_find_event(uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function
  public.ask_sum(uuid, text, date, date, uuid), public.ask_top_categories(uuid, date, date),
  public.ask_limit_left(uuid, uuid, timestamptz), public.ask_agenda(uuid, date, date),
  public.ask_open_tasks(uuid, timestamptz), public.ask_find_event(uuid, text, timestamptz)
  to service_role;
