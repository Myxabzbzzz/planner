begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.users (id, tg_id, name, tz, is_allowed, onboarded_at, base_currency, pro_until) values
  ('00000000-0000-0000-0000-0000000a9901', 9991, 'A', 'UTC', true, now(), 'RUB', 'infinity');

select is(public.api_settings('00000000-0000-0000-0000-0000000a9901')->>'accent', 'amber', 'amber by default');
select is(public.set_appearance('00000000-0000-0000-0000-0000000a9901', 'dark', 'ocean'), true, 'saved');
select is(public.api_settings('00000000-0000-0000-0000-0000000a9901')->>'theme' || ' ' ||
          (public.api_settings('00000000-0000-0000-0000-0000000a9901')->>'accent'), 'dark ocean', 'Pro sees the choice');
update public.users set pro_until = null where id = '00000000-0000-0000-0000-0000000a9901';
select is(public.api_settings('00000000-0000-0000-0000-0000000a9901')->>'accent', 'amber', 'without Pro — the default');
select throws_ok($$select public.set_appearance('00000000-0000-0000-0000-0000000a9901', 'neon', 'amber')$$,
  'P0001', 'bad appearance', 'unknown theme is refused');

select * from finish();
rollback;
