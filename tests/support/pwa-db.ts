import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach } from "vitest";

// A three-member Group (Alex is the admin) with one open UTC week, Mar 2–9 2026.
const migrationsDirectory = new URL(
  "../../supabase/migrations/",
  import.meta.url,
);
export const group = "10000000-0000-4000-8000-000000000001";
export const auth = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
];
export const accounts = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
];
export const memberships = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
  "40000000-0000-4000-8000-000000000003",
];
export const week = "50000000-0000-4000-8000-000000000001";
export const memberWeeks = [
  "60000000-0000-4000-8000-000000000001",
  "60000000-0000-4000-8000-000000000002",
  "60000000-0000-4000-8000-000000000003",
];

const opened: PGlite[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

export async function database(targets = [1, 1, 1]) {
  const db = new PGlite();
  opened.push(db);
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const file of (await readdir(migrationsDirectory)).sort()) {
    await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
  }
  await db.exec(`
    insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at, display_name) values
      ('${accounts[0]}', '${auth[0]}', 'a@example.test', '2026-03-01Z', 'Alex'),
      ('${accounts[1]}', '${auth[1]}', 'b@example.test', '2026-03-01Z', 'Blair'),
      ('${accounts[2]}', '${auth[2]}', 'c@example.test', '2026-03-01Z', 'Casey');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
      ('${group}', 'Friends', 'UTC', 'active', '2026-03-02Z');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('${memberships[0]}', '${accounts[0]}', '${group}', '2026-03-01Z', ${targets[0]}),
      ('${memberships[1]}', '${accounts[1]}', '${group}', '2026-03-01Z', ${targets[1]}),
      ('${memberships[2]}', '${accounts[2]}', '${group}', '2026-03-01Z', ${targets[2]});
    insert into app_private.group_admins (membership_id) values ('${memberships[0]}');
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('${week}', '${group}', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02Z');
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      ('${memberWeeks[0]}', '${memberships[0]}', '${week}', ${targets[0]}, '2026-03-02Z'),
      ('${memberWeeks[1]}', '${memberships[1]}', '${week}', ${targets[1]}, '2026-03-02Z'),
      ('${memberWeeks[2]}', '${memberships[2]}', '${week}', ${targets[2]}, '2026-03-02Z');
  `);
  return db;
}

export async function as(db: PGlite, member: number) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [
    auth[member],
  ]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-04T00:00Z",
  ]);
}

// Runs `sql` as `member` and returns the first row's `data` column.
export async function data<T = unknown>(
  db: PGlite,
  member: number,
  sql: string,
  values: unknown[] = [],
) {
  await as(db, member);
  return (await db.query<{ data: T }>(sql, values)).rows[0]?.data as T;
}

export async function rejects(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? "error";
  }
  return null;
}

export async function submitProof(
  db: PGlite,
  member: number,
  at = "2026-03-05T10:00Z",
) {
  await as(db, member);
  const upload = async (kind: string) =>
    (
      await db.query<{ path: string }>(
        "select app_private.create_proof_upload($1, $2) as path",
        [kind, at],
      )
    ).rows[0]?.path as string;
  const activity = await upload("activity");
  const presence = await upload("presence");
  const id = randomUUID();
  await db.query(
    `select * from app_private.submit_proof_checkin($1, $2, $3, $4, 'cardio',
      $8, 30, 'moderate', true, $5, $6, $7, $8)`,
    [
      randomUUID(),
      "a".repeat(64),
      randomUUID(),
      id,
      activity,
      presence,
      true,
      at,
    ],
  );
  return id;
}
