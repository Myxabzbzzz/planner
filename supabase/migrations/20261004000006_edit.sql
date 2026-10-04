-- План 6: правка задач, встреч, заметок и привычек из миниаппа; null в аргументе = не менять

create function public._check_title(p text) returns void language plpgsql immutable as $$
begin
  if p is not null and (btrim(p) = '' or length(btrim(p)) > 200) then raise exception 'bad title'; end if;
end $$;

create function public._check_time(p text) returns void language plpgsql immutable as $$
begin
  if p is not null and p !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'bad time'; end if;
end $$;

create function public._check_date(p date, p_tz text) returns void language plpgsql stable as $$
begin
  if p is not null and abs(p - (now() at time zone p_tz)::date) > 1830 then raise exception 'bad date'; end if;
end $$;

create function public.update_task(p_user uuid, p_id uuid, p_title text, p_due_date date, p_due_time text,
                                   p_clear_due boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
begin
  select tz into v_tz from public.users where id = p_user;
  perform 1 from public.items where id = p_id and user_id = p_user and kind = 'task' for update;
  if not found then return false; end if;
  perform public._check_title(p_title);
  perform public._check_time(p_due_time);
  if p_due_time is not null and p_due_date is null then raise exception 'time without date'; end if;
  perform public._check_date(p_due_date, v_tz);
  update public.items
     set title = coalesce(btrim(p_title), title),
         due_at = case when coalesce(p_clear_due, false) then null
                       when p_due_date is not null then (p_due_date + coalesce(p_due_time, '23:59')::time) at time zone v_tz
                       else due_at end
   where id = p_id;
  return true;
end $$;

create function public.update_event(p_user uuid, p_id uuid, p_title text, p_date date, p_time text, p_with_whom text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_old timestamptz;
  v_new timestamptz;
begin
  select tz into v_tz from public.users where id = p_user;
  select starts_at into v_old from public.items where id = p_id and user_id = p_user and kind = 'event' for update;
  if not found then return false; end if;
  perform public._check_title(p_title);
  perform public._check_time(p_time);
  perform public._check_date(p_date, v_tz);
  if p_with_whom is not null and length(btrim(p_with_whom)) > 200 then raise exception 'bad with_whom'; end if;
  v_new := case when p_date is null and p_time is null then v_old
                else (coalesce(p_date, (v_old at time zone v_tz)::date)
                      + coalesce(p_time, to_char(v_old at time zone v_tz, 'HH24:MI'))::time) at time zone v_tz end;
  update public.items
     set title = coalesce(btrim(p_title), title),
         starts_at = v_new,
         with_whom = case when p_with_whom is null then with_whom
                          when btrim(p_with_whom) = '' then null
                          else btrim(p_with_whom) end,
         reminded_at = case when v_new is distinct from v_old then null else reminded_at end
   where id = p_id;
  return true;
end $$;

create function public.delete_item(p_user uuid, p_id uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('task', 'event') then raise exception 'bad kind'; end if;
  delete from public.items where id = p_id and user_id = p_user and kind = p_kind;
  return found;
end $$;

create function public.update_note(p_user uuid, p_id uuid, p_text text, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.notes where id = p_id and user_id = p_user for update;
  if not found then return false; end if;
  if p_text is not null and (btrim(p_text) = '' or length(btrim(p_text)) > 4000) then raise exception 'bad text'; end if;
  if p_kind is not null and p_kind not in ('thought', 'journal') then raise exception 'bad kind'; end if;
  update public.notes set text = coalesce(btrim(p_text), text), kind = coalesce(p_kind, kind) where id = p_id;
  return true;
end $$;

create function public.delete_note(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.notes where id = p_id and user_id = p_user;
  return found;
end $$;

create function public.update_habit(p_user uuid, p_id uuid, p_name text, p_target int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.habits where id = p_id and user_id = p_user and archived_at is null for update;
  if not found then return false; end if;
  perform public._check_title(p_name);
  if p_target is not null and (p_target < 1 or p_target > 7) then raise exception 'bad target'; end if;
  if p_name is not null and exists (select 1 from public.habits
                                     where user_id = p_user and id <> p_id and name = btrim(p_name)) then
    raise exception 'name taken';
  end if;
  update public.habits
     set name = coalesce(btrim(p_name), name), target_per_week = coalesce(p_target, target_per_week)
   where id = p_id;
  return true;
end $$;

create function public.archive_habit(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.habits set archived_at = now() where id = p_id and user_id = p_user and archived_at is null;
  return found;
end $$;

-- поля для шторок: даты/«с кем» у встреч и срок у задач на «Сегодня», цель у привычек
create or replace function public.summary_today(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_cur text;
  v_today date;
begin
  select tz, base_currency into v_tz, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object(
    'base_currency', v_cur,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'time', to_char(starts_at at time zone v_tz, 'HH24:MI'),
                                          'date', v_today::text, 'with_whom', with_whom,
                                          'done', done_at is not null)
                       order by starts_at)
        from public.items
       where user_id = p_user and kind = 'event' and (starts_at at time zone v_tz)::date = v_today), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title,
                                          'due', to_char(t.due_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
                                          'overdue', (t.due_at at time zone v_tz)::date < v_today)
                       order by t.due_at)
        from (select id, title, due_at from public.items
               where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
                 and (due_at at time zone v_tz)::date <= v_today
               order by due_at
               limit 20) t), '[]'::jsonb),
    'tasks_more', greatest((
      select count(*) from public.items
       where user_id = p_user and kind = 'task' and done_at is null and due_at is not null
         and (due_at at time zone v_tz)::date <= v_today) - 20, 0),
    'spent_today', coalesce((
      select sum(amount_base) from public.transactions
       where user_id = p_user and type = 'expense' and occurred_at = v_today), 0),
    'month_spent', coalesce((
      select sum(amount_base) from public.transactions
       where user_id = p_user and type = 'expense'
         and occurred_at >= date_trunc('month', v_today)::date
         and occurred_at < (date_trunc('month', v_today) + interval '1 month')::date), 0),
    'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null),
    'habits', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name,
                                          'done', exists (select 1 from public.habit_logs l
                                                           where l.habit_id = h.id and l.date = v_today))
                       order by h.created_at)
        from public.habits h
       where h.user_id = p_user and h.archived_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public.api_habits(p_user uuid, p_weeks int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_from date;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 12 then
    raise exception 'bad weeks';
  end if;
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  v_from := v_today - (p_weeks * 7 - 1);
  return jsonb_build_object('habits', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id,
             'name', h.name,
             'target_per_week', h.target_per_week,
             'days', (select jsonb_agg(jsonb_build_object('date', d::date::text,
                                                          'done', exists (select 1 from public.habit_logs l
                                                                           where l.habit_id = h.id and l.date = d::date))
                                       order by d)
                        from generate_series(v_from::timestamp, v_today::timestamp, interval '1 day') d),
             'streak', public.habit_streak(h.id, v_today),
             'done_today', exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = v_today))
           order by h.created_at)
      from public.habits h
     where h.user_id = p_user and h.archived_at is null), '[]'::jsonb));
end $$;

revoke execute on function
  public._check_title(text), public._check_time(text), public._check_date(date, text),
  public.update_task(uuid, uuid, text, date, text, boolean),
  public.update_event(uuid, uuid, text, date, text, text), public.delete_item(uuid, uuid, text),
  public.update_note(uuid, uuid, text, text), public.delete_note(uuid, uuid),
  public.update_habit(uuid, uuid, text, int), public.archive_habit(uuid, uuid)
  from public, anon, authenticated;
