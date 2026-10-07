begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into public.users (id, tg_id, name, tz, is_allowed, notify_reminders) values
  ('00000000-0000-0000-0000-00000000f701', 9801, 'A', 'Asia/Tashkent', true, true);
select public.onboard_user('00000000-0000-0000-0000-00000000f701', 'UZS');

-- #32: 23:59 всё ещё хранится, когда времени нет, но правду говорит флаг.
-- create_task вызываем отдельным оператором: внутри одного SELECT вставленная
-- строка ещё не видна его снимку.
select public.create_task('00000000-0000-0000-0000-00000000f701', 'Без времени', current_date + 5, null);
select public.create_task('00000000-0000-0000-0000-00000000f701', 'В 15:00', current_date + 5, '15:00');
select public.create_task('00000000-0000-0000-0000-00000000f701', 'Ровно 23:59', current_date + 5, '23:59', true);
select public.create_task('00000000-0000-0000-0000-00000000f701', 'Явно без', current_date + 6, '23:59', false);
select public.create_task('00000000-0000-0000-0000-00000000f701', 'Без срока', null, null);

select is((select due_has_time from public.items where user_id = '00000000-0000-0000-0000-00000000f701' and title = 'Без времени'), false, 'no time given => flag false');
select is((select to_char(due_at at time zone 'Asia/Tashkent', 'HH24:MI') from public.items
            where user_id = '00000000-0000-0000-0000-00000000f701' and title = 'Без времени'), '23:59', '23:59 is still what gets stored');
select is((select due_has_time from public.items where user_id = '00000000-0000-0000-0000-00000000f701' and title = 'В 15:00'), true, 'time given => flag true');
-- задача ровно на 23:59 теперь возможна
select is((select due_has_time from public.items where user_id = '00000000-0000-0000-0000-00000000f701' and title = 'Ровно 23:59'), true, 'a task genuinely due at 23:59 is expressible');
select is((select due_has_time from public.items where user_id = '00000000-0000-0000-0000-00000000f701' and title = 'Явно без'), false, 'explicit has_time=false is honoured');
select is((select due_has_time from public.items where user_id = '00000000-0000-0000-0000-00000000f701' and title = 'Без срока'), false, 'no due date => flag false');
select throws_ok($$select public.create_task('00000000-0000-0000-0000-00000000f701', 'X', current_date + 5, null, true)$$,
  'P0001', 'has_time without time', 'cannot claim a time without giving one');

-- строки, вставленные в обход create_task (воркер, миниапп), получают флаг от триггера
insert into public.items (id, user_id, kind, title, due_at) values
  ('00000000-0000-0000-0000-00000000f711', '00000000-0000-0000-0000-00000000f701', 'task', 'Сырой инсерт 10:00',
    (current_date + 5 + time '10:00') at time zone 'Asia/Tashkent'),
  ('00000000-0000-0000-0000-00000000f712', '00000000-0000-0000-0000-00000000f701', 'task', 'Сырой инсерт 23:59',
    (current_date + 5 + time '23:59') at time zone 'Asia/Tashkent');
select is((select due_has_time from public.items where id = '00000000-0000-0000-0000-00000000f711'), true, 'raw insert with a real time gets the flag');
select is((select due_has_time from public.items where id = '00000000-0000-0000-0000-00000000f712'), false, 'raw insert at 23:59 keeps the old meaning');

-- update_task
select is(public.update_task('00000000-0000-0000-0000-00000000f701', '00000000-0000-0000-0000-00000000f711', null, current_date + 7, null, null), true, 'update without time ok');
select is((select due_has_time from public.items where id = '00000000-0000-0000-0000-00000000f711'), false, 'rescheduling without a time clears the flag');
select is(public.update_task('00000000-0000-0000-0000-00000000f701', '00000000-0000-0000-0000-00000000f711', null, current_date + 7, '09:30', null), true, 'update with time ok');
select is((select due_has_time from public.items where id = '00000000-0000-0000-0000-00000000f711'), true, 'rescheduling with a time sets the flag');
select is(public.update_task('00000000-0000-0000-0000-00000000f701', '00000000-0000-0000-0000-00000000f711', 'Только название', null, null, null), true, 'title-only update ok');
select is((select due_has_time from public.items where id = '00000000-0000-0000-0000-00000000f711'), true, 'a title-only update leaves the flag alone');
select is(public.update_task('00000000-0000-0000-0000-00000000f701', '00000000-0000-0000-0000-00000000f711', null, null, null, true), true, 'clearing the due date ok');
select is((select due_has_time from public.items where id = '00000000-0000-0000-0000-00000000f711'), false, 'clearing the due date clears the flag');
select is(public.update_task('00000000-0000-0000-0000-00000000f701', '00000000-0000-0000-0000-00000000f712', null, current_date + 8, '23:59', null, true), true, 'explicit has_time on update ok');
select is((select due_has_time from public.items where id = '00000000-0000-0000-0000-00000000f712'), true, 'explicit has_time=true honoured on update');

-- флаг виден всем читателям
select is(public.api_tasks('00000000-0000-0000-0000-00000000f701', 'upcoming')->'tasks'->0 ? 'due_has_time', true, 'api_tasks returns due_has_time');
select is(public.summary_tasks('00000000-0000-0000-0000-00000000f701')->'tasks'->0 ? 'due_has_time', true, 'summary_tasks returns due_has_time');

-- напоминания читают флаг, а не 23:59
insert into public.items (id, user_id, kind, title, due_at, due_has_time) values
  ('00000000-0000-0000-0000-00000000f721', '00000000-0000-0000-0000-00000000f701', 'task', 'Настоящие 23:59',
    (date '2026-11-10' + time '23:59') at time zone 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f722', '00000000-0000-0000-0000-00000000f701', 'task', 'Срок без времени',
    (date '2026-11-10' + time '23:59') at time zone 'Asia/Tashkent', false);
select is((select local_time from public.due_reminders((date '2026-11-10' + time '23:40') at time zone 'Asia/Tashkent')
            where item_id = '00000000-0000-0000-0000-00000000f721'), '23:59', 'a real 23:59 task reports its time');
select is((select local_time from public.due_reminders((date '2026-11-10' + time '23:40') at time zone 'Asia/Tashkent')
            where item_id = '00000000-0000-0000-0000-00000000f722'), null, 'a no-time deadline reports no time');
select is((select count(*)::int from public.due_reminders((date '2026-11-10' + time '10:30') at time zone 'Asia/Tashkent')
            where item_id = '00000000-0000-0000-0000-00000000f721'), 0, 'the real 23:59 task is not reminded in the morning');
select is((select count(*)::int from public.due_reminders((date '2026-11-10' + time '10:30') at time zone 'Asia/Tashkent')
            where item_id = '00000000-0000-0000-0000-00000000f722'), 1, 'the no-time deadline is reminded in the morning');

-- старые 4/6-аргументные вызовы продолжают работать
select public.create_task('00000000-0000-0000-0000-00000000f701', 'Старый вызов', current_date + 9, '08:00');
select is((select due_has_time from public.items where user_id = '00000000-0000-0000-0000-00000000f701' and title = 'Старый вызов'), true, 'legacy create_task derives the flag');
select is(has_function_privilege('authenticated', 'public.create_task(uuid, text, date, text, boolean)', 'execute'), false, 'create_task/5 not exposed');

select * from finish();
rollback;
