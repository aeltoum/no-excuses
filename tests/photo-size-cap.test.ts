import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migrations = new URL("../supabase/migrations/", import.meta.url);

it("caps proof photos at 1 MB of JPEG in storage", async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text, name text, metadata jsonb,
      created_at timestamptz);`);
  for (const file of (await readdir(migrations)).sort())
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
  const { rows } = await db.query(
    "select id, file_size_limit, allowed_mime_types from storage.buckets order by id",
  );
  expect(rows).toContainEqual({
    id: "proof-photos",
    file_size_limit: 1048576,
    allowed_mime_types: ["image/jpeg"],
  });
  await db.close();
});
