-- Свой цвет у категории расходов. Храним ключ слота палитры, а не hex:
-- у каждого слота свой оттенок в тёмной и светлой теме, их подбирает клиент.
-- null — цвета нет, категория красится по месту в рейтинге, как раньше.

alter table public.categories add column color text
  check (color in ('blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'));

create function public.set_category_color(p_user uuid, p_id uuid, p_color text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_color is not null
     and p_color not in ('blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red') then
    raise exception 'bad color';
  end if;
  update public.categories set color = p_color where id = p_id and user_id = p_user;
  return found;
end $$;

create or replace function public.api_categories(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'expense', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'color', color) order by name)
                           from public.categories where user_id = p_user and type = 'expense'), '[]'::jsonb),
    'income', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'color', color) order by name)
                          from public.categories where user_id = p_user and type = 'income'), '[]'::jsonb));
$$;

revoke execute on function public.set_category_color(uuid, uuid, text) from public, anon, authenticated;
