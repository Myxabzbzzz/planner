-- #35: до сих пор ни один вызов нигде не был ограничен.

-- Записывает попытку и говорит, можно ли её выполнять.
-- false = лимит уже исчерпан в окне (попытка всё равно учтена, чтобы спам не «отлёживался»).
create function public.rate_limit(p_user uuid, p_action text, p_limit int, p_window interval)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_used int;
begin
  if p_user is null then raise exception 'bad user'; end if;
  if p_action is null or btrim(p_action) = '' or length(p_action) > 64 then raise exception 'bad action'; end if;
  if p_limit is null or p_limit < 0 then raise exception 'bad limit'; end if;
  if p_window is null or p_window <= interval '0' then raise exception 'bad window'; end if;

  insert into public.rate_events (user_id, action) values (p_user, p_action);

  select count(*) into v_used from public.rate_events
   where user_id = p_user and action = p_action and at > now() - p_window;

  return v_used <= p_limit;
end $$;

create function public.purge_rate_events(p_before timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_before is null then raise exception 'bad before'; end if;
  delete from public.rate_events where at < p_before;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.rate_limit(uuid, text, int, interval),
  public.purge_rate_events(timestamptz)
  from public, anon, authenticated;
