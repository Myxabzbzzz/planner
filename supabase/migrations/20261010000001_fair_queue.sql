-- Открытый доступ: очередь на ноутбуке одна на всех, и строго «по времени» один человек
-- с сотней сообщений задерживал разбор у всех остальных на часы.
-- Теперь по кругу: первым идёт сообщение пользователя, которому воркер меньше всего уделил
-- за последние 10 минут (с учётом его же более ранних сообщений в очереди), при равенстве — самое старое.
create or replace function public.claim_inbox() returns setof public.inbox
language sql security definer set search_path = public as $$
  update public.inbox i
     set status = 'processing', claimed_at = now(), attempts = i.attempts + 1
   where i.id = (select p.id from public.inbox p
                  where p.status = 'pending'
                  order by (select count(*) from public.inbox q
                             where q.user_id = p.user_id
                               and ((q.status = 'pending' and q.created_at < p.created_at)
                                 or (q.status <> 'pending' and q.claimed_at > now() - interval '10 minutes'))),
                           p.created_at
                  for update skip locked
                  limit 1)
  returning i.*;
$$;

create index if not exists inbox_user_claimed_idx on public.inbox (user_id, claimed_at);
