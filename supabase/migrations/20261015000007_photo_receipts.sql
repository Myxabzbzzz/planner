-- Фото чека → трата (Pro). Бот кладёт в очередь file_id фото (image_ref) и подпись (text);
-- воркер читает чек моделью, понимающей картинки, записывает распознанное в text и стирает
-- image_ref — повторная попытка разбора не гоняет картинку через модель второй раз.

alter table public.inbox add column image_ref text;

alter table public.inbox drop constraint inbox_check;
alter table public.inbox add constraint inbox_payload_check
  check (text is not null or audio_ref is not null or image_ref is not null);

alter table public.inbox drop constraint inbox_source_check;
alter table public.inbox add constraint inbox_source_check
  check (source in ('voice', 'text', 'miniapp', 'shortcut', 'photo'));
