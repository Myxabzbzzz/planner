begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.users (id, tg_id, name, tz, is_allowed, onboarded_at, base_currency, pro_until) values
  ('00000000-0000-0000-0000-0000000f1e01', 9981, 'A', 'UTC', true, now(), 'RUB', 'infinity');
insert into public.habits (id, user_id, name, target_per_week) values
  ('00000000-0000-0000-0000-0000000f1e11', '00000000-0000-0000-0000-0000000f1e01', 'Зарядка', 7);

-- 5 дней подряд до позавчера, вчера пропуск, сегодня сделал
insert into public.habit_logs (user_id, habit_id, date)
select '00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11', current_date - n
  from generate_series(2, 6) n;
insert into public.habit_logs (user_id, habit_id, date)
values ('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11', current_date);

select is(public.habit_streak('00000000-0000-0000-0000-0000000f1e11', current_date), 1, 'a gap breaks the streak');
select is(public.freeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11',
  current_date - 1), 'ok', 'yesterday frozen');
select is(public.habit_streak('00000000-0000-0000-0000-0000000f1e11', current_date), 6,
  'the frozen day keeps the chain but does not count');
select is((public.api_habit_stats('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11')->>'best_streak')::int,
  6, 'best streak through the frozen day');

select is(public.freeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11',
  current_date - 1), 'already', 'twice is refused');
select is(public.freeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11',
  current_date), 'done', 'a done day needs no freeze');
select is(public.freeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11',
  current_date - 8), 'bad_date', 'only the last week');
select is(public.freeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11',
  current_date + 1), 'bad_date', 'not the future');

-- лимит: два в месяц. Берём два свободных дня в том же месяце, что и вчера, — иначе тест зависит от даты
delete from public.habit_freezes;
delete from public.habit_logs;
-- результат в «is not null»: голое 'ok' в выводе TAP принимает за пройденный тест
select public.freeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11', current_date) is not null;
select public.freeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11', current_date - 1) is not null;
select is(public.freeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11', current_date - 2),
  case when date_trunc('month', current_date - 2) = date_trunc('month', current_date) then 'limit' else 'ok' end,
  'no more than two a month');
select is(public.habit_streak('00000000-0000-0000-0000-0000000f1e11', current_date), 0, 'only frozen days make no streak');

select is((select (d->>'frozen')::boolean from jsonb_array_elements(
             public.api_habits('00000000-0000-0000-0000-0000000f1e01', 1)->'habits'->0->'days') d
            where d->>'date' = current_date::text), true, 'api_habits marks frozen days');
select is(public.unfreeze_habit_day('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11', current_date),
  true, 'unfreeze');

-- статистика: цель 3 раза в неделю — 13 раз за 30 дней это 100%
update public.habits set target_per_week = 3 where id = '00000000-0000-0000-0000-0000000f1e11';
insert into public.habit_logs (user_id, habit_id, date)
select '00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11', current_date - n * 2
  from generate_series(0, 12) n;
select is((public.api_habit_stats('00000000-0000-0000-0000-0000000f1e01', '00000000-0000-0000-0000-0000000f1e11')->>'rate_30')::int,
  100, 'rate is against the weekly target');

select * from finish();
rollback;
