begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000a9', 91, 'A', true, 'Asia/Tashkent'),
  ('00000000-0000-0000-0000-0000000000b9', 92, 'B', true, 'Asia/Tashkent');
select public.onboard_user('00000000-0000-0000-0000-0000000000a9', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-0000000000b9', 'UZS');

-- деньги A: сентябрь и октябрь; B — чужие
insert into public.transactions (user_id, type, amount_base, base_currency, occurred_at, category_id) values
  ('00000000-0000-0000-0000-0000000000a9', 'expense', 30000, 'UZS', '2026-09-10',
     (select id from public.categories where user_id = '00000000-0000-0000-0000-0000000000a9' and name = 'такси/транспорт')),
  ('00000000-0000-0000-0000-0000000000a9', 'expense', 20000, 'UZS', '2026-09-30',
     (select id from public.categories where user_id = '00000000-0000-0000-0000-0000000000a9' and name = 'такси/транспорт')),
  ('00000000-0000-0000-0000-0000000000a9', 'expense', 100000, 'UZS', '2026-09-15',
     (select id from public.categories where user_id = '00000000-0000-0000-0000-0000000000a9' and name = 'еда')),
  ('00000000-0000-0000-0000-0000000000a9', 'expense', 7000, 'UZS', '2026-10-01', null),
  ('00000000-0000-0000-0000-0000000000a9', 'income', 5000000, 'UZS', '2026-09-05',
     (select id from public.categories where user_id = '00000000-0000-0000-0000-0000000000a9' and name = 'зарплата' and type = 'income')),
  ('00000000-0000-0000-0000-0000000000b9', 'expense', 999999, 'UZS', '2026-09-10', null);

select is((public.ask_sum('00000000-0000-0000-0000-0000000000a9', 'expense', '2026-09-01', '2026-10-01')->>'total')::numeric, 150000::numeric, 'september expense, others excluded');
select is((public.ask_sum('00000000-0000-0000-0000-0000000000a9', 'expense', '2026-09-01', '2026-10-01')->>'count')::int, 3, 'september expense count');
select is((public.ask_sum('00000000-0000-0000-0000-0000000000a9', 'expense', '2026-09-01', '2026-10-01',
            (select id from public.categories where user_id = '00000000-0000-0000-0000-0000000000a9' and name = 'такси/транспорт'))->>'total')::numeric,
          50000::numeric, 'category filter');
select is((public.ask_sum('00000000-0000-0000-0000-0000000000a9', 'income', '2026-09-01', '2026-10-01')->>'total')::numeric, 5000000::numeric, 'income');
select is((public.ask_sum('00000000-0000-0000-0000-0000000000a9', 'expense', null, null)->>'total')::numeric, 157000::numeric, 'all time');
select is((public.ask_sum('00000000-0000-0000-0000-0000000000a9', 'expense', '2026-09-30', '2026-10-01')->>'total')::numeric, 20000::numeric, 'end is exclusive, start inclusive');
select is((public.ask_sum('00000000-0000-0000-0000-0000000000a9', 'expense', '2026-11-01', '2026-12-01')->>'count')::int, 0, 'empty period count');
select is((public.ask_sum('00000000-0000-0000-0000-0000000000a9', 'expense', '2026-11-01', '2026-12-01')->>'total')::numeric, 0::numeric, 'empty period total');

-- top categories
select is(public.ask_top_categories('00000000-0000-0000-0000-0000000000a9', '2026-09-01', '2026-10-01')->'items'->0->>'name', 'еда', 'top category first');
select is((public.ask_top_categories('00000000-0000-0000-0000-0000000000a9', '2026-09-01', '2026-10-01')->>'total')::numeric, 150000::numeric, 'top total');
select is(public.ask_top_categories('00000000-0000-0000-0000-0000000000a9', '2026-10-01', '2026-11-01')->'items'->0->>'name', 'без категории', 'uncategorized label');
select is((public.ask_top_categories('00000000-0000-0000-0000-0000000000a9', '2026-09-01', '2026-10-01')->>'other')::numeric, 0::numeric, 'no other when <=5 categories');
select is(jsonb_array_length(public.ask_top_categories('00000000-0000-0000-0000-0000000000a9', '2026-11-01', '2026-12-01')->'items'), 0, 'empty top');

-- limit: 2026-10-04 12:00 Ташкент
insert into public.budgets (user_id, category_id, monthly_limit) values ('00000000-0000-0000-0000-0000000000a9', null, 100000);
select is((public.ask_limit_left('00000000-0000-0000-0000-0000000000a9', null, '2026-10-04 07:00+00')->>'limit')::numeric, 100000::numeric, 'general limit');
select is((public.ask_limit_left('00000000-0000-0000-0000-0000000000a9', null, '2026-10-04 07:00+00')->>'spent')::numeric, 7000::numeric, 'spent this month');
select is((public.ask_limit_left('00000000-0000-0000-0000-0000000000a9', null, '2026-10-04 07:00+00')->>'days_left')::int, 28, 'days left incl. today');
select is((public.ask_limit_left('00000000-0000-0000-0000-0000000000a9', null, '2026-10-31 07:00+00')->>'days_left')::int, 1, 'days_left on last day');
select is(public.ask_limit_left('00000000-0000-0000-0000-0000000000a9', null, '2026-10-04 07:00+00')->>'month', '2026-10', 'month');
select is(public.ask_limit_left('00000000-0000-0000-0000-0000000000b9', null, '2026-10-04 07:00+00')->>'limit', null::text, 'no limit for B');
-- 2026-09-30 20:00 UTC = 2026-10-01 01:00 Ташкент → месяц октябрь
select is(public.ask_limit_left('00000000-0000-0000-0000-0000000000a9', null, '2026-09-30 20:00+00')->>'month', '2026-10', 'month by user tz');

-- agenda: встреча 2026-10-01 20:30 UTC = 2026-10-02 01:30 Ташкент
insert into public.items (user_id, kind, title, starts_at, with_whom) values
  ('00000000-0000-0000-0000-0000000000a9', 'event', 'Ночной созвон', '2026-10-01 20:30+00', null),
  ('00000000-0000-0000-0000-0000000000a9', 'event', 'Встреча с Ахмедом', '2026-10-06 10:00+00', 'Ахмед'),
  ('00000000-0000-0000-0000-0000000000a9', 'event', 'Стоматолог', '2026-09-20 05:00+00', null),
  ('00000000-0000-0000-0000-0000000000a9', 'event', 'Скидка 100%', '2026-10-07 05:00+00', null),
  ('00000000-0000-0000-0000-0000000000b9', 'event', 'Встреча с Ахмедом у B', '2026-10-06 10:00+00', 'Ахмед');
insert into public.items (user_id, kind, title, due_at, done_at) values
  ('00000000-0000-0000-0000-0000000000a9', 'task', 'Просрочено', '2026-10-01 10:00+00', null),
  ('00000000-0000-0000-0000-0000000000a9', 'task', 'Сегодня', '2026-10-04 10:00+00', null),
  ('00000000-0000-0000-0000-0000000000a9', 'task', 'Позже', '2026-10-10 10:00+00', null),
  ('00000000-0000-0000-0000-0000000000a9', 'task', 'Сделано', '2026-10-04 10:00+00', '2026-10-04 11:00+00'),
  ('00000000-0000-0000-0000-0000000000a9', 'task', 'Без срока', null, null);

select is(public.ask_agenda('00000000-0000-0000-0000-0000000000a9', '2026-10-02', '2026-10-03')->'events'->0->>'title', 'Ночной созвон', 'agenda by local date');
select is(public.ask_agenda('00000000-0000-0000-0000-0000000000a9', '2026-10-02', '2026-10-03')->'events'->0->>'time', '01:30', 'agenda local time');
select is(jsonb_array_length(public.ask_agenda('00000000-0000-0000-0000-0000000000a9', '2026-10-01', '2026-10-02')->'events'), 0, 'not on utc date');
select is(jsonb_array_length(public.ask_agenda('00000000-0000-0000-0000-0000000000a9', '2026-10-04', '2026-10-05')->'tasks'), 2, 'tasks due today incl. done');

-- open tasks at 2026-10-04 12:00 Ташкент
select is((public.ask_open_tasks('00000000-0000-0000-0000-0000000000a9', '2026-10-04 07:00+00')->>'overdue')::int, 1, 'overdue');
select is((public.ask_open_tasks('00000000-0000-0000-0000-0000000000a9', '2026-10-04 07:00+00')->>'no_due')::int, 1, 'no due');
select is(public.ask_open_tasks('00000000-0000-0000-0000-0000000000a9', '2026-10-04 07:00+00')->'items'->0->>'title', 'Просрочено', 'overdue first');
select is(jsonb_array_length(public.ask_open_tasks('00000000-0000-0000-0000-0000000000a9', '2026-10-04 07:00+00')->'items'), 4, 'done excluded');

-- find event at 2026-10-04 12:00 Ташкент
select is(jsonb_array_length(public.ask_find_event('00000000-0000-0000-0000-0000000000a9', 'ахмед', '2026-10-04 07:00+00')->'future'), 1, 'find by with_whom, only own');
select is(public.ask_find_event('00000000-0000-0000-0000-0000000000a9', 'стоматолог', '2026-10-04 07:00+00')->'past'->0->>'title', 'Стоматолог', 'past event');
select is(jsonb_array_length(public.ask_find_event('00000000-0000-0000-0000-0000000000a9', '%', '2026-10-04 07:00+00')->'future'), 1, 'escaped wildcard matches literal % only');

-- права
select is(has_function_privilege('anon', 'public.ask_sum(uuid, text, date, date, uuid)', 'execute')
          or has_function_privilege('authenticated', 'public.ask_find_event(uuid, text, timestamptz)', 'execute'),
          false, 'anon/authenticated cannot execute');

select * from finish();
rollback;
