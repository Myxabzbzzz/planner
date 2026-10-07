begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f101', 9201, 'A', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f102', 9202, 'B', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f101', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-00000000f102', 'UZS');

insert into public.inbox (id, user_id, source, text, status) values
  ('00000000-0000-0000-0000-00000000f1b1', '00000000-0000-0000-0000-00000000f101', 'voice', 'бегал, кофе, молоко', 'done');
insert into public.items (user_id, inbox_id, kind, title) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1', 'task', 'Молоко');
insert into public.transactions (user_id, inbox_id, type, amount_base, base_currency, comment, occurred_at) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1', 'expense', 20000, 'UZS', 'Кофе', current_date);
insert into public.notes (user_id, inbox_id, kind, text) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1', 'thought', 'Идея');
-- привычка, созданная этой же репликой, с единственной отметкой из неё
insert into public.habits (id, user_id, name, target_per_week, inbox_id) values
  ('00000000-0000-0000-0000-00000000f1c1', '00000000-0000-0000-0000-00000000f101', 'бег', 3, '00000000-0000-0000-0000-00000000f1b1');
insert into public.habit_logs (user_id, habit_id, date, inbox_id) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1c1', current_date - 1, '00000000-0000-0000-0000-00000000f1b1');
-- привычка из этой реплики, но с независимой отметкой: удалять её нельзя
insert into public.habits (id, user_id, name, inbox_id) values
  ('00000000-0000-0000-0000-00000000f1c2', '00000000-0000-0000-0000-00000000f101', 'чтение', '00000000-0000-0000-0000-00000000f1b1');
insert into public.habit_logs (user_id, habit_id, date) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1c2', current_date - 3);

select is(public.delete_inbox_records('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1'), 5, 'five records removed');
select is((select count(*)::int from public.items where inbox_id = '00000000-0000-0000-0000-00000000f1b1' and deleted_at is not null), 1, 'item soft-deleted');
select is((select count(*)::int from public.transactions where inbox_id = '00000000-0000-0000-0000-00000000f1b1' and deleted_at is not null), 1, 'transaction soft-deleted');
select is((select count(*)::int from public.notes where inbox_id = '00000000-0000-0000-0000-00000000f1b1' and deleted_at is not null), 1, 'note soft-deleted');
-- habit_logs/habits корзины не имеют: удаляются жёстко, но запоминаются в inbox.result
select is((select count(*)::int from public.habits where id = '00000000-0000-0000-0000-00000000f1c1'), 0, 'habit without other logs is hard-deleted');
select is((select count(*)::int from public.habits where id = '00000000-0000-0000-0000-00000000f1c2'), 1, 'habit with an independent log survives');
select is((select count(*)::int from public.habit_logs where habit_id = '00000000-0000-0000-0000-00000000f1c1'), 0, 'habit log is hard-deleted');
select is((select jsonb_array_length(result -> 'deleted_habits') from public.inbox where id = '00000000-0000-0000-0000-00000000f1b1'), 1, 'deleted habit stashed for undo');
select is((select jsonb_array_length(result -> 'deleted_habit_logs') from public.inbox where id = '00000000-0000-0000-0000-00000000f1b1'), 1, 'deleted habit log stashed for undo');
select is((select (result ->> 'deleted')::boolean from public.inbox where id = '00000000-0000-0000-0000-00000000f1b1'), true, 'inbox marked deleted');

-- отмена возвращает всё, включая отметку привычки (от неё зависит серия)
select is(public.restore_inbox_records('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1'), 5, 'five records restored');
select is((select count(*)::int from public.items where inbox_id = '00000000-0000-0000-0000-00000000f1b1' and deleted_at is null), 1, 'item back');
select is((select count(*)::int from public.transactions where inbox_id = '00000000-0000-0000-0000-00000000f1b1' and deleted_at is null), 1, 'transaction back');
select is((select count(*)::int from public.notes where inbox_id = '00000000-0000-0000-0000-00000000f1b1' and deleted_at is null), 1, 'note back');
select is((select count(*)::int from public.habits where id = '00000000-0000-0000-0000-00000000f1c1'), 1, 'habit recreated with its original id');
select is((select name from public.habits where id = '00000000-0000-0000-0000-00000000f1c1'), 'бег', 'habit name restored');
select is((select target_per_week from public.habits where id = '00000000-0000-0000-0000-00000000f1c1'), 3, 'habit target restored');
select is((select count(*)::int from public.habit_logs where habit_id = '00000000-0000-0000-0000-00000000f1c1'), 1, 'habit mark back, streak repairable');
select is((select result from public.inbox where id = '00000000-0000-0000-0000-00000000f1b1') ? 'deleted', false, 'undo markers cleared');

-- второе нажатие безопасно
select is(public.restore_inbox_records('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1'), 0, 'pressing undo twice does nothing');
select is((select count(*)::int from public.habit_logs where habit_id = '00000000-0000-0000-0000-00000000f1c1'), 1, 'no duplicate habit marks');
select is(public.restore_inbox_records('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000f1b1'), 0, 'cannot undo someone else inbox');

-- строку, удалённую отдельно ДО «удалить всё», отмена не воскрешает
insert into public.items (id, user_id, inbox_id, kind, title) values
  ('00000000-0000-0000-0000-00000000f1d9', '00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1', 'task', 'Убрана отдельно');
select public.delete_item('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1d9', 'task');
select pg_sleep(0.05);
select public.delete_inbox_records('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1');
select public.restore_inbox_records('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f1b1');
select is((select deleted_at is not null from public.items where id = '00000000-0000-0000-0000-00000000f1d9'), true, 'separately deleted row stays deleted');

select is(has_function_privilege('authenticated', 'public.restore_inbox_records(uuid, uuid)', 'execute'), false, 'restore_inbox_records not exposed');

select * from finish();
rollback;
