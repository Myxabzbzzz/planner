begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- даты правил
select is(public._next_occurrence('daily', '2026-10-15', '2026-10-15'), '2026-10-16'::date, 'daily: next day');
select is(public._next_occurrence('weekdays', '2026-10-15', '2026-10-16'), '2026-10-19'::date, 'weekdays: Friday → Monday');
select is(public._next_occurrence('weekly', '2026-10-15', '2026-10-15'), '2026-10-22'::date, 'weekly: same weekday a week later');
select is(public._next_occurrence('weekly', '2026-10-15', '2026-10-17'), '2026-10-22'::date, 'weekly: from Saturday to Thursday');
select is(public._next_occurrence('monthly', '2027-01-31', '2027-01-31'), '2027-02-28'::date, 'monthly: the 31st becomes the last day of February');
select is(public._next_occurrence('monthly', '2027-01-31', '2027-02-28'), '2027-03-31'::date, 'monthly: back to the 31st in March');

insert into public.users (id, tg_id, name, tz, is_allowed, onboarded_at, base_currency, pro_until) values
  ('00000000-0000-0000-0000-00000000ec01', 9951, 'Pro', 'Europe/Moscow', true, now(), 'RUB', 'infinity'),
  ('00000000-0000-0000-0000-00000000ec02', 9952, 'Free', 'Europe/Moscow', true, now(), 'RUB', null);

-- еженедельный созвон с 15.10 (чт) в 10:00
select isnt(public.create_recurrence('00000000-0000-0000-0000-00000000ec01', 'event', 'Созвон', '2026-10-15', '10:00',
  'Андрей', 'weekly'), null, 'recurrence created, instance id returned');
select is((select count(*)::int from public.items where user_id = '00000000-0000-0000-0000-00000000ec01'), 1,
  'one instance right away');
select is((select to_char(starts_at at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI') || ' ' || with_whom
             from public.items where user_id = '00000000-0000-0000-0000-00000000ec01'),
  '2026-10-15 10:00 Андрей', 'instance at the first date and time');

-- накануне ничего не создаётся, в день созвона появляется следующий
select is(public.spawn_recurrences('2026-10-14 12:00+03'), 0, 'nothing before the day comes');
select is(public.spawn_recurrences('2026-10-15 09:00+03'), 1, 'on the day the next one is created');
select is(public.spawn_recurrences('2026-10-15 09:01+03'), 0, 'and only once');
select is((select max(starts_at at time zone 'Europe/Moscow')::date from public.items
            where user_id = '00000000-0000-0000-0000-00000000ec01'), '2026-10-22'::date, 'next week');

-- после паузы — ближайшая дата, без россыпи пропущенных
select is(public.spawn_recurrences('2026-11-10 09:00+03'), 1, 'one instance after a long pause');
select is((select max(starts_at at time zone 'Europe/Moscow')::date from public.items
            where user_id = '00000000-0000-0000-0000-00000000ec01'), '2026-11-12'::date, 'the nearest Thursday, not the missed ones');

-- задача без времени по будням с субботы начинается с понедельника. Суббота следующей недели,
-- а не дата-константа: api_tasks('upcoming') сравнивает с настоящим сегодня (now())
select public.create_recurrence('00000000-0000-0000-0000-00000000ec01', 'task', 'Зарядка', (date_trunc('week', now() at time zone 'Europe/Moscow')::date + 12), null, null, 'weekdays');
select is((select (due_at at time zone 'Europe/Moscow')::date::text || ' ' || due_has_time
             from public.items where title = 'Зарядка'), (date_trunc('week', now() at time zone 'Europe/Moscow')::date + 14)::text || ' false', 'weekdays from Saturday start on Monday, no time');

-- в списке задач видно, что дело повторяется
select is((select t->'repeat'->>'freq' from jsonb_array_elements(
             public.api_tasks('00000000-0000-0000-0000-00000000ec01', 'upcoming')->'tasks') t
            where t->>'title' = 'Зарядка'), 'weekdays', 'api_tasks marks the repeat');

-- остановили — пометка пропала, новые не создаются
select is(public.stop_recurrence('00000000-0000-0000-0000-00000000ec01',
  (select id from public.recurrences where title = 'Зарядка')), true, 'stopped');
select is((select t->'repeat' from jsonb_array_elements(
             public.api_tasks('00000000-0000-0000-0000-00000000ec01', 'upcoming')->'tasks') t
            where t->>'title' = 'Зарядка'), 'null'::jsonb, 'no repeat mark after stop');

-- у Free повтор стоит на паузе
select public.create_recurrence('00000000-0000-0000-0000-00000000ec02', 'task', 'Отчёт', '2026-10-15', '18:00', null, 'daily');
select public.spawn_recurrences('2026-10-16 09:00+03');
select is((select count(*)::int from public.items where user_id = '00000000-0000-0000-0000-00000000ec02'), 1,
  'Free user gets no new instances');

-- созданный голосом повтор: «Отменить» ставит его на паузу, «Вернуть» — продолжает
insert into public.inbox (id, user_id, source, text, status) values
  ('00000000-0000-0000-0000-00000000ec10', '00000000-0000-0000-0000-00000000ec01', 'text', 'каждый вторник бассейн', 'done');
select public.create_recurrence('00000000-0000-0000-0000-00000000ec01', 'task', 'Бассейн', '2026-10-20', '19:00', null,
  'weekly', '00000000-0000-0000-0000-00000000ec10');
select public.delete_inbox_records('00000000-0000-0000-0000-00000000ec01', '00000000-0000-0000-0000-00000000ec10');
select is((select count(*)::int from public.items where title = 'Бассейн' and deleted_at is null), 0, 'undo hides the first instance');
select public.spawn_recurrences('2026-10-20 09:00+03');
select is((select count(*)::int from public.items where title = 'Бассейн'), 1, 'an undone repeat does not spawn');
select public.restore_inbox_records('00000000-0000-0000-0000-00000000ec01', '00000000-0000-0000-0000-00000000ec10');
select public.spawn_recurrences('2026-10-20 09:05+03');
select is((select count(*)::int from public.items where title = 'Бассейн' and deleted_at is null), 2,
  'restored — the repeat goes on');

select * from finish();
rollback;
