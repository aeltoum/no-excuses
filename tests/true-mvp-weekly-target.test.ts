import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const memberAuth = "30000000-0000-4000-8000-000000000001";
const membership = "40000000-0000-4000-8000-000000000001";

async function database() {
  const db = new PGlite();
  opened.push(db);
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const file of (await readdir(migrationsDirectory)).sort()) {
    await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
  }
  await db.exec(`
    insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at) values
      ('20000000-0000-4000-8000-000000000001', '${memberAuth}', 'member@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'left@example.test', '2026-03-01Z');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
      ('10000000-0000-4000-8000-000000000001', 'Friends', 'UTC', 'active', '2026-03-02Z');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, ended_at, end_reason, recurring_target) values
      ('${membership}', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-03-01Z', null, null, 2),
      ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '2026-03-01Z', '2026-03-04Z', 'left', 2);
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02Z');
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      ('60000000-0000-4000-8000-000000000001', '${membership}', '50000000-0000-4000-8000-000000000001', 2, '2026-03-02Z');
  `);
  return db;
}

async function auth(db: PGlite, authId: string) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-05T10:00:01Z",
  ]);
}

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("True-MVP Weekly target command", () => {
  it("changes recurring target once without rewriting locked current-week target", async () => {
    const db = await database();
    await auth(db, memberAuth);
    const command = `select * from app_private.set_weekly_target_command(
      '018f63c2-7d33-7f54-9fa7-9f55d735ae35', '${"a".repeat(64)}',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae36', 4)`;
    expect((await db.query(command)).rows).toEqual([
      { membership_id: membership, weekly_target: 4 },
    ]);
    expect((await db.query(command)).rows).toEqual([
      { membership_id: membership, weekly_target: 4 },
    ]);
    expect(
      (
        await db.query(`select m.recurring_target, mw.target as locked_target
      from app_private.memberships m join app_private.member_weeks mw using (membership_id)
      where m.membership_id = '${membership}'`)
      ).rows,
    ).toEqual([{ recurring_target: 4, locked_target: 2 }]);
    await expect(
      db.query(command.replace("a".repeat(64), "b".repeat(64))),
    ).rejects.toThrow("different request hash");
  });

  it("fails closed for invalid targets and Accounts without current membership", async () => {
    const db = await database();
    await auth(db, memberAuth);
    await expect(
      db.query(`select * from app_private.set_weekly_target_command(
      '018f63c2-7d33-7f54-9fa7-9f55d735ae37', '${"c".repeat(64)}',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae38', 0)`),
    ).rejects.toThrow("weekly target must be positive");
    await auth(db, "30000000-0000-4000-8000-000000000002");
    await expect(
      db.query(`select * from app_private.set_weekly_target_command(
      '018f63c2-7d33-7f54-9fa7-9f55d735ae39', '${"d".repeat(64)}',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae40', 3)`),
    ).rejects.toThrow("Group action unavailable");
  });
});
