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
  otherGroup: "10000000-0000-4000-8000-000000000002",
  admin: "20000000-0000-4000-8000-000000000001",
  peer: "20000000-0000-4000-8000-000000000002",
  third: "20000000-0000-4000-8000-000000000003",
  adminAuth: "30000000-0000-4000-8000-000000000001",
  peerAuth: "30000000-0000-4000-8000-000000000002",
  thirdAuth: "30000000-0000-4000-8000-000000000003",
  adminMembership: "40000000-0000-4000-8000-000000000001",
  peerMembership: "40000000-0000-4000-8000-000000000002",
  thirdMembership: "40000000-0000-4000-8000-000000000003",
  invitation: "50000000-0000-4000-8000-000000000001",
};

const digest = "a".repeat(64);

async function seedAccounts(db: PGlite) {
  await db.exec(`
    insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at) values
      ('${ids.admin}', '${ids.adminAuth}', 'admin@example.test', '2026-03-01Z'),
      ('${ids.peer}', '${ids.peerAuth}', 'peer@example.test', '2026-03-01Z'),
      ('${ids.third}', '${ids.thirdAuth}', 'third@example.test', '2026-03-01Z');
    insert into app_private.consents (account_id, purpose, version, granted_at)
    select account_id, purpose, 'v1', '2026-03-01T00:00:00Z'
    from app_private.accounts
    cross join (values ('pilot'), ('product'), ('media')) as p(purpose);
  `);
}

async function seedSetupGroup(db: PGlite) {
  await seedAccounts(db);
  await db.query(`select app_private.create_group(
    '${ids.group}', '${ids.adminMembership}', '${ids.admin}', 'Friends',
    'America/Chicago', 3, '2026-03-04T18:00:00Z')`);
  await db.exec(`insert into app_private.group_invitations
    (invitation_id, group_id, email, token_digest, issued_by_membership_id, issued_at, expires_at)
    values ('${ids.invitation}', '${ids.group}', 'peer@example.test', '${digest}',
      '${ids.adminMembership}', '2026-03-04T18:01:00Z', '2026-03-11T18:01:00Z')`);
}

async function authenticate(db: PGlite, authId: string, issuedAt: string) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    issuedAt,
  ]);
}

