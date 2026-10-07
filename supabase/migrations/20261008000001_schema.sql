-- Схема под мягкое удаление (#3), лимиты запросов (#35) и честный флаг времени (#32).

alter table public.items add column deleted_at timestamptz;
alter table public.notes add column deleted_at timestamptz;
alter table public.transactions add column deleted_at timestamptz;

-- Живые строки читаются на каждый чих, удалённые — только корзиной и purge.
create index items_live_idx on public.items (user_id, kind) where deleted_at is null;
create index items_live_due_idx on public.items (user_id, due_at) where deleted_at is null;
create index items_live_starts_idx on public.items (user_id, starts_at) where deleted_at is null;
create index notes_live_idx on public.notes (user_id, created_at desc, id desc) where deleted_at is null;
create index transactions_live_idx on public.transactions (user_id, occurred_at) where deleted_at is null;
create index items_deleted_idx on public.items (deleted_at) where deleted_at is not null;
create index notes_deleted_idx on public.notes (deleted_at) where deleted_at is not null;
create index transactions_deleted_idx on public.transactions (deleted_at) where deleted_at is not null;

-- #32: 23:59 перестаёт быть магическим значением «без времени».
-- Храним 23:59 как и раньше, но читать потребители должны флаг.
alter table public.items add column due_has_time boolean not null default false;

update public.items
   set due_has_time = true
 where kind = 'task' and due_at is not null
   and to_char(due_at at time zone (select tz from public.users u where u.id = items.user_id), 'HH24:MI') <> '23:59';

-- #35: счётчик попыток по действию.
create table public.rate_events (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events (user_id, action, at desc);
create index rate_events_at_idx on public.rate_events (at);

alter table public.rate_events enable row level security;
