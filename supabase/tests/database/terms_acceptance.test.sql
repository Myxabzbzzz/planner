begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-0000000e0001', 9995, 'A', 'UTC', true);
select is(public.accept_terms('00000000-0000-0000-0000-0000000e0001', '2026-10-15'), true, 'accepted');
select is((select terms_version from public.users where id = '00000000-0000-0000-0000-0000000e0001'), '2026-10-15', 'version kept');
select is(public.accept_terms('00000000-0000-0000-0000-0000000e0001', '2027-01-01'), false, 'the first acceptance is not overwritten');

select * from finish();
rollback;
