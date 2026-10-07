begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000f901', 9951, 'A', 'Asia/Tashkent', true),
  ('00000000-0000-0000-0000-00000000f902', 9952, 'B', 'Asia/Tashkent', true);
select public.onboard_user('00000000-0000-0000-0000-00000000f901', 'UZS');
select public.onboard_user('00000000-0000-0000-0000-00000000f902', 'UZS');

-- #21: раньше список молча обрезался и клиент не мог отличить «всё» от «первые 100»
insert into public.items (user_id, kind, title, done_at, created_at)
select '00000000-0000-0000-0000-00000000f901', 'task', 'Готово ' || g, now() - (g || ' hours')::interval, now() - (g || ' hours')::interval
  from generate_series(1, 150) g;
select is(public.api_tasks('00000000-0000-0000-0000-00000000f901', 'done')->'total', '150'::jsonb, 'total is the real unfiltered count');
select is(jsonb_array_length(public.api_tasks('00000000-0000-0000-0000-00000000f901', 'done')->'tasks'), 100, 'the list itself is still capped at 100');
select is(public.api_tasks('00000000-0000-0000-0000-00000000f901', 'nodue')->'total', '0'::jsonb, 'total respects the filter');
select is(public.api_tasks('00000000-0000-0000-0000-00000000f902', 'done')->'total', '0'::jsonb, 'total is per user');
select public.delete_item('00000000-0000-0000-0000-00000000f901',
  (select id from public.items where user_id = '00000000-0000-0000-0000-00000000f901' and title = 'Готово 1'), 'task');
select is(public.api_tasks('00000000-0000-0000-0000-00000000f901', 'done')->'total', '149'::jsonb, 'total excludes soft-deleted rows');

-- 130 операций за текущий месяц
insert into public.transactions (user_id, type, amount_base, base_currency, comment, occurred_at, created_at)
select '00000000-0000-0000-0000-00000000f901', 'expense', 1000 + g, 'UZS', 'Оп ' || g,
       date_trunc('month', current_date)::date, now() - (g || ' minutes')::interval
  from generate_series(1, 130) g;

select is(public.api_money('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'))->'operations_total', '130'::jsonb, 'api_money reports the real operation count');
select is(jsonb_array_length(public.api_money('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'))->'operations'), 130, 'all 130 fit in the first page');
select is(public.api_money('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'))->'operations_next_before', 'null'::jsonb, 'no cursor when nothing was cut');

-- постраничный проход
select is(jsonb_array_length(public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), null)->'operations'), 50, 'first page holds 50');
select isnt(public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), null)->>'next_before', null, 'first page offers a cursor');
-- курсор обязан проходить ту же проверку CURSOR, что в supabase/functions/api/handler.ts
select is((public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), null)->>'next_before')
            ~ '^[^~]{1,64}~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', true, 'cursor matches the handler CURSOR regexp');
select is(jsonb_array_length(public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'),
  public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), null)->>'next_before')->'operations'), 50, 'second page holds 50');
-- проход целиком: без дублей и без пропусков
select is((with recursive walk as (
    select public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), null) as page, 1 as n
    union all
    select public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), page->>'next_before'), n + 1
      from walk where page->>'next_before' is not null and n < 20)
  select count(distinct o->>'id')::int from walk, jsonb_array_elements(page->'operations') o),
  130, 'walking the cursor yields every operation exactly once');

-- форма операции та же, что в api_money
select is((public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), null)->'operations'->0)
            - array['id', 'date', 'type', 'title', 'amount', 'category', 'orig'], '{}'::jsonb, 'operation carries exactly the api_money fields');
select is(public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), null)->'operations'->0->>'category', 'другое', 'operations without a category fall back to другое');

-- мягко удалённое не попадает ни в счётчик, ни в страницы
select public.delete_transaction('00000000-0000-0000-0000-00000000f901',
  (select id from public.transactions where user_id = '00000000-0000-0000-0000-00000000f901' and comment = 'Оп 1'));
select is(public.api_money('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'))->'operations_total', '129'::jsonb, 'count excludes soft-deleted');
select is((select count(*)::int from jsonb_array_elements(public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), null)->'operations') o
            where o->>'title' = 'Оп 1'), 0, 'pages exclude soft-deleted');

select is(public.api_operations('00000000-0000-0000-0000-0000000000ff', to_char(current_date, 'YYYY-MM'), null), null, 'unknown user gets null');
select is(public.api_operations('00000000-0000-0000-0000-00000000f902', to_char(current_date, 'YYYY-MM'), null)->'operations', '[]'::jsonb, 'another user sees nothing');
select throws_ok($$select public.api_operations('00000000-0000-0000-0000-00000000f901', '2026-13', null)$$,
  'P0001', 'bad month', 'month is validated');
select throws_ok($$select public.api_operations('00000000-0000-0000-0000-00000000f901', to_char(current_date, 'YYYY-MM'), 'мусор~нет')$$,
  'P0001', 'bad cursor', 'garbage cursor is rejected like api_notes');

select is(has_function_privilege('authenticated', 'public.api_operations(uuid, text, text)', 'execute'), false, 'api_operations not exposed');

select * from finish();
rollback;
