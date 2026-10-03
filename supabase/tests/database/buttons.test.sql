begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000a1', 11, 'A', true, 'Asia/Tashkent'),
  ('00000000-0000-0000-0000-0000000000b1', 12, 'B', true, 'Europe/Moscow');
select public.onboard_user('00000000-0000-0000-0000-0000000000a1', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-0000000000b1', 'UZS');

-- встреча сегодня в 02:00 по Ташкенту (в UTC это ещё вчера) и встреча завтра
insert into public.items (id, user_id, kind, title, starts_at) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'event', 'Утро',
   ((now() at time zone 'Asia/Tashkent')::date + time '02:00') at time zone 'Asia/Tashkent'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'event', 'Завтра',
   ((now() at time zone 'Asia/Tashkent')::date + 1 + time '10:00') at time zone 'Asia/Tashkent');
insert into public.items (id, user_id, kind, title, due_at) values
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'task', 'Просрочено', now() - interval '3 days'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'task', 'Без срока', null),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b1', 'task', 'Чужая', now());
insert into public.transactions (user_id, type, amount_base, base_currency, occurred_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'expense', 30000, 'UZS', (now() at time zone 'Asia/Tashkent')::date),
  ('00000000-0000-0000-0000-0000000000a1', 'expense', 5000, 'UZS', (now() at time zone 'Asia/Tashkent')::date - 40),
  ('00000000-0000-0000-0000-0000000000a1', 'income', 100000, 'UZS', (now() at time zone 'Asia/Tashkent')::date);
insert into public.habits (id, user_id, name) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'зарядка');

-- сводка «Сегодня»
select is(jsonb_array_length(public.summary_today('00000000-0000-0000-0000-0000000000a1')->'events'), 1, 'only today events (tz-aware)');
select is(public.summary_today('00000000-0000-0000-0000-0000000000a1')->'events'->0->>'title', 'Утро', '02:00 Tashkent counts as today');
select is(jsonb_array_length(public.summary_today('00000000-0000-0000-0000-0000000000a1')->'tasks'), 1, 'only due/overdue tasks');
select is((public.summary_today('00000000-0000-0000-0000-0000000000a1')->'tasks'->0->>'overdue')::boolean, true, 'overdue flag');
select is((public.summary_today('00000000-0000-0000-0000-0000000000a1')->>'spent_today')::numeric, 30000::numeric, 'spent today');

select is((public.summary_today('00000000-0000-0000-0000-0000000000a1')->>'tasks_more')::int, 0, 'tasks_more is 0 under the cap');

-- «Деньги»
select is((public.summary_money('00000000-0000-0000-0000-0000000000a1')->>'expense')::numeric, 30000::numeric, 'month expense excludes old');
select is((public.summary_money('00000000-0000-0000-0000-0000000000a1')->>'income')::numeric, 100000::numeric, 'month income');

-- «Задачи»
select is(jsonb_array_length(public.summary_tasks('00000000-0000-0000-0000-0000000000a1')->'tasks'), 2, 'own open tasks');
select is(public.summary_tasks('00000000-0000-0000-0000-0000000000a1')->'tasks'->0->>'title', 'Просрочено', 'dated first');

select is((public.summary_tasks('00000000-0000-0000-0000-0000000000a1')->>'total')::int, 2, 'total counts all open tasks');

-- отметка задач
select is(public.complete_task('00000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000003'), true, 'complete own task');
select is(public.complete_task('00000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000003'), false, 'already done');
select is(public.complete_task('00000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000005'), false, 'cannot complete others task');

-- привычки
select is(public.log_habit('00000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001'), true, 'log habit');
select public.log_habit('00000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.habit_logs where habit_id = '30000000-0000-0000-0000-000000000001'), 1, 'no duplicate log');
select is(public.log_habit('00000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000001'), false, 'cannot log others habit');
select is((public.summary_habits('00000000-0000-0000-0000-0000000000a1')->'habits'->0->>'done_today')::boolean, true, 'done today');
select is((public.summary_habits('00000000-0000-0000-0000-0000000000a1')->'habits'->0->>'streak')::int, 1, 'streak 1');

-- лимит
select public.set_limit('00000000-0000-0000-0000-0000000000a1', 5000000);
select is((public.summary_money('00000000-0000-0000-0000-0000000000a1')->>'limit')::numeric, 5000000::numeric, 'limit set');
select public.set_limit('00000000-0000-0000-0000-0000000000a1', 0);
select is(public.summary_money('00000000-0000-0000-0000-0000000000a1')->'limit', 'null'::jsonb, 'limit removed');

-- часовой пояс
select is(public.set_tz('00000000-0000-0000-0000-0000000000a1', 'Mars/Base'), false, 'unknown tz rejected');
select is(public.set_tz('00000000-0000-0000-0000-0000000000a1', 'Europe/Moscow'), true, 'known tz accepted');

-- токен
create temporary table old_tok as select capture_token from public.users where tg_id = 11;
select isnt(public.rotate_capture_token('00000000-0000-0000-0000-0000000000a1'),
            (select capture_token from old_tok), 'token rotated');
select is(public.summary_settings('00000000-0000-0000-0000-0000000000a1')->>'capture_token',
          (select capture_token from public.users where tg_id = 11), 'settings show current token');

-- права
select is(has_function_privilege('anon', 'public.summary_today(uuid)', 'execute'), false, 'anon cannot execute');
select is(has_function_privilege('authenticated', 'public.set_limit(uuid, numeric)', 'execute'), false, 'authenticated cannot execute');

select * from finish();
rollback;
