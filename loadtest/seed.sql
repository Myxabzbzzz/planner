-- Тестовые пользователи для нагрузочного теста. ТОЛЬКО локальная база (supabase start).
-- tg_id 900000001…900000000+n, у каждого — категории, задачи, траты за два месяца и привычки,
-- чтобы запросы «Сегодня», «Деньги» и «Привычки» читали не пустые таблицы.
-- Повторный запуск ничего не дублирует: уже засеянные пользователи пропускаются.
\set ON_ERROR_STOP on

do $$
declare
  n int := coalesce(nullif(current_setting('loadtest.users', true), ''), '500')::int;
  u record;
  h uuid;
  i int;
  cats text[] := array['еда', 'кафе', 'такси/транспорт', 'дом', 'связь', 'подписки', 'развлечения', 'здоровье'];
begin
  insert into public.users (tg_id, name, is_allowed)
  select 900000000 + g, 'Нагрузка ' || g, true from generate_series(1, n) g
  on conflict (tg_id) do nothing;

  for u in select id from public.users where tg_id between 900000001 and 900000000 + n and onboarded_at is null loop
    perform public.onboard_user(u.id, 'RUB');
    for i in 1..15 loop
      perform public.create_task(u.id, 'Задача ' || i, (current_date + (i % 7) - 2)::date, null);
    end loop;
    for i in 1..60 loop
      perform public.create_transaction(u.id, 'expense', 100 + (i * 37) % 2000, 'Покупка ' || i,
                                        cats[1 + i % array_length(cats, 1)], (current_date - (i % 55))::date);
    end loop;
    perform public.create_transaction(u.id, 'income', 120000, 'Зарплата', 'зарплата', (current_date - 10)::date);
    for i in 1..3 loop
      h := public.create_habit(u.id, 'Привычка ' || i, 5);
    end loop;
    for i in 1..5 loop
      perform public.create_note(u.id, 'Заметка ' || i, 'thought');
    end loop;
  end loop;
end $$;

select count(*) as load_users from public.users where tg_id between 900000001 and 900999999;
