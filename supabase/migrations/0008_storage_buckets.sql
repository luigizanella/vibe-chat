-- ============================================================================
-- 0008_storage_buckets.sql — Buckets e políticas do Storage (usa funções da 0007)
-- ============================================================================

-- -------------------------------------------------------------- Storage ---
-- public-media (público p/ leitura): avatars/<uid>/…, banners/<uid>/…, servers/<server>/…
-- attachments (privado):             c/<canal>/<uid>/<id>/<arquivo>  |  d/<dm>/<uid>/<id>/<arquivo>
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('public-media', 'public-media', true, 5242880, array['image/png','image/jpeg','image/webp','image/gif'])
  on conflict (id) do update set public = true, file_size_limit = 5242880,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('attachments', 'attachments', false, 26214400)
  on conflict (id) do update set public = false, file_size_limit = 26214400;

  execute 'drop policy if exists vibe_media_insert on storage.objects';
  execute 'drop policy if exists vibe_media_update on storage.objects';
  execute 'drop policy if exists vibe_media_delete on storage.objects';
  execute 'drop policy if exists vibe_att_select on storage.objects';
  execute 'drop policy if exists vibe_att_insert on storage.objects';
  execute 'drop policy if exists vibe_att_delete on storage.objects';

  execute $p$create policy vibe_media_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'public-media' and private.media_path_allowed(name, auth.uid()))$p$;
  execute $p$create policy vibe_media_update on storage.objects for update to authenticated
    using (bucket_id = 'public-media' and private.media_path_allowed(name, auth.uid()))
    with check (bucket_id = 'public-media' and private.media_path_allowed(name, auth.uid()))$p$;
  execute $p$create policy vibe_media_delete on storage.objects for delete to authenticated
    using (bucket_id = 'public-media' and private.media_path_allowed(name, auth.uid()))$p$;

  execute $p$create policy vibe_att_select on storage.objects for select to authenticated
    using (bucket_id = 'attachments' and private.attachment_path_readable(name, auth.uid()))$p$;
  execute $p$create policy vibe_att_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'attachments' and private.attachment_path_writable(name, auth.uid()))$p$;
  execute $p$create policy vibe_att_delete on storage.objects for delete to authenticated
    using (bucket_id = 'attachments' and (string_to_array(name, '/'))[3] = auth.uid()::text)$p$;
end $$;


