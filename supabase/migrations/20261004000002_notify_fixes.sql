drop function public.due_digests(timestamptz);
create function public.due_digests(p_now timestamptz default now())
returns table(user_id uuid, chat_id bigint, kind text, local_date date)
language sql stable security definer set search_path = public as $$
  with u as (
    select id, tg_id, (p_now at time zone tz) as local_ts,
           notify_daily, notify_weekly, last_daily_on, last_weekly_on
      from public.users
     where is_allowed and onboarded_at is not null)
  select id, tg_id, 'daily'::text, local_ts::date from u
   where notify_daily and local_ts::time >= time '21:30'
     and (last_daily_on is null or last_daily_on < local_ts::date)
  union all
  select id, tg_id, 'weekly'::text, local_ts::date from u
   where notify_weekly and local_ts::time >= time '21:30' and extract(isodow from local_ts) = 7
     and (last_weekly_on is null or last_weekly_on < local_ts::date)
  order by 1, 3;
$$;

drop function public.set_item_done(uuid, uuid, boolean);
create function public.set_item_done(p_user uuid, p_item uuid, p_kind text, p_done boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_kind is null or p_kind not in ('task', 'event') then return false; end if;
  update public.items
     set done_at = case when p_done then coalesce(done_at, now()) else null end
   where id = p_item and user_id = p_user and kind = p_kind;
  return found;
end $$;

revoke execute on function
  public.due_digests(timestamptz), public.set_item_done(uuid, uuid, text, boolean)
  from public, anon, authenticated;
