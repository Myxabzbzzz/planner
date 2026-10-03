begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into public.users (id, tg_id, name, is_allowed) values
  ('00000000-0000-0000-0000-0000000000d1', 91, 'A', true),
  ('00000000-0000-0000-0000-0000000000d2', 92, 'B', true);
select public.onboard_user('00000000-0000-0000-0000-0000000000d1', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-0000000000d2', 'UZS');
insert into public.transactions (id, user_id, type, amount_base, base_currency, amount_orig, currency_orig, fx_rate, fx_date, comment) values
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'expense', 236260059.16, 'UZS', 20000, 'USD', 11813.002958, '2026-10-02', 'Ерунда');
insert into public.transactions (id, user_id, type, amount_base, base_currency, comment) values
  ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d1', 'expense', 40000, 'UZS', 'Кофе'),
  ('90000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000d1', 'income', 100, 'UZS', 'Доход');

-- foreign amount: edit orig, base recomputed by the stored rate
select is(public.update_transaction('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-000000000001', 200, null, null), true, 'edit orig amount');
select is((select amount_orig from public.transactions where id = '90000000-0000-0000-0000-000000000001'), 200.00::numeric, 'orig updated');
select is((select amount_base from public.transactions where id = '90000000-0000-0000-0000-000000000001'), 2362600.59::numeric, 'base recomputed');
-- base amount
select public.update_transaction('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-000000000002', 45000, null, null);
select is((select amount_base from public.transactions where id = '90000000-0000-0000-0000-000000000002'), 45000.00::numeric, 'base amount edited');
-- title and category
select public.update_transaction('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-000000000002', null, '  Латте  ', 'кафе');
select is((select comment from public.transactions where id = '90000000-0000-0000-0000-000000000002'), 'Латте', 'title trimmed');
select is((select c.name from public.transactions t join public.categories c on c.id = t.category_id
            where t.id = '90000000-0000-0000-0000-000000000002'), 'кафе', 'category set');
select is((select amount_base from public.transactions where id = '90000000-0000-0000-0000-000000000002'), 45000.00::numeric, 'amount untouched when null');
-- category of the wrong type is rejected
select throws_ok($$select public.update_transaction('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-000000000003', null, null, 'кафе')$$,
  'P0001', 'bad category', 'income cannot get expense category');
select throws_ok($$select public.update_transaction('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-000000000002', 0, null, null)$$,
  'P0001', 'bad amount', 'zero amount rejected');
select throws_ok($$select public.update_transaction('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-000000000002', null, '   ', null)$$,
  'P0001', 'bad title', 'blank title rejected');
-- other user's rows
select is(public.update_transaction('00000000-0000-0000-0000-0000000000d2', '90000000-0000-0000-0000-000000000002', 1, null, null), false, 'cannot edit others');
select is(public.delete_transaction('00000000-0000-0000-0000-0000000000d2', '90000000-0000-0000-0000-000000000002'), false, 'cannot delete others');
select is(public.delete_transaction('00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-000000000002'), true, 'delete own');
select is((select count(*)::int from public.transactions where id = '90000000-0000-0000-0000-000000000002'), 0, 'deleted');
-- categories list
select is(public.api_categories('00000000-0000-0000-0000-0000000000d1')->'income', '["другое", "зарплата"]'::jsonb, 'income categories sorted');
select is(has_function_privilege('authenticated', 'public.update_transaction(uuid, uuid, numeric, text, text)', 'execute'), false, 'no client access');

select * from finish();
rollback;
