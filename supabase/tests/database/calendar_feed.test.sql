begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.users (id, tg_id, name, tz, is_allowed, onboarded_at, base_currency, pro_until) values
  ('00000000-0000-0000-0000-0000000ca101', 9971, 'A', 'Europe/Moscow', true, now(), 'RUB', 'infinity'),
  ('00000000-0000-0000-0000-0000000ca102', 9972, 'B', 'Europe/Moscow', true, now(), 'RUB', 'infinity');

select isnt((select calendar_token from public.users where id = '00000000-0000-0000-0000-0000000ca101'),
            (select calendar_token from public.users where id = '00000000-0000-0000-0000-0000000ca102'), 'tokens differ');

insert into public.items (user_id, kind, title, starts_at, with_whom) values
  ('00000000-0000-0000-0000-0000000ca101', 'event', 'Созвон', now() + interval '1 day', 'Андрей'),
  ('00000000-0000-0000-0000-0000000ca101', 'event', 'Давно', now() - interval '90 days', null);
insert into public.items (user_id, kind, title, due_at, done_at) values
  ('00000000-0000-0000-0000-0000000ca101', 'task', 'Купить хлеб', now() + interval '2 days', null),
  ('00000000-0000-0000-0000-0000000ca101', 'task', 'Сделано', now() + interval '2 days', now());

select is(jsonb_array_length(public.calendar_feed((select calendar_token from public.users where id = '00000000-0000-0000-0000-0000000ca101'))->'events'),
  1, 'old events fall out of the window');
select is((public.calendar_feed((select calendar_token from public.users where id = '00000000-0000-0000-0000-0000000ca101'))->'events'->0->>'with_whom'),
  'Андрей', 'event details');
select is((select jsonb_agg(t->>'title') from jsonb_array_elements(public.calendar_feed(
  (select calendar_token from public.users where id = '00000000-0000-0000-0000-0000000ca101'))->'tasks') t),
  '["Купить хлеб"]'::jsonb, 'only open tasks');
select is(public.calendar_feed('nope'), null, 'garbage token');

-- сброс: старая ссылка перестаёт работать
create temp table old as select calendar_token as t from public.users where id = '00000000-0000-0000-0000-0000000ca101';
select isnt(public.reset_calendar_token('00000000-0000-0000-0000-0000000ca101')->>'token', (select t from old), 'new token');
select is(public.calendar_feed((select t from old)), null, 'old link is dead');

update public.users set pro_until = null where id = '00000000-0000-0000-0000-0000000ca101';
select is((public.calendar_feed((select calendar_token from public.users where id = '00000000-0000-0000-0000-0000000ca101'))->>'pro')::boolean,
  false, 'feed says when there is no Pro');

select * from finish();
rollback;
