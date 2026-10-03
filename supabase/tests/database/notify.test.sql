begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000a7', 71, 'A', true, 'Asia/Tashkent'),
  ('00000000-0000-0000-0000-0000000000b7', 72, 'B', true, 'Asia/Tashkent');
select public.onboard_user('00000000-0000-0000-0000-0000000000a7', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-0000000000b7', 'UZS');
update public.users set notify_daily = false, notify_reminders = false where tg_id = 72;

-- p_now = 2026-10-04 21:40 по Ташкенту (воскресенье)
-- digests
select is((select count(*)::int from public.due_digests('2026-10-04 16:29+00')), 0, 'no digests at 21:29');
select is((select count(*)::int from public.due_digests('2026-10-04 16:40+00') where user_id = '00000000-0000-0000-0000-0000000000a7'), 2, 'daily + weekly on sunday');
select is((select kind from public.due_digests('2026-10-04 16:40+00') where user_id = '00000000-0000-0000-0000-0000000000a7' limit 1), 'daily', 'daily first');
select is((select count(*)::int from public.due_digests('2026-10-04 16:40+00') where user_id = '00000000-0000-0000-0000-0000000000b7'), 1, 'B: weekly only (daily off)');
select is((select count(*)::int from public.due_digests('2026-10-03 16:40+00') where kind = 'weekly'), 0, 'no weekly on saturday');
select public.mark_digest('00000000-0000-0000-0000-0000000000a7', 'daily', '2026-10-04');
select is((select count(*)::int from public.due_digests('2026-10-04 16:45+00') where user_id = '00000000-0000-0000-0000-0000000000a7' and kind = 'daily'), 0, 'daily not repeated');
select is((select count(*)::int from public.due_digests('2026-10-04 16:45+00') where user_id = '00000000-0000-0000-0000-0000000000a7' and kind = 'weekly'), 1, 'weekly still due');

-- reminders
insert into public.items (id, user_id, kind, title, starts_at) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a7', 'event', 'Скоро', '2026-10-04 17:00+00'),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a7', 'event', 'Не скоро', '2026-10-04 17:20+00'),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a7', 'event', 'Прошла', '2026-10-04 17:00+00'),
  ('70000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b7', 'event', 'У B', '2026-10-04 17:00+00');
update public.items set done_at = '2026-10-04 16:00+00' where id = '70000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.due_reminders('2026-10-04 16:40+00')), 1, 'only the due, undone, enabled one');
select is((select local_time from public.due_reminders('2026-10-04 16:40+00')), '22:00', 'local time');
select is((select minutes_left from public.due_reminders('2026-10-04 16:40+00')), 20, 'minutes left');
select is((select chat_id from public.due_reminders('2026-10-04 16:40+00')), 71::bigint, 'chat id');
select public.mark_reminded(array['70000000-0000-0000-0000-000000000001'::uuid]);
select is((select count(*)::int from public.due_reminders('2026-10-04 16:45+00')), 0, 'reminded once');

-- daily digest
insert into public.items (user_id, kind, title, due_at, done_at) values
  ('00000000-0000-0000-0000-0000000000a7', 'task', 'Сделано', '2026-10-04 10:00+00', '2026-10-04 12:00+00'),
  ('00000000-0000-0000-0000-0000000000a7', 'task', 'Не успел', '2026-10-04 10:00+00', null),
  ('00000000-0000-0000-0000-0000000000a7', 'task', 'Завтра', '2026-10-05 10:00+00', null);
insert into public.items (user_id, kind, title, starts_at) values
  ('00000000-0000-0000-0000-0000000000a7', 'event', 'Созвон', '2026-10-05 05:00+00');
insert into public.transactions (user_id, type, amount_base, base_currency, occurred_at) values
  ('00000000-0000-0000-0000-0000000000a7', 'expense', 280000, 'UZS', '2026-10-04'),
  ('00000000-0000-0000-0000-0000000000a7', 'expense', 100000, 'UZS', '2026-09-30'),
  ('00000000-0000-0000-0000-0000000000a7', 'expense', 50000, 'UZS', '2026-09-25');
select is((public.digest_daily('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->>'tasks_done')::int, 1, 'tasks done today');
select is((public.digest_daily('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->'tasks_left'->>0), 'Не успел', 'tasks left');
select is((public.digest_daily('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->>'spent')::numeric, 280000::numeric, 'spent today');
select is((public.digest_daily('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->'tomorrow_events'->0->>'time'), '10:00', 'tomorrow event local time');
select is((public.digest_daily('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->>'tomorrow_tasks')::int, 1, 'tomorrow tasks');
select is((public.digest_daily('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->>'events_done')::int, 1, 'events done (marked one)');

-- weekly digest: неделя 28.09–04.10
select is(public.digest_weekly('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->>'from', '2026-09-28', 'week starts monday');
select is((public.digest_weekly('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->>'expense')::numeric, 380000::numeric, 'week expense');
select is((public.digest_weekly('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->>'prev_expense')::numeric, 50000::numeric, 'prev week expense');
select is((public.digest_weekly('00000000-0000-0000-0000-0000000000a7', '2026-10-04 16:40+00')->>'next_events')::int, 1, 'events ahead');

-- marks
select is(public.set_item_done('00000000-0000-0000-0000-0000000000a7', '70000000-0000-0000-0000-000000000002', true), true, 'mark event done');
select is(public.set_item_done('00000000-0000-0000-0000-0000000000b7', '70000000-0000-0000-0000-000000000002', false), false, 'cannot touch others');
insert into public.habits (id, user_id, name) values ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a7', 'зарядка');
select is(public.set_habit_today('00000000-0000-0000-0000-0000000000a7', '80000000-0000-0000-0000-000000000001', true), true, 'habit on');
select is((select count(*)::int from public.habit_logs where habit_id = '80000000-0000-0000-0000-000000000001'), 1, 'one log');
select public.set_habit_today('00000000-0000-0000-0000-0000000000a7', '80000000-0000-0000-0000-000000000001', false);
select is((select count(*)::int from public.habit_logs where habit_id = '80000000-0000-0000-0000-000000000001'), 0, 'log removed');

-- notify toggles, settings, today events
select public.set_notify('00000000-0000-0000-0000-0000000000a7', 'weekly', false);
select is((public.summary_settings('00000000-0000-0000-0000-0000000000a7')->>'notify_weekly')::boolean, false, 'toggle stored and exposed');
select throws_ok($$select public.set_notify('00000000-0000-0000-0000-0000000000a7', 'bogus', true)$$, 'P0001', null, 'bad kind');
select is(has_function_privilege('authenticated', 'public.due_digests(timestamptz)', 'execute'), false, 'no client access');

select * from finish();
rollback;
