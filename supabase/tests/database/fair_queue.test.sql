begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000fa01', 9601, 'Флудер', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000fa02', 9602, 'Тихий', 'Asia/Tashkent', true);

-- у первого три сообщения раньше, у второго одно позже
insert into public.inbox (id, user_id, source, text, status, created_at) values
  ('00000000-0000-0000-0000-00000000fa11', '00000000-0000-0000-0000-00000000fa01', 'text', 'a1', 'pending', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-00000000fa12', '00000000-0000-0000-0000-00000000fa01', 'text', 'a2', 'pending', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-00000000fa13', '00000000-0000-0000-0000-00000000fa01', 'text', 'a3', 'pending', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-00000000fa21', '00000000-0000-0000-0000-00000000fa02', 'text', 'b1', 'pending', now() - interval '30 seconds');

-- как воркер: взял одну запись, закончил, взял следующую
create function pg_temp.next() returns text language plpgsql as $$
declare r public.inbox;
begin
  select * into r from public.claim_inbox();
  update public.inbox set status = 'done' where id = r.id;
  return r.text;
end $$;

select is(pg_temp.next(), 'a1', 'oldest message of the queue goes first');
select is(pg_temp.next(), 'b1', 'another user''s first message does not wait behind a flood');
select is(pg_temp.next(), 'a2', 'then the flooder continues in order');
select is(pg_temp.next(), 'a3', 'and finishes');
select is(has_function_privilege('authenticated', 'public.claim_inbox()', 'execute'), false, 'claim_inbox not exposed');

select * from finish();
rollback;
