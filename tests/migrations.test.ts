import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../supabase/migrations/20260907000000_execution_baseline.sql",
  import.meta.url,
);

describe("first migration", () => {
  it("applies forward from an empty PostgreSQL database", async () => {
    const db = new PGlite();
    const migration = await readFile(migrationPath, "utf8");
    await db.exec("create role anon; create role authenticated;");
    await db.exec(migration);

    const result = await db.query<{ version: number }>(
      "select version from app_private.schema_versions",
    );
    expect(result.rows).toEqual([{ version: 1 }]);
    await db.close();
  });

  it("leaves the previous public surface unchanged", async () => {
    const db = new PGlite();
    await db.exec(
      "create role anon; create role authenticated; create table public.previous_client_probe (value text);",
    );
    const migration = await readFile(migrationPath, "utf8");
    await db.exec(migration);

    await db.exec(
      "insert into public.previous_client_probe values ('compatible')",
    );
    const result = await db.query<{ value: string }>(
      "select value from public.previous_client_probe",
    );
    expect(result.rows).toEqual([{ value: "compatible" }]);
    await db.close();
  });
});
