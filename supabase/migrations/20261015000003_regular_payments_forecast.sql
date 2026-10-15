-- Регулярные платежи и прогноз трат (Pro).
--
-- Регулярный платёж — подписка, связь, аренда: планер сам находит их в тратах
-- (та же категория и название, похожая сумма, похожее число, хотя бы два месяца)
-- и предлагает; человек подтверждает или добавляет сам. За день до списания бот
-- напоминает и по кнопке записывает трату.
-- Прогноз — сколько уйдёт к концу месяца: темп обычных трат плюс регулярные платежи,
-- которые ещё впереди. Регулярные считаем отдельно, иначе аренда первого числа
-- раздувает «темп» на весь месяц.

create table public.regular_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null check (btrim(title) <> '' and length(title) <= 200),
  amount numeric(18,2) not null check (amount > 0),
  category_id uuid references public.categories(id) on delete set null,
  day smallint not null check (day between 1 and 31),
  -- suggested — нашёл сам и спрашиваю; active — напоминаю; dismissed — «не регулярный», больше не предлагаю
  status text not null default 'suggested' check (status in ('suggested', 'active', 'dismissed')),
  -- дата списания, о которой уже напомнил
  reminded_on date,
  created_at timestamptz not null default now()
);
alter table public.regular_payments enable row level security;
create unique index regular_payments_title_idx on public.regular_payments (user_id, lower(btrim(title)));

-- Дата списания в месяце: 31-е в коротком месяце — последний день.
create function public._charge_in(p_day int, p_month date) returns date
language sql immutable as $$
  select date_trunc('month', p_month)::date
         + (least(p_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int) - 1);
$$;

-- Ближайшее списание, начиная с p_from.
create function public._next_charge(p_day int, p_from date) returns date
language sql immutable as $$
  select case when public._charge_in(p_day, p_from) >= p_from then public._charge_in(p_day, p_from)
              else public._charge_in(p_day, (date_trunc('month', p_from) + interval '1 month')::date) end;
$$;

-- Найти повторяющиеся траты за ~3 месяца и предложить их. Отклонённые не предлагаются снова
-- (тот же уникальный ключ), так что вызывать можно сколько угодно.
create function public.detect_regular_payments(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date;
  n int;
begin
  select (now() at time zone tz)::date into v_today from public.users where id = p_user;
  if not found then return 0; end if;
  insert into public.regular_payments (user_id, title, amount, category_id, day)
  select p_user, s.title, s.amount, s.category_id, s.day
    from (select min(btrim(t.comment)) as title,
                 round(avg(t.amount_base), 2) as amount,
                 t.category_id,
                 round(avg(extract(day from t.occurred_at)))::int as day,
                 count(*) as times,
                 count(distinct date_trunc('month', t.occurred_at)) as months,
                 max(t.amount_base) / min(t.amount_base) as spread,
                 max(extract(day from t.occurred_at)) - min(extract(day from t.occurred_at)) as day_spread
            from public.transactions t
           where t.user_id = p_user and t.type = 'expense' and t.deleted_at is null
             and btrim(t.comment) <> ''
             and t.occurred_at > v_today - 100
           group by lower(btrim(t.comment)), t.category_id) s
   -- раз в месяц, а не кофе каждый день: не больше одной траты на месяц, сумма и число почти те же
   where s.months >= 2 and s.times <= s.months and s.spread <= 1.15 and s.day_spread <= 6
  on conflict (user_id, lower(btrim(title))) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.api_regular_payments(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date;
  v_cur text;
begin
  perform public.detect_regular_payments(p_user);
  select (now() at time zone tz)::date, base_currency into v_today, v_cur from public.users where id = p_user;
  if not found then return null; end if;
  return jsonb_build_object(
    'base_currency', v_cur,
    'monthly_total', coalesce((select sum(amount) from public.regular_payments
                                where user_id = p_user and status = 'active'), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'amount', r.amount, 'day', r.day, 'status', r.status,
               'category', coalesce(c.name, 'другое'),
               'next_on', public._next_charge(r.day, v_today)::text)
             order by r.status desc, public._next_charge(r.day, v_today), r.title)
        from public.regular_payments r left join public.categories c on c.id = r.category_id
       where r.user_id = p_user and r.status <> 'dismissed'), '[]'::jsonb));
end $$;

