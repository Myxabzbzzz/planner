-- Аудит #36: таблица corrections заполнялась при каждом уточнении и не читалась ничем.
-- Теперь воркер подмешивает её в few-shot промпта, поэтому нужна аккуратная проекция:
-- «дословный текст записи» → «тип, который выбрал пользователь».
--
-- Берём только осмысленные исправления: выбран реальный тип (не 'drop') и есть
-- исходный текст. Дедуп по тексту делает воркер (prompts.corrections_block) — там он
-- не зависит от collation базы и видно, что побеждает последнее слово пользователя.

create function public.recent_corrections(p_user uuid, p_limit int default 30)
returns table (text text, kind text)
language sql stable security definer set search_path = public as $$
  select btrim(x.text), x.kind
    from (
      select cr.created_at,
             cr.before -> 'item' ->> 'source_text' as text,
             cr.after ->> 'kind' as kind
        from public.corrections cr
       where cr.user_id = p_user
    ) x
   where x.text is not null and btrim(x.text) <> ''
     and x.kind in ('task', 'event', 'expense', 'income', 'note', 'journal', 'habit_done', 'habit_new')
   order by x.created_at desc
   limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke execute on function public.recent_corrections(uuid, int) from public, anon, authenticated;
