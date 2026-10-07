begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f601', 9701, 'A', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f602', 9702, 'B', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f601', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-00000000f602', 'UZS');

insert into public.transactions (user_id, type, amount_base, base_currency, comment, occurred_at, category_id) values
  ('00000000-0000-0000-0000-00000000f601', 'expense', 50000, 'UZS', 'Еда', date_trunc('month', current_date)::date,
    (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'еда')),
  ('00000000-0000-0000-0000-00000000f601', 'expense', 300000, 'UZS', 'Кафе', date_trunc('month', current_date)::date,
    (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'кафе')),
  ('00000000-0000-0000-0000-00000000f601', 'expense', 70000, 'UZS', 'Без категории', date_trunc('month', current_date)::date, null);

select public.set_limit('00000000-0000-0000-0000-00000000f601', 2000000);
select is(public.set_category_limit('00000000-0000-0000-0000-00000000f601', 'еда', 600000), true, 'category limit written');
select is(public.set_category_limit('00000000-0000-0000-0000-00000000f601', 'подписки', 100000), true, 'limit for a category without spending');
select is((select count(*)::int from public.budgets where user_id = '00000000-0000-0000-0000-00000000f601'), 3, 'overall and per-category rows coexist');
select is((select count(*)::int from public.budgets where user_id = '00000000-0000-0000-0000-00000000f601' and category_id is null), 1, 'overall row untouched by category limits');

select is(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'overall'->'limit', '2000000.00'::jsonb, 'overall limit reported');
select is(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'overall'->'spent', '420000.00'::jsonb, 'overall spend reported');
select is(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'base_currency', '"UZS"'::jsonb, 'base currency reported');
select is(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'uncategorized', '70000.00'::jsonb, 'uncategorised spend reported separately');
-- категория с лимитом и тратами
select is((select c->'limit' from jsonb_array_elements(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'categories') c
            where c->>'name' = 'еда'), '600000.00'::jsonb, 'limit for a spent category');
select is((select c->'spent' from jsonb_array_elements(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'categories') c
            where c->>'name' = 'еда'), '50000.00'::jsonb, 'spend for a limited category');
-- категория с тратами, но без лимита — обязана быть в списке
select is((select c->'limit' from jsonb_array_elements(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'categories') c
            where c->>'name' = 'кафе'), 'null'::jsonb, 'spent category without a limit is listed');
select is((select c->'spent' from jsonb_array_elements(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'categories') c
            where c->>'name' = 'кафе'), '300000.00'::jsonb, 'its spend is reported');
-- категория с лимитом, но без трат — тоже в списке
select is((select c->'spent' from jsonb_array_elements(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'categories') c
            where c->>'name' = 'подписки'), '0'::jsonb, 'limited category without spending is listed');
-- категории без лимита и без трат в списке не нужны
select is((select count(*)::int from jsonb_array_elements(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'categories') c
            where c->>'name' = 'здоровье'), 0, 'idle categories are not listed');
-- мягко удалённое в лимитах не учитывается
select public.delete_transaction('00000000-0000-0000-0000-00000000f601',
  (select id from public.transactions where user_id = '00000000-0000-0000-0000-00000000f601' and comment = 'Кафе'));
select is(public.api_budgets('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'overall'->'spent', '120000.00'::jsonb, 'api_budgets hides deleted rows');

-- 0 снимает лимит
select is(public.set_category_limit('00000000-0000-0000-0000-00000000f601', 'подписки', 0), true, 'zero accepted');
select is((select count(*)::int from public.budgets b join public.categories c on c.id = b.category_id
            where b.user_id = '00000000-0000-0000-0000-00000000f601' and c.name = 'подписки'), 0, 'zero removes the limit');
select throws_ok($$select public.set_category_limit('00000000-0000-0000-0000-00000000f601', 'еда', -1)$$,
  'P0001', 'bad amount', 'negative limit rejected');
select throws_ok($$select public.set_category_limit('00000000-0000-0000-0000-00000000f601', 'нетакой', 100)$$,
  'P0001', 'bad category', 'unknown category rejected');
select throws_ok($$select public.set_category_limit('00000000-0000-0000-0000-00000000f601', 'зарплата', 100)$$,
  'P0001', 'bad category', 'income category cannot have a spending limit');
select is(public.set_category_limit('00000000-0000-0000-0000-0000000000ff', 'еда', 100), false, 'unknown user reports false');
select throws_ok($$select public.api_budgets('00000000-0000-0000-0000-00000000f601', '2026-13')$$,
  'P0001', 'bad month', 'api_budgets validates the month');

-- ask_limit_left видит категорийный лимит, который теперь можно записать
select is(public.ask_limit_left('00000000-0000-0000-0000-00000000f601',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'еда'),
  now())->'limit', '600000.00'::jsonb, 'ask_limit_left reads the per-category limit');

-- api_categories: НОВАЯ форма с id
select is(public.api_categories('00000000-0000-0000-0000-00000000f601')->'income'->0->>'name', 'другое', 'income categories sorted by name');
select is((public.api_categories('00000000-0000-0000-0000-00000000f601')->'income'->0) ? 'id', true, 'each category carries its id');
select is(jsonb_typeof(public.api_categories('00000000-0000-0000-0000-00000000f601')->'income'->0), 'object', 'categories are objects now, not strings');

-- переименование
select is(public.rename_category('00000000-0000-0000-0000-00000000f601',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'кафе'),
  '  кофейни  '), true, 'rename ok');
select is((select count(*)::int from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and name = 'кофейни'), 1, 'new name trimmed and stored');
select throws_ok($$select public.rename_category('00000000-0000-0000-0000-00000000f601',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'кофейни'), 'еда')$$,
  'P0001', 'duplicate name', 'rename to an existing name rejected');
select throws_ok($$select public.rename_category('00000000-0000-0000-0000-00000000f601',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'кофейни'), '   ')$$,
  'P0001', 'bad name', 'blank name rejected');
select is(public.rename_category('00000000-0000-0000-0000-00000000f602',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'кофейни'), 'x'),
  false, 'cannot rename another user category');

-- удаление: операции живут, их категория обнуляется, лимит уходит
select is((select count(*)::int from public.transactions t join public.categories c on c.id = t.category_id
            where t.user_id = '00000000-0000-0000-0000-00000000f601' and c.name = 'еда'), 1, 'operation linked before delete');
select is(public.delete_category('00000000-0000-0000-0000-00000000f601',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'еда')),
  true, 'delete_category ok');
select is((select count(*)::int from public.transactions where user_id = '00000000-0000-0000-0000-00000000f601' and comment = 'Еда'), 1, 'operation survives the category');
select is((select category_id is null from public.transactions where user_id = '00000000-0000-0000-0000-00000000f601' and comment = 'Еда'), true, 'its category_id is cleared');
select is((select count(*)::int from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and name = 'еда'), 0, 'category gone');
select is(public.api_money('00000000-0000-0000-0000-00000000f601', to_char(current_date, 'YYYY-MM'))->'by_category'->0->>'name', 'другое', 'orphaned spend falls back to другое');
select is(public.delete_category('00000000-0000-0000-0000-00000000f602',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f601' and type = 'expense' and name = 'дом')),
  false, 'cannot delete another user category');

select is(has_function_privilege('authenticated', 'public.api_budgets(uuid, text)', 'execute'), false, 'api_budgets not exposed');
select is(has_function_privilege('authenticated', 'public.set_category_limit(uuid, text, numeric)', 'execute'), false, 'set_category_limit not exposed');

select * from finish();
rollback;
