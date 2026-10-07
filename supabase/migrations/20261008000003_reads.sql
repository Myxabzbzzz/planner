-- #3: ни одна цифра и ни один список больше не видят удалённые строки.
-- #32: api_tasks / summary_today / summary_tasks отдают due_has_time рядом с due.

create or replace function public.activity_days(p_user uuid, p_tz text)
returns table(day date)
language sql stable security definer set search_path = public as $$
  select distinct d from (
    select (done_at at time zone p_tz)::date as d
      from public.items where user_id = p_user and done_at is not null and deleted_at is null
    union all
    select occurred_at from public.transactions where user_id = p_user and deleted_at is null
    union all
    select (created_at at time zone p_tz)::date
      from public.notes where user_id = p_user and deleted_at is null
    union all
    select l.date from public.habit_logs l where l.user_id = p_user
  ) s
  where d is not null;
$$;

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
             where i.user_id = p_user and i.kind = 'event' and i.deleted_at is null
               and (i.starts_at at time zone v_tz)::date between p_from and p_to
             group by 1) d), '[]'::jsonb));
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
  -- #21: клиент должен честно сказать «показаны первые 100 из N», а не угадывать по длине массива
  return jsonb_build_object('total', (
    select count(*) from public.items i
     where i.user_id = p_user and i.kind = 'task' and i.deleted_at is null
       and case p_filter
             when 'today' then i.done_at is null and i.due_at is not null and (i.due_at at time zone v_tz)::date <= v_today
             when 'upcoming' then i.done_at is null and i.due_at is not null and (i.due_at at time zone v_tz)::date > v_today
             when 'nodue' then i.done_at is null and i.due_at is null
             else i.done_at is not null
           end), 'tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id,
             'title', t.title,
             'due', case when t.due_at is null then null else to_char(t.due_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI') end,
             'due_has_time', t.due_has_time,
             'overdue', t.done_at is null and public.is_overdue(t.due_at, v_tz, now()),
             'done_at', case when t.done_at is null then null else to_char(t.done_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI') end)
           order by t.ord)
      from (select i.*,
                   row_number() over (order by
                     case when p_filter = 'done' then i.done_at end desc nulls last,
                     i.due_at nulls last, i.created_at) as ord
              from public.items i
             where i.user_id = p_user and i.kind = 'task' and i.deleted_at is null
               and case p_filter
                     when 'today' then i.done_at is null and i.due_at is not null and (i.due_at at time zone v_tz)::date <= v_today
                     when 'upcoming' then i.done_at is null and i.due_at is not null and (i.due_at at time zone v_tz)::date > v_today
                     when 'nodue' then i.done_at is null and i.due_at is null
                     else i.done_at is not null
                   end
             order by ord
             limit 100) t), '[]'::jsonb));
end $$;

-- #21: форма операции одна и та же в api_money и api_operations
create function public._operation_json(t public.transactions, c public.categories) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', t.id, 'date', t.occurred_at::text, 'type', t.type, 'title', t.comment,
    'amount', t.amount_base, 'category', coalesce(c.name, 'другое'),
    'orig', case when t.currency_orig is null then null else jsonb_build_object(
              'amount', t.amount_orig, 'currency', t.currency_orig,
              'rate', t.fx_rate, 'rate_date', t.fx_date::text) end);
$$;

