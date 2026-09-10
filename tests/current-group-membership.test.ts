import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCurrentGroupMembership } from "../packages/delivery/src/api.js";
import {
  failure,
  opaqueId,
  success,
} from "../packages/shared-kernel/src/index.js";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const groupId = "10000000-0000-4000-8000-000000000001";
const membershipId = "40000000-0000-4000-8000-000000000001";
const memberAuth = "30000000-0000-4000-8000-000000000001";
const outsiderAuth = "30000000-0000-4000-8000-000000000002";

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
      ('20000000-0000-4000-8000-000000000001', '${memberAuth}', 'member@example.test', '2026-03-01Z'),
      ('20000000-0000-4000-8000-000000000002', '${outsiderAuth}', 'out@example.test', '2026-03-01Z');
    insert into app_private.groups (group_id, name, time_zone) values
      ('${groupId}', 'Friends', 'UTC');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('${membershipId}', '20000000-0000-4000-8000-000000000001', '${groupId}', '2026-03-01Z', 3);
  `);
  return db;
}

async function authenticate(
  db: PGlite,
  authId: string,
  issuedAt = "2026-03-05T10:00:01Z",
) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    issuedAt,
  ]);
}

async function current(db: PGlite) {
  return (
    await db.query("select app_private.current_group_membership() as data")
  ).rows;
}

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("current Group membership query", () => {
  it("returns only authoritative active membership IDs or explicit empty state", async () => {
    const db = await database();
    await authenticate(db, memberAuth);
    expect(await current(db)).toEqual([
      { data: { membership: { groupId, membershipId } } },
    ]);

    await authenticate(db, outsiderAuth);
    expect(await current(db)).toEqual([{ data: { membership: null } }]);

    await db.exec(`update app_private.memberships
      set ended_at = '2026-03-05T10:01Z', end_reason = 'left'
      where membership_id = '${membershipId}'`);
    await authenticate(db, memberAuth);
    expect(await current(db)).toEqual([{ data: { membership: null } }]);
  });

  it("denies missing and revoked authentication without revealing membership", async () => {
    const db = await database();
    await expect(current(db)).rejects.toThrow("authenticated account required");

    await db.exec(`update app_private.accounts
      set access_cutoff = '2026-03-05T10:00:00Z'
      where auth_user_id = '${memberAuth}'`);
    await authenticate(db, memberAuth, "2026-03-05T09:59:59Z");
    await expect(current(db)).rejects.toThrow("authenticated account required");
  });
});

describe("current Group membership delivery", () => {
  const actor = {
    actorId: opaqueId("actor", "018f63c2-7d33-7f54-9fa7-9f55d735ae36"),
    kind: "member" as const,
  };
  const statusFor = (code: string) => (code === "unauthorized" ? 401 : 500);

  it("returns explicit membership data through authenticated read handler", async () => {
    const execute = vi.fn(async () =>
      success({ membership: { groupId, membershipId } }),
    );
    const response = await handleCurrentGroupMembership(
      { authorization: "Bearer local", body: {}, headers: {} },
      {
        authenticate: async () => success(actor),
        execute,
        statusFor,
      },
    );

    expect(response).toEqual({
      status: 200,
      body: {
        contractVersion: 1,
        data: { membership: { groupId, membershipId } },
      },
    });
    expect(execute).toHaveBeenCalledWith({}, actor);
  });

  it("denies unauthenticated requests before querying membership", async () => {
    const execute = vi.fn();
    const response = await handleCurrentGroupMembership(
      { authorization: undefined, body: {}, headers: {} },
      {
        authenticate: async () =>
          failure("unauthorized" as const, "Sign in required"),
        execute,
        statusFor,
      },
    );

    expect(response).toMatchObject({
      status: 401,
      body: { error: { code: "unauthorized" } },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
