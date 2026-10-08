-- Подписка Pro за Telegram Stars.
-- Free: все разделы и текстовые записи без лимита, 3 действия ИИ в день (голосовое или вопрос).
-- Pro: без лимита ИИ, итоги недели, захват из iPhone Shortcuts.
-- pro_until: до какого момента Pro; 'infinity' — навсегда; в прошлом или null — Free.

-- Новым — 7 дней пробного Pro с момента регистрации.
alter table public.users add column pro_until timestamptz default now() + interval '7 days';
-- Все, кто пользовался до запуска подписки, получают Pro навсегда.
update public.users set pro_until = 'infinity';

create table public.payments (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  -- telegram_payment_charge_id: Telegram может прислать successful_payment повторно
  charge_id text not null unique,
  plan text not null check (plan in ('month', 'year', 'lifetime')),
  stars int not null check (stars > 0),
  is_recurring boolean not null default false,
  pro_until timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;
create index payments_user_idx on public.payments (user_id, created_at);

create function public.is_pro(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select pro_until > now() from public.users where id = p_user), false);
$$;

-- Одно действие ИИ (голосовое или вопрос). Pro — без лимита; Free — 3 за календарный день пользователя.
create function public.ai_quota_use(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_used int;
begin
  if public.is_pro(p_user) then return true; end if;
  select tz into v_tz from public.users where id = p_user;
  if not found then return false; end if;
  select count(*) into v_used from public.rate_events
   where user_id = p_user and action = 'ai'
     and at >= (date_trunc('day', now() at time zone v_tz) at time zone v_tz);
  if v_used >= 3 then return false; end if;
  insert into public.rate_events (user_id, action) values (p_user, 'ai');
  return true;
end $$;

-- Зачисление оплаты. false — этот платёж уже зачислен (повтор от Telegram).
-- month: до даты из Telegram (subscription_expiration_date), иначе +30 дней от текущего срока.
create function public.apply_payment(p_user uuid, p_charge_id text, p_plan text, p_stars int,
                                     p_until timestamptz, p_recurring boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz;
  v_until timestamptz;
begin
  if p_plan is null or p_plan not in ('month', 'year', 'lifetime') then raise exception 'bad plan'; end if;
  if p_charge_id is null or btrim(p_charge_id) = '' then raise exception 'bad charge'; end if;
  if exists (select 1 from public.payments where charge_id = p_charge_id) then return false; end if;

  select greatest(coalesce(pro_until, now()), now()) into v_from from public.users where id = p_user for update;
  if not found then raise exception 'user not found'; end if;
  v_until := case p_plan
    when 'lifetime' then 'infinity'::timestamptz
    when 'year' then v_from + interval '365 days'
    else greatest(coalesce(p_until, v_from + interval '30 days'), v_from)
  end;

  insert into public.payments (user_id, charge_id, plan, stars, is_recurring, pro_until)
  values (p_user, p_charge_id, p_plan, coalesce(p_stars, 0), coalesce(p_recurring, false), v_until);
  update public.users set pro_until = v_until where id = p_user;
  return true;
end $$;

create function public.api_subscription(p_user uuid) returns jsonb
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
    'ai_per_day', 3);
end $$;

-- Итоги недели — функция Pro.
drop function public.due_digests(timestamptz);
create function public.due_digests(p_now timestamptz default now())
returns table (user_id uuid, chat_id bigint, kind text, local_date date)
language sql stable security definer set search_path = public as $$
  with u as (
    select id, tg_id, (p_now at time zone tz) as local_ts,
           notify_daily, notify_weekly, last_daily_on, last_weekly_on, pro_until > p_now as pro
      from public.users
     where is_allowed and onboarded_at is not null)
  select u.id, u.tg_id, 'daily'::text, d.day
    from u, lateral (select case
             when u.local_ts::time between time '21:30' and time '23:59:59' then u.local_ts::date
             when u.local_ts::time < time '09:00' then u.local_ts::date - 1  -- догон за вчера
           end as day) d
   where u.notify_daily and d.day is not null
     and (u.last_daily_on is null or u.last_daily_on < d.day)
  union all
  select u.id, u.tg_id, 'weekly'::text, w.day
    from u, lateral (select case
             when extract(isodow from u.local_ts) = 7
                  and u.local_ts::time between time '21:30' and time '23:59:59' then u.local_ts::date
             when extract(isodow from u.local_ts) = 1
                  and u.local_ts::time < time '12:00' then u.local_ts::date - 1  -- догон за воскресенье
           end as day) w
   where u.notify_weekly and u.pro and w.day is not null
     and (u.last_weekly_on is null or u.last_weekly_on < w.day)
   order by 1, 3;
$$;

revoke execute on function public.is_pro(uuid), public.ai_quota_use(uuid),
  public.apply_payment(uuid, text, text, int, timestamptz, boolean), public.api_subscription(uuid),
  public.due_digests(timestamptz)
  from public, anon, authenticated;
