begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f801', 9901, 'A', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f802', 9902, 'B', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f801', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-00000000f802', 'UZS');

-- pending_review в том же виде, в каком его пишет worker/pipeline.py
insert into public.inbox (id, user_id, source, text, status, result) values
 ('00000000-0000-0000-0000-00000000f8e1', '00000000-0000-0000-0000-00000000f801', 'voice', 'лая, встреча, созвон, кофе', 'needs_review',
  jsonb_build_object('text', 'лая, встреча, созвон, кофе', 'saved', 0, 'pending_review', jsonb_build_array(
    jsonb_build_object('item', jsonb_build_object('kind','note','title','лая','source_text','лая'),
                       'reason','laya','laya', jsonb_build_object('group','note','confidence',0.41)),
    jsonb_build_object('item', jsonb_build_object('kind','event','title','встреча','source_text','встреча с Лёшей','with_whom','Лёша'),
                       'reason','time','laya', null),
    jsonb_build_object('item', jsonb_build_object('kind','event','title','созвон','source_text','созвон в 9',
                                                  'starts_at', to_char(((current_date + time '09:00') at time zone 'Asia/Tashkent'), 'YYYY-MM-DD"T"HH24:MI:SSOF')),
                       'reason','past','laya', null),
    jsonb_build_object('item', jsonb_build_object('kind','expense','title','кофе','source_text','кофе 50','amount',50,'currency','USD',
                                                  'occurred_on', (current_date + 2)::text),
                       'reason','future','laya', null),
    -- на этот вопрос уже ответили: в выдаче его быть не должно
    jsonb_build_object('item', jsonb_build_object('kind','task','title','молоко','source_text','молоко'),
                       'reason','laya','forced_kind','task','resolved',true))));
-- разобранная запись вопросов не содержит
insert into public.inbox (id, user_id, source, text, status, result) values
 ('00000000-0000-0000-0000-00000000f8e2', '00000000-0000-0000-0000-00000000f801', 'text', 'всё ок', 'done', '{"pending_review": []}'::jsonb);

select is(public.api_reviews('00000000-0000-0000-0000-0000000000ff'), null, 'unknown user gets null');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f802')->'reviews', '[]'::jsonb, 'another user sees nothing');
select is(jsonb_array_length(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'), 1, 'only the row with open questions is returned');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->>'inbox_id', '00000000-0000-0000-0000-00000000f8e1', 'inbox_id is the resolve_* argument');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->>'text', 'лая, встреча, созвон, кофе', 'original text included');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->>'status', 'needs_review', 'status included');
select is(jsonb_array_length(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'), 4, 'answered entries are filtered out');

-- idx обязан совпадать с индексом в result->pending_review
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->0->'idx', '0'::jsonb, 'first question keeps index 0');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->3->'idx', '3'::jsonb, 'fourth question keeps index 3');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->1->>'reason', 'time', 'reason passed through');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->1->>'source_text', 'встреча с Лёшей', 'source_text surfaced for the UI');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->0->'laya'->>'group', 'note', 'classifier hint passed through');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->0->'item'->>'title', 'лая', 'the whole extracted item is included');

-- наборы вариантов повторяют кнопки бота
select is(jsonb_array_length(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->0->'options'), 9, 'laya offers eight kinds plus skip');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->0->'options'->0->>'rpc', 'resolve_review', 'laya is answered via resolve_review');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->0->'options'->0->>'arg', 'task', 'first option is task');
select is(jsonb_array_length(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->1->'options'), 7, 'time offers five hours, no-time and skip');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->1->'options'->0->>'rpc', 'resolve_time', 'time is answered via resolve_time');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->1->'options'->0->>'arg', '0900', 'HHMM is what resolve_time expects');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->1->'options'->5->>'arg', 'none', 'no-time option present');
select is(jsonb_array_length(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->3->'options'), 2, 'future offers today or skip');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->3->'options'->0->>'arg', 'expense', 'future keeps the extracted kind');

-- каждый arg действительно принимается своим RPC
select is(public.resolve_time('00000000-0000-0000-0000-00000000f801', '00000000-0000-0000-0000-00000000f8e1', 1,
  (public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->1->'options'->2->>'arg')), true, 'an offered resolve_time arg is accepted');
select is((select result->'pending_review'->1->>'forced_kind' from public.inbox where id = '00000000-0000-0000-0000-00000000f8e1'), 'event', 'resolve_time wrote forced_kind');
select is((select result->'pending_review'->1->>'forced_time' from public.inbox where id = '00000000-0000-0000-0000-00000000f8e1'), '15:00', 'resolve_time wrote forced_time');
-- строка ушла в pending, но остальные вопросы всё ещё открыты и обязаны быть видны
select is((select status from public.inbox where id = '00000000-0000-0000-0000-00000000f8e1'), 'pending', 'answering flips the row to pending');
select is(jsonb_array_length(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'), 3, 'the remaining questions stay visible while pending');
select is(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'->0->'idx', '0'::jsonb, 'indexes do not shift after an answer');
select is(public.resolve_review('00000000-0000-0000-0000-00000000f801', '00000000-0000-0000-0000-00000000f8e1', 0, 'note'), true, 'an offered resolve_review arg is accepted');
select is(jsonb_array_length(public.api_reviews('00000000-0000-0000-0000-00000000f801')->'reviews'->0->'questions'), 2, 'the answered question disappears');
select is(public.resolve_review('00000000-0000-0000-0000-00000000f801', '00000000-0000-0000-0000-00000000f8e1', 0, 'task'), false, 'answering the same question twice is refused');

select is(has_function_privilege('authenticated', 'public.api_reviews(uuid)', 'execute'), false, 'api_reviews not exposed');

select * from finish();
rollback;
