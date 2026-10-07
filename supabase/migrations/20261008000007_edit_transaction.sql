-- #20: операцию наконец можно починить целиком — дату, тип и валюту, а не только сумму.
-- «потратил 200 на обед» в Ташкенте ложилось как 200 UZS вместо 200 000 и не правилось никак.
-- Все аргументы кроме первых двух nullable и означают «не трогать».

create function public.edit_transaction(p_user uuid, p_id uuid, p_amount numeric, p_title text,
                                        p_category text, p_date date, p_type text, p_currency text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  t public.transactions%rowtype;
  v_tz text;
  v_base text;
  v_type text;
  v_date date;
  v_cur text;
  v_cat uuid;
  v_cat_set boolean := false;
  v_amt numeric;
  v_rate numeric;
  v_fx record;
begin
  select tz, base_currency into v_tz, v_base from public.users where id = p_user;
  if not found then return false; end if;
  select * into t from public.transactions
   where id = p_id and user_id = p_user and deleted_at is null for update;
  if not found then return false; end if;

  if p_amount is not null and not (p_amount > 0 and p_amount < 1e13) then raise exception 'bad amount'; end if;
  if p_title is not null and (btrim(p_title) = '' or length(btrim(p_title)) > 200) then raise exception 'bad title'; end if;
  if p_type is not null and p_type not in ('expense', 'income') then raise exception 'bad type'; end if;
  if p_currency is not null and upper(btrim(p_currency)) !~ '^[A-Z]{3}$' then raise exception 'bad currency'; end if;

  v_type := coalesce(p_type, t.type);
  v_date := coalesce(p_date, t.occurred_at);
  perform public._check_date(v_date, v_tz);

  if p_category is not null then
    v_cat_set := true;
    if btrim(p_category) = '' then
      v_cat := null;  -- явная пустая строка = снять категорию
    else
      select id into v_cat from public.categories
       where user_id = p_user and type = v_type and name = btrim(p_category);
      if v_cat is null then raise exception 'bad category'; end if;
    end if;
  elsif p_type is not null and p_type <> t.type then
    -- расход стал доходом: старая категория принадлежит другому типу, её нельзя оставить
    v_cat_set := true;
    v_cat := null;
  end if;

  if p_currency is null then
    -- валюту не меняли: сумма трактуется как раньше (в исходной валюте, если она есть)
    if p_amount is null then
      v_amt := null;
    elsif t.currency_orig is not null then
      v_amt := round(p_amount, 2);
      v_rate := t.fx_rate;
    else
      v_amt := round(p_amount, 2);
    end if;
    update public.transactions
       set type = v_type,
           occurred_at = v_date,
           comment = coalesce(btrim(p_title), comment),
           category_id = case when v_cat_set then v_cat else category_id end,
           amount_orig = case when v_amt is not null and currency_orig is not null then v_amt else amount_orig end,
           amount_base = case when v_amt is null then amount_base
                              when currency_orig is not null then round(v_amt * v_rate, 2)
                              else v_amt end
     where id = p_id;
    return true;
  end if;

  v_cur := upper(btrim(p_currency));
  -- сумму трактуем в указанной валюте; не передали — берём то число, которое пользователь и видел
  v_amt := round(coalesce(p_amount, t.amount_orig, t.amount_base), 2);
  if not (v_amt > 0 and v_amt < 1e13) then raise exception 'bad amount'; end if;

  if v_cur = v_base then
    -- валюта совпала с базовой: исходные поля больше не нужны
    update public.transactions
       set type = v_type,
           occurred_at = v_date,
           comment = coalesce(btrim(p_title), comment),
           category_id = case when v_cat_set then v_cat else category_id end,
           amount_base = v_amt,
           base_currency = v_base,
           amount_orig = null, currency_orig = null, fx_rate = null, fx_date = null, fx_source = null
     where id = p_id;
    return true;
  end if;

  select f.date, f.source into v_fx
    from public.fx_rates f where f.date <= v_date order by f.date desc limit 1;
  v_rate := public._fx_pair(v_date, v_cur, v_base);
  if v_rate is null then raise exception 'no rate for % on %', v_cur, v_date; end if;
  if round(v_amt * v_rate, 2) <= 0 then raise exception 'bad amount'; end if;

  update public.transactions
     set type = v_type,
         occurred_at = v_date,
         comment = coalesce(btrim(p_title), comment),
         category_id = case when v_cat_set then v_cat else category_id end,
         amount_orig = v_amt,
         currency_orig = v_cur,
         fx_rate = round(v_rate, 8),
         fx_date = v_fx.date,
         fx_source = v_fx.source,
         amount_base = round(v_amt * v_rate, 2),
         base_currency = v_base
   where id = p_id;
  return true;
end $$;

revoke execute on function
  public.edit_transaction(uuid, uuid, numeric, text, text, date, text, text)
  from public, anon, authenticated;
