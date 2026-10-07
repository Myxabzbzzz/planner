begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- единственный пользователь в тесте: часовой пояс Ташкент (UTC+5)
insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000e1', 51, 'E', true, 'Asia/Tashkent');
select public.onboard_user('00000000-0000-0000-0000-0000000000e1', 'UZS');
delete from public.users where id <> '00000000-0000-0000-0000-0000000000e1';

-- 2026-10-07 05:00 UTC = вторник 10:00 в Ташкенте
insert into public.items (id, user_id, kind, title, starts_at, due_at, remind_before_min) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'event', 'Созвон',
   '2026-10-07 05:20:00+00', null, 30),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'task', 'Оплатить интернет',
   null, '2026-10-07 05:20:00+00', 30),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e1', 'task', 'Сдать отчёт',
   null, '2026-10-07 18:59:00+00', 30),
  ('70000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000e1', 'task', 'Срок завтра',
   null, '2026-10-08 18:59:00+00', 30),
  ('70000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e1', 'task', 'Без срока',
   null, null, 30);

-- #14: задачи со сроком наконец напоминают
select is((select count(*)::int from public.due_reminders('2026-10-07 05:00:00+00')), 3,
          'event, timed task and today-due task');
select is((select kind from public.due_reminders('2026-10-07 05:00:00+00')
            where item_id = '70000000-0000-0000-0000-000000000002'), 'task', 'the task is reminded');
select is((select local_time from public.due_reminders('2026-10-07 05:00:00+00')
            where item_id = '70000000-0000-0000-0000-000000000002'), '10:20', 'a timed task keeps its time');
select is((select local_time from public.due_reminders('2026-10-07 05:00:00+00')
            where item_id = '70000000-0000-0000-0000-000000000003'), null,
          'a date-only task has no time: 23:59 means «no time»');
select is((select count(*)::int from public.due_reminders('2026-10-07 02:00:00+00')), 0,
          'nothing fires at 07:00 local: too early for date-only tasks and too far from the event');
select is((select count(*)::int from public.due_reminders('2026-10-07 05:00:00+00')
            where item_id in ('70000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000005')), 0,
          'tomorrow and no-due tasks stay quiet');

-- #15: окно вместо открытого «>= 21:30» плюс утренний догон
select is((select local_date from public.due_digests('2026-10-07 16:35:00+00') where kind = 'daily'),
          '2026-10-07'::date, 'the evening window fires for today');
select is((select local_date from public.due_digests('2026-10-07 19:35:00+00') where kind = 'daily'),
          '2026-10-07'::date, 'at 00:35 the catch-up is still yesterday, not an empty new day');
select is((select count(*)::int from public.due_digests('2026-10-07 09:00:00+00')), 0,
          'nothing fires at 14:00 local');
select is((select count(*)::int from public.due_digests('2026-10-07 16:35:00+00') where kind = 'weekly'), 0,
          'no weekly digest on a Tuesday');
-- воскресенье 2026-10-11 21:40 Ташкент = 16:40 UTC
select is((select local_date from public.due_digests('2026-10-11 16:40:00+00') where kind = 'weekly'),
          '2026-10-11'::date, 'the weekly digest fires on Sunday evening');
-- понедельник 2026-10-12 08:00 Ташкент = 03:00 UTC
select is((select local_date from public.due_digests('2026-10-12 03:00:00+00') where kind = 'weekly'),
          '2026-10-11'::date, 'a missed weekly digest is caught up on Monday morning, for Sunday');

-- #15: сводка считается за переданный день
insert into public.transactions (user_id, type, amount_base, base_currency, occurred_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'expense', 50000, 'UZS', '2026-10-06');
select is((public.digest_daily('00000000-0000-0000-0000-0000000000e1', '2026-10-06',
                               '2026-10-07 05:00:00+00') ->> 'spent')::numeric,
          50000::numeric, 'the digest is computed for the requested day');
select is(public.digest_daily('00000000-0000-0000-0000-0000000000e1', null, '2026-10-07 05:00:00+00') ->> 'date',
          '2026-10-07', 'without a day it falls back to «today»');

select * from finish();
rollback;