create or replace function public.api_money(p_user uuid, p_month text) returns jsonb
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
                          where user_id = p_user and type = 'expense' and deleted_at is null
                            and occurred_at >= v_start and occurred_at < v_end), 0),
    'income', coalesce((select sum(amount_base) from public.transactions
                         where user_id = p_user and type = 'income' and deleted_at is null
                           and occurred_at >= v_start and occurred_at < v_end), 0),
    'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount) order by s.amount desc)
        from (select coalesce(c.name, 'другое') as name, sum(t.amount_base) as amount
                from public.transactions t left join public.categories c on c.id = t.category_id
               where t.user_id = p_user and t.type = 'expense' and t.deleted_at is null
                 and t.occurred_at >= v_start and t.occurred_at < v_end
               group by 1) s), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', s.day::text, 'expense', s.amount) order by s.day)
        from (select occurred_at as day, sum(amount_base) as amount
                from public.transactions
               where user_id = p_user and type = 'expense' and deleted_at is null
                 and occurred_at >= v_start and occurred_at < v_end
               group by 1) s), '[]'::jsonb),
    -- #21: порядок и курсор совпадают с api_operations, чтобы «показать ещё» не дублировало строки
    'operations_total', (select count(*) from public.transactions
                          where user_id = p_user and deleted_at is null
                            and occurred_at >= v_start and occurred_at < v_end),
    'operations', coalesce((
      select jsonb_agg(o.obj order by o.created_at desc, o.id desc)
        from (select t.id, t.created_at, public._operation_json(t, c) as obj
                from public.transactions t left join public.categories c on c.id = t.category_id
               where t.user_id = p_user and t.deleted_at is null
                 and t.occurred_at >= v_start and t.occurred_at < v_end
               order by t.created_at desc, t.id desc
               limit 200) o), '[]'::jsonb),
    'operations_next_before', (
      select o.created_at::text || '~' || o.id::text
        from (select t.id, t.created_at,
                     row_number() over (order by t.created_at desc, t.id desc) as rn
                from public.transactions t
               where t.user_id = p_user and t.deleted_at is null
                 and t.occurred_at >= v_start and t.occurred_at < v_end
               order by t.created_at desc, t.id desc
               limit 201) o
       where o.rn = 200 and exists (
         select 1 from public.transactions t2
          where t2.user_id = p_user and t2.deleted_at is null
            and t2.occurred_at >= v_start and t2.occurred_at < v_end
            and (t2.created_at, t2.id) < (o.created_at, o.id)))
  );
end $$;

create or replace function public.api_notes(p_user uuid, p_q text, p_before text) returns jsonb
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
             where user_id = p_user and deleted_at is null
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

create or replace function public.ask_agenda(p_user uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
                                 where user_id = p_user and kind = 'event' and deleted_at is null
                                   and (p_from is null or (starts_at at time zone v_tz)::date >= p_from)
                                   and (p_to is null or (starts_at at time zone v_tz)::date < p_to)
                                 order by starts_at limit 20) e), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'done', t.done_at is not null)
                                        order by t.due_at)
                         from (select title, due_at, done_at from public.items
                                where user_id = p_user and kind = 'task' and due_at is not null and deleted_at is null
                                  and (p_from is null or (due_at at time zone v_tz)::date >= p_from)
                                  and (p_to is null or (due_at at time zone v_tz)::date < p_to)
                                order by due_at limit 20) t), '[]'::jsonb));
end $$;

create or replace function public.ask_find_event(p_user uuid, p_query text, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
                                 where user_id = p_user and kind = 'event' and deleted_at is null
                                   and (title ilike v_pat or with_whom ilike v_pat)
                                   and starts_at >= p_now and starts_at < p_now + interval '30 days'
                                 order by starts_at limit 3) e), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(jsonb_build_object(
                               'day', to_char(e.starts_at at time zone v_tz, 'YYYY-MM-DD'),
                               'time', to_char(e.starts_at at time zone v_tz, 'HH24:MI'),
                               'title', e.title, 'with_whom', e.with_whom) order by e.starts_at desc)
                        from (select title, starts_at, with_whom from public.items
                               where user_id = p_user and kind = 'event' and deleted_at is null
                                 and (title ilike v_pat or with_whom ilike v_pat)
                                 and starts_at < p_now and starts_at >= p_now - interval '30 days'
                               order by starts_at desc limit 3) e), '[]'::jsonb));
end $$;

create or replace function public.ask_limit_left(p_user uuid, p_category uuid default null, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
                        where user_id = p_user and type = 'expense' and deleted_at is null
                          and occurred_at >= v_from and occurred_at < v_to
                          and (p_category is null or category_id = p_category)), 0),
    'days_left', v_to - v_day);
end $$;

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

