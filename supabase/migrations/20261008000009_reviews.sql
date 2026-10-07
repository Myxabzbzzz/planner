-- #8/#9: вопросы ИИ жили только в чате, миниапп умел лишь сказать «открой чат».
-- Отдаём открытые вопросы в точно той форме, в которой resolve_review/resolve_time ждут ответ:
--   resolve_review(p_user, p_inbox, p_idx, p_kind)   — p_kind = option.arg
--   resolve_time  (p_user, p_inbox, p_idx, p_choice) — p_choice = option.arg ('HHMM' | 'none' | 'drop')
-- idx — индекс записи в inbox.result->'pending_review' (ровно как в callback_data rv:/rt: у бота).

create function public._review_options(p_entry jsonb, p_tz text, p_now timestamptz) returns jsonb
language plpgsql immutable security definer set search_path = public as $$
declare
  v_reason text := p_entry ->> 'reason';
  v_item jsonb := p_entry -> 'item';
  v_kind text := v_item ->> 'kind';
  v_start timestamptz;
  v_local timestamp;
  v_pm timestamp;
  v_out jsonb := '[]'::jsonb;
  c text;
begin
  if v_reason = 'time' then
    -- те же пять часов, что предлагает бот, плюс «без времени» и «пропустить»
    foreach c in array array['0900', '1200', '1500', '1800', '2000'] loop
      v_out := v_out || jsonb_build_object('rpc', 'resolve_time', 'arg', c,
                                           'label', substr(c, 1, 2) || ':' || substr(c, 3, 2));
    end loop;
    return v_out
      || jsonb_build_object('rpc', 'resolve_time', 'arg', 'none', 'label', 'Без времени')
      || jsonb_build_object('rpc', 'resolve_time', 'arg', 'drop', 'label', 'Пропустить');
  end if;

  if v_reason = 'past' then
    v_start := (v_item ->> 'starts_at')::timestamptz;
    v_local := v_start at time zone p_tz;
    -- «04:30» почти всегда значит 16:30, если 16:30 ещё не наступило
    if extract(hour from v_local) < 12 then
      v_pm := v_local + interval '12 hours';
      if (v_pm at time zone p_tz) > p_now then
        v_out := v_out || jsonb_build_object('rpc', 'resolve_time', 'arg', to_char(v_pm, 'HH24MI'),
                                             'label', 'Сегодня ' || to_char(v_pm, 'HH24:MI'));
      end if;
    end if;
    return v_out
      || jsonb_build_object('rpc', 'resolve_time', 'arg', to_char(v_local, 'HH24MI'),
                            'label', 'Завтра ' || to_char(v_local, 'HH24:MI'))
      || jsonb_build_object('rpc', 'resolve_review', 'arg', 'event',
                            'label', 'Оставить ' || to_char(v_local, 'HH24:MI'))
      || jsonb_build_object('rpc', 'resolve_time', 'arg', 'drop', 'label', 'Пропустить');
  end if;

  if v_reason = 'future' then
    return jsonb_build_array(
      jsonb_build_object('rpc', 'resolve_review', 'arg', v_kind, 'label', 'На сегодня'),
      jsonb_build_object('rpc', 'resolve_review', 'arg', 'drop', 'label', 'Пропустить'));
  end if;

  -- «куда отнести» — полный набор типов, как в REVIEW_ROWS бота
  return jsonb_build_array(
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'task',       'label', 'Задача'),
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'event',      'label', 'Встреча'),
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'expense',    'label', 'Расход'),
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'income',     'label', 'Доход'),
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'note',       'label', 'Мысль'),
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'journal',    'label', 'Дневник'),
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'habit_done', 'label', 'Привычка'),
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'habit_new',  'label', 'Новая привычка'),
    jsonb_build_object('rpc', 'resolve_review', 'arg', 'drop',       'label', 'Пропустить'));
end $$;

create function public.api_reviews(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_now timestamptz := now();
begin
  select tz into v_tz from public.users where id = p_user;
  if not found then return null; end if;
  return jsonb_build_object('reviews', coalesce((
    select jsonb_agg(r.obj order by r.created_at)
      from (
        select i.created_at,
               jsonb_build_object(
                 'inbox_id', i.id,
                 'source', i.source,
                 'created_at', to_char(i.created_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
                 -- 'pending' = воркер уже переваривает предыдущий ответ; остальные вопросы
                 -- при этом открыты, и resolve_* их принимает, так что прятать строку нельзя
                 'status', i.status,
                 'text', i.result ->> 'text',
                 'questions', q.questions) as obj
          from public.inbox i
          cross join lateral (
            -- нумерация должна совпадать с индексом в массиве: ordinality - 1
            select coalesce(jsonb_agg(jsonb_build_object(
                     'idx', e.ord - 1,
                     'reason', e.entry ->> 'reason',
                     'title', e.entry -> 'item' ->> 'title',
                     'source_text', e.entry -> 'item' ->> 'source_text',
                     'kind', e.entry -> 'item' ->> 'kind',
                     'item', e.entry -> 'item',
                     'laya', e.entry -> 'laya',
                     'options', public._review_options(e.entry, v_tz, v_now))
                   order by e.ord), '[]'::jsonb) as questions
              from jsonb_array_elements(coalesce(i.result -> 'pending_review', '[]'::jsonb))
                   with ordinality as e(entry, ord)
             where not (e.entry ? 'forced_kind')
               and coalesce((e.entry ->> 'resolved')::boolean, false) = false
          ) q
         where i.user_id = p_user
           and i.status in ('needs_review', 'pending')
           and jsonb_typeof(i.result -> 'pending_review') = 'array'
           and jsonb_array_length(q.questions) > 0
      ) r), '[]'::jsonb));
end $$;

revoke execute on function public.api_reviews(uuid),
  public._review_options(jsonb, text, timestamptz)
  from public, anon, authenticated;
