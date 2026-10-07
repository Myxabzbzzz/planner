-- #19: лимиты по категориям существовали в схеме, но записать их было нечем.
-- Плюс категорией наконец можно управлять: создать, переименовать, удалить.

create function public.set_category_limit(p_user uuid, p_category text, p_amount numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_cat uuid;
begin
  if p_amount is null or p_amount < 0 or p_amount >= 1e13 then raise exception 'bad amount'; end if;
  if p_category is null or btrim(p_category) = '' then raise exception 'bad category'; end if;
  perform 1 from public.users where id = p_user;
  if not found then return false; end if;
  -- лимиты имеют смысл только для расходов
  select id into v_cat from public.categories
   where user_id = p_user and type = 'expense' and name = btrim(p_category);
  if v_cat is null then raise exception 'bad category'; end if;

  delete from public.budgets where user_id = p_user and category_id = v_cat;
  if p_amount > 0 then
    insert into public.budgets (user_id, category_id, monthly_limit) values (p_user, v_cat, p_amount);
  end if;
  return true;
end $$;

-- Лимиты и траты за месяц: и категории с лимитом, и категории, где просто тратили.
create function public.api_budgets(p_user uuid, p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cur text;
  v_start date;
  v_end date;
begin
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'bad month'; end if;
  select base_currency into v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month')::date;
  return jsonb_build_object(
    'base_currency', v_cur,
    'month', p_month,
    'overall', jsonb_build_object(
      'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null),
      'spent', coalesce((select sum(amount_base) from public.transactions
                          where user_id = p_user and type = 'expense' and deleted_at is null
                            and occurred_at >= v_start and occurred_at < v_end), 0)),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'limit', s.lim, 'spent', s.spent)
                       order by s.spent desc, s.name)
        from (
          select c.name,
                 (select b.monthly_limit from public.budgets b
                   where b.user_id = p_user and b.category_id = c.id) as lim,
                 coalesce((select sum(t.amount_base) from public.transactions t
                            where t.user_id = p_user and t.category_id = c.id
                              and t.type = 'expense' and t.deleted_at is null
                              and t.occurred_at >= v_start and t.occurred_at < v_end), 0) as spent
            from public.categories c
           where c.user_id = p_user and c.type = 'expense'
        ) s
       where s.lim is not null or s.spent > 0), '[]'::jsonb),
    -- траты без категории: лимита у них быть не может, но из суммы по категориям они иначе выпадают
    'uncategorized', coalesce((select sum(amount_base) from public.transactions
                                where user_id = p_user and type = 'expense' and deleted_at is null
                                  and category_id is null
                                  and occurred_at >= v_start and occurred_at < v_end), 0)
  );
end $$;

create function public.rename_category(p_user uuid, p_id uuid, p_name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  if p_name is null or btrim(p_name) = '' or length(btrim(p_name)) > 50 then raise exception 'bad name'; end if;
  select type into v_type from public.categories where id = p_id and user_id = p_user for update;
  if not found then return false; end if;
  if exists (select 1 from public.categories
              where user_id = p_user and type = v_type and name = btrim(p_name) and id <> p_id) then
    raise exception 'duplicate name';
  end if;
  update public.categories set name = btrim(p_name) where id = p_id;
  return true;
end $$;

-- Операции остаются, их category_id обнуляется (FK on delete set null);
-- лимит этой категории уходит каскадом.
create function public.delete_category(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.categories where id = p_id and user_id = p_user;
  return found;
end $$;

-- ВНИМАНИЕ: форма ответа изменилась. Было ["еда","кафе"], стало [{"id":…,"name":…}] —
-- иначе переименовать и удалить категорию из клиента нечем.
create or replace function public.api_categories(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'expense', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
                           from public.categories where user_id = p_user and type = 'expense'), '[]'::jsonb),
    'income', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
                          from public.categories where user_id = p_user and type = 'income'), '[]'::jsonb));
$$;

revoke execute on function
  public.set_category_limit(uuid, text, numeric), public.api_budgets(uuid, text),
  public.rename_category(uuid, uuid, text), public.delete_category(uuid, uuid)
  from public, anon, authenticated;