create or replace function public.ask_top_categories(p_user uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with by_cat as (
    select coalesce(c.name, 'без категории') as name, sum(t.amount_base) as amount
      from public.transactions t
      left join public.categories c on c.id = t.category_id
     where t.user_id = p_user and t.type = 'expense' and t.deleted_at is null
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

create or replace function public.complete_task(p_user uuid, p_item uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.items set done_at = now()
   where id = p_item and user_id = p_user and kind = 'task' and done_at is null and deleted_at is null;
  return found;
end $$;

create or replace function public.set_item_done(p_user uuid, p_item uuid, p_kind text, p_done boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('task', 'event') then return false; end if;
  update public.items
     set done_at = case when p_done then coalesce(done_at, now()) else null end
   where id = p_item and user_id = p_user and kind = p_kind and deleted_at is null;
  return found;
end $$;

create or replace function public.mark_reminded(p_items uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.items set reminded_at = now() where id = any(p_items) and deleted_at is null;
$$;

create or replace function public.update_event(p_user uuid, p_id uuid, p_title text, p_date date, p_time text, p_with_whom text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_old timestamptz;
  v_new timestamptz;
begin
  select tz into v_tz from public.users where id = p_user;
  select starts_at into v_old from public.items
   where id = p_id and user_id = p_user and kind = 'event' and deleted_at is null for update;
  if not found then return false; end if;
  perform public._check_title(p_title);
  perform public._check_time(p_time);
  perform public._check_date(p_date, v_tz);
  if p_with_whom is not null and length(btrim(p_with_whom)) > 200 then raise exception 'bad with_whom'; end if;
  v_new := case when p_date is null and p_time is null then v_old
                else (coalesce(p_date, (v_old at time zone v_tz)::date)
                      + coalesce(p_time, to_char(v_old at time zone v_tz, 'HH24:MI'))::time) at time zone v_tz end;
  update public.items
     set title = coalesce(btrim(p_title), title),
         starts_at = v_new,
         with_whom = case when p_with_whom is null then with_whom
                          when btrim(p_with_whom) = '' then null
                          else btrim(p_with_whom) end,
         reminded_at = case when v_new is distinct from v_old then null else reminded_at end
   where id = p_id;
  return true;
end $$;

create or replace function public.update_note(p_user uuid, p_id uuid, p_text text, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.notes where id = p_id and user_id = p_user and deleted_at is null for update;
  if not found then return false; end if;
  if p_text is not null and (btrim(p_text) = '' or length(btrim(p_text)) > 4000) then raise exception 'bad text'; end if;
  if p_kind is not null and p_kind not in ('thought', 'journal') then raise exception 'bad kind'; end if;
  update public.notes set text = coalesce(btrim(p_text), text), kind = coalesce(p_kind, kind) where id = p_id;
  return true;
end $$;

create or replace function public.update_transaction(p_user uuid, p_id uuid, p_amount numeric, p_title text, p_category text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  t public.transactions%rowtype;
  v_cat uuid;
begin
  select * into t from public.transactions
   where id = p_id and user_id = p_user and deleted_at is null for update;
  if not found then return false; end if;
  if p_amount is not null and not (p_amount > 0 and p_amount < 1e13) then
    raise exception 'bad amount';
  end if;
  if p_title is not null and (btrim(p_title) = '' or length(btrim(p_title)) > 200) then
    raise exception 'bad title';
  end if;
  if p_category is not null then
    select id into v_cat from public.categories where user_id = p_user and type = t.type and name = p_category;
    if v_cat is null then raise exception 'bad category'; end if;
  end if;
  update public.transactions
     set amount_orig = case when p_amount is not null and currency_orig is not null then round(p_amount, 2) else amount_orig end,
         amount_base = case when p_amount is null then amount_base
                            when currency_orig is not null then round(p_amount * fx_rate, 2)
                            else round(p_amount, 2) end,
         comment = coalesce(btrim(p_title), comment),
         category_id = coalesce(v_cat, category_id)
   where id = p_id;
  return true;
end $$;

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
             'overdue', public.is_overdue(t.due_at, v_tz, now()))
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
                                          'overdue', public.is_overdue(t.due_at, v_tz, now()))
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

create or replace function public.api_profile(p_user uuid, p_months int) returns jsonb
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
                where user_id = p_user and kind = 'task' and done_at is null and deleted_at is null),
      'overdue', (select count(*) from public.items
                   where user_id = p_user and kind = 'task' and done_at is null and deleted_at is null
                     and due_at is not null and (due_at at time zone v_tz)::date < v_today),
      'done_total', (select count(*) from public.items
                      where user_id = p_user and kind = 'task' and done_at is not null and deleted_at is null),
      'done_30d', (select count(*) from public.items
                    where user_id = p_user and kind = 'task' and done_at is not null and deleted_at is null
                      and (done_at at time zone v_tz)::date > v_today - 30),
      'created_30d', (select count(*) from public.items
                       where user_id = p_user and kind = 'task' and deleted_at is null
                         and (created_at at time zone v_tz)::date > v_today - 30)),

    'events', jsonb_build_object(
      'total', (select count(*) from public.items
                 where user_id = p_user and kind = 'event' and deleted_at is null),
      'done_total', (select count(*) from public.items
                      where user_id = p_user and kind = 'event' and done_at is not null and deleted_at is null),
      'next_7d', (select count(*) from public.items
                   where user_id = p_user and kind = 'event' and done_at is null and deleted_at is null
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
      'total', (select count(*) from public.notes where user_id = p_user and deleted_at is null),
      'thoughts', (select count(*) from public.notes
                    where user_id = p_user and kind = 'thought' and deleted_at is null),
      'journals', (select count(*) from public.notes
                    where user_id = p_user and kind = 'journal' and deleted_at is null),
      'd30', (select count(*) from public.notes
               where user_id = p_user and deleted_at is null
                 and (created_at at time zone v_tz)::date > v_today - 30)),

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
                                       where user_id = p_user and type = 'expense' and deleted_at is null
                                         and occurred_at >= m.start::date
                                         and occurred_at < (m.start + interval '1 month')::date), 0),
                 'income', coalesce((select sum(amount_base) from public.transactions
                                      where user_id = p_user and type = 'income' and deleted_at is null
                                        and occurred_at >= m.start::date
                                        and occurred_at < (m.start + interval '1 month')::date), 0))
                 order by m.start)
          from generate_series(
                 date_trunc('month', v_today::timestamp) - ((p_months - 1) || ' month')::interval,
                 date_trunc('month', v_today::timestamp),
                 interval '1 month') m(start)), '[]'::jsonb)),

    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', w.start::date::text,
               'done', (select count(*) from public.items
                         where user_id = p_user and kind = 'task' and done_at is not null and deleted_at is null
                           and (done_at at time zone v_tz)::date >= w.start::date
                           and (done_at at time zone v_tz)::date < (w.start + interval '7 day')::date),
               'created', (select count(*) from public.items
                            where user_id = p_user and kind = 'task' and deleted_at is null
                              and (created_at at time zone v_tz)::date >= w.start::date
                              and (created_at at time zone v_tz)::date < (w.start + interval '7 day')::date))
               order by w.start)
        from generate_series(
               date_trunc('week', v_today::timestamp) - interval '11 week',
               date_trunc('week', v_today::timestamp),
               interval '1 week') w(start)), '[]'::jsonb),

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

