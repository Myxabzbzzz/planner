begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f001', 9101, 'A', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f002', 9102, 'B', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f001', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-00000000f002', 'UZS');

insert into public.items (id, user_id, kind, title, due_at, due_has_time) values
  ('00000000-0000-0000-0000-00000000f011', '00000000-0000-0000-0000-00000000f001', 'task', 'Задача',
    (current_date + time '10:00') at time zone 'Asia/Tashkent', true);
insert into public.notes (id, user_id, kind, text) values
  ('00000000-0000-0000-0000-00000000f021', '00000000-0000-0000-0000-00000000f001', 'thought', 'Мысль');
insert into public.transactions (id, user_id, type, amount_base, base_currency, comment, occurred_at) values
  ('00000000-0000-0000-0000-00000000f031', '00000000-0000-0000-0000-00000000f001', 'expense', 50000, 'UZS', 'Обед', current_date);

-- удаление мягкое: строка остаётся, но помечена
select is(public.delete_item('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011', 'task'), true, 'delete_item ok');
select is((select count(*)::int from public.items where id = '00000000-0000-0000-0000-00000000f011'), 1, 'item row survives');
select is((select deleted_at is not null from public.items where id = '00000000-0000-0000-0000-00000000f011'), true, 'item flagged deleted');
select is(public.delete_note('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f021'), true, 'delete_note ok');
select is((select deleted_at is not null from public.notes where id = '00000000-0000-0000-0000-00000000f021'), true, 'note flagged deleted');
select is(public.delete_transaction('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f031'), true, 'delete_transaction ok');
select is((select deleted_at is not null from public.transactions where id = '00000000-0000-0000-0000-00000000f031'), true, 'transaction flagged deleted');

-- повторное удаление ничего не делает
select is(public.delete_item('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011', 'task'), false, 'second delete is a no-op');

-- ни один путь чтения удалённого не показывает
select is(public.api_tasks('00000000-0000-0000-0000-00000000f001', 'today')->'total', '0'::jsonb, 'api_tasks hides deleted');
select is(jsonb_array_length(public.api_notes('00000000-0000-0000-0000-00000000f001', null, null)->'notes'), 0, 'api_notes hides deleted');
select is(public.api_money('00000000-0000-0000-0000-00000000f001', to_char(current_date, 'YYYY-MM'))->'expense', '0'::jsonb, 'api_money hides deleted');
select is(public.summary_money('00000000-0000-0000-0000-00000000f001')->'expense', '0'::jsonb, 'summary_money hides deleted');
select is(public.summary_tasks('00000000-0000-0000-0000-00000000f001')->'total', '0'::jsonb, 'summary_tasks hides deleted');
select is(public.summary_today('00000000-0000-0000-0000-00000000f001')->'spent_today', '0'::jsonb, 'summary_today hides deleted');
select is(public.ask_sum('00000000-0000-0000-0000-00000000f001', 'expense', null, null, null)->'total', '0'::jsonb, 'ask_sum hides deleted');
select is(public.ask_limit_left('00000000-0000-0000-0000-00000000f001', null, now())->'spent', '0'::jsonb, 'ask_limit_left hides deleted');
select is(public.ask_top_categories('00000000-0000-0000-0000-00000000f001', null, null)->'total', '0'::jsonb, 'ask_top_categories hides deleted');
select is(public.ask_open_tasks('00000000-0000-0000-0000-00000000f001', now())->'today', '0'::jsonb, 'ask_open_tasks hides deleted');
select is(public.api_profile('00000000-0000-0000-0000-00000000f001', 1)->'notes'->'total', '0'::jsonb, 'api_profile hides deleted notes');
select is(public.api_profile('00000000-0000-0000-0000-00000000f001', 1)->'tasks'->'open', '0'::jsonb, 'api_profile hides deleted tasks');
select is(public.digest_daily('00000000-0000-0000-0000-00000000f001', current_date, now())->'spent', '0'::jsonb, 'digest_daily hides deleted');
select is(public.digest_weekly('00000000-0000-0000-0000-00000000f001', current_date, now())->'next_tasks', '0'::jsonb, 'digest_weekly hides deleted');
select is((select count(*)::int from public.activity_days('00000000-0000-0000-0000-00000000f001', 'Asia/Tashkent')), 0, 'activity_days hides deleted');
select is((select count(*)::int from public.due_reminders(now())), 0, 'due_reminders skips deleted');

-- удалённое не правится и не закрывается
select is(public.set_item_done('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011', 'task', true), false, 'set_item_done skips deleted');
select is(public.complete_task('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011'), false, 'complete_task skips deleted');
select is(public.update_task('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011', 'Новое', null, null, null), false, 'update_task skips deleted');
select is(public.update_note('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f021', 'Новое', null), false, 'update_note skips deleted');
select is(public.update_transaction('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f031', 1, null, null), false, 'update_transaction skips deleted');

-- возврат
select is(public.restore_item('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011', 'task'), true, 'restore_item ok');
select is(public.restore_note('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f021'), true, 'restore_note ok');
select is(public.restore_transaction('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f031'), true, 'restore_transaction ok');
select is(public.api_money('00000000-0000-0000-0000-00000000f001', to_char(current_date, 'YYYY-MM'))->'expense', '50000.00'::jsonb, 'money back after restore');
select is(public.api_tasks('00000000-0000-0000-0000-00000000f001', 'today')->'total', '1'::jsonb, 'task back after restore');
select is(jsonb_array_length(public.api_notes('00000000-0000-0000-0000-00000000f001', null, null)->'notes'), 1, 'note back after restore');
select is(public.restore_item('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011', 'task'), false, 'restore is idempotent');

-- чужие строки недоступны в обе стороны
select is(public.delete_item('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f011', 'task'), false, 'cannot delete others item');
select is(public.delete_note('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f021'), false, 'cannot delete others note');
select is(public.delete_transaction('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f031'), false, 'cannot delete others transaction');
select throws_ok($$select public.delete_item('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011', 'habit')$$,
  'P0001', 'bad kind', 'delete_item validates kind');
select throws_ok($$select public.restore_item('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f011', 'habit')$$,
  'P0001', 'bad kind', 'restore_item validates kind');

-- purge: только то, что удалено раньше порога
select public.delete_transaction('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f031');
select public.delete_note('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f021');
update public.transactions set deleted_at = now() - interval '40 days' where id = '00000000-0000-0000-0000-00000000f031';
select is(public.purge_deleted(now() - interval '30 days'), 1, 'purge removes only the old one');
select is((select count(*)::int from public.transactions where id = '00000000-0000-0000-0000-00000000f031'), 0, 'old row gone for good');
select is((select count(*)::int from public.notes where id = '00000000-0000-0000-0000-00000000f021'), 1, 'fresh deleted row stays in the bin');
select throws_ok($$select public.purge_deleted(null)$$, 'P0001', 'bad before', 'purge validates argument');

-- клиенту эти функции недоступны
select is(has_function_privilege('authenticated', 'public.restore_item(uuid, uuid, text)', 'execute'), false, 'restore_item not exposed');
select is(has_function_privilege('authenticated', 'public.purge_deleted(timestamptz)', 'execute'), false, 'purge_deleted not exposed');

select * from finish();
rollback;
