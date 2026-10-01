-- habits created by a habit_new item are tied to the inbox row so "delete all" can remove them
alter table public.habits add column inbox_id uuid references public.inbox(id) on delete set null;

create or replace function public.delete_inbox_records(p_user uuid, p_inbox uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  c int;
begin
  delete from public.items where user_id = p_user and inbox_id = p_inbox; get diagnostics c = row_count; n := n + c;
  delete from public.transactions where user_id = p_user and inbox_id = p_inbox; get diagnostics c = row_count; n := n + c;
  delete from public.notes where user_id = p_user and inbox_id = p_inbox; get diagnostics c = row_count; n := n + c;
  delete from public.habit_logs where user_id = p_user and inbox_id = p_inbox; get diagnostics c = row_count; n := n + c;
  delete from public.habits h where h.user_id = p_user and h.inbox_id = p_inbox
    and not exists (select 1 from public.habit_logs l where l.habit_id = h.id); get diagnostics c = row_count; n := n + c;
  update public.inbox set result = result || '{"deleted": true}'::jsonb where id = p_inbox and user_id = p_user;
  return n;
end $$;

revoke execute on function public.delete_inbox_records(uuid, uuid) from public, anon, authenticated;
