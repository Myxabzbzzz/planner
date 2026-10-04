begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.users (id, tg_id, name, is_allowed) values
  ('00000000-0000-0000-0000-0000000000a5', 51, 'A', true),
  ('00000000-0000-0000-0000-0000000000b5', 52, 'B', true);
insert into public.inbox (id, user_id, source, text, status, result) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', 'miniapp', 'кофе 40 000', 'done',
   '{"reply": "✅ Записал:\n💸 Кофе — 40 000 сум"}');

select is(public.api_inbox_status('00000000-0000-0000-0000-0000000000a5', '50000000-0000-0000-0000-000000000001')->>'status', 'done', 'status');
select is(public.api_inbox_status('00000000-0000-0000-0000-0000000000a5', '50000000-0000-0000-0000-000000000001')->>'reply', E'✅ Записал:\n💸 Кофе — 40 000 сум', 'reply');
select is(public.api_inbox_status('00000000-0000-0000-0000-0000000000b5', '50000000-0000-0000-0000-000000000001'), null, 'not visible to others');
select is(has_function_privilege('anon', 'public.api_inbox_status(uuid, uuid)', 'execute'), false, 'anon cannot execute');

select * from finish();
rollback;
