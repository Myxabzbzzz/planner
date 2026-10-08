begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f501', 9601, 'A', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f502', 9602, 'B', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f501', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-00000000f502', 'UZS');
insert into public.fx_rates (date, base, rates, source) values
  (current_date - 3, 'USD', '{"USD":1,"UZS":12500,"EUR":0.92}', 'test');

-- #20: «потратил 200 на обед» в Ташкенте легло как 200 UZS вместо 200 000
insert into public.transactions (id, user_id, type, amount_base, base_currency, comment, occurred_at) values
  ('00000000-0000-0000-0000-00000000f511', '00000000-0000-0000-0000-00000000f501', 'expense', 200, 'UZS', 'Обед', current_date);

-- все аргументы null = ничего не менять
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, null, null, null, null), true, 'all-null edit succeeds');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 200.00::numeric, 'all-null edit changes nothing');

-- сумма, название, категория и дата — всё сразу
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511',
  200000, '  Обед в кафе  ', 'кафе', current_date - 2, null, null), true, 'full edit succeeds');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 200000.00::numeric, 'amount fixed');
select is((select comment from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 'Обед в кафе', 'title trimmed');
select is((select occurred_at from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), current_date - 2, 'date changed');
select is((select c.name from public.transactions t join public.categories c on c.id = t.category_id
            where t.id = '00000000-0000-0000-0000-00000000f511'), 'кафе', 'category set');

-- расход -> доход: категория чужого типа снимается
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, null, null, 'income', null), true, 'type flipped');
select is((select type from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 'income', 'type is income now');
select is((select category_id is null from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), true, 'expense category dropped on type change');
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, 'зарплата', null, null, null), true, 'income category accepted');
select public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, 'кафе', null, 'expense', null);

-- неверная валюта: сумму трактуем в ней и пересчитываем по курсу на дату операции
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', 200, null, null, null, null, 'USD'), true, 'currency edit succeeds');
select is((select amount_orig from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 200.00::numeric, 'original amount stored');
select is((select currency_orig from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 'USD', 'original currency stored');
select is((select fx_rate from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 12500.00000000::numeric, 'rate stored');
select is((select fx_date from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), current_date - 3, 'rate date is the nearest earlier table');
select is((select fx_source from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 'test', 'rate source stored');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 2500000.00::numeric, 'base recomputed from the original');

-- валюта равна базовой: исходные поля чистятся
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', 250000, null, null, null, null, 'UZS'), true, 'switching back to base succeeds');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 250000.00::numeric, 'amount taken as base');
select is((select amount_orig from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), null, 'original amount cleared');
select is((select currency_orig from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), null, 'original currency cleared');
select is((select fx_rate from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), null, 'rate cleared');
select is((select fx_date from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), null, 'rate date cleared');

-- пустая строка в категории = снять категорию
select public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, 'кафе', null, null, null);
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, '', null, null, null), true, 'blank category accepted');
select is((select category_id is null from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), true, 'blank category clears it');

select throws_ok($$select public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', 0, null, null, null, null, null)$$,
  'P0001', 'bad amount', 'zero amount rejected');
select throws_ok($$select public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, '   ', null, null, null, null)$$,
  'P0001', 'bad title', 'blank title rejected');
-- новая категория при правке создаётся, как и при создании операции (в OpSheet есть «или своя категория»)
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, 'Подарки', null, null, null), true, 'new category accepted');
select is((select c.name || '/' || c.type from public.transactions t join public.categories c on c.id = t.category_id
            where t.id = '00000000-0000-0000-0000-00000000f511'), 'Подарки/expense', 'new category created with the operation type');
select throws_ok($$select public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, null, null, 'wrong', null)$$,
  'P0001', 'bad type', 'bad type rejected');
select throws_ok($$select public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', null, null, null, null, null, 'ab')$$,
  'P0001', 'bad currency', 'malformed currency rejected');
select throws_ok($$select public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', 10, null, null, null, null, 'GBP')$$,
  null, null, 'currency without a rate is refused rather than guessed');

select is(public.edit_transaction('00000000-0000-0000-0000-00000000f502', '00000000-0000-0000-0000-00000000f511', 5, null, null, null, null, null), false, 'cannot edit another user row');
select is(public.edit_transaction('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-00000000f511', 5, null, null, null, null, null), false, 'unknown user cannot edit');
select public.delete_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511');
select is(public.edit_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', 5, null, null, null, null, null), false, 'cannot edit a deleted row');
select public.restore_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511');

-- старая функция продолжает работать
select is(public.update_transaction('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f511', 300000, 'Через старую', 'кафе'), true, 'update_transaction still works');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f511'), 300000.00::numeric, 'update_transaction still edits the amount');

select is(has_function_privilege('authenticated', 'public.edit_transaction(uuid, uuid, numeric, text, text, date, text, text)', 'execute'), false, 'edit_transaction not exposed');

select * from finish();
rollback;
