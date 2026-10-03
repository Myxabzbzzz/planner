-- при онбординге ставим часовой пояс по валюте, если пользователь его ещё не менял
create or replace function public.onboard_user(p_user_id uuid, p_currency text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.users
     set base_currency = upper(p_currency), onboarded_at = now(),
         tz = case when tz = 'Europe/Moscow' then
                case upper(p_currency) when 'UZS' then 'Asia/Tashkent' when 'KZT' then 'Asia/Almaty'
                                       when 'KGS' then 'Asia/Bishkek' when 'TJS' then 'Asia/Dushanbe'
                                       else tz end
              else tz end
   where id = p_user_id and onboarded_at is null;
  if not found then
    raise exception 'user % not found or already onboarded', p_user_id;
  end if;
  insert into public.categories (user_id, name, type, is_default)
  select p_user_id, v.n, v.t, true
    from (values ('еда','expense'), ('кафе','expense'), ('такси/транспорт','expense'),
                 ('дом','expense'), ('связь','expense'), ('подписки','expense'),
                 ('развлечения','expense'), ('здоровье','expense'), ('другое','expense'),
                 ('зарплата','income'), ('другое','income')) as v(n, t)
  on conflict do nothing;
end $$;

revoke execute on function public.onboard_user(uuid, text) from public, anon, authenticated;
