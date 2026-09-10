import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const deletedAccount = "20000000-0000-4000-8000-000000000001";
const deletedAuth = "30000000-0000-4000-8000-000000000001";
const deletedMembership = "40000000-0000-4000-8000-000000000001";
const olderPeerMembership = "40000000-0000-4000-8000-000000000002";
const newerPeerMembership = "40000000-0000-4000-8000-000000000003";
const group = "10000000-0000-4000-8000-000000000001";

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
    insert into app_private.accounts
      (account_id, auth_user_id, email, adult_attested_at) values
      ('${deletedAccount}', '${deletedAuth}', 'delete-me@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'older@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'newer@example.test', '2026-03-01Z');
    insert into app_private.groups
      (group_id, name, time_zone, status, activation_at) values
      ('${group}', 'Friends', 'UTC', 'active', '2026-03-02T12:00Z');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('${deletedMembership}', '${deletedAccount}', '${group}', '2026-03-01Z', 3),
      ('${olderPeerMembership}', '20000000-0000-4000-8000-000000000002', '${group}', '2026-03-02Z', 2),
      ('${newerPeerMembership}', '20000000-0000-4000-8000-000000000003', '${group}', '2026-03-03Z', 2);
    insert into app_private.group_admins (membership_id) values ('${deletedMembership}');
    insert into app_private.group_invitations
      (invitation_id, group_id, email, token_digest, issued_by_membership_id, issued_at, expires_at) values
      ('50000000-0000-4000-8000-000000000001', '${group}', 'pending@example.test', '${"a".repeat(64)}', '${deletedMembership}', '2026-03-04Z', '2026-03-11Z'),
      ('50000000-0000-4000-8000-000000000002', '${group}', 'expired@example.test', '${"b".repeat(64)}', '${deletedMembership}', '2026-02-20Z', '2026-02-27Z'),
      ('50000000-0000-4000-8000-000000000003', '${group}', 'delete-me@example.test', '${"e".repeat(64)}', '${olderPeerMembership}', '2026-03-04Z', '2026-03-11Z');
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('60000000-0000-4000-8000-000000000001', '${group}', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02T12:00Z'),
      ('60000000-0000-4000-8000-000000000002', '${group}', '2026-02-23Z', '2026-03-02Z', 'UTC', '2026-02-23Z');
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at, status) values
      ('61000000-0000-4000-8000-000000000001', '${deletedMembership}', '60000000-0000-4000-8000-000000000001', 3, '2026-03-02Z', 'active'),
      ('61000000-0000-4000-8000-000000000002', '${deletedMembership}', '60000000-0000-4000-8000-000000000002', 3, '2026-02-23Z', 'attained'),
      ('61000000-0000-4000-8000-000000000003', '${olderPeerMembership}', '60000000-0000-4000-8000-000000000002', 2, '2026-02-23Z', 'missed');
    insert into app_private.workout_checkins
      (workout_checkin_id, member_week_id, membership_id, activity_type, completed_at,
       duration_minutes, perceived_intensity, self_report_attested, submitted_at) values
      ('62000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002',
       '${deletedMembership}', 'strength', '2026-02-25Z', 30, 'moderate', true, '2026-02-25Z');
  `);
  return db;
}

async function auth(db: PGlite, authId = deletedAuth) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-05T10:00:01Z",
  ]);
}

function command(hash = "c".repeat(64), confirmed = true) {
  return `select app_private.delete_account_command(
    '70000000-0000-4000-8000-000000000001', '${hash}',
    '70000000-0000-4000-8000-000000000002', ${confirmed},
    '2026-03-05T10:00Z') as account_id`;
}

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("True-MVP Account deletion", () => {
  it("requires an authenticated active actor and explicit confirmation", async () => {
    const db = await database();
    await expect(db.query(command())).rejects.toThrow(
      "active account required",
    );
    await auth(db);
    await expect(db.query(command("c".repeat(64), false))).rejects.toThrow(
      "Account deletion confirmation required",
    );
    await db.exec("reset role");
    expect(
      (
        await db.query(`select status, email from app_private.accounts
        where account_id = '${deletedAccount}'`)
      ).rows,
    ).toEqual([{ status: "active", email: "delete-me@example.test" }]);
  });

  it("atomically anonymizes self, ends membership, revokes invitations, and promotes longest-tenured peer", async () => {
    const db = await database();
    await auth(db);
    expect((await db.query(command())).rows).toEqual([
      { account_id: deletedAccount },
    ]);
    await db.exec("reset role");
    expect(
      (
        await db.query(`select status, email, adult_attested_at, access_cutoff
        from app_private.accounts where account_id = '${deletedAccount}'`)
      ).rows,
    ).toEqual([
      {
        status: "deleted",
        email: `deleted-${deletedAccount}@deleted.invalid`,
        adult_attested_at: null,
        access_cutoff: new Date("2026-03-05T10:00:00.000Z"),
      },
    ]);
    expect(
      (
        await db.query(`select ended_at, end_reason from app_private.memberships
        where membership_id = '${deletedMembership}'`)
      ).rows,
    ).toEqual([
      {
        ended_at: new Date("2026-03-05T10:00:00.000Z"),
        end_reason: "account_deleted",
      },
    ]);
    expect(
      (await db.query("select membership_id from app_private.group_admins"))
        .rows,
    ).toEqual([{ membership_id: olderPeerMembership }]);
    expect(
      (
        await db.query(`select status, email from app_private.group_invitations
        order by invitation_id`)
      ).rows,
    ).toEqual([
      { status: "revoked", email: "pending@example.test" },
      { status: "revoked", email: "expired@example.test" },
      {
        status: "revoked",
        email: `deleted-${deletedAccount}@deleted.invalid`,
      },
    ]);
    expect(
      (
        await db.query(`select status from app_private.member_weeks
        order by member_week_id`)
      ).rows,
    ).toEqual([
      { status: "ended_without_result" },
      { status: "attained" },
      { status: "missed" },
    ]);
    expect(
      (
        await db.query(`select workout_checkin_id, duration_minutes
        from app_private.workout_checkins`)
      ).rows,
    ).toEqual([
      {
        workout_checkin_id: "62000000-0000-4000-8000-000000000001",
        duration_minutes: 30,
      },
    ]);
  });

  it("replays stable result after deletion and rejects changed-body key reuse", async () => {
    const db = await database();
    await auth(db);
    const first = (await db.query(command())).rows;
    expect((await db.query(command())).rows).toEqual(first);
    await expect(db.query(command("d".repeat(64)))).rejects.toThrow(
      "different request hash",
    );
    await db.exec("reset role");
    expect(
      (
        await db.query(`select count(*)::integer as count
        from app_private.departure_cleanup_receipts
        where membership_id = '${deletedMembership}'`)
      ).rows,
    ).toEqual([{ count: 1 }]);
  });

  it("closes an emptied Group and leaves finalized history unchanged", async () => {
    const db = await database();
    await db.exec(`
      delete from app_private.group_invitations
        where issued_by_membership_id <> '${deletedMembership}';
      delete from app_private.member_weeks where membership_id <> '${deletedMembership}';
      delete from app_private.group_admins where membership_id <> '${deletedMembership}';
      delete from app_private.memberships where membership_id <> '${deletedMembership}';
    `);
    await auth(db);
    await db.query(command());
    await db.exec("reset role");
    expect(
      (
        await db.query(`select status, closed_at from app_private.groups
        where group_id = '${group}'`)
      ).rows,
    ).toEqual([
      { status: "closed", closed_at: new Date("2026-03-05T10:00:00.000Z") },
    ]);
    expect(
      (
        await db.query(`select status from app_private.member_weeks
        order by member_week_id`)
      ).rows,
    ).toEqual([{ status: "ended_without_result" }, { status: "attained" }]);
  });

  it("keeps tables and command unavailable to public, anon, and authenticated roles", async () => {
    const db = await database();
    const privileges = await db.query(`select
      has_function_privilege('public', 'app_private.delete_account_command(uuid,text,uuid,boolean,timestamptz)', 'execute') as public_execute,
      has_function_privilege('anon', 'app_private.delete_account_command(uuid,text,uuid,boolean,timestamptz)', 'execute') as anon_execute,
      has_function_privilege('authenticated', 'app_private.delete_account_command(uuid,text,uuid,boolean,timestamptz)', 'execute') as authenticated_execute,
      has_function_privilege('service_role', 'app_private.delete_account_command(uuid,text,uuid,boolean,timestamptz)', 'execute') as service_execute,
      has_table_privilege('public', 'app_private.accounts', 'select') as public_table,
      has_table_privilege('anon', 'app_private.accounts', 'select') as anon_table,
      has_table_privilege('authenticated', 'app_private.accounts', 'select') as authenticated_table`);
    expect(privileges.rows).toEqual([
      {
        public_execute: false,
        anon_execute: false,
        authenticated_execute: false,
        service_execute: true,
        public_table: false,
        anon_table: false,
        authenticated_table: false,
      },
    ]);
  });
});
