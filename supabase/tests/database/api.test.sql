begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000e1', 31, 'Муха', true, 'Asia/Tashkent'),
  ('00000000-0000-0000-0000-0000000000f1', 32, 'F', true, 'Asia/Tashkent');
select public.onboard_user('00000000-0000-0000-0000-0000000000e1', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-0000000000f1', 'UZS');

-- me
select is(public.api_me('00000000-0000-0000-0000-0000000000e1')->>'base_currency', 'UZS', 'me currency');
select is(public.api_me('00000000-0000-0000-0000-0000000000e1')->>'tz', 'Asia/Tashkent', 'me tz');

-- tasks
insert into public.items (user_id, kind, title, due_at, done_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'task', 'Просрочено', now() - interval '2 days', null),
  ('00000000-0000-0000-0000-0000000000e1', 'task', 'Позже', now() + interval '5 days', null),
  ('00000000-0000-0000-0000-0000000000e1', 'task', 'Без срока', null, null),
  ('00000000-0000-0000-0000-0000000000e1', 'task', 'Готово', null, now()),
  ('00000000-0000-0000-0000-0000000000f1', 'task', 'Чужая', null, null);
select is(jsonb_array_length(public.api_tasks('00000000-0000-0000-0000-0000000000e1', 'today')->'tasks'), 1, 'today incl overdue');
select is((public.api_tasks('00000000-0000-0000-0000-0000000000e1', 'today')->'tasks'->0->>'overdue')::boolean, true, 'overdue flag');
select is(public.api_tasks('00000000-0000-0000-0000-0000000000e1', 'upcoming')->'tasks'->0->>'title', 'Позже', 'upcoming');
select is(public.api_tasks('00000000-0000-0000-0000-0000000000e1', 'nodue')->'tasks'->0->>'title', 'Без срока', 'nodue own only');
select is(jsonb_array_length(public.api_tasks('00000000-0000-0000-0000-0000000000e1', 'nodue')->'tasks'), 1, 'nodue count');
select is(public.api_tasks('00000000-0000-0000-0000-0000000000e1', 'done')->'tasks'->0->>'title', 'Готово', 'done');
select throws_ok($$select public.api_tasks('00000000-0000-0000-0000-0000000000e1', 'bogus')$$, 'P0001', null, 'bad filter');

-- events: 02:00 по Ташкенту сегодня — это «сегодня» по Ташкенту
insert into public.items (user_id, kind, title, starts_at, with_whom) values
  ('00000000-0000-0000-0000-0000000000e1', 'event', 'Утро',
   ((now() at time zone 'Asia/Tashkent')::date + time '02:00') at time zone 'Asia/Tashkent', 'Андрей');
select is(public.api_events('00000000-0000-0000-0000-0000000000e1',
            (now() at time zone 'Asia/Tashkent')::date, (now() at time zone 'Asia/Tashkent')::date)
          ->'days'->0->'events'->0->>'time', '02:00', 'event local time');
select is(public.api_events('00000000-0000-0000-0000-0000000000e1',
            (now() at time zone 'Asia/Tashkent')::date, (now() at time zone 'Asia/Tashkent')::date)
          ->'days'->0->>'date', ((now() at time zone 'Asia/Tashkent')::date)::text, 'event local date');
select throws_ok($$select public.api_events('00000000-0000-0000-0000-0000000000e1', '2026-10-01', '2026-12-01')$$,
                 'P0001', null, 'range too long');

-- money
insert into public.transactions (user_id, type, amount_base, base_currency, comment, occurred_at,
                                 amount_orig, currency_orig, fx_rate, fx_date, fx_source) values
  ('00000000-0000-0000-0000-0000000000e1', 'expense', 264738.31, 'UZS', 'Подписка', '2026-10-03', 22.4, 'USD', 11818.67475800, '2026-10-01', 'open.er-api.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'expense', 30000, 'UZS', 'Такси', '2026-10-03', null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000000e1', 'income', 100000, 'UZS', 'Доход', '2026-10-05', null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000000e1', 'expense', 999, 'UZS', 'Сентябрь', '2026-09-30', null, null, null, null, null);
select is((public.api_money('00000000-0000-0000-0000-0000000000e1', '2026-10')->>'expense')::numeric, 294738.31, 'month expense');
select is((public.api_money('00000000-0000-0000-0000-0000000000e1', '2026-10')->>'income')::numeric, 100000::numeric, 'month income');
select is(jsonb_array_length(public.api_money('00000000-0000-0000-0000-0000000000e1', '2026-10')->'operations'), 3, 'month operations');
select is(public.api_money('00000000-0000-0000-0000-0000000000e1', '2026-10')->'by_day'->0->>'date', '2026-10-03', 'by_day date');
select is((public.api_money('00000000-0000-0000-0000-0000000000e1', '2026-10')->'by_day'->0->>'expense')::numeric, 294738.31, 'by_day sum');
select is(
  (select o->'orig'->>'currency' from jsonb_array_elements(public.api_money('00000000-0000-0000-0000-0000000000e1', '2026-10')->'operations') o
    where o->>'title' = 'Подписка'), 'USD', 'fx original kept');
select throws_ok($$select public.api_money('00000000-0000-0000-0000-0000000000e1', '2026-1')$$, 'P0001', null, 'bad month');

-- habits
insert into public.habits (id, user_id, name) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'зарядка');
insert into public.habit_logs (user_id, habit_id, date) values
  ('00000000-0000-0000-0000-0000000000e1', '60000000-0000-0000-0000-000000000001', (now() at time zone 'Asia/Tashkent')::date);
select is(jsonb_array_length(public.api_habits('00000000-0000-0000-0000-0000000000e1', 4)->'habits'->0->'days'), 28, '4 weeks of days');
select is((public.api_habits('00000000-0000-0000-0000-0000000000e1', 4)->'habits'->0->>'done_today')::boolean, true, 'done today');
select throws_ok($$select public.api_habits('00000000-0000-0000-0000-0000000000e1', 13)$$, 'P0001', null, 'weeks bound');

-- notes: поиск буквальный
insert into public.notes (user_id, kind, text) values
  ('00000000-0000-0000-0000-0000000000e1', 'thought', 'скидка 50% на всё'),
  ('00000000-0000-0000-0000-0000000000e1', 'thought', 'просто мысль');
select is(jsonb_array_length(public.api_notes('00000000-0000-0000-0000-0000000000e1', '50%', null)->'notes'), 1, 'literal percent');
select is(jsonb_array_length(public.api_notes('00000000-0000-0000-0000-0000000000e1', '%', null)->'notes'), 1, 'percent is not wildcard');

select is(has_function_privilege('authenticated', 'public.api_money(uuid, text)', 'execute'), false, 'no client access');

select * from finish();
rollback;
