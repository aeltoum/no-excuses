import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const group = "10000000-0000-4000-8000-000000000001";
const adminAuth = "30000000-0000-4000-8000-000000000001";
const peerAuth = "30000000-0000-4000-8000-000000000002";
const admin = "20000000-0000-4000-8000-000000000001";
const peer = "20000000-0000-4000-8000-000000000002";

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
    insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at, display_name) values
      ('${admin}', '${adminAuth}', 'admin@example.test', '2026-03-01Z', 'Alex'),
      ('${peer}', '${peerAuth}', 'peer@example.test', '2026-03-01Z', 'Pat');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
      ('${group}', 'Friends', 'UTC', 'active', '2026-03-02T12:00Z');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('40000000-0000-4000-8000-000000000001', '${admin}', '${group}', '2026-03-01T12:00Z', 3),
      ('40000000-0000-4000-8000-000000000002', '${peer}', '${group}', '2026-03-01T12:00Z', 2);
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('50000000-0000-4000-8000-000000000001', '${group}', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02T12:00Z');
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 3, '2026-03-02T12:00Z'),
      ('60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 2, '2026-03-02T12:00Z');
  `);
  return db;
}

async function subscribe(db: PGlite, authId: string, endpoint: string) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [authId]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-05T10:00Z",
  ]);
  await db.query(
    "select app_private.save_push_subscription($1, 'key', 'secret')",
    [endpoint],
  );
  await db.query(
    "update app_private.web_push_subscriptions set created_at = '2026-03-03Z' where endpoint = $1",
    [endpoint],
  );
}

const outbox = async (db: PGlite) =>
  (
    await db.query<{ account_id: string; title: string; body: string }>(
      "select account_id, title, body from app_private.web_push_outbox order by outbox_id",
    )
  ).rows;

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("Web Push notifications", () => {
  it("notifies Group peers of a check-in exactly once, never the author", async () => {
    const db = await database();
    await subscribe(db, adminAuth, "https://push.example/admin");
    await subscribe(db, peerAuth, "https://push.example/peer");
    await db.exec(`insert into app_private.workout_checkins
      (workout_checkin_id, member_week_id, membership_id, activity_type, completed_at,
       duration_minutes, perceived_intensity, self_report_attested, submitted_at) values
      ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
       '40000000-0000-4000-8000-000000000001', 'cardio', '2026-03-05T09:00Z', 30,
       'moderate', true, '2026-03-05T10:00Z')`);
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-05T11:00Z')",
    );
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-05T11:01Z')",
    );
    expect(await outbox(db)).toEqual([
      {
        account_id: peer,
        title: "Alex posted a cardio workout",
        body: "1 of 3 this week.",
      },
    ]);
  });

  it("reminds members under target in the final 24 hours, then reports results", async () => {
    const db = await database();
    await subscribe(db, peerAuth, "https://push.example/peer");
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-07T23:00Z')",
    );
    expect(await outbox(db)).toEqual([]);
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-08T12:00Z')",
    );
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-08T13:00Z')",
    );
    // Members without a device get it in the app's notification list too.
    expect(await outbox(db)).toEqual([
      {
        account_id: admin,
        title: "Less than 24 hours left",
        body: "You have 0 of 3 workouts. No excuses.",
      },
      {
        account_id: peer,
        title: "Less than 24 hours left",
        body: "You have 0 of 2 workouts. No excuses.",
      },
    ]);
    await db.query(
      "select app_private.finalize_ended_member_weeks('2026-03-09T00:01Z')",
    );
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-09T00:01Z')",
    );
    expect((await outbox(db)).at(-1)).toEqual({
      account_id: peer,
      title: "Week Missed",
      body: "Target missed. Your Group can see it.",
    });
  });

  it("scopes subscription removal to the signed-in Account", async () => {
    const db = await database();
    await subscribe(db, peerAuth, "https://push.example/peer");
    await db.query("select set_config('app.auth_user_id', $1, false)", [
      adminAuth,
    ]);
    await db.query(
      "select app_private.delete_push_subscription('https://push.example/peer')",
    );
    expect(
      (
        await db.query(
          "select count(*)::integer as count from app_private.web_push_subscriptions",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  });
});
