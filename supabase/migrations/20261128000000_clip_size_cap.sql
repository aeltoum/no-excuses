-- Egress control (2026-11-11): three Consequence clips at about 5 MB each were served
-- about 800 times in one day, most of the Free plan's 5 GB monthly egress. The client now
-- records at 640x480 and about 700 kbps (about 2.6 MB for the full 30 seconds) and never
-- downloads a clip before play is tapped. This cap keeps any client from uploading more.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $sql$
      update storage.buckets set file_size_limit = 4194304 where id = 'consequence-clips'
    $sql$;
  end if;
end;
$$;

insert into app_private.schema_versions (version) values (61);
