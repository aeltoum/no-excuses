// Generate a read-only catalog comparison for the two manually applied migrations.
// Run locally, then run its SQL in Supabase's SQL editor. This never connects to hosting.
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const directory = new URL("../supabase/migrations/", import.meta.url);
const files = (await readdir(directory))
  .sort()
  .filter((file) => file.slice(0, 14) <= "20261018000000");
const db = new PGlite();
await db.exec(
  "create role anon; create role authenticated; create role service_role;",
);
try {
  for (const file of files)
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  const functions = `select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as result, md5(p.prosrc) as body,
    p.prosecdef as definer, p.provolatile as volatility, p.proconfig as config,
    (select jsonb_agg(jsonb_build_array(r.rolname, has_function_privilege(r.oid,p.oid,'EXECUTE')) order by r.rolname)
      from pg_roles r where r.rolname in ('anon','authenticated','service_role')) as grants,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and p.proname in ('consequence_logging_blocked',
      'enforce_consequence_log_gate','consequence_home','consequence_command',
      'consequence_home_base','consequence_command_base','accept_group_invitation')`;
  const columns = `select table_name,column_name,ordinal_position,data_type,is_nullable,column_default
    from information_schema.columns where table_schema='app_private'
    and table_name in ('consequence_pause_requests','consequence_pause_votes')`;
  const constraints = `select c.relname,t.conname,pg_get_constraintdef(t.oid) as definition
    from pg_constraint t join pg_class c on c.oid=t.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app_private' and t.contype <> 'n' and c.relname in ('consequence_pause_requests','consequence_pause_votes')`;
  const indexes = `select tablename,indexname,indexdef from pg_indexes where schemaname='app_private'
    and tablename in ('consequence_pause_requests','consequence_pause_votes')`;
  const grants = `select c.relname,r.rolname,v.privilege,has_table_privilege(r.oid,c.oid,v.privilege) as allowed
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join pg_roles r cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
    where n.nspname='app_private' and c.relname in ('consequence_pause_requests','consequence_pause_votes')
      and r.rolname in ('anon','authenticated','service_role')`;
  const trigger = `select t.tgname,pg_get_triggerdef(t.oid) as definition,t.tgenabled
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app_private' and c.relname='workout_checkins' and t.tgname='workout_checkins_consequence_gate'`;
  const checks = [];
  for (const [name, sql] of Object.entries({
    functions,
    columns,
    constraints,
    indexes,
    grants,
    trigger,
  })) {
    const digest = `select md5(coalesce(jsonb_agg(to_jsonb(item) order by to_jsonb(item)::text),'[]'::jsonb)::text) as hash from (${sql}) item`;
    const { rows } = await db.query(digest);
    checks.push(`'${name}', ((${digest}) = '${rows[0].hash}')`);
  }
  const versions = files
    .filter((file) => file.slice(0, 14) < "20261017000000")
    .map((file) => `'${file.slice(0, 14)}'`)
    .join(",");
  checks.push(
    `'history', (select array_agg(version order by version) = array[${versions}] from supabase_migrations.schema_migrations)`,
  );
  checks.push(
    `'schema_versions', (select array_agg(version order by version) = array[${Array.from({ length: 22 }, (_, i) => i + 1).join(",")}] from app_private.schema_versions)`,
  );
  checks.push(`'midweek_repair', not exists (
    select 1 from app_private.memberships m
    join app_private.groups g on g.group_id=m.group_id and g.status='active'
    join app_private.accountability_weeks aw on aw.group_id=m.group_id
      and m.joined_at>=aw.starts_at and now()<aw.ends_at
    where m.ended_at is null and not exists (select 1 from app_private.member_weeks mw
      where mw.membership_id=m.membership_id and mw.accountability_week_id=aw.accountability_week_id))`);
  const sql = `begin read only;\nselect jsonb_build_object(\n${checks.join(",\n")}\n) as verification;\nrollback;`;
  if (process.argv.includes("--database")) {
    const { default: pg } = await import("pg");
    if (!process.env.SUPABASE_DB_URL)
      throw new Error("SUPABASE_DB_URL required");
    const client = new pg.Client({
      connectionString: process.env.SUPABASE_DB_URL,
      connectionTimeoutMillis: 15000,
      query_timeout: 30000,
    });
    try {
      await client.connect();
      const results = await client.query(sql);
      const verification = results[1]?.rows[0]?.verification;
      if (
        !verification ||
        Object.keys(verification).length !== checks.length ||
        Object.values(verification).some((value) => value !== true)
      ) {
        console.error("History verification failed", verification);
        throw new Error(
          "Hosted schema differs from committed migration effects; history unchanged",
        );
      }
      console.info("All migration history verification checks passed");
    } finally {
      await client.end();
    }
  } else console.info(sql);
} finally {
  await db.close();
}
