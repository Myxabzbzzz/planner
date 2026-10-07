-- #3: удаление становится мягким, появляется отмена и сборщик мусора.

create or replace function public.delete_item(p_user uuid, p_id uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('task', 'event') then raise exception 'bad kind'; end if;
  update public.items set deleted_at = now()
   where id = p_id and user_id = p_user and kind = p_kind and deleted_at is null;
  return found;
end $$;

create or replace function public.delete_note(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.notes set deleted_at = now()
   where id = p_id and user_id = p_user and deleted_at is null;
  return found;
end $$;

create or replace function public.delete_transaction(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.transactions set deleted_at = now()
   where id = p_id and user_id = p_user and deleted_at is null;
  return found;
end $$;

create function public.restore_item(p_user uuid, p_id uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('task', 'event') then raise exception 'bad kind'; end if;
  update public.items set deleted_at = null
   where id = p_id and user_id = p_user and kind = p_kind and deleted_at is not null;
  return found;
end $$;

create function public.restore_note(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.notes set deleted_at = null
   where id = p_id and user_id = p_user and deleted_at is not null;
  return found;
end $$;

create function public.restore_transaction(p_user uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.transactions set deleted_at = null
   where id = p_id and user_id = p_user and deleted_at is not null;
  return found;
end $$;

-- Корзина живёт ограниченное время; вызывает notify-крон с now() - 30 days.
create function public.purge_deleted(p_before timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  if p_before is null then raise exception 'bad before'; end if;
  delete from public.items where deleted_at is not null and deleted_at < p_before;
  get diagnostics c = row_count; n := n + c;
  delete from public.transactions where deleted_at is not null and deleted_at < p_before;
  get diagnostics c = row_count; n := n + c;
  delete from public.notes where deleted_at is not null and deleted_at < p_before;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- «Убрать всё, что ИИ записал по этой реплике» — тоже мягко, чтобы работала отмена.
-- Метку времени удаления кладём в inbox.result: по ней restore_inbox_records отличает
-- «удалено этой кнопкой» от «удалено отдельно потом» и не воскрешает лишнего.
create or replace function public.delete_inbox_records(p_user uuid, p_inbox uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  c int;
  -- clock_timestamp(), а не now(): внутри одной транзакции now() не меняется, и тогда
  -- отдельное удаление и «удалить всё» получили бы одну метку и стали неразличимы
  v_at timestamptz := clock_timestamp();
  v_logs jsonb;
  v_habits jsonb;
begin
  perform 1 from public.inbox where id = p_inbox and user_id = p_user for update;
  if not found then return 0; end if;

  update public.items set deleted_at = v_at
   where user_id = p_user and inbox_id = p_inbox and deleted_at is null;
  get diagnostics c = row_count; n := n + c;
  update public.transactions set deleted_at = v_at
   where user_id = p_user and inbox_id = p_inbox and deleted_at is null;
  get diagnostics c = row_count; n := n + c;
  update public.notes set deleted_at = v_at
   where user_id = p_user and inbox_id = p_inbox and deleted_at is null;
  get diagnostics c = row_count; n := n + c;

  -- У habit_logs/habits нет deleted_at (отметка привычки — это (habit_id, date), мягкое
  -- удаление ломало бы unique и habit_streak). Поэтому их удаляем жёстко, но запоминаем
  -- в inbox.result ровно столько, чтобы restore_inbox_records мог вставить их обратно —
  -- иначе серия (streak) порвалась бы без возможности починки.
  select jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'date', l.date))
    into v_logs
    from public.habit_logs l where l.user_id = p_user and l.inbox_id = p_inbox;
  delete from public.habit_logs where user_id = p_user and inbox_id = p_inbox;
  get diagnostics c = row_count; n := n + c;

  select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name,
                                      'target_per_week', h.target_per_week))
    into v_habits
    from public.habits h
   where h.user_id = p_user and h.inbox_id = p_inbox
     and not exists (select 1 from public.habit_logs l where l.habit_id = h.id);
  delete from public.habits h where h.user_id = p_user and h.inbox_id = p_inbox
    and not exists (select 1 from public.habit_logs l where l.habit_id = h.id);
  get diagnostics c = row_count; n := n + c;

  update public.inbox
     set result = result || jsonb_build_object(
           'deleted', true,
           'deleted_at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
           'deleted_habit_logs', coalesce(v_logs, '[]'::jsonb),
           'deleted_habits', coalesce(v_habits, '[]'::jsonb))
   where id = p_inbox and user_id = p_user;
  return n;
end $$;

-- Кнопка «↩️ Вернуть» под «🗑 Удалено.». Возвращает только то, что убрала именно
-- эта кнопка (по совпадению deleted_at), и безопасна при повторном нажатии.
create function public.restore_inbox_records(p_user uuid, p_inbox uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_at timestamptz;
  n int := 0;
  c int;
begin
  select result into r from public.inbox
   where id = p_inbox and user_id = p_user for update;
  if not found then return 0; end if;
  -- нет метки — удаление было до этой миграции, различить «что именно убрали» уже нельзя
  if (r ->> 'deleted_at') is null then return 0; end if;
  v_at := (r ->> 'deleted_at')::timestamptz;

  update public.items set deleted_at = null
   where user_id = p_user and inbox_id = p_inbox and deleted_at = v_at;
  get diagnostics c = row_count; n := n + c;
  update public.transactions set deleted_at = null
   where user_id = p_user and inbox_id = p_inbox and deleted_at = v_at;
  get diagnostics c = row_count; n := n + c;
  update public.notes set deleted_at = null
   where user_id = p_user and inbox_id = p_inbox and deleted_at = v_at;
  get diagnostics c = row_count; n := n + c;

  -- привычки возвращаем с исходными id, иначе отметки некуда присоединить;
  -- если пользователь успел создать привычку с тем же именем — эту пропускаем
  insert into public.habits (id, user_id, name, target_per_week, inbox_id)
  select (h ->> 'id')::uuid, p_user, h ->> 'name', (h ->> 'target_per_week')::int, p_inbox
    from jsonb_array_elements(coalesce(r -> 'deleted_habits', '[]'::jsonb)) h
   where not exists (select 1 from public.habits x where x.id = (h ->> 'id')::uuid)
     and not exists (select 1 from public.habits x
                      where x.user_id = p_user and x.name = h ->> 'name');
  get diagnostics c = row_count; n := n + c;

  insert into public.habit_logs (user_id, habit_id, date, inbox_id)
  select p_user, (l ->> 'habit_id')::uuid, (l ->> 'date')::date, p_inbox
    from jsonb_array_elements(coalesce(r -> 'deleted_habit_logs', '[]'::jsonb)) l
   where exists (select 1 from public.habits x
                  where x.id = (l ->> 'habit_id')::uuid and x.user_id = p_user)
  on conflict (habit_id, date) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- метки снимаем: второе нажатие вернёт 0, а не продублирует отметки
  update public.inbox
     set result = (result - 'deleted' - 'deleted_at' - 'deleted_habit_logs' - 'deleted_habits')
   where id = p_inbox and user_id = p_user;
  return n;
end $$;

revoke execute on function
  public.restore_item(uuid, uuid, text), public.restore_note(uuid, uuid),
  public.restore_transaction(uuid, uuid), public.purge_deleted(timestamptz),
  public.restore_inbox_records(uuid, uuid)
  from public, anon, authenticated;
