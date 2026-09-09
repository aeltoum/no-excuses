import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];

async function migratedDatabase() {
  const db = new PGlite();
  opened.push(db);
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const file of (await readdir(migrationsDirectory)).sort()) {
    await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
  }
  return db;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

const ids = {
  group: "10000000-0000-4000-8000-000000000001",
  admin: "20000000-0000-4000-8000-000000000001",
  peer: "20000000-0000-4000-8000-000000000002",
  adminAuth: "30000000-0000-4000-8000-000000000001",
  peerAuth: "30000000-0000-4000-8000-000000000002",
  adminMembership: "40000000-0000-4000-8000-000000000001",
  peerMembership: "40000000-0000-4000-8000-000000000002",
  invitation: "50000000-0000-4000-8000-000000000001",
  session: "60000000-0000-4000-8000-000000000001",
  otherSession: "60000000-0000-4000-8000-000000000002",
};

const digest = "a".repeat(64);

async function authenticate(db: PGlite, authId: string, issuedAt: string) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    issuedAt,
  ]);
}

async function seedActiveGroup(db: PGlite) {
  await db.exec(`
    insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at) values
      ('${ids.admin}', '${ids.adminAuth}', 'admin@example.test', '2026-03-01Z'),
      ('${ids.peer}', '${ids.peerAuth}', 'peer@example.test', '2026-03-01Z');
    insert into app_private.consents (account_id, purpose, version, granted_at)
    select account_id, purpose, 'v1', '2026-03-01T00:00:00Z'
    from app_private.accounts
    cross join (values ('pilot'), ('product'), ('media')) as p(purpose);
  `);
  await db.query(`select app_private.create_group(
    '${ids.group}', '${ids.adminMembership}', '${ids.admin}', 'Friends',
    'America/Chicago', 3, '2026-03-04T18:00:00Z')`);
  await db.exec(`insert into app_private.group_invitations
    (invitation_id, group_id, email, token_digest, issued_by_membership_id, issued_at, expires_at)
    values ('${ids.invitation}', '${ids.group}', 'peer@example.test', '${digest}',
      '${ids.adminMembership}', '2026-03-04T18:01:00Z', '2026-03-11T18:01:00Z')`);
  await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
  await db.query(`select app_private.accept_group_invitation(
    '${digest}', '${ids.peerMembership}', 3, 2, '2026-03-05T18:00:00Z')`);
}