-- #21: постраничный список операций месяца. Курсор — как в api_notes: "<created_at>~<uuid>".
create function public.api_operations(p_user uuid, p_month text, p_before text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date;
  v_end date;
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
  v_next text;
begin
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'bad month';
  end if;
  perform 1 from public.users where id = p_user;
  if not found then return null; end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month')::date;
  if p_before is not null and length(p_before) > 0 then
    begin
      v_ts := split_part(p_before, '~', 1)::timestamptz;
      v_id := split_part(p_before, '~', 2)::uuid;
    exception when others then
      raise exception 'bad cursor';
    end;
  end if;
  with page as (
    select o.id, o.created_at, o.obj,
           row_number() over (order by o.created_at desc, o.id desc) as rn
      from (select t.id, t.created_at, public._operation_json(t, c) as obj
              from public.transactions t left join public.categories c on c.id = t.category_id
             where t.user_id = p_user and t.deleted_at is null
               and t.occurred_at >= v_start and t.occurred_at < v_end
               and (v_ts is null or (t.created_at, t.id) < (v_ts, v_id))
             order by t.created_at desc, t.id desc
             limit 51) o
  )
  select coalesce(jsonb_agg(obj order by rn) filter (where rn <= 50), '[]'::jsonb),
         (select created_at::text || '~' || id::text from page where rn = 50
            and exists (select 1 from page where rn = 51))
    into v_rows, v_next
    from page;
  return jsonb_build_object('operations', v_rows, 'next_before', v_next);
end $$;

revoke execute on function public.api_operations(uuid, text, text), public._operation_json(public.transactions, public.categories)
  from public, anon, authenticated;
