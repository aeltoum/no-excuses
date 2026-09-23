import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const memberAuth = "30000000-0000-4000-8000-000000000001";
const peerAuth = "30000000-0000-4000-8000-000000000002";
const outsiderAuth = "30000000-0000-4000-8000-000000000003";

async function database() {
  const db = new PGlite();
  opened.push(db);
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const file of (await readdir(migrationsDirectory)).sort())
    await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
  await db.exec(`
    insert into app_private.accounts
      (account_id, auth_user_id, email, adult_attested_at) values
      ('20000000-0000-4000-8000-000000000001', '${memberAuth}', 'member@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000002', '${peerAuth}', 'peer@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000003', '${outsiderAuth}', 'out@example.test', '2026-03-01Z');
    insert into app_private.groups
      (group_id, name, time_zone, week_starts, status, activation_at) values
      ('10000000-0000-4000-8000-000000000001', 'Friends', 'America/Chicago', 1, 'active', '2026-03-02T12:00Z'),
      ('10000000-0000-4000-8000-000000000002', 'Solo', 'UTC', 1, 'setup', null);
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-03-01Z', 4),
      ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '2026-03-01Z', 2);
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-03-02T06:00Z', '2026-03-09T05:00Z', 'America/Chicago', '2026-03-02T12:00Z');
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 3, '2026-03-02T12:00Z');
  `);
  return db;
}

async function authenticate(db: PGlite, authId: string) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-05T10:00Z",
  ]);
}

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("Weekly target context read", () => {
  it("returns only actor target state and authoritative Group boundary", async () => {
    const db = await database();
    await authenticate(db, memberAuth);
    expect(
      (
        await db.query(
          "select * from app_private.weekly_target_context('2026-03-05T10:00Z')",
        )
      ).rows,
    ).toEqual([
      {
        membership_id: "40000000-0000-4000-8000-000000000001",
        recurring_target: 4,
        locked_target: 3,
        next_week_starts_at: new Date("2026-03-09T05:00:00.000Z"),
        member_count: 2,
        time_zone: "America/Chicago",
      },
    ]);

    await authenticate(db, outsiderAuth);
    expect(
      (
        await db.query(
          "select * from app_private.weekly_target_context('2026-03-05T10:00Z')",
        )
      ).rows,
    ).toEqual([]);
  });

  it("returns no target state without an authenticated actor", async () => {
    const db = await database();
    expect(
      (
        await db.query(
          "select * from app_private.weekly_target_context('2026-03-05T10:00Z')",
        )
      ).rows,
    ).toEqual([]);
  });
});
