-- правка и удаление операций из миниаппа; null в аргументе = не менять
create function public.update_transaction(p_user uuid, p_id uuid, p_amount numeric, p_title text, p_category text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  t public.transactions%rowtype;
  v_cat uuid;
begin
  select * into t from public.transactions where id = p_id and user_id = p_user for update;
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

create function public.delete_transaction(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.transactions where id = p_id and user_id = p_user;
  return found;
end $$;

create function public.api_categories(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'expense', coalesce((select jsonb_agg(name order by name) from public.categories where user_id = p_user and type = 'expense'), '[]'::jsonb),
    'income', coalesce((select jsonb_agg(name order by name) from public.categories where user_id = p_user and type = 'income'), '[]'::jsonb));
$$;

revoke execute on function public.update_transaction(uuid, uuid, numeric, text, text),
  public.delete_transaction(uuid, uuid), public.api_categories(uuid)
  from public, anon, authenticated;
