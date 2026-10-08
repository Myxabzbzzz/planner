begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- новый пользователь получает 7 дней пробного Pro
insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000b001', 9701, 'Новый', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000b001', 'UZS');
select ok((select pro_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
             from public.users where id = '00000000-0000-0000-0000-00000000b001'), 'new user gets a 7-day trial');
select is(public.is_pro('00000000-0000-0000-0000-00000000b001'), true, 'trial counts as Pro');
select is(public.api_subscription('00000000-0000-0000-0000-00000000b001') ->> 'status', 'trial', 'status says trial');

-- триал закончился — Free, 3 действия ИИ в день
update public.users set pro_until = now() - interval '1 minute' where id = '00000000-0000-0000-0000-00000000b001';
select is(public.is_pro('00000000-0000-0000-0000-00000000b001'), false, 'expired trial is Free');
select is(public.api_subscription('00000000-0000-0000-0000-00000000b001') ->> 'status', 'free', 'status says free');
select is(public.ai_quota_use('00000000-0000-0000-0000-00000000b001'), true, 'free AI action 1');
select is(public.ai_quota_use('00000000-0000-0000-0000-00000000b001'), true, 'free AI action 2');
select is((public.api_subscription('00000000-0000-0000-0000-00000000b001') ->> 'ai_left')::int, 1, 'one action left today');
select is(public.ai_quota_use('00000000-0000-0000-0000-00000000b001'), true, 'free AI action 3');
select is(public.ai_quota_use('00000000-0000-0000-0000-00000000b001'), false, 'fourth action today is refused');
-- вчерашние действия не считаются
update public.rate_events set at = at - interval '1 day' where user_id = '00000000-0000-0000-0000-00000000b001';
select is(public.ai_quota_use('00000000-0000-0000-0000-00000000b001'), true, 'quota resets the next day');

-- оплата месяца продлевает до даты из Telegram; повтор того же платежа не зачисляется
select is(public.apply_payment('00000000-0000-0000-0000-00000000b001', 'ch-1', 'month', 150, now() + interval '30 days', true),
          true, 'month payment applied');
select is(public.is_pro('00000000-0000-0000-0000-00000000b001'), true, 'paid user is Pro');
select is(public.apply_payment('00000000-0000-0000-0000-00000000b001', 'ch-1', 'month', 150, now() + interval '30 days', true),
          false, 'same charge id is not applied twice');
select is((select count(*)::int from public.payments where user_id = '00000000-0000-0000-0000-00000000b001'), 1, 'one payment row');
select is(public.ai_quota_use('00000000-0000-0000-0000-00000000b001'), true, 'Pro has no AI limit');
select is(public.api_subscription('00000000-0000-0000-0000-00000000b001') ->> 'status', 'pro', 'status says pro');

-- год — прибавляется к оставшемуся сроку; навсегда — бессрочно
select public.apply_payment('00000000-0000-0000-0000-00000000b001', 'ch-2', 'year', 1100, null, false);
select ok((select pro_until > now() + interval '394 days' from public.users where id = '00000000-0000-0000-0000-00000000b001'),
          'a year is added on top of the remaining month');
select public.apply_payment('00000000-0000-0000-0000-00000000b001', 'ch-3', 'lifetime', 2200, null, false);
select is(public.api_subscription('00000000-0000-0000-0000-00000000b001') ->> 'status', 'lifetime', 'lifetime status');
select throws_ok($$select public.apply_payment('00000000-0000-0000-0000-00000000b001', 'ch-4', 'weekly', 1, null, false)$$,
  'P0001', 'bad plan', 'unknown plan rejected');

-- итоги недели — только Pro
insert into public.users (id, tg_id, name, tz, is_allowed, onboarded_at, base_currency, pro_until, notify_weekly) values
  ('00000000-0000-0000-0000-00000000b002', 9702, 'Free', 'Asia/Tashkent', true, now(), 'UZS', '2026-10-11 12:00 Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000b003', 9703, 'Pro', 'Asia/Tashkent', true, now(), 'UZS', '2026-10-12 12:00 Asia/Tashkent', true);
select is((select array_agg(chat_id order by chat_id) from public.due_digests('2026-10-11 22:00 Asia/Tashkent') where kind = 'weekly'
             and chat_id in (9702, 9703)), array[9703::bigint], 'weekly digest goes to Pro only');

select is(has_function_privilege('authenticated', 'public.apply_payment(uuid, text, text, int, timestamptz, boolean)', 'execute'),
          false, 'apply_payment not exposed');

select * from finish();
rollback;
