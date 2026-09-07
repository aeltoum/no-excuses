create schema if not exists app_private;

revoke all on schema app_private from public, anon, authenticated;

create table app_private.schema_versions (
  version integer primary key,
  applied_at timestamptz not null default transaction_timestamp(),
  constraint schema_versions_positive check (version > 0)
);

revoke all on table app_private.schema_versions from public, anon, authenticated;

insert into app_private.schema_versions (version) values (1);
