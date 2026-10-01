create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule('reclaim-stuck', '* * * * *', $$select public.reclaim_stuck()$$);

-- Требует секретов в Vault (задаются при деплое, Task 13):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
select cron.schedule('fx-sync', '15 0 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fx-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
