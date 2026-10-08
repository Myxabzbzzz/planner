begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000d1', 41, 'D', true, 'Asia/Tashkent'),
  ('00000000-0000-0000-0000-0000000000d2', 42, 'E', true, 'Asia/Tashkent');
select public.onboard_user('00000000-0000-0000-0000-0000000000d1', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-0000000000d2', 'UZS');

-- #13 идемпотентность апдейтов
select is(public.record_update(9000001), true, 'a new update_id is accepted');
select is(public.record_update(9000001), false, 'the same update_id is rejected');
select is(public.record_update(null), true, 'an update without an id is processed as usual');
insert into public.tg_updates (update_id, seen_at) values (9000002, now() - interval '3 days');
select is(public.purge_tg_updates(), 1, 'only entries older than two days are purged');
select is((select count(*)::int from public.tg_updates where update_id = 9000001), 1, 'fresh entries survive');

-- #11 возврат failed в очередь
insert into public.inbox (id, user_id, source, text, status, attempts, error, notified_at, claimed_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 'voice', 'минута речи',
   'failed', 3, 'boom', now(), now());
select is(public.retry_inbox('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1'), true,
          'a failed row can be retried');
select is((select status from public.inbox where id = '00000000-0000-0000-0000-0000000000f1'), 'pending',
          'it goes back to pending');
select is((select attempts from public.inbox where id = '00000000-0000-0000-0000-0000000000f1'), 0,
          'attempts are reset so the worker really tries again');
select is((select text from public.inbox where id = '00000000-0000-0000-0000-0000000000f1'), 'минута речи',
          'the transcript is kept');
select is(public.retry_inbox('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1'), false,
          'a pending row is not retried again');
select is(public.retry_inbox('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f1'), false,
          'another user cannot retry it');

-- #10 отмена
insert into public.inbox (id, user_id, source, text, status, result, created_at) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', 'text', 'x', 'needs_review',
   '{"pending_review": [{"item": {"source_text": "кофе"}}, {"item": {"source_text": "зал"}, "forced_kind": "habit_new"}]}',
   now() - interval '5 hours');
select is(public.cancel_inbox('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f2'), true,
          'a queued row can be cancelled');
select is((select status from public.inbox where id = '00000000-0000-0000-0000-0000000000f2'), 'done',
          'cancelled rows leave the queue');
select is((select result ->> 'cancelled' from public.inbox where id = '00000000-0000-0000-0000-0000000000f2'), 'true',
          'the cancellation is visible in the row');
select is((select bool_and((e ->> 'resolved')::boolean)
             from public.inbox i, jsonb_array_elements(i.result -> 'pending_review') e
            where i.id = '00000000-0000-0000-0000-0000000000f2'), true,
          'open questions are closed so nothing re-asks them');
select is(public.cancel_inbox('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f2'), false,
          'cancelling twice does nothing');

-- #8 переспрос забытых уточнений
insert into public.inbox (id, user_id, source, text, status, result, created_at) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d1', 'text', 'y', 'needs_review',
   '{"pending_review": [{"item": {"source_text": "что это"}}, {"item": {"source_text": "и это"}}]}',
   now() - interval '5 hours'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d1', 'text', 'fresh', 'needs_review',
   '{"pending_review": [{"item": {"source_text": "свежее"}}]}', now()),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000d1', 'text', 'ok', 'needs_review',
   '{"pending_review": [{"item": {"source_text": "уже"}, "forced_kind": "task"}]}', now() - interval '9 hours');

select is((select count(*)::int from public.stale_reviews()), 1, 'only old and still-open questions are pinged');
select is((select pending from public.stale_reviews()), 2, 'counts the unanswered questions');
select is((select sample from public.stale_reviews()), 'что это', 'shows what the question was about');
select public.mark_review_pinged(array['00000000-0000-0000-0000-0000000000f3']::uuid[]);
select is((select count(*)::int from public.stale_reviews()), 0, 'a pinged row is quiet for a while');

-- #10 «ИИ спит, в очереди N»
select is((select count(*)::int from public.sleeping_queues()), 0, 'a fresh queue is not reported');
insert into public.inbox (id, user_id, source, text, status, created_at, reply_chat_id) values
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000d1', 'text', 'q1', 'pending',
   now() - interval '30 hours', 4242),
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000d1', 'text', 'q2', 'pending',
   now() - interval '2 hours', null);
select is((select queued from public.sleeping_queues() where user_id = '00000000-0000-0000-0000-0000000000d1'), 3,
          'counts everything still waiting, including the retried row');

select * from finish();
rollback;
