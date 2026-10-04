begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
select is((select public from storage.buckets where id = 'audio'), false, 'audio bucket is private');
select is((select file_size_limit from storage.buckets where id = 'audio'), 2097152::bigint, 'audio size limit');
select * from finish();
rollback;
