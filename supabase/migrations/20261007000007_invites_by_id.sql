-- #7 Доступ выдавался по Telegram-нику, а ник переиспользуется: `/allow @bob`, bob не зашёл,
--    через месяц освободил ник — посторонний жмёт /start и получает полный доступ.
--    И наоборот: пользователь сменил ник, и `/deny @old` молча ничего не делал.
--
-- Что меняется:
--  * приглашение можно выдать на tg_id — он не переиспользуется никогда;
--  * приглашение по нику одноразовое и живёт 7 дней, при входе «сгорает» и к нему
--    привязывается реальный tg_id — дальше доступ держится на id, а не на нике;
--  * отзыв работает и по нику, и по id;
--  * tg_username обновляется при каждом апдейте (touch_user), поэтому ник в базе
--    всегда актуальный и `/deny @ник` попадает в того, кого видно в чате.

alter table public.invites drop constraint invites_pkey;
alter table public.invites
  add column tg_id bigint,
  add column used_at timestamptz,
  add column expires_at timestamptz not null default now() + interval '7 days';
alter table public.invites alter column username drop not null;
create unique index invites_username_uidx on public.invites (username) where username is not null;
create unique index invites_tg_id_uidx on public.invites (tg_id) where tg_id is not null;
alter table public.invites add constraint invites_target_chk check (username is not null or tg_id is not null);

-- «@Bob», « bob », «bob» — один и тот же человек
create function public._norm_username(p text) returns text
language sql immutable as $$
  select nullif(lower(btrim(btrim(coalesce(p, '')), '@')), '');
$$;

-- приглашение по id не истекает: id не передаётся другому человеку
create function public.invite_user(p_username text, p_tg_id bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text := public._norm_username(p_username);
begin
  if v_name is null and p_tg_id is null then raise exception 'invite needs a username or a tg_id'; end if;
  if p_tg_id is not null then
    insert into public.invites (username, tg_id, used_at, expires_at)
    values (v_name, p_tg_id, null, now() + interval '100 years')
    on conflict (tg_id) where tg_id is not null
    do update set username = coalesce(excluded.username, public.invites.username),
                  used_at = null, expires_at = excluded.expires_at;
    update public.users set is_allowed = true, tg_username = coalesce(v_name, tg_username) where tg_id = p_tg_id;
  else
    insert into public.invites (username, expires_at) values (v_name, now() + interval '7 days')
    on conflict (username) where username is not null
    do update set used_at = null, expires_at = excluded.expires_at;
    -- уже знакомый пользователь с этим ником: открываем доступ сразу
    update public.users set is_allowed = true where tg_username = v_name;
  end if;
end $$;

create function public.revoke_user(p_username text, p_tg_id bigint default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_name text := public._norm_username(p_username);
  v_ids bigint[];
  v_invites int := 0;
  v_users int := 0;
begin
  if v_name is null and p_tg_id is null then raise exception 'revoke needs a username or a tg_id'; end if;
  -- id, которых касается отзыв: явный, плюс те, что знаем по нику (из users и из приглашений)
  select array_agg(distinct x) into v_ids from (
    select p_tg_id as x where p_tg_id is not null
    union select tg_id from public.users where v_name is not null and tg_username = v_name
    union select tg_id from public.invites where v_name is not null and username = v_name and tg_id is not null
  ) s where x is not null;
  delete from public.invites
   where (v_name is not null and username = v_name)
      or (v_ids is not null and tg_id = any(v_ids));
  get diagnostics v_invites = row_count;
  update public.users set is_allowed = false
   where is_admin = false
     and ((v_name is not null and tg_username = v_name) or (v_ids is not null and tg_id = any(v_ids)));
  get diagnostics v_users = row_count;
  return v_invites + v_users;
end $$;

-- Вход нового человека: приглашение по id — всегда, по нику — один раз и пока не истекло.
create function public.claim_invite(p_tg_id bigint, p_username text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_name text := public._norm_username(p_username);
  v_ctid tid;
begin
  if p_tg_id is null then return false; end if;
  select ctid into v_ctid from public.invites
   where tg_id = p_tg_id
      or (v_name is not null and username = v_name and used_at is null and expires_at > now())
   order by (tg_id = p_tg_id) desc
   limit 1
   for update;
  if not found then return false; end if;
  update public.invites
     set used_at = coalesce(used_at, now()),
         tg_id = coalesce(tg_id, p_tg_id),
         username = coalesce(username, v_name)
   where ctid = v_ctid;
  return true;
end $$;

-- #7: ник в базе должен быть свежим, иначе /deny @ник бьёт мимо.
create function public.touch_user(p_tg_id bigint, p_username text, p_name text default null) returns void
language sql security definer set search_path = public as $$
  update public.users
     set tg_username = public._norm_username(p_username),
         name = case when coalesce(btrim(p_name), '') = '' then name else btrim(p_name) end
   where tg_id = p_tg_id
     and (tg_username is distinct from public._norm_username(p_username)
          or (coalesce(btrim(p_name), '') <> '' and name is distinct from btrim(p_name)));
$$;

revoke execute on function
  public._norm_username(text), public.invite_user(text, bigint), public.revoke_user(text, bigint),
  public.claim_invite(bigint, text), public.touch_user(bigint, text, text)
  from public, anon, authenticated;
