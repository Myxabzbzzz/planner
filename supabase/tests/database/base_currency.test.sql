begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f301', 9401, 'A', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f301', 'UZS');

-- курсы: единиц валюты за 1 USD (то же соглашение, что читает worker/fx.py)
insert into public.fx_rates (date, base, rates, source) values
  (current_date - 40, 'USD', '{"USD":1,"UZS":12000,"EUR":0.9}', 'test'),
  (current_date - 5,  'USD', '{"USD":1,"UZS":12500,"EUR":0.92}', 'test');

-- без исходной суммы: пересчёт из старой базы по курсу на дату операции
insert into public.transactions (id, user_id, type, amount_base, base_currency, comment, occurred_at) values
  ('00000000-0000-0000-0000-00000000f311', '00000000-0000-0000-0000-00000000f301', 'expense', 50000, 'UZS', 'Обед', current_date - 1);
-- с исходной суммой: пересчёт от неё, курсом новой базы на fx_date
insert into public.transactions (id, user_id, type, amount_base, base_currency, amount_orig, currency_orig, fx_rate, fx_date, fx_source, comment, occurred_at) values
  ('00000000-0000-0000-0000-00000000f312', '00000000-0000-0000-0000-00000000f301', 'expense', 1200000, 'UZS', 100, 'USD', 12000, current_date - 40, 'test', 'Кроссовки', current_date - 39);
-- валюта, которой нет в курсах: должна остаться нетронутой
insert into public.transactions (id, user_id, type, amount_base, base_currency, amount_orig, currency_orig, fx_rate, fx_date, comment, occurred_at) values
  ('00000000-0000-0000-0000-00000000f313', '00000000-0000-0000-0000-00000000f301', 'expense', 777000, 'UZS', 50, 'GBP', 15540, current_date - 40, 'Книга', current_date - 39);
select public.set_limit('00000000-0000-0000-0000-00000000f301', 5000000);
select public.set_category_limit('00000000-0000-0000-0000-00000000f301', 'еда', 600000);

select is(public.change_base_currency('00000000-0000-0000-0000-00000000f301', 'usd'),
  jsonb_build_object('converted', 2, 'skipped', 1, 'from', 'UZS', 'to', 'USD'), 'report counts converted and skipped');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f311'), 4.00::numeric, 'base amount converted at the rate of the operation date');
select is((select base_currency from public.transactions where id = '00000000-0000-0000-0000-00000000f311'), 'USD', 'row base currency updated');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f312'), 100.00::numeric, 'amount re-derived from the original');
select is((select fx_rate from public.transactions where id = '00000000-0000-0000-0000-00000000f312'), 1.00000000::numeric, 'stored rate now points at the new base');
select is((select amount_orig from public.transactions where id = '00000000-0000-0000-0000-00000000f312'), 100.00::numeric, 'original amount untouched');
-- строка без курса остаётся как была: лучше старое число, чем заведомо неверное
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f313'), 777000.00::numeric, 'unconvertible row keeps its amount');
select is((select base_currency from public.transactions where id = '00000000-0000-0000-0000-00000000f313'), 'UZS', 'unconvertible row keeps its currency');
select is((select base_currency from public.users where id = '00000000-0000-0000-0000-00000000f301'), 'USD', 'user base currency updated');
select is((select monthly_limit from public.budgets where user_id = '00000000-0000-0000-0000-00000000f301' and category_id is null), 400.00::numeric, 'overall limit converted');
select is((select b.monthly_limit from public.budgets b join public.categories c on c.id = b.category_id
            where b.user_id = '00000000-0000-0000-0000-00000000f301' and c.name = 'еда'), 48.00::numeric, 'category limit converted');

-- обратно: суммы возвращаются точно
select is(public.change_base_currency('00000000-0000-0000-0000-00000000f301', 'UZS')->'converted', '2'::jsonb, 'round trip converts the same rows');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f311'), 50000.00::numeric, 'round trip restores the base amount');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f312'), 1200000.00::numeric, 'round trip restores the derived amount');
select is((select monthly_limit from public.budgets where user_id = '00000000-0000-0000-0000-00000000f301' and category_id is null), 5000000.00::numeric, 'round trip restores the limit');

select throws_ok($$select public.change_base_currency('00000000-0000-0000-0000-00000000f301', 'UZS')$$,
  'P0001', 'same currency', 'changing to the same currency is refused');
select throws_ok($$select public.change_base_currency('00000000-0000-0000-0000-00000000f301', 'XYZ')$$,
  'P0001', 'unknown currency', 'currency must exist in fx_rates');
select throws_ok($$select public.change_base_currency('00000000-0000-0000-0000-00000000f301', 'ab')$$,
  'P0001', 'bad currency', 'malformed code rejected');
select throws_ok($$select public.change_base_currency('00000000-0000-0000-0000-0000000000ff', 'USD')$$,
  'P0001', 'user not found', 'unknown user rejected');

-- мягко удалённые строки тоже пересчитываются, иначе отмена удаления вернёт старую валюту
select public.delete_transaction('00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-00000000f311');
select public.change_base_currency('00000000-0000-0000-0000-00000000f301', 'USD');
select is((select amount_base from public.transactions where id = '00000000-0000-0000-0000-00000000f311'), 4.00::numeric, 'deleted rows are converted too');

select is(has_function_privilege('authenticated', 'public.change_base_currency(uuid, text)', 'execute'), false, 'change_base_currency not exposed');

select * from finish();
rollback;
