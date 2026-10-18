begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000fb01', 9701, 'Первый', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000fb02', 9702, 'Второй', 'Asia/Tashkent', true);

insert into public.inbox (id, user_id, source, text, status, created_at) values
  ('00000000-0000-0000-0000-00000000fb11', '00000000-0000-0000-0000-00000000fb01', 'text', 'a1', 'pending', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-00000000fb12', '00000000-0000-0000-0000-00000000fb01', 'text', 'a2', 'pending', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-00000000fb21', '00000000-0000-0000-0000-00000000fb02', 'text', 'b1', 'pending', now() - interval '1 minute');

-- два потока берут, ничего не заканчивая
select is((select text from public.claim_inbox()), 'a1', 'first lane takes the oldest message');
select is((select text from public.claim_inbox()), 'b1', 'second lane skips a2: its author already has a message in work');
select is((select count(*)::int from public.claim_inbox()), 0, 'third lane waits instead of taking a2 early');

update public.inbox set status = 'done' where text = 'a1';
select is((select text from public.claim_inbox()), 'a2', 'a2 goes once a1 is done');

select * from finish();
rollback;
