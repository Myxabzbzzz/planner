-- Согласие с пользовательским соглашением и политикой: новый человек после /start
-- сначала видит ссылки и кнопку «Принимаю», и только потом — выбор валюты.
-- Когда и какую редакцию принял — храним: это нужно платёжному сервису и банку.
-- Тем, кто пользовался ботом раньше, засчитываем дату регистрации: соглашение говорит,
-- что пользование сервисом означает согласие, а дёргать их второй раз незачем.

alter table public.users
  add column terms_accepted_at timestamptz,
  add column terms_version text;

update public.users set terms_accepted_at = coalesce(onboarded_at, created_at), terms_version = 'before-2026-10-15'
 where onboarded_at is not null;

create function public.accept_terms(p_user uuid, p_version text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_version is null or length(p_version) > 40 then raise exception 'bad version'; end if;
  update public.users set terms_accepted_at = now(), terms_version = p_version
   where id = p_user and terms_accepted_at is null;
  return found;
end $$;

revoke execute on function public.accept_terms(uuid, text) from public, anon, authenticated;
