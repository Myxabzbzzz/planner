-- Оформление (Pro): тема и цвет акцента мини-приложения.
-- Хранится на сервере, чтобы совпадало на телефоне и на компьютере. Без Pro api_settings
-- отдаёт оформление по умолчанию, но выбор не стирается — вернётся вместе с Pro.

alter table public.users
  add column ui_theme text not null default 'auto' check (ui_theme in ('auto', 'light', 'dark')),
  add column ui_accent text not null default 'amber' check (ui_accent in ('amber', 'ocean', 'mint', 'berry', 'violet'));

create or replace function public.api_settings(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'name', u.name,
           'tz', u.tz,
           'base_currency', u.base_currency,
           'limit', (select monthly_limit from public.budgets
                      where user_id = u.id and category_id is null),
           'notify_reminders', u.notify_reminders,
           'notify_daily', u.notify_daily,
           'notify_weekly', u.notify_weekly,
           'theme', case when u.pro_until > now() then u.ui_theme else 'auto' end,
           'accent', case when u.pro_until > now() then u.ui_accent else 'amber' end)
    from public.users u where u.id = p_user;
$$;

create function public.set_appearance(p_user uuid, p_theme text, p_accent text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_theme not in ('auto', 'light', 'dark') or p_accent not in ('amber', 'ocean', 'mint', 'berry', 'violet') then
    raise exception 'bad appearance';
  end if;
  update public.users set ui_theme = p_theme, ui_accent = p_accent where id = p_user;
  return found;
end $$;

revoke execute on function public.set_appearance(uuid, text, text) from public, anon, authenticated;
