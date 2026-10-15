begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select is(public._charge_in(31, '2027-02-10'), '2027-02-28'::date, 'the 31st is the last day of February');
select is(public._next_charge(5, '2026-10-06'), '2026-11-05'::date, 'next charge moves to next month once passed');
select is(public._next_charge(5, '2026-10-05'), '2026-10-05'::date, 'today counts');

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-0000000ab001', 9961, 'Pro', 'UTC', true);
select public.onboard_user('00000000-0000-0000-0000-0000000ab001', 'RUB');
update public.users set pro_until = 'infinity' where id = '00000000-0000-0000-0000-0000000ab001';

-- два месяца подряд 5-го числа — подписка; кофе каждый день и разовая аренда — нет
insert into public.transactions (user_id, type, amount_base, base_currency, comment, occurred_at, category_id)
select '00000000-0000-0000-0000-0000000ab001', 'expense', a, 'RUB', c, d,
       (select id from public.categories where user_id = '00000000-0000-0000-0000-0000000ab001' and type = 'expense' and name = 'другое')
  from (values
    (299, 'Яндекс Плюс', (date_trunc('month', current_date) - interval '2 months' + interval '4 days')::date),
    (299, 'Яндекс Плюс', (date_trunc('month', current_date) - interval '1 month' + interval '5 days')::date),
    (300, 'Кофе', (date_trunc('month', current_date) - interval '2 months' + interval '3 days')::date),
    (300, 'Кофе', (date_trunc('month', current_date) - interval '2 months' + interval '9 days')::date),
    (300, 'Кофе', (date_trunc('month', current_date) - interval '1 month' + interval '3 days')::date),
    (50000, 'Аренда', (date_trunc('month', current_date) - interval '1 month')::date)
  ) v(a, c, d);

select is(public.detect_regular_payments('00000000-0000-0000-0000-0000000ab001'), 1, 'only the monthly subscription is found');
select is(public.detect_regular_payments('00000000-0000-0000-0000-0000000ab001'), 0, 'detection is idempotent');

select is((select jsonb_agg(i->>'title' || ' ' || (i->>'status') || ' ' || (i->>'day'))
             from jsonb_array_elements(public.api_regular_payments('00000000-0000-0000-0000-0000000ab001')->'items') i),
  '["Яндекс Плюс suggested 6"]'::jsonb, 'suggested with the average day');

select is(public.set_regular_payment('00000000-0000-0000-0000-0000000ab001',
  (select id from public.regular_payments where title = 'Яндекс Плюс'), 'active'), true, 'confirmed');
select is((public.api_regular_payments('00000000-0000-0000-0000-0000000ab001')->>'monthly_total')::numeric, 299::numeric,
  'monthly total counts active ones');

-- напоминание накануне списания, с 10 утра, один раз
select is((select count(*)::int from public.due_payment_reminders('2026-11-05 09:00Z')), 0, 'not before 10:00');
select is((select title || ' ' || charge_on from public.due_payment_reminders('2026-11-05 10:30Z')),
  'Яндекс Плюс 2026-11-06', 'the day before the charge');
select public.mark_payment_reminded(array(select id from public.due_payment_reminders('2026-11-05 10:30Z')), '2026-11-05 10:30Z');
select is((select count(*)::int from public.due_payment_reminders('2026-11-05 12:00Z')), 0, 'only once');

-- кнопка «Записать трату»: двойное нажатие не дублирует
select is((public.record_regular_payment('00000000-0000-0000-0000-0000000ab001',
  (select id from public.regular_payments where title = 'Яндекс Плюс'))->>'created')::boolean, true, 'recorded');
select is((public.record_regular_payment('00000000-0000-0000-0000-0000000ab001',
  (select id from public.regular_payments where title = 'Яндекс Плюс'))->>'created')::boolean, false, 'no duplicate');

-- «не регулярный» больше не предлагается
select public.set_regular_payment('00000000-0000-0000-0000-0000000ab001',
  (select id from public.regular_payments where title = 'Яндекс Плюс'), 'dismissed');
select is(public.detect_regular_payments('00000000-0000-0000-0000-0000000ab001'), 0, 'dismissed is not suggested again');
select is(jsonb_array_length(public.api_regular_payments('00000000-0000-0000-0000-0000000ab001')->'items'), 0,
  'dismissed is hidden');

-- вручную, с категорией по имени
select isnt(public.add_regular_payment('00000000-0000-0000-0000-0000000ab001', 'Аренда', 50000, 1, 'дом'), null, 'added by hand');
select is((select status || ' ' || coalesce(c.name, '-') from public.regular_payments r
             left join public.categories c on c.id = r.category_id where r.title = 'Аренда'), 'active дом',
  'manual payment is active with its category');

-- прогноз: потрачено + темп обычных трат на остаток + регулярные впереди
select ok((select case when extract(day from current_date) >= 3
                       then (f->>'forecast')::numeric >= (f->>'spent')::numeric
                       else f->'forecast' = 'null'::jsonb end
             from (select public.api_forecast('00000000-0000-0000-0000-0000000ab001') f) x),
  'forecast is at least what is already spent (or null in the first days)');

-- 10 дней из 30: 20 000 потрачено, из них 15 000 — аренда первого числа; впереди подписка 300.
-- Темп обычных трат 500 в день → 20 000 + 500 × 20 + 300
select is(public._forecast(20000, 15000, 300, 10, 30), 30300::numeric, 'rent does not inflate the pace');
select is(public._forecast(900, 0, 0, 3, 31), 9300::numeric, 'plain pace from the third day');
select is(public._forecast(900, 0, 0, 2, 31), null, 'no forecast in the first two days');

select * from finish();
rollback;
