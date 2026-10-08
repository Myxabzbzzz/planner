begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- первая регистрация — 7 дней пробного Pro
insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000c001', 9801, 'Первый', 'Asia/Tashkent', true);
select ok((select pro_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
             from public.users where id = '00000000-0000-0000-0000-00000000c001'), 'first signup gets a 7-day trial');
select is(public.api_subscription('00000000-0000-0000-0000-00000000c001') ->> 'status', 'trial', 'first signup status is trial');

-- удалил аккаунт и пришёл снова — пробного Pro больше нет
select public.delete_account('00000000-0000-0000-0000-00000000c001');
insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000c002', 9801, 'Снова', 'Asia/Tashkent', true);
select is((select pro_until from public.users where id = '00000000-0000-0000-0000-00000000c002'), null,
          'returning tg_id gets no second trial');
select is(public.api_subscription('00000000-0000-0000-0000-00000000c002') ->> 'status', 'free', 'returning user is free');

-- явно выданный Pro навсегда не отнимается
select public.delete_account('00000000-0000-0000-0000-00000000c002');
insert into public.users (id, tg_id, name, tz, is_allowed, pro_until) values
  ('00000000-0000-0000-0000-00000000c003', 9801, 'Навсегда', 'Asia/Tashkent', true, 'infinity');
select is((select pro_until from public.users where id = '00000000-0000-0000-0000-00000000c003'), 'infinity'::timestamptz,
          'explicit lifetime Pro is kept for a returning tg_id');

-- другой человек получает свой пробный Pro
insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000c004', 9802, 'Другой', 'Asia/Tashkent', true);
select is(public.api_subscription('00000000-0000-0000-0000-00000000c004') ->> 'status', 'trial', 'different tg_id still gets a trial');

-- хранится только хэш: ни id, ни открытого tg_id
select is((select count(*)::int from public.trial_claims where tg_hash !~ '^[0-9a-f]{64}$'), 0, 'trial_claims holds only sha256 hex');
select is((select count(*)::int from public.trial_claims where tg_hash in ('9801', '9802')), 0, 'no plain tg_id in trial_claims');
select is((select count(*)::int from public.trial_claims
            where tg_hash = encode(extensions.digest('9801', 'sha256'), 'hex')), 1, 'one claim per tg_id');

-- бэкфилл: пользователь, который был до миграции (без записи в trial_claims), после неё учтён
alter table public.users disable trigger users_trial_once;
insert into public.users (id, tg_id, name, tz, is_allowed, pro_until) values
  ('00000000-0000-0000-0000-00000000c005', 9803, 'Старый', 'Asia/Tashkent', true, 'infinity');
alter table public.users enable trigger users_trial_once;
-- тот же оператор, что в миграции 20261012000001_trial_once.sql
insert into public.trial_claims (tg_hash)
select encode(extensions.digest(tg_id::text, 'sha256'), 'hex') from public.users
on conflict do nothing;
select public.delete_account('00000000-0000-0000-0000-00000000c005');
insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000c006', 9803, 'Старый снова', 'Asia/Tashkent', true);
select is((select pro_until from public.users where id = '00000000-0000-0000-0000-00000000c006'), null,
          'backfilled existing user gets no trial after re-signup');

-- таблица закрыта, функция триггера не вызывается снаружи
select is((select relrowsecurity from pg_class where oid = 'public.trial_claims'::regclass), true, 'RLS enabled on trial_claims');
select is(has_function_privilege('authenticated', 'public.users_trial_once()', 'execute'),
          false, 'trigger function not executable by authenticated');

select * from finish();
rollback;
