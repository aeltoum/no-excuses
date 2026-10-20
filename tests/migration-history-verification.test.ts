import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("accepts the exact committed schema and detects drift before history repair", {
  timeout: 30_000,
}, async () => {
  const sql = execFileSync(
    process.execPath,
    ["scripts/verify-migration-history.mjs"],
    { encoding: "utf8" },
  );
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);",
    );
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(directory)).sort()) {
      if (file.slice(0, 14) > "20261018000000") continue;
      await db.exec(await readFile(new URL(file, directory), "utf8"));
      if (file.slice(0, 14) < "20261017000000")
        await db.query(
          "insert into supabase_migrations.schema_migrations values ($1)",
          [file.slice(0, 14)],
        );
    }
    const verify = async () => {
      const results = await db.exec(sql);
      return results[1]?.rows[0]?.verification;
    };
    expect(await verify()).toEqual({
      functions: true,
      columns: true,
      constraints: true,
      indexes: true,
      grants: true,
      trigger: true,
      history: true,
      schema_versions: true,
      midweek_repair: true,
    });
    await db.exec(
      "alter table app_private.workout_checkins disable trigger workout_checkins_consequence_gate; grant select on app_private.consequence_pause_votes to authenticated;",
    );
    expect(await verify()).toMatchObject({ trigger: false, grants: false });
  } finally {
    await db.close();
  }
});
