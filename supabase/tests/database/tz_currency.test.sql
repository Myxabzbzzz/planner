begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
insert into public.users (id, tg_id, name, is_allowed) values
  ('00000000-0000-0000-0000-0000000000c1', 81, 'U', true),
  ('00000000-0000-0000-0000-0000000000c2', 82, 'R', true),
  ('00000000-0000-0000-0000-0000000000c3', 83, 'C', true);
update public.users set tz = 'Europe/Berlin' where tg_id = 83;
select public.onboard_user('00000000-0000-0000-0000-0000000000c1', 'uzs');
select public.onboard_user('00000000-0000-0000-0000-0000000000c2', 'RUB');
select public.onboard_user('00000000-0000-0000-0000-0000000000c3', 'UZS');
select is((select tz from public.users where tg_id = 81), 'Asia/Tashkent', 'UZS → Tashkent');
select is((select tz from public.users where tg_id = 82), 'Europe/Moscow', 'RUB keeps Moscow');
select is((select tz from public.users where tg_id = 83), 'Europe/Berlin', 'explicit tz kept');
select * from finish();
rollback;
