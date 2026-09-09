import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const group = "10000000-0000-4000-8000-000000000001";
const otherGroup = "10000000-0000-4000-8000-000000000002";
const adminAuth = "30000000-0000-4000-8000-000000000001";
const peerAuth = "30000000-0000-4000-8000-000000000002";
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
      ('20000000-0000-4000-8000-000000000001', '${adminAuth}', 'admin@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000002', '${peerAuth}', 'peer@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000003', '${outsiderAuth}', 'out@example.test', '2026-03-01Z');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
      ('${group}', 'Friends', 'UTC', 'active', '2026-03-02T12:00Z'),
      ('${otherGroup}', 'Other', 'UTC', 'setup', null);
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '${group}', '2026-03-01T12:00Z', 3),
      ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '${group}', '2026-03-04T12:00Z', 2);
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('50000000-0000-4000-8000-000000000001', '${group}', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02T12:00Z'),
      ('50000000-0000-4000-8000-000000000002', '${group}', '2026-03-09Z', '2026-03-16Z', 'UTC', null);
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 3, '2026-03-02T12:00Z'),
      ('60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 2, '2026-03-04T12:00Z'),
      ('60000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 4, '2026-03-09Z');
  `);
  return db;
}

async function auth(db: PGlite, authId: string) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-05T10:00Z",
  ]);
}

function submit() {
  return `select * from app_private.submit_workout_checkin(
    '70000000-0000-4000-8000-000000000001', '${"a".repeat(64)}',
    '70000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003',
    'cardio', '2026-03-05T09:00Z', 30, 'moderate', true,
    '2026-03-05T10:00Z')`;
}

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("True-MVP workout check-ins", () => {
  it("counts an attested structured check-in immediately and replays it exactly once", async () => {
    const db = await database();
    await auth(db, adminAuth);
    await db.exec("set role service_role");
    expect((await db.query(submit())).rows).toEqual([
      {
        workout_checkin_id: "70000000-0000-4000-8000-000000000003",
        current_week_count: 1,
      },
    ]);
    await expect(
      db.query(submit().replace("a".repeat(64), "b".repeat(64))),
    ).rejects.toThrow("different request");
    expect((await db.query(submit())).rows).toEqual([
      {
        workout_checkin_id: "70000000-0000-4000-8000-000000000003",
        current_week_count: 1,
      },
    ]);
    await db.exec("reset role");
    expect(
      (
        await db.query(
          "select count(*)::integer as count from app_private.workout_checkins",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    const columns = await db.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'app_private' and table_name = 'workout_checkins'
      order by ordinal_position`);
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "workout_checkin_id",
      "member_week_id",
      "membership_id",
      "activity_type",
      "completed_at",
      "duration_minutes",
      "perceived_intensity",
      "self_report_attested",
      "submitted_at",
    ]);
  });

  it("rejects missing attestation, future, pre-membership, cross-week, and pre-activation completions", async () => {
    const db = await database();
    await auth(db, adminAuth);
    await db.exec("set role service_role");
    for (const [sql, message] of [
      [
        submit().replace("'moderate', true", "'moderate', false"),
        "attestation",
      ],
      [submit().replace("2026-03-05T09:00Z", "2026-03-05T11:00Z"), "future"],
      [
        submit().replace("2026-03-05T09:00Z", "2026-02-28T09:00Z"),
        "membership",
      ],
      [
        submit()
          .replace("2026-03-05T09:00Z", "2026-03-08T09:00Z")
          .replace("'2026-03-05T10:00Z'", "'2026-03-10T10:00Z'"),
        "assigned accountability week",
      ],
      [
        submit().replace("2026-03-05T09:00Z", "2026-03-02T09:00Z"),
        "assigned accountability week",
      ],
    ] as const) {
      await expect(db.query(sql)).rejects.toThrow(message);
    }
  });

  it("rejects submission after departure and has no active member-week fallback", async () => {
    const db = await database();
    await db.exec(`update app_private.memberships set ended_at = '2026-03-05T09:30Z', end_reason = 'left'
      where membership_id = '40000000-0000-4000-8000-000000000001'`);
    await auth(db, adminAuth);
    await db.exec("set role service_role");
    await expect(db.query(submit())).rejects.toThrow(
      "current membership required",
    );
  });

  it("returns each current member's locked target and count only to current Group members", async () => {
    const db = await database();
    await auth(db, adminAuth);
    await db.exec("set role service_role");
    await db.query(submit());
    await db.exec("reset role; set role authenticated");
    expect(
      (
        await db.query(
          `select * from app_private.current_week_progress('${group}', '2026-03-05T10:00Z')`,
        )
      ).rows,
    ).toEqual([
      {
        membership_id: "40000000-0000-4000-8000-000000000001",
        locked_target: 3,
        completed_workout_count: 1,
      },
      {
        membership_id: "40000000-0000-4000-8000-000000000002",
        locked_target: 2,
        completed_workout_count: 0,
      },
    ]);
    await db.exec("reset role");
    await auth(db, outsiderAuth);
    await db.exec("set role authenticated");
    await expect(
      db.query(
        `select * from app_private.current_week_progress('${group}', '2026-03-05T10:00Z')`,
      ),
    ).rejects.toThrow("current Group membership required");
    await expect(
      db.query(
        `select * from app_private.current_week_progress('${otherGroup}', '2026-03-05T10:00Z')`,
      ),
    ).rejects.toThrow("current Group membership required");
  });
});
