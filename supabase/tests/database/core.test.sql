begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into public.users (id, tg_id, name, is_allowed) values
  ('00000000-0000-0000-0000-00000000000a', 1, 'A', true),
  ('00000000-0000-0000-0000-00000000000b', 2, 'B', true);

-- onboarding
select lives_ok($$select public.onboard_user('00000000-0000-0000-0000-00000000000a', 'uzs')$$, 'onboard works');
select is((select base_currency from public.users where tg_id = 1), 'UZS', 'currency upper-cased');
select is((select count(*)::int from public.categories where user_id = '00000000-0000-0000-0000-00000000000a'), 11, '11 default categories');
select throws_ok($$select public.onboard_user('00000000-0000-0000-0000-00000000000a', 'USD')$$, 'P0001', null, 'second onboarding rejected');

-- queue
insert into public.inbox (id, user_id, source, text) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'text', 'кофе 40 000'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'text', 'привет');
select is((select count(*)::int from public.claim_inbox()), 1, 'claim returns one row');
select is((select count(*)::int from public.inbox where status = 'processing' and attempts = 1), 1, 'one row processing, attempts=1');
update public.inbox set claimed_at = now() - interval '10 minutes' where status = 'processing';
select is(public.reclaim_stuck(), 1, 'stuck row reclaimed');
select is((select count(*)::int from public.inbox where status = 'pending'), 2, 'both pending again');

-- review resolution
update public.inbox set status = 'needs_review',
  result = '{"pending_review":[{"item":{"kind":"habit_done","title":"Кофе","source_text":"кофе 40 000"},"reason":"laya","laya":null}]}'
  where id = '10000000-0000-0000-0000-000000000001';
select is(public.resolve_review('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 0, 'expense'), true, 'review resolved');
select is((select result->'pending_review'->0->>'forced_kind' from public.inbox where id = '10000000-0000-0000-0000-000000000001'), 'expense', 'forced_kind stored');
select is((select count(*)::int from public.corrections), 1, 'correction logged');
select is(public.resolve_review('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 0, 'task'), false, 'other user cannot resolve');

-- delete_inbox_records removes habits created from the inbox row (when unused)
insert into public.habits (id, user_id, name, inbox_id) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Медитация', '10000000-0000-0000-0000-000000000001');
select is(public.delete_inbox_records('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001'), 1, 'delete_inbox_records counts the habit');
select is((select count(*)::int from public.habits where id = '20000000-0000-0000-0000-000000000001'), 0, 'habit from inbox deleted');

-- RLS
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.inbox), 1, 'B sees only own inbox');
select is((select count(*)::int from public.categories), 0, 'B does not see A categories');

select * from finish();
rollback;
