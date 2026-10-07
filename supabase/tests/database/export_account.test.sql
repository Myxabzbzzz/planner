begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into public.users (id, tg_id, tg_username, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f401', 9501, 'amir', 'Amir', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f402', 9502, 'other', 'B', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f401', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-00000000f402', 'UZS');

insert into public.items (id, user_id, kind, title) values
  ('00000000-0000-0000-0000-00000000f411', '00000000-0000-0000-0000-00000000f401', 'task', 'Живая'),
  ('00000000-0000-0000-0000-00000000f412', '00000000-0000-0000-0000-00000000f401', 'task', 'Удалённая');
insert into public.notes (id, user_id, kind, text) values
  ('00000000-0000-0000-0000-00000000f421', '00000000-0000-0000-0000-00000000f401', 'thought', 'Мысль');
insert into public.transactions (id, user_id, type, amount_base, base_currency, amount_orig, currency_orig, fx_rate, fx_date, comment, occurred_at) values
  ('00000000-0000-0000-0000-00000000f431', '00000000-0000-0000-0000-00000000f401', 'expense', 1200000, 'UZS', 100, 'USD', 12000, current_date, 'Кроссовки', current_date);
insert into public.habits (id, user_id, name, target_per_week) values
  ('00000000-0000-0000-0000-00000000f441', '00000000-0000-0000-0000-00000000f401', 'бег', 3);
insert into public.habit_logs (user_id, habit_id, date) values
  ('00000000-0000-0000-0000-00000000f401', '00000000-0000-0000-0000-00000000f441', current_date);
select public.set_limit('00000000-0000-0000-0000-00000000f401', 2000000);
select public.delete_item('00000000-0000-0000-0000-00000000f401', '00000000-0000-0000-0000-00000000f412', 'task');

select is(public.export_data('00000000-0000-0000-0000-0000000000ff'), null, 'unknown user exports nothing');
select is(public.export_data('00000000-0000-0000-0000-00000000f401')->'profile'->>'name', 'Amir', 'profile included');
select is(public.export_data('00000000-0000-0000-0000-00000000f401')->'profile'->>'base_currency', 'UZS', 'base currency included');
select is(public.export_data('00000000-0000-0000-0000-00000000f401')->'profile'->>'tg_username', 'amir', 'username included');
select is(jsonb_array_length(public.export_data('00000000-0000-0000-0000-00000000f401')->'items'), 1, 'soft-deleted items excluded');
select is(public.export_data('00000000-0000-0000-0000-00000000f401')->'items'->0->>'title', 'Живая', 'the surviving item is the live one');
select is(jsonb_array_length(public.export_data('00000000-0000-0000-0000-00000000f401')->'notes'), 1, 'notes included');
select is(jsonb_array_length(public.export_data('00000000-0000-0000-0000-00000000f401')->'transactions'), 1, 'transactions included');
select is(public.export_data('00000000-0000-0000-0000-00000000f401')->'transactions'->0->>'currency_orig', 'USD', 'original currency included');
select is(public.export_data('00000000-0000-0000-0000-00000000f401')->'transactions'->0->>'amount_orig', '100.00', 'original amount included');
select is(jsonb_array_length(public.export_data('00000000-0000-0000-0000-00000000f401')->'habits'), 1, 'habits included');
select is(jsonb_array_length(public.export_data('00000000-0000-0000-0000-00000000f401')->'habits'->0->'logs'), 1, 'habit logs included');
select is(jsonb_array_length(public.export_data('00000000-0000-0000-0000-00000000f401')->'categories'), 11, 'default categories included');
select is(jsonb_array_length(public.export_data('00000000-0000-0000-0000-00000000f401')->'budgets'), 1, 'budgets included');
-- выгрузка строго своя
select is(jsonb_array_length(public.export_data('00000000-0000-0000-0000-00000000f402')->'items'), 0, 'export never leaks another user rows');

-- удаление аккаунта уносит всё каскадом, но только своё
select is(public.delete_account('00000000-0000-0000-0000-00000000f401'), true, 'account deleted');
select is((select count(*)::int from public.items where user_id = '00000000-0000-0000-0000-00000000f401'), 0, 'items cascade');
select is((select count(*)::int from public.transactions where user_id = '00000000-0000-0000-0000-00000000f401'), 0, 'transactions cascade');
select is((select count(*)::int from public.notes where user_id = '00000000-0000-0000-0000-00000000f401'), 0, 'notes cascade');
select is((select count(*)::int from public.habits where user_id = '00000000-0000-0000-0000-00000000f401'), 0, 'habits cascade');
select is((select count(*)::int from public.habit_logs where user_id = '00000000-0000-0000-0000-00000000f401'), 0, 'habit logs cascade');
select is((select count(*)::int from public.categories where user_id = '00000000-0000-0000-0000-00000000f401'), 0, 'categories cascade');
select is((select count(*)::int from public.budgets where user_id = '00000000-0000-0000-0000-00000000f401'), 0, 'budgets cascade');
select is((select count(*)::int from public.users where id = '00000000-0000-0000-0000-00000000f402'), 1, 'other user untouched');
select is((select count(*)::int from public.categories where user_id = '00000000-0000-0000-0000-00000000f402'), 11, 'other user categories untouched');
select is(public.delete_account('00000000-0000-0000-0000-00000000f401'), false, 'deleting twice reports nothing done');

select is(has_function_privilege('authenticated', 'public.export_data(uuid)', 'execute'), false, 'export_data not exposed');
select is(has_function_privilege('authenticated', 'public.delete_account(uuid)', 'execute'), false, 'delete_account not exposed');

select * from finish();
rollback;
