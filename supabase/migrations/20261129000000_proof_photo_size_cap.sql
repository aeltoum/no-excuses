-- Storage and egress control (2026-11-22): the client now encodes proof photos and avatars
-- at most 1280 px on the long edge as JPEG within a ~300 KB budget (Supabase Free has 1 GB
-- storage, 5 GB egress and no image transforms). 1 MB leaves room for older clients, which
-- encoded 1600 px at quality 0.8, while stopping any client from storing 2 MB photos.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $sql$
      update storage.buckets
      set file_size_limit = 1048576, allowed_mime_types = array['image/jpeg']
      where id = 'proof-photos'
    $sql$;
  end if;
end;
$$;

insert into app_private.schema_versions (version) values (62);
