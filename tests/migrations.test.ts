import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

async function migratedDatabase() {
  const db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const file of (await readdir(migrationsDirectory)).sort()) {
    await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
  }
  return db;
}

describe("migrations", () => {
  it("applies forward from an empty PostgreSQL-compatible database", async () => {
    const db = await migratedDatabase();

    const result = await db.query<{ version: number }>(
      "select version from app_private.schema_versions order by version",
    );
    expect(result.rows).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
    ]);
    await db.close();
  });

  it("leaves the previous public surface unchanged", async () => {
    const db = new PGlite();
    await db.exec(
      "create role anon; create role authenticated; create role service_role; create table public.previous_client_probe (value text);",
    );
    for (const file of (await readdir(migrationsDirectory)).sort()) {
      await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
    }

    await db.exec(
      "insert into public.previous_client_probe values ('compatible')",
    );
    const result = await db.query<{ value: string }>(
      "select value from public.previous_client_probe",
    );
    expect(result.rows).toEqual([{ value: "compatible" }]);
    await db.close();
  });

  it("replays a matching idempotency key and rejects a different request hash", async () => {
    const db = await migratedDatabase();
    const claim = `select * from app_private.claim_idempotent_request(
      '018f63c2-7d33-7f54-9fa7-9f55d735ae35', '${"a".repeat(64)}',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae36', '018f63c2-7d33-7f54-9fa7-9f55d735ae37')`;
    expect((await db.query(claim)).rows).toEqual([
      { state: "claimed", response: null },
    ]);
    expect((await db.query(claim)).rows).toEqual([
      { state: "claimed", response: null },
    ]);
    await expect(
      db.query(claim.replace("a".repeat(64), "b".repeat(64))),
    ).rejects.toThrow("different request hash");
    await db.close();
  });

  it("retries failed work once and replays its stable completed response", async () => {
    const db = await migratedDatabase();
    const key = "018f63c2-7d33-7f54-9fa7-9f55d735ae38";
    const requestHash = "c".repeat(64);
    const claim = `select * from app_private.claim_idempotent_request(
      '${key}', '${requestHash}',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae39',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae40')`;

    await db.exec("begin");
    await db.query(claim);
    await db.exec(`insert into app_private.domain_events
      (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
      values ('018f63c2-7d33-7f54-9fa7-9f55d735ae41',
        '018f63c2-7d33-7f54-9fa7-9f55d735ae42', 0, 'retry.recorded', now(), '{}')`);
    await db.exec("rollback");

    await db.exec("begin");
    expect((await db.query(claim)).rows).toEqual([
      { state: "claimed", response: null },
    ]);
    await db.exec(`insert into app_private.domain_events
      (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
      values ('018f63c2-7d33-7f54-9fa7-9f55d735ae41',
        '018f63c2-7d33-7f54-9fa7-9f55d735ae42', 0, 'retry.recorded', now(), '{}');
      insert into app_private.outbox (event_id)
        values ('018f63c2-7d33-7f54-9fa7-9f55d735ae41');`);
    const completed = await db.query<{ response: { receipt: string } }>(`
      select app_private.complete_idempotent_request(
        '${key}', '${requestHash}', '{"receipt":"stable"}'::jsonb
      ) as response`);
    expect(completed.rows).toEqual([{ response: { receipt: "stable" } }]);
    await db.exec("commit");

    expect((await db.query(claim)).rows).toEqual([
      { state: "completed", response: { receipt: "stable" } },
    ]);
    const replay = await db.query<{ response: { receipt: string } }>(`
      select app_private.complete_idempotent_request(
        '${key}', '${requestHash}', '{"receipt":"different"}'::jsonb
      ) as response`);
    expect(replay.rows).toEqual([{ response: { receipt: "stable" } }]);
    const effects = await db.query<{ count: number }>(
      "select count(*)::integer as count from app_private.domain_events",
    );
    expect(effects.rows).toEqual([{ count: 1 }]);
    await db.close();
  });

  it("commits domain events and outbox work atomically", async () => {
    const db = await migratedDatabase();
    await db.exec(`begin;
      insert into app_private.domain_events
        (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
      values ('018f63c2-7d33-7f54-9fa7-9f55d735ae35',
        '018f63c2-7d33-7f54-9fa7-9f55d735ae36', 0, 'example.recorded', now(), '{}');
      insert into app_private.outbox (event_id)
        values ('018f63c2-7d33-7f54-9fa7-9f55d735ae35');
      commit;`);
    const result = await db.query<{ events: number; work: number }>(`
      select (select count(*)::integer from app_private.domain_events) as events,
        (select count(*)::integer from app_private.outbox) as work`);
    expect(result.rows).toEqual([{ events: 1, work: 1 }]);
    await db.close();
  });

  it("rolls back the event when its outbox write fails", async () => {
    const db = await migratedDatabase();
    await db.exec("begin");
    await db.exec(`insert into app_private.domain_events
      (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
      values ('018f63c2-7d33-7f54-9fa7-9f55d735ae35',
        '018f63c2-7d33-7f54-9fa7-9f55d735ae36', 0, 'example.recorded', now(), '{}')`);
    await expect(
      db.exec(
        "insert into app_private.outbox (event_id) values ('018f63c2-7d33-7f54-9fa7-9f55d735ae37')",
      ),
    ).rejects.toThrow();
    await db.exec("rollback");
    const result = await db.query<{ count: number }>(
      "select count(*)::integer as count from app_private.domain_events",
    );
    expect(result.rows).toEqual([{ count: 0 }]);
    await db.close();
  });
});
