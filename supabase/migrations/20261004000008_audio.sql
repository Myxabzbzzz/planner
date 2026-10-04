-- План 6: голос из миниаппа. Файл живёт до распознавания, воркер удаляет его сразу после.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 2097152, array['audio/mp4', 'audio/x-m4a', 'audio/webm'])
on conflict (id) do nothing;
