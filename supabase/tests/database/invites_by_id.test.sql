begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- #7 приглашение по нику — одноразовое и на 7 дней
select public.invite_user('@Bob');
select is((select count(*)::int from public.invites where username = 'bob'), 1, '«@Bob» и «bob» — один ник');
select is((select used_at is null and expires_at > now() from public.invites where username = 'bob'), true,
          'a fresh invite is unused and not expired');
select is(public.claim_invite(5001, 'BOB'), true, 'the invited person gets in, case-insensitively');
select is((select tg_id from public.invites where username = 'bob'), 5001::bigint,
          'the invite is bound to a real telegram id on first login');
select is(public.claim_invite(9999, 'bob'), false,
          'a stranger who later takes the freed nick gets nothing');
select is(public.claim_invite(5001, 'bob_renamed'), true, 'the real person gets in by id even after a rename');

-- истёкшее приглашение
select public.invite_user('carol');
update public.invites set expires_at = now() - interval '1 day' where username = 'carol';
select is(public.claim_invite(5002, 'carol'), false, 'an expired nick invite is refused');

-- приглашение сразу по id (кнопка «Разрешить» у владельца)
select public.invite_user(null, 5003);
select is(public.claim_invite(5003, 'dave'), true, 'an id invite works without a nick');

insert into public.users (id, tg_id, tg_username, name, is_allowed, is_admin) values
  ('00000000-0000-0000-0000-000000005001', 5001, 'bob_renamed', 'Bob', true, false),
  ('00000000-0000-0000-0000-000000005003', 5003, 'dave', 'Dave', true, false),
  ('00000000-0000-0000-0000-000000005004', 5004, 'owner', 'Owner', true, true);

select isnt(public.revoke_user('bob_renamed'), 0, 'revoking by the current nick finds the person');
select is((select is_allowed from public.users where tg_id = 5001), false, 'and closes their access');
select is((select count(*)::int from public.invites where tg_id = 5001), 0, 'and removes the invite');

select isnt(public.revoke_user(null, 5003), 0, 'revoking by id works too');
select is((select is_allowed from public.users where tg_id = 5003), false, 'dave is closed');

select is(public.revoke_user('owner'), 0, 'the owner cannot be locked out');

-- ник в базе должен быть свежим, иначе /deny @ник бьёт мимо
select public.touch_user(5004, '@NewOwner', 'Owner Two');
select is((select tg_username || '|' || name from public.users where tg_id = 5004), 'newowner|Owner Two',
          'touch_user keeps the nick and the name up to date');

select * from finish();
rollback;