describe("M3 authoritative Workout-session lifecycle", () => {
  it("starts for the current member in the eligible activation Member-week", async () => {
    const db = await migratedDatabase();
    await seedActiveGroup(db);
    await db.query(`select app_private.start_workout_session(
      '${ids.session}', '${ids.peerMembership}', '2026-03-05T18:00:00Z')`);

    const result = await db.query(`select ws.workout_session_id, ws.started_at,
      ws.status, mw.membership_id, aw.activation_at
      from app_private.workout_sessions ws
      join app_private.member_weeks mw on mw.member_week_id = ws.member_week_id
      join app_private.accountability_weeks aw
        on aw.accountability_week_id = mw.accountability_week_id`);
    expect(result.rows).toEqual([
      {
        workout_session_id: ids.session,
        started_at: new Date("2026-03-05T18:00:00.000Z"),
        status: "active",
        membership_id: ids.peerMembership,
        activation_at: new Date("2026-03-05T18:00:00.000Z"),
      },
    ]);
  });

  it("rejects pre-membership and retroactive pre-activation starts", async () => {
    const db = await migratedDatabase();
    await seedActiveGroup(db);

    await expect(
      db.query(`select app_private.start_workout_session(
        '${ids.session}', '${ids.peerMembership}', '2026-03-05T17:59:59Z')`),
    ).rejects.toThrow("active Workout-session membership required");
    await authenticate(db, ids.adminAuth, "2026-03-05T18:00:00Z");
    await expect(
      db.query(`select app_private.start_workout_session(
        '${ids.session}', '${ids.adminMembership}', '2026-03-05T17:59:59Z')`),
    ).rejects.toThrow("active Workout-session membership required");
  });

  it("rejects ended Membership, paused accountability, and Target pending", async () => {
    const db = await migratedDatabase();
    await seedActiveGroup(db);

    await db.exec(`update app_private.memberships
      set ended_at = '2026-03-05T19:00:00Z', end_reason = 'left'
      where membership_id = '${ids.peerMembership}'`);
    await expect(
      db.query(`select app_private.start_workout_session(
        '${ids.session}', '${ids.peerMembership}', '2026-03-05T19:00:00Z')`),
    ).rejects.toThrow("active Workout-session membership required");

    await db.exec(`update app_private.memberships set ended_at = null, end_reason = null
      where membership_id = '${ids.peerMembership}';
      update app_private.groups set status = 'accountability_paused'
      where group_id = '${ids.group}'`);
    await expect(
      db.query(`select app_private.start_workout_session(
        '${ids.session}', '${ids.peerMembership}', '2026-03-05T19:00:00Z')`),
    ).rejects.toThrow("active Workout-session membership required");

    await db.exec(`update app_private.groups set status = 'active'
      where group_id = '${ids.group}';
      update app_private.member_weeks
      set target_pending_until = '2026-03-06T18:00:00Z'
      where membership_id = '${ids.peerMembership}'`);
    await expect(
      db.query(`select app_private.start_workout_session(
        '${ids.session}', '${ids.peerMembership}', '2026-03-05T19:00:00Z')`),
    ).rejects.toThrow("eligible Member-week with locked Target required");

    await db.exec(`update app_private.member_weeks
      set target_pending_until = null, status = 'ended_without_result'
      where membership_id = '${ids.peerMembership}'`);
    await expect(
      db.query(`select app_private.start_workout_session(
        '${ids.session}', '${ids.peerMembership}', '2026-03-05T19:00:00Z')`),
    ).rejects.toThrow("eligible Member-week with locked Target required");
  });

  it("enforces one active session per Membership and releases it after end", async () => {
    const db = await migratedDatabase();
    await seedActiveGroup(db);
    await db.query(`select app_private.start_workout_session(
      '${ids.session}', '${ids.peerMembership}', '2026-03-05T18:00:00Z')`);
    await expect(
      db.query(`select app_private.start_workout_session(
        '${ids.otherSession}', '${ids.peerMembership}', '2026-03-05T18:01:00Z')`),
    ).rejects.toThrow("duplicate key");

    await db.query(`select app_private.end_workout_session(
      '${ids.session}', '2026-03-05T19:00:00Z')`);
    await db.query(`select app_private.start_workout_session(
      '${ids.otherSession}', '${ids.peerMembership}', '2026-03-05T19:01:00Z')`);
    expect(
      (
        await db.query(`select count(*)::integer as active
          from app_private.workout_sessions where status = 'active'`)
      ).rows,
    ).toEqual([{ active: 1 }]);
  });

  it("makes start, accountability-week, and Member-week assignment immutable", async () => {
    const db = await migratedDatabase();
    await seedActiveGroup(db);
    await db.query(`select app_private.start_workout_session(
      '${ids.session}', '${ids.peerMembership}', '2026-03-05T18:00:00Z')`);

    await expect(
      db.exec(`update app_private.workout_sessions
        set started_at = '2026-03-05T18:01:00Z'
        where workout_session_id = '${ids.session}'`),
    ).rejects.toThrow("immutable");
    await expect(
      db.exec(`update app_private.workout_sessions
        set member_week_id = (select member_week_id from app_private.member_weeks
          where membership_id = '${ids.adminMembership}')
        where workout_session_id = '${ids.session}'`),
    ).rejects.toThrow("immutable");
    await expect(
      db.exec(`update app_private.workout_sessions
        set accountability_week_id = gen_random_uuid()
        where workout_session_id = '${ids.session}'`),
    ).rejects.toThrow("immutable");
  });

  it("ends manually, rejects an end before start, and expires at 12 hours", async () => {
    const db = await migratedDatabase();
    await seedActiveGroup(db);
    await db.query(`select app_private.start_workout_session(
      '${ids.session}', '${ids.peerMembership}', '2026-03-05T18:00:00Z')`);

    await expect(
      db.query(`select app_private.end_workout_session(
        '${ids.session}', '2026-03-05T17:59:59Z')`),
    ).rejects.toThrow("cannot end before");
    await db.query(`select app_private.end_workout_session(
      '${ids.session}', '2026-03-05T19:00:00Z')`);
    expect(
      (
        await db.query(`select status, ended_at from app_private.workout_sessions
          where workout_session_id = '${ids.session}'`)
      ).rows,
    ).toEqual([
      { status: "ended", ended_at: new Date("2026-03-05T19:00:00.000Z") },
    ]);

    await db.query(`select app_private.start_workout_session(
      '${ids.otherSession}', '${ids.peerMembership}', '2026-03-05T19:01:00Z')`);
    expect(
      (
        await db.query(
          "select app_private.expire_workout_sessions('2026-03-06T07:00:59Z') as expired",
        )
      ).rows,
    ).toEqual([{ expired: 0 }]);
    expect(
      (
        await db.query(
          "select app_private.expire_workout_sessions('2026-03-06T07:01:00Z') as expired",
        )
      ).rows,
    ).toEqual([{ expired: 1 }]);
    expect(
      (
        await db.query(`select status, ended_at from app_private.workout_sessions
          where workout_session_id = '${ids.otherSession}'`)
      ).rows,
    ).toEqual([
      { status: "expired", ended_at: new Date("2026-03-06T07:01:00.000Z") },
    ]);
  });
});
