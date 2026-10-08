-- Пробный Pro — один раз на Telegram-аккаунт.
-- Без этого можно удалить аккаунт (delete_account) и через /start получить новые 7 дней.
-- Храним только sha256 от tg_id: без имени, id пользователя и записей.
-- Внешнего ключа на users нет намеренно — запись должна пережить удаление аккаунта.

create table public.trial_claims (
  tg_hash text primary key,
  claimed_at timestamptz not null default now()
);
alter table public.trial_claims enable row level security;

-- Все, кто уже зарегистрирован, свой пробный период уже получили.
insert into public.trial_claims (tg_hash)
select encode(extensions.digest(tg_id::text, 'sha256'), 'hex') from public.users
on conflict do nothing;

-- Повторная регистрация того же tg_id — без пробного Pro (явно выданный «навсегда» не трогаем).
create function public.users_trial_once() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(extensions.digest(new.tg_id::text, 'sha256'), 'hex');
begin
  insert into public.trial_claims (tg_hash) values (v_hash) on conflict do nothing;
  if not found and new.pro_until is distinct from 'infinity'::timestamptz then
    new.pro_until := null;
  end if;
  return new;
end $$;

create trigger users_trial_once before insert on public.users
  for each row execute function public.users_trial_once();

revoke execute on function public.users_trial_once() from public, anon, authenticated;
