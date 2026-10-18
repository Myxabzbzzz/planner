-- Воркер разбирает несколько сообщений одновременно (WORKER_CONCURRENCY, несколько машин).
-- Сообщения одного человека при этом должны идти по очереди: «кофе 100», а следом
-- «нет, 150» не может закончиться раньше первого. Пока у человека есть сообщение в работе,
-- его следующие ждут; зависшее «в работе» (воркер умер) через 5 минут не держит очередь —
-- его и так вернёт в pending reclaim.
-- Окно в миллисекунды, когда два потока одновременно возьмут сообщения одного человека,
-- остаётся: строгая блокировка по человеку остановила бы всю очередь ради редкого случая.
create or replace function public.claim_inbox() returns setof public.inbox
language sql security definer set search_path = public as $$
  update public.inbox i
     set status = 'processing', claimed_at = now(), attempts = i.attempts + 1
   where i.id = (select p.id from public.inbox p
                  where p.status = 'pending'
                    and not exists (select 1 from public.inbox b
                                     where b.user_id = p.user_id
                                       and b.status = 'processing'
                                       and b.claimed_at > now() - interval '5 minutes')
                  order by (select count(*) from public.inbox q
                             where q.user_id = p.user_id
                               and ((q.status = 'pending' and q.created_at < p.created_at)
                                 or (q.status <> 'pending' and q.claimed_at > now() - interval '10 minutes'))),
                           p.created_at
                  for update skip locked
                  limit 1)
  returning i.*;
$$;

revoke execute on function public.claim_inbox() from public, anon, authenticated;
