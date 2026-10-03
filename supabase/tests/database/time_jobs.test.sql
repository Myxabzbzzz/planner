begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.users (id, tg_id, name, is_allowed) values
  ('00000000-0000-0000-0000-0000000000c1', 21, 'C', true),
  ('00000000-0000-0000-0000-0000000000d1', 22, 'D', true);
insert into public.inbox (id, user_id, source, text, status, result) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'text', 'x', 'needs_review',
   '{"pending_review":[{"item":{"kind":"event","title":"A","source_text":"a"},"reason":"time","laya":null},
                       {"item":{"kind":"event","title":"B","source_text":"b"},"reason":"time","laya":null},
                       {"item":{"kind":"event","title":"C","source_text":"c"},"reason":"time","laya":null}]}');

select is(public.resolve_time('00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', 0, '2500'), false, 'bad hour rejected');
select is(public.resolve_time('00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', 0, 'abc'), false, 'garbage rejected');
select is(public.resolve_time('00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', -1, '1500'), false, 'negative idx rejected');
select is(public.resolve_time('00000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-000000000001', 0, '1500'), false, 'other user rejected');
select is(public.resolve_time('00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', 0, '1500'), true, 'time accepted');
select is((select result->'pending_review'->0->>'forced_kind' from public.inbox where id = '40000000-0000-0000-0000-000000000001'), 'event', 'forced event');
select is((select result->'pending_review'->0->>'forced_time' from public.inbox where id = '40000000-0000-0000-0000-000000000001'), '15:00', 'forced time');
select is((select status from public.inbox where id = '40000000-0000-0000-0000-000000000001'), 'pending', 'back to pending');
select is(public.resolve_time('00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', 0, '0900'), false, 'already resolved');
select is(public.resolve_time('00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001', 1, 'none'), true, 'none accepted');
select is((select result->'pending_review'->1->>'forced_kind' from public.inbox where id = '40000000-0000-0000-0000-000000000001'), 'task', 'none -> task');
select is((select count(*)::int from public.corrections where inbox_id = '40000000-0000-0000-0000-000000000001'), 2, 'corrections logged');

-- jobs
insert into public.jobs (id, user_id, kind, chat_id) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'shortcut_file', 21);
select is((select count(*)::int from public.claim_job()), 1, 'job claimed');
select is((select count(*)::int from public.claim_job()), 0, 'nothing left to claim');
update public.jobs set claimed_at = now() - interval '10 minutes' where id = '50000000-0000-0000-0000-000000000001';
select public.reclaim_stuck();
select is((select status from public.jobs where id = '50000000-0000-0000-0000-000000000001'), 'pending', 'stuck job reclaimed');
update public.jobs set status = 'processing', attempts = 3, claimed_at = now() - interval '10 minutes' where id = '50000000-0000-0000-0000-000000000001';
select public.reclaim_stuck();
select is((select status || '/' || error from public.jobs where id = '50000000-0000-0000-0000-000000000001'), 'failed/stuck: too many attempts', 'stuck job at max attempts fails with error');

select is(has_function_privilege('authenticated', 'public.resolve_time(uuid, uuid, int, text)', 'execute')
          or has_function_privilege('anon', 'public.claim_job()', 'execute'), false, 'no client access');

select * from finish();
rollback;
