-- #32: время «есть/нет» становится отдельным полем, а не значением 23:59.
-- 23:59 по-прежнему пишется в due_at, чтобы ничего не поехало; читать нужно флаг.

create function public.create_task(p_user uuid, p_title text, p_due_date date, p_due_time text, p_has_time boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_id uuid;
  v_has boolean;
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  if p_title is null then raise exception 'bad title'; end if;
  perform public._check_title(p_title);
  perform public._check_time(p_due_time);
  if p_due_time is not null and p_due_date is null then raise exception 'time without date'; end if;
  perform public._check_date(p_due_date, v_tz);
  -- без даты времени быть не может; иначе верим явному флагу, а по умолчанию — наличию p_due_time
  v_has := p_due_date is not null and coalesce(p_has_time, p_due_time is not null);
  if v_has and p_due_time is null then raise exception 'has_time without time'; end if;
  insert into public.items (user_id, kind, title, due_at, due_has_time)
  values (p_user, 'task', btrim(p_title),
          case when p_due_date is null then null
               else (p_due_date + coalesce(p_due_time, '23:59')::time) at time zone v_tz end,
          v_has)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.create_task(p_user uuid, p_title text, p_due_date date, p_due_time text)
returns uuid
language sql security definer set search_path = public as $$
  select public.create_task(p_user, p_title, p_due_date, p_due_time, p_due_time is not null);
$$;

create function public.update_task(p_user uuid, p_id uuid, p_title text, p_due_date date, p_due_time text,
                                   p_clear_due boolean, p_has_time boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
begin
  select tz into v_tz from public.users where id = p_user;
  perform 1 from public.items
   where id = p_id and user_id = p_user and kind = 'task' and deleted_at is null for update;
  if not found then return false; end if;
  perform public._check_title(p_title);
  perform public._check_time(p_due_time);
  if p_due_time is not null and p_due_date is null then raise exception 'time without date'; end if;
  perform public._check_date(p_due_date, v_tz);
  update public.items
     set title = coalesce(btrim(p_title), title),
         due_at = case when coalesce(p_clear_due, false) then null
                       when p_due_date is not null then (p_due_date + coalesce(p_due_time, '23:59')::time) at time zone v_tz
                       else due_at end,
         -- срок снят — времени нет; срок переставлен — флаг из аргумента, иначе по наличию времени;
         -- срок не трогали — оставляем как было
         due_has_time = case when coalesce(p_clear_due, false) then false
                             when p_due_date is not null then coalesce(p_has_time, p_due_time is not null)
                             else due_has_time end
   where id = p_id;
  return true;
end $$;

create or replace function public.update_task(p_user uuid, p_id uuid, p_title text, p_due_date date,
                                               p_due_time text, p_clear_due boolean)
returns boolean
language sql security definer set search_path = public as $$
  select public.update_task(p_user, p_id, p_title, p_due_date, p_due_time, p_clear_due, p_due_time is not null);
$$;

revoke execute on function
  public.create_task(uuid, text, date, text, boolean),
  public.update_task(uuid, uuid, text, date, text, boolean, boolean)
  from public, anon, authenticated;

-- Воркер, миниапп и тесты пишут в items напрямую (store.insert("items", row)) и про
-- новый флаг не знают. Чтобы timed-напоминания не пропали у всех, кто вставляет строку
-- в обход create_task, сохраняем старое соглашение как подстраховку ровно на вставке:
-- локальное время не 23:59 => время есть. Явный due_has_time = true не трогаем,
-- а «23:59 как отсутствие времени» остаётся false — то есть поведение то же, что до #32.
create function public._items_due_has_time() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.due_has_time and new.due_at is not null then
    if to_char(new.due_at at time zone (select tz from public.users u where u.id = new.user_id),
               'HH24:MI') <> '23:59' then
      new.due_has_time := true;
    end if;
  end if;
  return new;
end $$;

create trigger items_due_has_time before insert on public.items
  for each row execute function public._items_due_has_time();
