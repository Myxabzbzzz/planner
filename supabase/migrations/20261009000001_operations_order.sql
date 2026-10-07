-- Порядок операций: по дате операции, а не по времени записи.
--
-- Пагинация по (created_at, id) корректна как keyset, но ломает экран «Деньги»:
-- список сгруппирован по дням, и операция, введённая сегодня задним числом,
-- оказывалась выше вчерашних — заголовки дат шли вразнобой, а одна и та же
-- дата могла появиться в списке дважды.
--
-- Поэтому курсор составной: (occurred_at, created_at, id). Это по-прежнему
-- keyset — сортировка один в один совпадает с курсором, — и строка курсора
-- по-прежнему проходит CURSOR из supabase/functions/api/handler.ts
-- (левая часть без «~» и короче 64 символов).

create or replace function public.api_operations(p_user uuid, p_month text, p_before text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date;
  v_end date;
  v_day date;
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
      v_day := split_part(split_part(p_before, '~', 1), '|', 1)::date;
      v_ts := split_part(split_part(p_before, '~', 1), '|', 2)::timestamptz;
      v_id := split_part(p_before, '~', 2)::uuid;
    exception when others then
      raise exception 'bad cursor';
    end;
  end if;
  with page as (
    select o.id, o.occurred_at, o.created_at, o.obj,
           row_number() over (order by o.occurred_at desc, o.created_at desc, o.id desc) as rn
      from (select t.id, t.occurred_at, t.created_at, public._operation_json(t, c) as obj
              from public.transactions t left join public.categories c on c.id = t.category_id
             where t.user_id = p_user and t.deleted_at is null
               and t.occurred_at >= v_start and t.occurred_at < v_end
               and (v_day is null
                    or (t.occurred_at, t.created_at, t.id) < (v_day, v_ts, v_id))
             order by t.occurred_at desc, t.created_at desc, t.id desc
             limit 51) o
  )
  select coalesce(jsonb_agg(obj order by rn) filter (where rn <= 50), '[]'::jsonb),
         (select occurred_at::text || '|' || created_at::text || '~' || id::text
            from page where rn = 50 and exists (select 1 from page where rn = 51))
    into v_rows, v_next
    from page;
  return jsonb_build_object('operations', v_rows, 'next_before', v_next);
end $$;

-- `api_money` отдаёт первую страницу и курсор — они обязаны идти в том же
-- порядке, иначе «показать ещё» продолжит не с того места.
create or replace function public.api_money(p_user uuid, p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur text;
  v_start date;
  v_end date;
  v_total int;
begin
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'bad month';
  end if;
  select base_currency into v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month')::date;

  select count(*) into v_total from public.transactions
   where user_id = p_user and deleted_at is null
     and occurred_at >= v_start and occurred_at < v_end;

  return jsonb_build_object(
    'base_currency', v_cur,
    'month', p_month,
    'expense', coalesce((select sum(amount_base) from public.transactions
                          where user_id = p_user and deleted_at is null and type = 'expense'
                            and occurred_at >= v_start and occurred_at < v_end), 0),
    'income', coalesce((select sum(amount_base) from public.transactions
                         where user_id = p_user and deleted_at is null and type = 'income'
                           and occurred_at >= v_start and occurred_at < v_end), 0),
    'limit', (select monthly_limit from public.budgets
               where user_id = p_user and category_id is null),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount) order by s.amount desc)
        from (select coalesce(c.name, 'другое') as name, sum(t.amount_base) as amount
                from public.transactions t left join public.categories c on c.id = t.category_id
               where t.user_id = p_user and t.deleted_at is null and t.type = 'expense'
                 and t.occurred_at >= v_start and t.occurred_at < v_end
               group by 1) s), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', s.day::text, 'expense', s.amount) order by s.day)
        from (select occurred_at as day, sum(amount_base) as amount
                from public.transactions
               where user_id = p_user and deleted_at is null and type = 'expense'
                 and occurred_at >= v_start and occurred_at < v_end
               group by 1) s), '[]'::jsonb),
    'operations_total', v_total,
    'operations', coalesce((
      select jsonb_agg(o.obj order by o.rn)
        from (select public._operation_json(t, c) as obj,
                     row_number() over (order by t.occurred_at desc, t.created_at desc, t.id desc) as rn
                from public.transactions t left join public.categories c on c.id = t.category_id
               where t.user_id = p_user and t.deleted_at is null
                 and t.occurred_at >= v_start and t.occurred_at < v_end
               order by t.occurred_at desc, t.created_at desc, t.id desc
               limit 200) o), '[]'::jsonb),
    'operations_next_before', (
      select o.occurred_at::text || '|' || o.created_at::text || '~' || o.id::text
        from (select t.occurred_at, t.created_at, t.id,
                     row_number() over (order by t.occurred_at desc, t.created_at desc, t.id desc) as rn
                from public.transactions t
               where t.user_id = p_user and t.deleted_at is null
                 and t.occurred_at >= v_start and t.occurred_at < v_end
               order by t.occurred_at desc, t.created_at desc, t.id desc
               limit 200) o
       where o.rn = 200 and v_total > 200)
  );
end $$;

-- Индекс под новый порядок: без него keyset по трём полям читает месяц целиком.
create index if not exists transactions_user_month_order_idx
  on public.transactions (user_id, occurred_at desc, created_at desc, id desc)
  where deleted_at is null;
