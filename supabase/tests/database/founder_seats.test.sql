begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.users (id, tg_id, name, tz, is_allowed) values
  ('00000000-0000-0000-0000-00000000fa01', 9901, 'A', 'Europe/Moscow', true),
  ('00000000-0000-0000-0000-00000000fa02', 9902, 'B', 'Europe/Moscow', true);
delete from public.payments;

select is((public.api_subscription('00000000-0000-0000-0000-00000000fa01')->>'founder_sold')::int, 0, 'no founders yet');

select public.apply_payment('00000000-0000-0000-0000-00000000fa01', 'ch-1', 'lifetime', 2200, null, false);
select public.apply_payment('00000000-0000-0000-0000-00000000fa02', 'ch-2', 'month', 150, null, true);
select is((public.api_subscription('00000000-0000-0000-0000-00000000fa02')->>'founder_sold')::int, 1,
  'one lifetime purchase is one seat, monthly ones do not count');

select public.apply_payment('00000000-0000-0000-0000-00000000fa01', 'ch-3', 'lifetime', 2200, null, false);
select is((public.api_subscription('00000000-0000-0000-0000-00000000fa02')->>'founder_sold')::int, 1,
  'a second lifetime payment by the same person takes no extra seat');

select * from finish();
rollback;
