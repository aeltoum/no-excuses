import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const group = "10000000-0000-4000-8000-000000000001";
const otherGroup = "10000000-0000-4000-8000-000000000002";
const memberAuth = "30000000-0000-4000-8000-000000000001";
const outsiderAuth = "30000000-0000-4000-8000-000000000003";

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
      ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'peer@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000003', '${outsiderAuth}', 'outside@example.test', '2026-03-01Z');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
      ('${group}', 'Friends', 'UTC', 'active', '2026-03-02Z'),
      ('${otherGroup}', 'Other', 'UTC', 'active', '2026-03-02Z');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '${group}', '2026-03-01Z', 2),
      ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '${group}', '2026-03-01Z', 2);
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('50000000-0000-4000-8000-000000000001', '${group}', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02Z'),
      ('50000000-0000-4000-8000-000000000002', '${group}', '2026-03-09Z', '2026-03-16Z', 'UTC', null);
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 2, '2026-03-02Z'),
      ('60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 2, '2026-03-02Z'),
      ('60000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 2, '2026-03-09Z');
    insert into app_private.workout_checkins
      (workout_checkin_id, member_week_id, membership_id, activity_type, completed_at,
       duration_minutes, perceived_intensity, self_report_attested, submitted_at) values
      ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'cardio', '2026-03-03Z', 30, 'moderate', true, '2026-03-03Z'),
      ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'strength', '2026-03-05Z', 40, 'high', true, '2026-03-05Z'),
      ('70000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'class', '2026-03-04Z', 45, 'moderate', true, '2026-03-04Z');
  `);
  return db;
}

async function auth(db: PGlite, authId: string) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-10T10:00Z",
  ]);
}

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("True-MVP weekly settlement", () => {
  it("finalizes ended active weeks from locked target and self-reported count exactly once", async () => {
    const db = await database();
    await db.exec("set role service_role");
    expect(
      (
        await db.query(
          "select app_private.finalize_ended_member_weeks('2026-03-09Z') as count",
        )
      ).rows,
    ).toEqual([{ count: 2 }]);
    expect(
      (
        await db.query(
          "select app_private.finalize_ended_member_weeks('2026-03-10Z') as count",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    await db.exec("reset role");
    expect(
      (
        await db.query(`select m.membership_id, m.target_streak,
          count(u.card_unlock_id)::integer as unlocks
          from app_private.memberships m
          join app_private.accounts a using (account_id)
          left join app_private.card_unlocks u using (account_id)
          where m.membership_id in (
            '40000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000002'
          ) group by m.membership_id, m.target_streak order by m.membership_id`)
      ).rows,
    ).toEqual([
      {
        membership_id: "40000000-0000-4000-8000-000000000001",
        target_streak: 1,
        unlocks: 1,
      },
      {
        membership_id: "40000000-0000-4000-8000-000000000002",
        target_streak: 0,
        unlocks: 0,
      },
    ]);
    expect(
      (
        await db.query(`select member_week_id, status from app_private.member_weeks
          order by member_week_id`)
      ).rows,
    ).toEqual([
      {
        member_week_id: "60000000-0000-4000-8000-000000000001",
        status: "attained",
      },
      {
        member_week_id: "60000000-0000-4000-8000-000000000002",
        status: "missed",
      },
      {
        member_week_id: "60000000-0000-4000-8000-000000000003",
        status: "active",
      },
    ]);
  });

  it("does not finalize before week end or rewrite terminal outcomes", async () => {
    const db = await database();
    await db.exec(`update app_private.member_weeks set status = 'attained'
      where member_week_id = '60000000-0000-4000-8000-000000000002';
      set role service_role;`);
    expect(
      (
        await db.query(
          "select app_private.finalize_ended_member_weeks('2026-03-08T23:59:59Z') as count",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await db.query(
          "select app_private.finalize_ended_member_weeks('2026-03-09Z') as count",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    await db.exec("reset role");
    expect(
      (
        await db.query(`select status from app_private.member_weeks
          where member_week_id = '60000000-0000-4000-8000-000000000002'`)
      ).rows,
    ).toEqual([{ status: "attained" }]);
  });

  it("keeps departed member unfinished weeks ended without result", async () => {
    const db = await database();
    await auth(db, "30000000-0000-4000-8000-000000000002");
    await db.exec("set role service_role");
    await db.query(`select app_private.leave_group_command(
      '80000000-0000-4000-8000-000000000001', '${"a".repeat(64)}',
      '80000000-0000-4000-8000-000000000002', '2026-03-08Z')`);
    expect(
      (
        await db.query(
          "select app_private.finalize_ended_member_weeks('2026-03-09Z') as count",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    await db.exec("reset role");
    expect(
      (
        await db.query(`select status from app_private.member_weeks
          where member_week_id = '60000000-0000-4000-8000-000000000002'`)
      ).rows,
    ).toEqual([{ status: "ended_without_result" }]);
  });

  it("returns finalized Group history only to current Group members", async () => {
    const db = await database();
    await db.exec("set role service_role");
    await db.query(
      "select app_private.finalize_ended_member_weeks('2026-03-09Z')",
    );
    await db.exec("reset role");
    await auth(db, memberAuth);
    await db.exec("set role authenticated");
    await expect(
      db.query("select app_private.finalize_ended_member_weeks('2026-03-16Z')"),
    ).rejects.toThrow("permission denied");
    expect(
      (
        await db.query(
          `select * from app_private.finalized_weekly_history('${group}')`,
        )
      ).rows,
    ).toEqual([
      {
        membership_id: "40000000-0000-4000-8000-000000000001",
        starts_at: new Date("2026-03-02T00:00:00.000Z"),
        ends_at: new Date("2026-03-09T00:00:00.000Z"),
        locked_target: 2,
        completed_workout_count: 2,
        outcome: "attained",
      },
      {
        membership_id: "40000000-0000-4000-8000-000000000002",
        starts_at: new Date("2026-03-02T00:00:00.000Z"),
        ends_at: new Date("2026-03-09T00:00:00.000Z"),
        locked_target: 2,
        completed_workout_count: 1,
        outcome: "missed",
      },
    ]);
    await expect(
      db.query(
        `select * from app_private.finalized_weekly_history('${otherGroup}')`,
      ),
    ).rejects.toThrow("current Group membership required");
    await db.exec("reset role");
    await auth(db, outsiderAuth);
    await db.exec("set role authenticated");
    await expect(
      db.query(
        `select * from app_private.finalized_weekly_history('${group}')`,
      ),
    ).rejects.toThrow("current Group membership required");
  });

  it("hides weeks fully before current membership but includes an overlapping week", async () => {
    const db = await database();
    await db.exec(`
      update app_private.memberships set joined_at = '2026-03-02Z'
      where membership_id = '40000000-0000-4000-8000-000000000001';
      insert into app_private.accountability_weeks
        (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at)
      values ('50000000-0000-4000-8000-000000000004', '${group}',
        '2026-02-23Z', '2026-03-02Z', 'UTC', '2026-02-23Z');
      insert into app_private.member_weeks
        (member_week_id, membership_id, accountability_week_id, target, target_locked_at, status)
      values ('60000000-0000-4000-8000-000000000004',
        '40000000-0000-4000-8000-000000000002',
        '50000000-0000-4000-8000-000000000004', 2, '2026-02-23Z', 'missed');
      set role service_role;
      select app_private.finalize_ended_member_weeks('2026-03-09Z');
      reset role;
    `);
    await auth(db, memberAuth);
    await db.exec("set role authenticated");

    const history = await db.query<{
      ends_at: Date;
      membership_id: string;
    }>(`select ends_at, membership_id
      from app_private.finalized_weekly_history('${group}')`);
    expect(history.rows).toEqual([
      {
        ends_at: new Date("2026-03-09T00:00:00.000Z"),
        membership_id: "40000000-0000-4000-8000-000000000001",
      },
      {
        ends_at: new Date("2026-03-09T00:00:00.000Z"),
        membership_id: "40000000-0000-4000-8000-000000000002",
      },
    ]);
  });
});