describe("M2 identity, Group authority, and accountability calendar", () => {
  it("gates email OTP without consuming or exposing invitation state", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    const result = await db.query(`select
      app_private.can_begin_email_otp(' PEER@example.test ', '${digest}', '2026-03-05Z') as invited,
      app_private.can_begin_email_otp('unknown@example.test', '${digest}', '2026-03-05Z') as unknown,
      app_private.can_begin_email_otp('peer@example.test', '${"b".repeat(64)}', '2026-03-05Z') as existing`);
    expect(result.rows).toEqual([
      { invited: true, unknown: false, existing: true },
    ]);
    await db.exec(`update app_private.group_invitations set email = 'new@example.test'
      where invitation_id = '${ids.invitation}'`);
    expect(
      (
        await db.query(`select
      app_private.can_begin_email_otp('new@example.test', '${digest}', '2026-03-05Z') as invited,
      app_private.can_begin_email_otp('new@example.test', '${"b".repeat(64)}', '2026-03-05Z') as wrong_token`)
      ).rows,
    ).toEqual([{ invited: true, wrong_token: false }]);
    expect(
      (
        await db.query(`select status from app_private.group_invitations
      where invitation_id = '${ids.invitation}'`)
      ).rows,
    ).toEqual([{ status: "issued" }]);
  });

  it("default-denies business tables and exposes only focused role grants", async () => {
    const db = await migratedDatabase();
    const tableGrants = await db.query<{ count: number }>(`
      select count(*)::integer as count from information_schema.role_table_grants
      where table_schema = 'app_private' and grantee in ('anon', 'authenticated')`);
    expect(tableGrants.rows).toEqual([{ count: 0 }]);
    const enabled = await db.query<{ relrowsecurity: boolean }>(`
      select relrowsecurity from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app_private' and c.relname = 'memberships'`);
    expect(enabled.rows).toEqual([{ relrowsecurity: true }]);
    const serviceGrant = await db.query<{ allowed: boolean }>(`
      select has_function_privilege(
        'service_role',
        'app_private.accept_group_invitation(text,uuid,integer,integer,timestamptz)',
        'execute'
      ) as allowed`);
    expect(serviceGrant.rows).toEqual([{ allowed: true }]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select * from app_private.memberships"),
    ).rejects.toThrow("permission denied");
    expect(
      (
        await db.query(
          `select app_private.can_group_action('${ids.group}', 'group_read') as allowed`,
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
    await db.exec("reset role");
  });

  it("authorizes current peer/admin live; denies pre-join, cross-Group, operator, and unknown actions", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    expect(
      (
        await db.query(
          `select app_private.can_group_action('${ids.group}', 'group_read') as allowed`,
        )
      ).rows,
    ).toEqual([{ allowed: false }]);

    await db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 3, 2, '2026-03-05T18:00:00Z')`);
    expect(
      (
        await db.query(`select
      app_private.can_group_action('${ids.group}', 'group_read') as read,
      app_private.can_group_action('${ids.group}', 'peer_decision') as peer,
      app_private.can_group_action('${ids.group}', 'group_admin') as admin,
      app_private.can_group_action('${ids.otherGroup}', 'group_read') as cross_group`)
      ).rows,
    ).toEqual([{ read: true, peer: true, admin: false, cross_group: false }]);

    await authenticate(db, ids.adminAuth, "2026-03-05T18:00:00Z");
    expect(
      (
        await db.query(`select
      app_private.can_group_action('${ids.group}', 'group_admin') as admin,
      app_private.can_group_action('${ids.group}', 'peer_decision') as peer`)
      ).rows,
    ).toEqual([{ admin: true, peer: true }]);

    await db.exec(`insert into app_private.staff_assignments
      (assignment_id, account_id, role, starts_at)
      values ('60000000-0000-4000-8000-000000000001', '${ids.third}', 'operator', '2026-01-01Z')`);
    await authenticate(db, ids.thirdAuth, "2026-03-05T18:00:00Z");
    expect(
      (
        await db.query(`select
      app_private.can_group_action('${ids.group}', 'operator_assignment') as operator_assignment,
      app_private.can_group_action('${ids.group}', 'group_read') as group_read,
      app_private.can_group_action('${ids.group}', 'peer_decision') as peer`)
      ).rows,
    ).toEqual([{ operator_assignment: true, group_read: false, peer: false }]);
  });

  it("revokes departed and stale sessions, then treats return as a new membership", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    await db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 3, 2, '2026-03-05T18:00:00Z')`);
    await db.query(`select app_private.end_membership(
      '${ids.peerMembership}', 'left', '2026-03-06T12:00:00Z')`);
    expect(
      (
        await db.query(
          `select app_private.can_group_action('${ids.group}', 'group_read') as allowed`,
        )
      ).rows,
    ).toEqual([{ allowed: false }]);

    await db.exec(`update app_private.memberships set ended_at = '2026-03-07T12:00:00Z', end_reason = 'left'
      where membership_id = '${ids.adminMembership}';
      insert into app_private.memberships
        (membership_id, account_id, group_id, joined_at, recurring_target)
      values ('${ids.thirdMembership}', '${ids.peer}', '${ids.group}', '2026-03-08T12:00:00Z', 3);`);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    expect(
      (
        await db.query(
          `select app_private.can_group_action('${ids.group}', 'group_read') as allowed`,
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
    await authenticate(db, ids.peerAuth, "2026-03-08T12:00:01Z");
    expect(
      (
        await db.query(
          `select app_private.can_group_action('${ids.group}', 'group_read') as allowed`,
        )
      ).rows,
    ).toEqual([{ allowed: true }]);
  });

  it("accepts one normalized invitation once and activates membership, week, targets atomically", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    await db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 4, 2, '2026-03-05T18:00:00Z')`);
    const state = await db.query(`select
      (select status from app_private.groups where group_id = '${ids.group}') as group_status,
      (select count(*)::integer from app_private.memberships where group_id = '${ids.group}' and ended_at is null) as members,
      (select count(*)::integer from app_private.member_weeks) as member_weeks,
      (select count(*)::integer from app_private.group_invitations where status = 'accepted') as accepted`);
    expect(state.rows).toEqual([
      { group_status: "active", members: 2, member_weeks: 2, accepted: 1 },
    ]);
    await expect(
      db.query(`select app_private.accept_group_invitation(
      '${digest}', '40000000-0000-4000-8000-000000000099', 4, 2, '2026-03-05T18:00:01Z')`),
    ).rejects.toThrow("invitation unavailable");
  });

  it("keeps invitation unused when adult or consent admission gates fail", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    await db.exec(`update app_private.accounts set adult_attested_at = null
      where account_id = '${ids.peer}'`);
    await expect(
      db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 3, 2, '2026-03-05T18:00:00Z')`),
    ).rejects.toThrow("invitation unavailable");
    await db.exec(`update app_private.accounts set adult_attested_at = '2026-03-01Z'
      where account_id = '${ids.peer}';
      update app_private.consents set withdrawn_at = '2026-03-05Z'
      where account_id = '${ids.peer}' and purpose = 'media'`);
    await expect(
      db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 3, 2, '2026-03-05T18:00:00Z')`),
    ).rejects.toThrow("required consent missing");
    expect(
      (
        await db.query(`select status from app_private.group_invitations
      where invitation_id = '${ids.invitation}'`)
      ).rows,
    ).toEqual([{ status: "issued" }]);
  });

  it("rolls invitation acceptance back when one-Group or capacity invariants reject it", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await db.exec(`insert into app_private.groups (group_id, name, time_zone)
      values ('${ids.otherGroup}', 'Other', 'UTC');
      insert into app_private.memberships
        (membership_id, account_id, group_id, joined_at, recurring_target)
      values ('${ids.peerMembership}', '${ids.peer}', '${ids.otherGroup}', '2026-03-05Z', 2)`);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    await expect(
      db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.thirdMembership}', 3, 2, '2026-03-05T18:00:00Z')`),
    ).rejects.toThrow("already belongs");
    expect(
      (
        await db.query(
          `select status from app_private.group_invitations where invitation_id = '${ids.invitation}'`,
        )
      ).rows,
    ).toEqual([{ status: "issued" }]);

    await db.exec(`delete from app_private.memberships where membership_id = '${ids.peerMembership}';
      insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at)
      select gen_random_uuid(), gen_random_uuid(), 'member' || n || '@example.test', '2026-03-01Z'
      from generate_series(1, 9) n;
      insert into app_private.memberships (membership_id, account_id, group_id, joined_at, recurring_target)
      select gen_random_uuid(), account_id, '${ids.group}', '2026-03-05Z', 2
      from app_private.accounts where email like 'member%@example.test';`);
    await expect(
      db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.thirdMembership}', 3, 2, '2026-03-05T18:00:00Z')`),
    ).rejects.toThrow("capacity");
    expect(
      (
        await db.query(
          `select status from app_private.group_invitations where invitation_id = '${ids.invitation}'`,
        )
      ).rows,
    ).toEqual([{ status: "issued" }]);
  });

  it("persists authoritative week bounds across DST gaps and folds", async () => {
    const db = await migratedDatabase();
    const result = await db.query<{
      spring_hours: number;
      fall_hours: number;
    }>(`
      select
        extract(epoch from spring.ends_at - spring.starts_at) / 3600 as spring_hours,
        extract(epoch from fall.ends_at - fall.starts_at) / 3600 as fall_hours
      from app_private.accountability_week_bounds('2026-03-04T12:00:00Z', 'America/Chicago') spring,
           app_private.accountability_week_bounds('2026-10-28T12:00:00Z', 'America/Chicago') fall`);
    expect(result.rows).toEqual([
      {
        spring_hours: "167.0000000000000000",
        fall_hours: "169.0000000000000000",
      },
    ]);
  });

  it("uses configured non-Monday week starts across DST", async () => {
    const db = await migratedDatabase();
    const result = await db.query(`select *
      from app_private.accountability_week_bounds(
        '2026-03-06T12:00:00Z', 'America/Chicago', 3::smallint
      )`);
    expect(result.rows).toEqual([
      {
        starts_at: new Date("2026-03-04T06:00:00.000Z"),
        ends_at: new Date("2026-03-11T05:00:00.000Z"),
      },
    ]);
  });

  it("uses authoritative activation cutoff and cleans departure in one transaction", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    await db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 4, 2, '2026-03-05T18:00:00Z')`);
    const week = await db.query(`select activation_at, starts_at, ends_at
      from app_private.accountability_weeks`);
    expect(week.rows).toEqual([
      {
        activation_at: new Date("2026-03-05T18:00:00.000Z"),
        starts_at: new Date("2026-03-02T06:00:00.000Z"),
        ends_at: new Date("2026-03-09T05:00:00.000Z"),
      },
    ]);
    const season = await db.query(`select season_number, starts_at, ends_at,
      active_weeks_consumed from app_private.seasons`);
    expect(season.rows).toEqual([
      {
        season_number: 1,
        starts_at: new Date("2026-03-05T18:00:00.000Z"),
        ends_at: new Date("2026-03-30T05:00:00.000Z"),
        active_weeks_consumed: 1,
      },
    ]);

    await db.query(`select app_private.end_membership(
      '${ids.peerMembership}', 'left', '2026-03-06T12:00:00Z')`);
    const cleanup = await db.query(`select
      (select count(*)::integer from app_private.member_weeks
        where status = 'ended_without_result') as ended_weeks,
      (select access_cutoff from app_private.accounts where account_id = '${ids.peer}') as cutoff,
      (select status from app_private.groups where group_id = '${ids.group}') as group_status,
      (select unfinished_member_weeks from app_private.departure_cleanup_receipts
        where membership_id = '${ids.peerMembership}') as cleaned`);
    expect(cleanup.rows).toEqual([
      {
        ended_weeks: 2,
        cutoff: new Date("2026-03-06T12:00:00.000Z"),
        group_status: "accountability_paused",
        cleaned: 2,
      },
    ]);
  });

  it("returns through a fresh invitation without restarting Season state", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    await db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 4, 2, '2026-03-05T18:00:00Z')`);
    await db.query(`select app_private.end_membership(
      '${ids.peerMembership}', 'left', '2026-03-06T12:00:00Z')`);
    await db.exec(`insert into app_private.group_invitations
      (invitation_id, group_id, email, token_digest, issued_by_membership_id,
       issued_at, expires_at)
      values ('50000000-0000-4000-8000-000000000002', '${ids.group}',
        'peer@example.test', '${"b".repeat(64)}', '${ids.adminMembership}',
        '2026-03-06T12:01:00Z', '2026-03-13T12:01:00Z')`);
    await authenticate(db, ids.peerAuth, "2026-03-07T12:00:01Z");
    await db.query(`select app_private.accept_group_invitation(
      '${"b".repeat(64)}', '${ids.thirdMembership}', 4, 2, '2026-03-07T12:00:00Z')`);
    const state = await db.query(`select
      (select count(*)::integer from app_private.seasons) as seasons,
      (select active_weeks_consumed from app_private.seasons) as active_weeks,
      (select status from app_private.groups where group_id = '${ids.group}') as group_status,
      (select activation_at from app_private.groups where group_id = '${ids.group}') as resumed_at,
      (select count(*)::integer from app_private.memberships
        where group_id = '${ids.group}' and ended_at is null) as current_members,
      (select count(*)::integer from app_private.member_weeks mw
        join app_private.memberships m on m.membership_id = mw.membership_id
        where m.group_id = '${ids.group}' and m.ended_at is null
          and mw.status = 'active') as active_member_weeks`);
    expect(state.rows).toEqual([
      {
        seasons: 1,
        active_weeks: 1,
        group_status: "active",
        resumed_at: new Date("2026-03-07T12:00:00.000Z"),
        current_members: 2,
        active_member_weeks: 2,
      },
    ]);
  });

  it("keeps continuing member-weeks active when departure leaves two members", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    await db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 3, 2, '2026-03-05T18:00:00Z')`);
    await db.exec(`insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target)
      values ('${ids.thirdMembership}', '${ids.third}', '${ids.group}',
        '2026-03-05T19:00:00Z', 3);
      insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at)
      select '70000000-0000-4000-8000-000000000003', '${ids.thirdMembership}',
        accountability_week_id, 3, '2026-03-05T19:00:00Z'
      from app_private.accountability_weeks`);
    await db.query(`select app_private.end_membership(
      '${ids.peerMembership}', 'left', '2026-03-06T12:00:00Z')`);
    const state = await db.query(`select
      (select status from app_private.groups where group_id = '${ids.group}') as group_status,
      (select count(*)::integer from app_private.member_weeks mw
        join app_private.memberships m on m.membership_id = mw.membership_id
        where m.group_id = '${ids.group}' and m.ended_at is null
          and mw.status = 'active') as continuing_active,
      (select status from app_private.member_weeks
        where membership_id = '${ids.peerMembership}') as departed_status`);
    expect(state.rows).toEqual([
      {
        group_status: "active",
        continuing_active: 2,
        departed_status: "ended_without_result",
      },
    ]);
  });

  it("activates configured Wednesday Group calendar and first shortened Season atomically", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await db.exec(`update app_private.groups set week_starts = 3
      where group_id = '${ids.group}'`);
    await authenticate(db, ids.peerAuth, "2026-03-06T12:00:00Z");
    await db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 3, 2, '2026-03-06T12:00:00Z')`);
    const state = await db.query(`select
      w.starts_at, w.ends_at, w.activation_at,
      s.season_number, s.active_weeks_consumed, s.starts_at as season_starts_at,
      s.ends_at as season_ends_at
      from app_private.accountability_weeks w
      join app_private.seasons s on s.group_id = w.group_id`);
    expect(state.rows).toEqual([
      {
        starts_at: new Date("2026-03-04T06:00:00.000Z"),
        ends_at: new Date("2026-03-11T05:00:00.000Z"),
        activation_at: new Date("2026-03-06T12:00:00.000Z"),
        season_number: 1,
        active_weeks_consumed: 1,
        season_starts_at: new Date("2026-03-06T12:00:00.000Z"),
        season_ends_at: new Date("2026-04-01T05:00:00.000Z"),
      },
    ]);
  });

  it("protects last admin and rolls back all departure effects", async () => {
    const db = await migratedDatabase();
    await seedSetupGroup(db);
    await authenticate(db, ids.peerAuth, "2026-03-05T18:00:00Z");
    await db.query(`select app_private.accept_group_invitation(
      '${digest}', '${ids.peerMembership}', 3, 2, '2026-03-05T18:00:00Z')`);
    await expect(
      db.query(`select app_private.end_membership(
      '${ids.adminMembership}', 'left', '2026-03-06T12:00:00Z')`),
    ).rejects.toThrow("retain an admin");
    expect(
      (
        await db.query(`select ended_at from app_private.memberships
      where membership_id = '${ids.adminMembership}'`)
      ).rows,
    ).toEqual([{ ended_at: null }]);
  });
});
