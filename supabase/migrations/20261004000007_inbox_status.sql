-- План 6: статус записи, отправленной из миниаппа
create function public.api_inbox_status(p_user uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', status, 'reply', result->>'reply')
    from public.inbox where id = p_id and user_id = p_user
$$;

revoke execute on function public.api_inbox_status(uuid, uuid) from public, anon, authenticated;