-- Добавить вручную (или вернуть отклонённый) — сразу активный.
create function public.add_regular_payment(p_user uuid, p_title text, p_amount numeric, p_day int, p_category text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_cat uuid;
begin
  perform 1 from public.users where id = p_user;
  if not found then return null; end if;
  if p_title is null or btrim(p_title) = '' or length(btrim(p_title)) > 200 then raise exception 'bad title'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e13 then raise exception 'bad amount'; end if;
  if p_day is null or p_day not between 1 and 31 then raise exception 'bad day'; end if;
  select id into v_cat from public.categories
   where user_id = p_user and type = 'expense' and lower(name) = lower(btrim(coalesce(p_category, '')));
  insert into public.regular_payments (user_id, title, amount, category_id, day, status)
  values (p_user, btrim(p_title), round(p_amount, 2), v_cat, p_day, 'active')
  on conflict (user_id, lower(btrim(title))) do update
     set amount = excluded.amount, day = excluded.day, status = 'active',
         category_id = coalesce(excluded.category_id, regular_payments.category_id)
  returning id into v_id;
  return v_id;
end $$;

create function public.set_regular_payment(p_user uuid, p_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('active', 'dismissed') then raise exception 'bad status'; end if;
  update public.regular_payments set status = p_status where id = p_id and user_id = p_user;
  return found;
end $$;

-- Напоминания на завтрашние списания: утром, с 10:00, у Pro с включёнными напоминаниями.
create function public.due_payment_reminders(p_now timestamptz default now())
returns table (id uuid, chat_id bigint, title text, amount numeric, base_currency text, charge_on date)
language sql stable security definer set search_path = public as $$
  select r.id, u.tg_id, r.title, r.amount, u.base_currency,
         public._next_charge(r.day, (p_now at time zone u.tz)::date + 1)
    from public.regular_payments r join public.users u on u.id = r.user_id
   where r.status = 'active' and u.is_allowed and u.onboarded_at is not null and u.notify_reminders
     and u.pro_until > p_now
     and (p_now at time zone u.tz)::time >= time '10:00'
     and public._next_charge(r.day, (p_now at time zone u.tz)::date + 1) = (p_now at time zone u.tz)::date + 1
     and r.reminded_on is distinct from (p_now at time zone u.tz)::date + 1
   limit 200;
$$;

create function public.mark_payment_reminded(p_ids uuid[], p_now timestamptz default now()) returns void
language sql security definer set search_path = public as $$
  update public.regular_payments r
     set reminded_on = (p_now at time zone u.tz)::date + 1
    from public.users u
   where u.id = r.user_id and r.id = any(p_ids);
$$;

-- Кнопка «Записать трату» под напоминанием. Повторное нажатие в тот же день не дублирует.
create function public.record_regular_payment(p_user uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.regular_payments;
  u public.users;
  v_today date;
  v_tx uuid;
  v_new boolean := false;
begin
  select * into u from public.users where id = p_user;
  if not found or u.base_currency is null then return null; end if;
  select * into r from public.regular_payments where id = p_id and user_id = p_user and status = 'active';
  if not found then return null; end if;
  v_today := (now() at time zone u.tz)::date;
  select id into v_tx from public.transactions
   where user_id = p_user and type = 'expense' and deleted_at is null and occurred_at = v_today
     and lower(btrim(comment)) = lower(btrim(r.title)) and amount_base = r.amount
   limit 1;
  if v_tx is null then
    insert into public.transactions (user_id, type, amount_base, base_currency, category_id, comment, occurred_at)
    values (p_user, 'expense', r.amount, u.base_currency,
            coalesce(r.category_id, (select id from public.categories
                                      where user_id = p_user and type = 'expense' and name = 'другое')),
            r.title, v_today)
    returning id into v_tx;
    v_new := true;
  end if;
  return jsonb_build_object('id', v_tx, 'created', v_new, 'title', r.title, 'amount', r.amount,
                            'base_currency', u.base_currency);
end $$;

-- Формула прогноза: уже потрачено + темп обычных трат (без регулярных) на оставшиеся дни
-- + регулярные, которые ещё впереди. null, пока прошло меньше трёх дней: темп по одному дню — шум.
create function public._forecast(p_spent numeric, p_reg_paid numeric, p_reg_left numeric, p_passed int, p_days int)
returns numeric
language sql immutable as $$
  select case when p_passed >= 3
              then round(p_spent + greatest(p_spent - p_reg_paid, 0) / p_passed * (p_days - p_passed) + p_reg_left)
         end;
$$;

create function public.api_forecast(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  u public.users;
  v_today date;
  v_start date;
  v_days int;
  v_passed int;
  v_spent numeric;
  v_prev numeric;
  v_reg_paid numeric;
  v_reg_left numeric;
  v_forecast numeric;
begin
  select * into u from public.users where id = p_user;
  if not found then return null; end if;
  v_today := (now() at time zone u.tz)::date;
  v_start := date_trunc('month', v_today)::date;
  v_days := extract(day from (v_start + interval '1 month - 1 day'))::int;
  v_passed := extract(day from v_today)::int;
  select coalesce(sum(amount_base), 0) into v_spent from public.transactions
   where user_id = p_user and type = 'expense' and deleted_at is null
     and occurred_at >= v_start and occurred_at <= v_today;
  select coalesce(sum(amount_base), 0) into v_prev from public.transactions
   where user_id = p_user and type = 'expense' and deleted_at is null
     and occurred_at >= (v_start - interval '1 month')::date and occurred_at < v_start;
  select coalesce(sum(amount) filter (where public._charge_in(day, v_start) <= v_today), 0),
         coalesce(sum(amount) filter (where public._charge_in(day, v_start) > v_today), 0)
    into v_reg_paid, v_reg_left
    from public.regular_payments where user_id = p_user and status = 'active';
  v_forecast := public._forecast(v_spent, v_reg_paid, v_reg_left, v_passed, v_days);
  return jsonb_build_object(
    'base_currency', u.base_currency,
    'month', to_char(v_start, 'YYYY-MM'),
    'spent', v_spent,
    'forecast', v_forecast,
    'prev_month', v_prev,
    'regular_left', v_reg_left,
    'days_left', v_days - v_passed,
    'limit', (select monthly_limit from public.budgets where user_id = p_user and category_id is null));
end $$;

revoke execute on function public._charge_in(int, date), public._next_charge(int, date),
  public.detect_regular_payments(uuid), public.api_regular_payments(uuid),
  public.add_regular_payment(uuid, text, numeric, int, text), public.set_regular_payment(uuid, uuid, text),
  public.due_payment_reminders(timestamptz), public.mark_payment_reminded(uuid[], timestamptz),
  public.record_regular_payment(uuid, uuid), public._forecast(numeric, numeric, numeric, int, int), public.api_forecast(uuid)
  from public, anon, authenticated;
