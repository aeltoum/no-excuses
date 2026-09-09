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
const adminMembership = "40000000-0000-4000-8000-000000000001";
const peerMembership = "40000000-0000-4000-8000-000000000002";

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
      ('${adminMembership}', '20000000-0000-4000-8000-000000000001', '${group}', '2026-03-01Z', 3),
      ('${peerMembership}', '20000000-0000-4000-8000-000000000002', '${group}', '2026-03-01Z', 2),
      ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', '${otherGroup}', '2026-03-01Z', 2);
    insert into app_private.group_admins (membership_id) values ('${adminMembership}');
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

describe("True-MVP Group commands", () => {
  it("exposes command wrappers without privileged primitive bypasses", async () => {
    const db = await database();
    const privileges = await db.query(`select
      has_function_privilege('service_role', 'app_private.create_group_command(uuid,text,uuid,uuid,uuid,text,text,integer,timestamptz)', 'execute') as create_command,
      has_function_privilege('service_role', 'app_private.issue_group_invitation_command(uuid,text,uuid,uuid,text,text,timestamptz)', 'execute') as issue_command,
      has_function_privilege('service_role', 'app_private.revoke_group_invitation_command(uuid,text,uuid,uuid,timestamptz)', 'execute') as revoke_command,
      has_function_privilege('service_role', 'app_private.accept_group_invitation_command(uuid,text,uuid,text,uuid,integer,integer,timestamptz)', 'execute') as accept_command,
      has_function_privilege('service_role', 'app_private.leave_group_command(uuid,text,uuid,timestamptz)', 'execute') as leave_command,
      has_function_privilege('service_role', 'app_private.remove_group_member_command(uuid,text,uuid,uuid,uuid,timestamptz)', 'execute') as remove_command,
      has_function_privilege('service_role', 'app_private.create_group(uuid,uuid,uuid,text,text,integer,timestamptz)', 'execute') as create_primitive,
      has_function_privilege('service_role', 'app_private.issue_group_invitation(uuid,text,text,timestamptz)', 'execute') as issue_primitive,
      has_function_privilege('service_role', 'app_private.revoke_group_invitation(uuid,timestamptz)', 'execute') as revoke_primitive,
      has_function_privilege('service_role', 'app_private.accept_group_invitation(text,uuid,integer,integer,timestamptz)', 'execute') as accept_primitive,
      has_function_privilege('service_role', 'app_private.end_membership(uuid,app_private.membership_end_reason,timestamptz)', 'execute') as end_primitive,
      has_function_privilege('service_role', 'app_private.leave_group(timestamptz)', 'execute') as leave_primitive,
      has_function_privilege('service_role', 'app_private.remove_group_member(uuid,uuid,timestamptz)', 'execute') as remove_primitive`);
    expect(privileges.rows).toEqual([
      {
        create_command: true,
        issue_command: true,
        revoke_command: true,
        accept_command: true,
        leave_command: true,
        remove_command: true,
        create_primitive: false,
        issue_primitive: false,
        revoke_primitive: false,
        accept_primitive: false,
        end_primitive: false,
        leave_primitive: false,
        remove_primitive: false,
      },
    ]);
  });

  it("durably replays command results and rejects changed-body key reuse", async () => {
    const db = await database();
    await auth(db, adminAuth);
    const command = (
      hash: string,
    ) => `select * from app_private.issue_group_invitation_command(
      '70000000-0000-4000-8000-000000000001', '${hash}',
      '70000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000010', 'new@example.test',
      '${"d".repeat(64)}', '2026-03-05T10:00Z')`;
    const first = (await db.query(command("a".repeat(64)))).rows;
    expect(await db.query(command("a".repeat(64)))).toEqual(
      expect.objectContaining({ rows: first }),
    );
    await expect(db.query(command("b".repeat(64)))).rejects.toThrow(
      "different request hash",
    );
    await db.exec("reset role");
    expect(
      (
        await db.query(`select count(*)::integer as count
          from app_private.group_invitations
          where invitation_id = '50000000-0000-4000-8000-000000000010'`)
      ).rows,
    ).toEqual([{ count: 1 }]);
  });

  it("lets only a current admin issue and revoke an exact seven-day digest-only invitation", async () => {
    const db = await database();
    await auth(db, adminAuth);
    const invitationId = "50000000-0000-4000-8000-000000000001";
    const digest = "a".repeat(64);
    expect(
      (
        await db.query(`select * from app_private.issue_group_invitation(
          '${invitationId}', ' PEER2@EXAMPLE.TEST ', '${digest}', '2026-03-05T10:00Z')`)
      ).rows,
    ).toEqual([
      {
        invitation_id: invitationId,
        expires_at: new Date("2026-03-12T10:00:00.000Z"),
      },
    ]);
    await db.exec("reset role");
    expect(
      (
        await db.query(`select email, token_digest, expires_at - issued_at as lifetime
          from app_private.group_invitations where invitation_id = '${invitationId}'`)
      ).rows,
    ).toEqual([
      { email: "peer2@example.test", token_digest: digest, lifetime: "7 days" },
    ]);
    await auth(db, adminAuth);
    expect(
      (
        await db.query(
          `select app_private.revoke_group_invitation('${invitationId}', '2026-03-05T11:00Z') as invitation_id`,
        )
      ).rows,
    ).toEqual([{ invitation_id: invitationId }]);

    await db.exec("reset role");
    await auth(db, peerAuth);
    await expect(
      db.query(`select * from app_private.issue_group_invitation(
        '50000000-0000-4000-8000-000000000002', 'x@example.test',
        '${"b".repeat(64)}', '2026-03-05T12:00Z')`),
    ).rejects.toThrow("Group action unavailable");
  });

  it("leaves only caller membership and preserves last-admin protection", async () => {
    const db = await database();
    await auth(db, peerAuth);
    expect(
      (
        await db.query(
          "select app_private.leave_group('2026-03-05T10:01Z') as membership_id",
        )
      ).rows,
    ).toEqual([{ membership_id: peerMembership }]);
    await db.exec("reset role");
    expect(
      (
        await db.query(`select membership_id, end_reason from app_private.memberships
          where ended_at is not null`)
      ).rows,
    ).toEqual([{ membership_id: peerMembership, end_reason: "left" }]);

    const adminDb = await database();
    await auth(adminDb, adminAuth);
    await expect(
      adminDb.query("select app_private.leave_group('2026-03-05T10:01Z')"),
    ).rejects.toThrow("retain an admin");
  });

  it("lets current admins remove only current non-admin peers with neutral cross-Group denial", async () => {
    const db = await database();
    await auth(db, adminAuth);
    expect(
      (
        await db.query(`select app_private.remove_group_member(
          '${group}', '${peerMembership}', '2026-03-05T10:01Z') as membership_id`)
      ).rows,
    ).toEqual([{ membership_id: peerMembership }]);
    await db.exec("reset role");
    expect(
      (
        await db.query(`select end_reason from app_private.memberships
          where membership_id = '${peerMembership}'`)
      ).rows,
    ).toEqual([{ end_reason: "removed" }]);
    await auth(db, adminAuth);
    await expect(
      db.query(`select app_private.remove_group_member(
        '${otherGroup}', '40000000-0000-4000-8000-000000000003', '2026-03-05T10:02Z')`),
    ).rejects.toThrow("Group action unavailable");
    await expect(
      db.query(`select app_private.remove_group_member(
        '${group}', '${adminMembership}', '2026-03-05T10:02Z')`),
    ).rejects.toThrow("Group action unavailable");
  });
});
