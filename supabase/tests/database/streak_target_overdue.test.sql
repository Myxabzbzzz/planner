begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000a1', 61, 'A', true, 'Asia/Tashkent');
select public.onboard_user('00000000-0000-0000-0000-0000000000a1', 'UZS');
insert into public.habits (id, user_id, name, target_per_week) values
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'зал', 3),
  ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'чтение', 7);

-- #27: серия одним оконным запросом вместо запроса на каждый день
-- отметки: сегодня, вчера, позавчера, потом разрыв, потом ещё два дня
insert into public.habit_logs (user_id, habit_id, date)
select '00000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-000000000001',
       (now() at time zone 'Asia/Tashkent')::date - n
  from unnest(array[0, 1, 2, 4, 5]) t(n);
select is(public.habit_streak('80000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Tashkent')::date), 3,
          'streak stops at the gap');
delete from public.habit_logs where habit_id = '80000000-0000-0000-0000-000000000001'
   and date = (now() at time zone 'Asia/Tashkent')::date;
select is(public.habit_streak('80000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Tashkent')::date), 2,
          'an empty today does not break the streak');
delete from public.habit_logs where habit_id = '80000000-0000-0000-0000-000000000001'
   and date = (now() at time zone 'Asia/Tashkent')::date - 1;
select is(public.habit_streak('80000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Tashkent')::date), 0,
          'two empty days do break it');
select is(public.habit_streak('80000000-0000-0000-0000-000000000002', (now() at time zone 'Asia/Tashkent')::date), 0,
          'no logs at all is a zero streak');

-- #18: цель на неделю наконец видна
select is((public.summary_habits('00000000-0000-0000-0000-0000000000a1') -> 'habits' -> 0 ->> 'target_per_week')::int,
          3, 'summary_habits returns the weekly target');
select isnt(public.summary_habits('00000000-0000-0000-0000-0000000000a1') -> 'habits' -> 0 -> 'week_done',
            'null'::jsonb, 'summary_habits returns the weekly progress');
select is((public.summary_today('00000000-0000-0000-0000-0000000000a1') -> 'habits' -> 0 ->> 'target_per_week')::int,
          3, 'summary_today returns the weekly target too');

-- #28: «просрочено» по времени, а не по дате
insert into public.items (id, user_id, kind, title, due_at) values
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'task', 'Сегодня 00:01',
   ((now() at time zone 'Asia/Tashkent')::date + time '00:01') at time zone 'Asia/Tashkent'),
  ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'task', 'Сегодня без времени',
   ((now() at time zone 'Asia/Tashkent')::date + time '23:59') at time zone 'Asia/Tashkent');

select is(public.is_overdue(((now() at time zone 'Asia/Tashkent')::date + time '00:01') at time zone 'Asia/Tashkent',
                            'Asia/Tashkent', now()), true, 'a time that has passed today is overdue');
select is(public.is_overdue(((now() at time zone 'Asia/Tashkent')::date + time '23:59') at time zone 'Asia/Tashkent',
                            'Asia/Tashkent', now()), false, '23:59 means «no time»: not overdue until tomorrow');
select is(public.is_overdue(null, 'Asia/Tashkent', now()), false, 'no due date is never overdue');
select is((select (t ->> 'overdue')::boolean
             from jsonb_array_elements(public.summary_tasks('00000000-0000-0000-0000-0000000000a1') -> 'tasks') t
            where t ->> 'title' = 'Сегодня 00:01'), true, 'summary_tasks compares the time');
select is((select (t ->> 'overdue')::boolean
             from jsonb_array_elements(public.api_tasks('00000000-0000-0000-0000-0000000000a1', 'today') -> 'tasks') t
            where t ->> 'title' = 'Сегодня без времени'), false, 'api_tasks leaves a date-only task alone');

select * from finish();
rollback;
