begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into public.users (id, tg_id, name, is_allowed) values
  ('00000000-0000-0000-0000-00000000f201', 9301, 'A', true),
  ('00000000-0000-0000-0000-00000000f202', 9302, 'B', true);

select is(public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', 3, interval '1 minute'), true, 'first attempt allowed');
select is(public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', 3, interval '1 minute'), true, 'second allowed');
select is(public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', 3, interval '1 minute'), true, 'third allowed');
select is(public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', 3, interval '1 minute'), false, 'fourth over the limit');
select is(public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', 3, interval '1 minute'), false, 'still over');
select is((select count(*)::int from public.rate_events where user_id = '00000000-0000-0000-0000-00000000f201'), 5, 'every attempt is recorded, including the rejected ones');

-- счётчики раздельные по действию и по пользователю
select is(public.rate_limit('00000000-0000-0000-0000-00000000f201', 'export', 3, interval '1 minute'), true, 'another action has its own counter');
select is(public.rate_limit('00000000-0000-0000-0000-00000000f202', 'capture', 3, interval '1 minute'), true, 'another user has their own counter');

-- окно сдвинулось — старые попытки не считаются
update public.rate_events set at = at - interval '2 minutes'
 where user_id = '00000000-0000-0000-0000-00000000f201' and action = 'capture';
select is(public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', 3, interval '1 minute'), true, 'attempts outside the window do not count');

-- limit = 0 запрещает всё
select is(public.rate_limit('00000000-0000-0000-0000-00000000f202', 'blocked', 0, interval '1 minute'), false, 'zero limit blocks everything');

select throws_ok($$select public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', -1, interval '1 minute')$$,
  'P0001', 'bad limit', 'negative limit rejected');
select throws_ok($$select public.rate_limit('00000000-0000-0000-0000-00000000f201', '  ', 3, interval '1 minute')$$,
  'P0001', 'bad action', 'blank action rejected');
select throws_ok($$select public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', 3, interval '0')$$,
  'P0001', 'bad window', 'non-positive window rejected');
select throws_ok($$select public.rate_limit(null, 'capture', 3, interval '1 minute')$$,
  'P0001', 'bad user', 'null user rejected');

-- уборка
select is(public.purge_rate_events(now() + interval '1 minute'), 9, 'purge removes everything older than the cutoff');
select is((select count(*)::int from public.rate_events), 0, 'table empty after purge');
select throws_ok($$select public.purge_rate_events(null)$$, 'P0001', 'bad before', 'purge validates argument');

-- строки уходят вместе с пользователем
select public.rate_limit('00000000-0000-0000-0000-00000000f201', 'capture', 3, interval '1 minute');
delete from public.users where id = '00000000-0000-0000-0000-00000000f201';
select is((select count(*)::int from public.rate_events where user_id = '00000000-0000-0000-0000-00000000f201'), 0, 'rate_events cascade with the user');

select is(has_function_privilege('authenticated', 'public.rate_limit(uuid, text, int, interval)', 'execute'), false, 'rate_limit not exposed');

select * from finish();
rollback;
