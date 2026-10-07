-- Создание записей руками, без ИИ-воркера.
-- До этого единственным путём создания был `inbox` + локальный воркер на ноутбуке:
-- когда Mac спал, мини-апп превращался в режим «только чтение». Теперь любую
-- запись можно добавить прямо из приложения, а композер с ИИ остаётся быстрым путём.
--
-- Валюта у ручной операции всегда базовая: пересчёт по курсу — работа воркера,
-- руками человек вводит сумму в своей валюте.

create function public.create_task(p_user uuid, p_title text, p_due_date date, p_due_time text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_id uuid;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  if p_title is null then raise exception 'bad title'; end if;
  perform public._check_title(p_title);
  perform public._check_time(p_due_time);
  if p_due_time is not null and p_due_date is null then raise exception 'time without date'; end if;
  perform public._check_date(p_due_date, v_tz);
  insert into public.items (user_id, kind, title, due_at)
  values (p_user, 'task', btrim(p_title),
          case when p_due_date is null then null
               else (p_due_date + coalesce(p_due_time, '23:59')::time) at time zone v_tz end)
  returning id into v_id;
  return v_id;
end $$;

create function public.create_event(p_user uuid, p_title text, p_date date, p_time text, p_with_whom text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_id uuid;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  if p_title is null or p_date is null or p_time is null then raise exception 'bad event'; end if;
  perform public._check_title(p_title);
  perform public._check_time(p_time);
  perform public._check_date(p_date, v_tz);
  if p_with_whom is not null and length(btrim(p_with_whom)) > 200 then raise exception 'bad with_whom'; end if;
  insert into public.items (user_id, kind, title, starts_at, with_whom)
  values (p_user, 'event', btrim(p_title), (p_date + p_time::time) at time zone v_tz,
          nullif(btrim(coalesce(p_with_whom, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

create function public.create_note(p_user uuid, p_text text, p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from public.users where id = p_user;
  if not found then return null; end if;
  if p_text is null or btrim(p_text) = '' or length(btrim(p_text)) > 4000 then raise exception 'bad text'; end if;
  if p_kind is null or p_kind not in ('thought', 'journal') then raise exception 'bad kind'; end if;
  insert into public.notes (user_id, kind, text) values (p_user, p_kind, btrim(p_text))
  returning id into v_id;
  return v_id;
end $$;

-- Привычка с тем же именем могла быть заархивирована: не падаем на unique,
-- а возвращаем её обратно вместе с историей отметок.
create function public.create_habit(p_user uuid, p_name text, p_target int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from public.users where id = p_user;
  if not found then return null; end if;
  if p_name is null then raise exception 'bad name'; end if;
  perform public._check_title(p_name);
  if p_target is null or p_target < 1 or p_target > 7 then raise exception 'bad target'; end if;
  insert into public.habits (user_id, name, target_per_week)
  values (p_user, btrim(p_name), p_target)
  on conflict (user_id, name) do update
    set archived_at = null, target_per_week = excluded.target_per_week
  returning id into v_id;
  return v_id;
end $$;

create function public.unarchive_habit(p_user uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.habits set archived_at = null
   where id = p_id and user_id = p_user and archived_at is not null;
  return found;
end $$;

create function public.create_category(p_user uuid, p_name text, p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from public.users where id = p_user;
  if not found then return null; end if;
  if p_name is null or btrim(p_name) = '' or length(btrim(p_name)) > 50 then raise exception 'bad name'; end if;
  if p_type is null or p_type not in ('expense', 'income') then raise exception 'bad type'; end if;
  insert into public.categories (user_id, name, type) values (p_user, btrim(p_name), p_type)
  on conflict (user_id, type, name) do update set name = excluded.name
  returning id into v_id;
  return v_id;
end $$;

create function public.create_transaction(p_user uuid, p_type text, p_amount numeric, p_title text,
                                          p_category text, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_cat uuid;
  v_date date;
  v_id uuid;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  if p_type is null or p_type not in ('expense', 'income') then raise exception 'bad type'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e13 then raise exception 'bad amount'; end if;
  if p_title is not null and length(btrim(p_title)) > 200 then raise exception 'bad title'; end if;
  v_date := coalesce(p_date, (now() at time zone v_tz)::date);
  perform public._check_date(v_date, v_tz);
  if p_category is not null and btrim(p_category) <> '' then
    select id into v_cat from public.categories
     where user_id = p_user and type = p_type and name = btrim(p_category);
    if not found then
      insert into public.categories (user_id, name, type) values (p_user, btrim(p_category), p_type)
      returning id into v_cat;
    end if;
  end if;
  insert into public.transactions (user_id, type, amount_base, base_currency, category_id, comment, occurred_at)
  values (p_user, p_type, round(p_amount, 2), v_cur, v_cat, coalesce(btrim(p_title), ''), v_date)
  returning id into v_id;
  return v_id;
end $$;

-- Настройки для мини-аппа: раньше часовой пояс, лимит и уведомления можно было
-- менять только кнопками в чате бота, хотя лимит — центральный элемент «Денег».
create function public.api_settings(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'name', u.name,
           'tz', u.tz,
           'base_currency', u.base_currency,
           'limit', (select monthly_limit from public.budgets
                      where user_id = u.id and category_id is null),
           'notify_reminders', u.notify_reminders,
           'notify_daily', u.notify_daily,
           'notify_weekly', u.notify_weekly)
    from public.users u where u.id = p_user;
$$;

-- `set_limit` раньше ничего не возвращал, из-за чего роут не мог отличить
-- успех от «пользователя нет»; обёртка даёт мини-аппу однозначный ответ.
create function public.api_set_limit(p_user uuid, p_amount numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount < 0 or p_amount >= 1e13 then raise exception 'bad amount'; end if;
  perform 1 from public.users where id = p_user;
  if not found then return false; end if;
  perform public.set_limit(p_user, p_amount);
  return true;
end $$;

create function public.api_set_notify(p_user uuid, p_kind text, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_on is null then raise exception 'bad flag'; end if;
  perform 1 from public.users where id = p_user;
  if not found then return false; end if;
  perform public.set_notify(p_user, p_kind, p_on);
  return true;
end $$;

-- Отметить привычку на любой день, а не только на сегодня: воркер ставит лог
-- на сегодня независимо от того, что сказал человек («вчера сделал зарядку»),
-- и починить это в сетке было нечем.
create function public.set_habit_on(p_user uuid, p_habit uuid, p_date date, p_done boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return false; end if;
  if p_done is null or p_date is null then raise exception 'bad args'; end if;
  v_today := (now() at time zone v_tz)::date;
  if p_date > v_today or p_date < v_today - 365 then raise exception 'bad date'; end if;
  perform 1 from public.habits where id = p_habit and user_id = p_user;
  if not found then return false; end if;
  if p_done then
    insert into public.habit_logs (user_id, habit_id, date) values (p_user, p_habit, p_date)
    on conflict (habit_id, date) do nothing;
  else
    delete from public.habit_logs where habit_id = p_habit and date = p_date and user_id = p_user;
  end if;
  return true;
end $$;

revoke execute on function
  public.create_task(uuid, text, date, text),
  public.create_event(uuid, text, date, text, text),
  public.create_note(uuid, text, text),
  public.create_habit(uuid, text, int),
  public.unarchive_habit(uuid, uuid),
  public.create_category(uuid, text, text),
  public.create_transaction(uuid, text, numeric, text, text, date),
  public.api_settings(uuid),
  public.api_set_limit(uuid, numeric),
  public.api_set_notify(uuid, text, boolean),
  public.set_habit_on(uuid, uuid, date, boolean)
  from public, anon, authenticated;
