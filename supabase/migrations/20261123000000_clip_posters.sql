-- Each Consequence clip may carry a small JPEG poster beside it (same path, .jpg), uploaded
-- by the recording phone so the Wall shows thumbnails without loading video (owner request
-- 2026-11-02).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $sql$
      update storage.buckets
      set allowed_mime_types = array['video/mp4', 'video/webm', 'image/jpeg']
      where id = 'consequence-clips'
    $sql$;
  end if;
end;
$$;

insert into app_private.schema_versions (version) values (56);
