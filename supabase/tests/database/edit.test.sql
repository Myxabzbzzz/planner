begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000a6', 61, 'A', true, 'Asia/Tashkent'),
  ('00000000-0000-0000-0000-0000000000b6', 62, 'B', true, 'Asia/Tashkent');
select public.onboard_user('00000000-0000-0000-0000-0000000000a6', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-0000000000b6', 'UZS');

insert into public.items (id, user_id, kind, title, due_at) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a6', 'task', 'Оплатить', now() + interval '1 day'),
  ('60000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b6', 'task', 'Чужая', null);
insert into public.items (id, user_id, kind, title, starts_at, with_whom, reminded_at) values
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a6', 'event', 'Встреча',
   '2026-10-06 10:00:30+00', 'Ахмед', now());
insert into public.notes (id, user_id, kind, text) values
  ('60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a6', 'thought', 'Идея');
insert into public.habits (id, user_id, name) values
  ('60000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a6', 'чтение'),
  ('60000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a6', 'зарядка'),
  ('60000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a6', 'старая');
update public.habits set archived_at = now() where id = '60000000-0000-0000-0000-000000000006';

-- задача
select is(public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', '  Оплатить интернет ', null, null, false), true, 'task title');
select is((select title from public.items where id = '60000000-0000-0000-0000-000000000001'), 'Оплатить интернет', 'title trimmed');
select public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', null, '2026-10-10', '09:30', false);
select is((select due_at from public.items where id = '60000000-0000-0000-0000-000000000001'), '2026-10-10 04:30+00'::timestamptz, 'due date+time in user tz');
select public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', null, '2026-10-11', null, false);
select is((select due_at from public.items where id = '60000000-0000-0000-0000-000000000001'), '2026-10-11 18:59+00'::timestamptz, 'date only = 23:59 local');
select public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', null, null, null, true);
select is((select due_at from public.items where id = '60000000-0000-0000-0000-000000000001'), null, 'clear due');
select throws_ok($$select public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', '  ', null, null, false)$$, 'P0001', null, 'blank title raises');
select throws_ok($$select public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', null, null, '10:00', false)$$, 'P0001', null, 'time without date raises');
select throws_ok($$select public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', null, '2026-10-10', '25:00', false)$$, 'P0001', null, 'bad time raises');
select throws_ok($$select public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', null, '2036-10-10', null, false)$$, 'P0001', null, 'far date raises');
select is(public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000009', 'x', null, null, false), false, 'other user task');
select is(public.update_task('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', 'x', null, null, false), false, 'event id is not a task');

-- встреча (10:00:30 UTC = 15:00:30 Ташкент)
select is(public.update_event('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', 'Встреча с Ахмедом', null, null, null), true, 'event title');
select isnt((select reminded_at from public.items where id = '60000000-0000-0000-0000-000000000002'), null, 'title-only edit keeps reminded_at');
select public.update_event('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', null, null, '16:30', null);
select is((select starts_at from public.items where id = '60000000-0000-0000-0000-000000000002'), '2026-10-06 11:30+00'::timestamptz, 'time only keeps local date');
select is((select reminded_at from public.items where id = '60000000-0000-0000-0000-000000000002'), null, 'moved event resets reminded_at');
select public.update_event('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', null, '2026-10-08', null, null);
select is((select starts_at from public.items where id = '60000000-0000-0000-0000-000000000002'), '2026-10-08 11:30+00'::timestamptz, 'date only keeps local time');
select public.update_event('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', null, null, null, '');
select is((select with_whom from public.items where id = '60000000-0000-0000-0000-000000000002'), null, 'empty with_whom clears');
select public.update_event('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', null, null, null, ' Олег ');
select is((select with_whom from public.items where id = '60000000-0000-0000-0000-000000000002'), 'Олег', 'with_whom set');
select throws_ok($$select public.update_event('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', null, null, '7:5', null)$$, 'P0001', null, 'bad event time raises');

-- удаление
select is(public.delete_item('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000009', 'task'), false, 'cannot delete others');
select is(public.delete_item('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', 'task'), false, 'kind must match');
select is(public.delete_item('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', 'event'), true, 'delete event');
select throws_ok($$select public.delete_item('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', 'note')$$, 'P0001', null, 'bad kind raises');

-- заметка
select is(public.update_note('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000003', 'Идея кофейни', 'journal'), true, 'note update');
select is((select kind || ':' || text from public.notes where id = '60000000-0000-0000-0000-000000000003'), 'journal:Идея кофейни', 'note fields');
select throws_ok($$select public.update_note('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000003', repeat('x', 4001), null)$$, 'P0001', null, 'long note raises');
select is(public.delete_note('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000003'), true, 'delete note');

-- привычки
select throws_ok($$select public.update_habit('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000004', 'зарядка', null)$$, 'P0001', null, 'rename to taken name raises');
select throws_ok($$select public.update_habit('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000004', 'старая', null)$$, 'P0001', null, 'rename to archived name raises');
select throws_ok($$select public.update_habit('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000004', null, 8)$$, 'P0001', null, 'target 8 raises');
select is(public.update_habit('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000004', 'книги', 3), true, 'habit update');
select is(public.archive_habit('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000004'), true, 'archive');
select is(public.update_habit('00000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000004', 'ещё', null), false, 'archived habit not editable');

-- поля для шторок
insert into public.items (user_id, kind, title, starts_at, with_whom) values
  ('00000000-0000-0000-0000-0000000000a6', 'event', 'Сейчас', now(), 'Андрей');
select is(public.summary_today('00000000-0000-0000-0000-0000000000a6')->'events'->0->>'with_whom', 'Андрей', 'summary event with_whom');
select is((public.api_habits('00000000-0000-0000-0000-0000000000a6', 4)->'habits'->0->>'target_per_week')::int, 7, 'habit target in api');

select is(has_function_privilege('anon', 'public.update_task(uuid, uuid, text, date, text, boolean)', 'execute'), false, 'anon cannot execute');

select * from finish();
rollback;
