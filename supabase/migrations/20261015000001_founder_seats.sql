-- «Founder · навсегда» — только для первых покупателей. Сколько мест, решает код (plans.ts),
-- база лишь считает проданные: так лимит можно поменять без миграции.
create or replace function public.api_subscription(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u public.users%rowtype;
  v_used int;
  v_paid boolean;
begin
  select * into u from public.users where id = p_user;
  if not found then return null; end if;
  select count(*) into v_used from public.rate_events
   where user_id = p_user and action = 'ai'
     and at >= (date_trunc('day', now() at time zone u.tz) at time zone u.tz);
  v_paid := exists (select 1 from public.payments where user_id = p_user);
  return jsonb_build_object(
    'status', case
      when u.pro_until = 'infinity' then 'lifetime'
      when u.pro_until > now() and v_paid then 'pro'
      when u.pro_until > now() then 'trial'
      else 'free' end,
    'pro_until', case when u.pro_until is null or u.pro_until = 'infinity' then null
                      else to_char(u.pro_until at time zone u.tz, 'YYYY-MM-DD"T"HH24:MI') end,
    'ai_left', case when u.pro_until > now() then null else greatest(3 - v_used, 0) end,
    'ai_per_day', 3,
    -- считаем людей, а не платежи: повторная покупка тем же человеком места не занимает
    'founder_sold', (select count(distinct user_id) from public.payments where plan = 'lifetime'));
end $$;
