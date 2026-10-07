begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.users (id, tg_id, name, is_allowed, tz) values
  ('00000000-0000-0000-0000-0000000000c1', 31, 'C', true, 'Asia/Tashkent'),
  ('00000000-0000-0000-0000-0000000000c2', 32, 'D', true, 'Asia/Tashkent');
select public.onboard_user('00000000-0000-0000-0000-0000000000c1', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-0000000000c2', 'UZS');
insert into public.inbox (id, user_id, source, text) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'text', 'x'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2', 'text', 'y');

insert into public.corrections (user_id, inbox_id, before, after, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1',
   '{"item": {"source_text": "кофе 40к"}}', '{"kind": "expense"}', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1',
   '{"item": {"source_text": "  зал  "}}', '{"kind": "habit_new"}', now()),
  -- пропущенная запись ничему не учит
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1',
   '{"item": {"source_text": "мусор"}}', '{"kind": "drop"}', now()),
  -- запись без исходного текста тоже
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1',
   '{"item": {}}', '{"kind": "task"}', now()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2',
   '{"item": {"source_text": "чужое"}}', '{"kind": "note"}', now());

select is((select count(*)::int from public.recent_corrections('00000000-0000-0000-0000-0000000000c1')), 2,
          'only usable corrections are returned');
select is((select text from public.recent_corrections('00000000-0000-0000-0000-0000000000c1') limit 1), 'зал',
          'newest first and trimmed');
select is((select kind from public.recent_corrections('00000000-0000-0000-0000-0000000000c1') limit 1), 'habit_new',
          'the kind the user picked');
select is((select count(*)::int from public.recent_corrections('00000000-0000-0000-0000-0000000000c1')
            where kind = 'drop'), 0, 'skipped entries are excluded');
select is((select count(*)::int from public.recent_corrections('00000000-0000-0000-0000-0000000000c2')), 1,
          'scoped to the user');
select is((select count(*)::int from public.recent_corrections('00000000-0000-0000-0000-0000000000c1', 1)), 1,
          'limit is honoured');
select is((select count(*)::int from public.recent_corrections('00000000-0000-0000-0000-0000000000c1', 0)), 1,
          'a zero limit is clamped to 1, not to nothing');

select is(has_function_privilege('authenticated', 'public.recent_corrections(uuid, int)', 'execute'), false,
          'authenticated cannot execute');

select * from finish();
rollback;
