begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f701', 9801, 'A', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f702', 9802, 'B', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f701', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-00000000f702', 'UZS');

select is((select c->'color' from jsonb_array_elements(public.api_categories('00000000-0000-0000-0000-00000000f701')->'expense') c
            where c->>'name' = 'еда'), 'null'::jsonb, 'no color by default');

select is(public.set_category_color('00000000-0000-0000-0000-00000000f701',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f701' and type = 'expense' and name = 'еда'),
  'green'), true, 'color set');
select is((select c->>'color' from jsonb_array_elements(public.api_categories('00000000-0000-0000-0000-00000000f701')->'expense') c
            where c->>'name' = 'еда'), 'green', 'api_categories reports the color');

select throws_ok($$select public.set_category_color('00000000-0000-0000-0000-00000000f701',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f701' and type = 'expense' and name = 'еда'),
  '#ff0000')$$, 'P0001', 'bad color', 'only palette keys');

-- чужую категорию не перекрасить
select is(public.set_category_color('00000000-0000-0000-0000-00000000f702',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f701' and type = 'expense' and name = 'еда'),
  'red'), false, 'another user''s category is untouched');
select is((select color from public.categories where user_id = '00000000-0000-0000-0000-00000000f701' and name = 'еда'),
  'green', 'color stays after the foreign attempt');

select is(public.set_category_color('00000000-0000-0000-0000-00000000f701',
  (select id from public.categories where user_id = '00000000-0000-0000-0000-00000000f701' and type = 'expense' and name = 'еда'),
  null) and (select color is null from public.categories where user_id = '00000000-0000-0000-0000-00000000f701' and name = 'еда'),
  true, 'null clears the color');

select * from finish();
rollback;
