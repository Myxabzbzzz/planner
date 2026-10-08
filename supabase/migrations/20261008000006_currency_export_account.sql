-- #2: базовую валюту можно сменить, данные — выгрузить, аккаунт — удалить.
-- Раньше промах на первом экране («USD» вместо «UZS») означал год кривых сумм без выхода.

-- Курсы в fx_rates: base = USD, rates[X] = единиц X за 1 USD (ровно как читает worker/fx.py).
-- Если на нужную дату таблицы нет — берём ближайшую более раннюю, а для дат раньше
-- первой таблицы — самую раннюю: приблизительный курс лучше суммы в чужой валюте.
create function public._fx_rates_on(p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select rates from public.fx_rates where date <= p_date order by date desc limit 1),
    (select rates from public.fx_rates order by date asc limit 1));
$$;

-- Сколько единиц p_to за 1 единицу p_from на дату p_date; null, если курса нет.
create function public._fx_pair(p_date date, p_from text, p_to text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  a numeric;
  b numeric;
begin
  if p_from is null or p_to is null then return null; end if;
  if p_from = p_to then return 1; end if;
  v := public._fx_rates_on(p_date);
  if v is null then return null; end if;
  begin
    a := (v ->> p_from)::numeric;
    b := (v ->> p_to)::numeric;
  exception when others then
    return null;
  end;
  if a is null or b is null or a <= 0 or b <= 0 then return null; end if;
  return b / a;
end $$;

create function public.change_base_currency(p_user uuid, p_cur text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_new text;
  v_old text;
  r record;
  v_src text;
  v_amt numeric;
  v_date date;
  v_rate numeric;
  v_base numeric;
  v_conv int := 0;
  v_skip int := 0;
begin
  if p_cur is null or upper(btrim(p_cur)) !~ '^[A-Z]{3}$' then raise exception 'bad currency'; end if;
  v_new := upper(btrim(p_cur));

  select base_currency into v_old from public.users where id = p_user for update;
  if not found then raise exception 'user not found'; end if;
  if v_old is null then raise exception 'not onboarded'; end if;
  if v_old = v_new then raise exception 'same currency'; end if;
  -- валюта должна быть в таблице курсов, иначе пересчитать уже ничего не выйдет
  if public._fx_rates_on(current_date) is null
     or (public._fx_rates_on(current_date)) ->> v_new is null then
    raise exception 'unknown currency';
  end if;

  -- Удалённые строки тоже пересчитываем: иначе «отменить удаление» вернёт сумму в старой валюте.
  -- Пропускать строки нельзя: суммы читаются без фильтра по base_currency, и одна
  -- непересчитанная строка смешала бы валюты во всех итогах. Нечем пересчитать — отменяем всё.
  for r in select * from public.transactions where user_id = p_user order by id for update loop
    v_rate := null;
    if r.currency_orig is not null and r.amount_orig is not null and r.fx_date is not null then
      -- есть исходная сумма — считаем от неё, курсом на дату операции в исходных документах
      v_src := r.currency_orig; v_amt := r.amount_orig; v_date := r.fx_date;
      v_rate := public._fx_pair(v_date, v_src, v_new);
    end if;
    if v_rate is null then
      -- исходной суммы нет или её валюты нет в курсах — переводим из старой базы курсом на дату операции
      v_src := r.base_currency; v_amt := r.amount_base; v_date := r.occurred_at;
      v_rate := public._fx_pair(v_date, v_src, v_new);
    end if;
    if v_rate is null then raise exception 'no rate'; end if;
    v_base := greatest(round(v_amt * v_rate, 2), 0.01);  -- amount_base > 0 по схеме

    update public.transactions
       set amount_base = v_base,
           base_currency = v_new,
           fx_rate = case when r.currency_orig is not null and v_src = r.currency_orig
                          then round(v_rate, 8) else fx_rate end
     where id = r.id;
    v_conv := v_conv + 1;
  end loop;

  -- лимиты тоже в деньгах; без курса старое число в новой валюте было бы бессмысленным
  v_rate := public._fx_pair(current_date, v_old, v_new);
  if v_rate is null then raise exception 'no rate'; end if;
  update public.budgets
     set monthly_limit = greatest(round(monthly_limit * v_rate, 2), 0.01)
   where user_id = p_user;

  update public.users set base_currency = v_new where id = p_user;

  return jsonb_build_object('converted', v_conv, 'skipped', v_skip, 'from', v_old, 'to', v_new);
end $$;

create function public.export_data(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u public.users%rowtype;
begin
  select * into u from public.users where id = p_user;
  if not found then return null; end if;
  return jsonb_build_object(
    'exported_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'profile', jsonb_build_object('name', u.name, 'tz', u.tz, 'base_currency', u.base_currency,
                                  'tg_username', u.tg_username,
                                  'onboarded_at', u.onboarded_at, 'created_at', u.created_at),
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
                                     'id', c.id, 'name', c.name, 'type', c.type, 'is_default', c.is_default)
                                   order by c.type, c.name)
                              from public.categories c where c.user_id = p_user), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object(
                                  'category', c.name, 'monthly_limit', b.monthly_limit)
                                order by c.name nulls first)
                           from public.budgets b left join public.categories c on c.id = b.category_id
                          where b.user_id = p_user), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', i.id, 'kind', i.kind, 'title', i.title, 'notes', i.notes,
                                'due_at', i.due_at, 'due_has_time', i.due_has_time,
                                'priority', i.priority, 'done_at', i.done_at,
                                'starts_at', i.starts_at, 'duration_min', i.duration_min,
                                'with_whom', i.with_whom, 'created_at', i.created_at)
                              order by i.created_at)
                         from public.items i
                        where i.user_id = p_user and i.deleted_at is null), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', t.id, 'type', t.type,
                                       'amount_base', t.amount_base, 'base_currency', t.base_currency,
                                       'amount_orig', t.amount_orig, 'currency_orig', t.currency_orig,
                                       'fx_rate', t.fx_rate, 'fx_date', t.fx_date, 'fx_source', t.fx_source,
                                       'category', c.name, 'comment', t.comment,
                                       'occurred_at', t.occurred_at, 'created_at', t.created_at)
                                     order by t.occurred_at, t.created_at)
                                from public.transactions t
                                left join public.categories c on c.id = t.category_id
                               where t.user_id = p_user and t.deleted_at is null), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', n.id, 'kind', n.kind, 'text', n.text, 'tags', n.tags,
                                'created_at', n.created_at)
                              order by n.created_at)
                         from public.notes n
                        where n.user_id = p_user and n.deleted_at is null), '[]'::jsonb),
    'habits', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', h.id, 'name', h.name, 'target_per_week', h.target_per_week,
                                 'archived_at', h.archived_at, 'created_at', h.created_at,
                                 'logs', coalesce((select jsonb_agg(l.date order by l.date)
                                                     from public.habit_logs l where l.habit_id = h.id), '[]'::jsonb))
                               order by h.created_at)
                          from public.habits h where h.user_id = p_user), '[]'::jsonb)
  );
end $$;

-- Всё остальное уходит каскадом по user_id.
create function public.delete_account(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.users where id = p_user;
  return found;
end $$;

revoke execute on function
  public._fx_rates_on(date), public._fx_pair(date, text, text),
  public.change_base_currency(uuid, text), public.export_data(uuid), public.delete_account(uuid)
  from public, anon, authenticated;
