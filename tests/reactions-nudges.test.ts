import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const group = "10000000-0000-4000-8000-000000000001";
const auth = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
];
const accounts = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
];
const memberships = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
  "40000000-0000-4000-8000-000000000003",
];
const week = "50000000-0000-4000-8000-000000000001";

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
      ('${accounts[0]}', '${auth[0]}', 'a@example.test', '2026-03-01Z', 'Alex'),
      ('${accounts[1]}', '${auth[1]}', 'b@example.test', '2026-03-01Z', 'Blair'),
      ('${accounts[2]}', '${auth[2]}', 'c@example.test', '2026-03-01Z', 'Casey');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
      ('${group}', 'Friends', 'UTC', 'active', '2026-03-02Z');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('${memberships[0]}', '${accounts[0]}', '${group}', '2026-03-01Z', 1),
      ('${memberships[1]}', '${accounts[1]}', '${group}', '2026-03-01Z', 1),
      ('${memberships[2]}', '${accounts[2]}', '${group}', '2026-03-01Z', 1);
    insert into app_private.group_admins (membership_id) values ('${memberships[0]}');
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('${week}', '${group}', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02Z');
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      ('60000000-0000-4000-8000-000000000001', '${memberships[0]}', '${week}', 1, '2026-03-02Z'),
      ('60000000-0000-4000-8000-000000000002', '${memberships[1]}', '${week}', 1, '2026-03-02Z'),
      ('60000000-0000-4000-8000-000000000003', '${memberships[2]}', '${week}', 1, '2026-03-02Z');
  `);
  return db;
}

async function as(db: PGlite, member: number) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [
    auth[member],
  ]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-04T00:00Z",
  ]);
}

async function upload(db: PGlite, kind: string, at = "2026-03-05T09:00Z") {
  return (
    await db.query<{ path: string }>(
      "select app_private.create_proof_upload($1, $2) as path",
      [kind, at],
    )
  ).rows[0]?.path as string;
}

async function submit(
  db: PGlite,
  member: number,
  photos?: { activity?: string; presence?: string; consent?: boolean },
) {
  await as(db, member);
  const activity = photos?.activity ?? (await upload(db, "activity"));
  const presence = photos?.presence ?? (await upload(db, "presence"));
  const id = randomUUID();
  await db.query(
    `select * from app_private.submit_proof_checkin($1, $2, $3, $4, 'cardio',
      '2026-03-05T09:00Z', 30, 'moderate', true, $5, $6, $7, '2026-03-05T10:00Z')`,
    [
      randomUUID(),
      "a".repeat(64),
      randomUUID(),
      id,
      activity,
      presence,
      photos?.consent ?? true,
    ],
  );
  return id;
}

const react = async (
  db: PGlite,
  member: number,
  id: string,
  reaction: string,
  on = true,
) => {
  await as(db, member);
  return db.query(
    "select app_private.react_to_proof($1, $2, $3, '2026-03-05T11:00Z')",
    [id, reaction, on],
  );
};
const nudge = async (
  db: PGlite,
  member: number,
  target: number,
  at = "2026-03-05T11:00Z",
) => {
  await as(db, member);
  return db.query("select app_private.nudge_member($1, $2)", [
    memberships[target],
    at,
  ]);
};
const subscribe = (db: PGlite, account: number) =>
  db.query(
    "insert into app_private.web_push_subscriptions (endpoint, account_id, p256dh, auth, created_at) values ($1, $2, 'k', 'a', '2026-03-01Z')",
    [`https://push.example.test/${account}`, accounts[account]],
  );
const outbox = async (db: PGlite, account: number) =>
  (
    await db.query<{ title: string }>(
      "select title from app_private.web_push_outbox where account_id = $1 and dedupe_key like 'social:%' order by outbox_id",
      [accounts[account]],
    )
  ).rows.map((row) => row.title);
const social = (db: PGlite, at: string) =>
  db.query("select app_private.enqueue_social_push($1)", [at]);

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("Reactions and nudges", { timeout: 30_000 }, () => {
  it("keeps any number of distinct emoji per member on others' proof", async () => {
    const db = await database();
    const id = await submit(db, 0);
    await expect(react(db, 0, id, "🔥")).rejects.toThrow(
      "Reaction unavailable",
    );
    await expect(react(db, 1, id, "lol")).rejects.toThrow();
    await react(db, 1, id, "🔥");
    await react(db, 1, id, "🦍");
    await react(db, 1, id, "🔥");
    await react(db, 2, id, "🔥");
    await as(db, 1);
    const summary = (
      await db.query<{ counts: unknown; my_reactions: string[] }>(
        "select * from app_private.proof_reaction_summary('2026-03-05T12:00Z')",
      )
    ).rows;
    expect(summary).toEqual([
      expect.objectContaining({
        counts: [
          { emoji: "🔥", count: 2 },
          { emoji: "🦍", count: 1 },
        ],
        my_reactions: ["🔥", "🦍"],
      }),
    ]);
    await react(db, 1, id, "🔥", false);
    await as(db, 1);
    const removed = (
      await db.query<{ my_reactions: string[] }>(
        "select my_reactions from app_private.proof_reaction_summary('2026-03-05T12:00Z')",
      )
    ).rows;
    expect(removed[0]?.my_reactions).toEqual(["🦍"]);
    for (const emoji of ["😤", "🏋️", "👑", "⚡", "🫡"])
      await react(db, 1, id, emoji);
    await expect(react(db, 1, id, "🥇")).rejects.toThrow("Up to 6");
  });

  it("lists who reacted, in order, to the viewer's Group only", async () => {
    const db = await database();
    const id = await submit(db, 0);
    await as(db, 2);
    await db.query(
      "select app_private.react_to_proof($1, '🔥', true, '2026-03-05T11:00Z')",
      [id],
    );
    await as(db, 1);
    await db.query(
      "select app_private.react_to_proof($1, '🦍', true, '2026-03-05T11:01Z')",
      [id],
    );
    await db.query(
      "select app_private.react_to_proof($1, '🔥', true, '2026-03-05T11:02Z')",
      [id],
    );
    const list = async () =>
      (
        await db.query<{ mine: boolean }>(
          "select reaction, display_name, mine from app_private.proof_reactors($1, '2026-03-05T12:00Z')",
          [id],
        )
      ).rows;
    expect(await list()).toEqual([
      { reaction: "🔥", display_name: "Casey", mine: false },
      { reaction: "🦍", display_name: "Blair", mine: true },
      { reaction: "🔥", display_name: "Blair", mine: true },
    ]);
    // The author sees the same list; nobody is "mine".
    await as(db, 0);
    expect((await list()).map((row) => row.mine)).toEqual([
      false,
      false,
      false,
    ]);
    // Ended memberships drop out.
    await db.query(
      "update app_private.memberships set ended_at = '2026-03-05T11:30Z', end_reason = 'left' where membership_id = $1",
      [memberships[2]],
    );
    expect(await list()).toEqual([
      { reaction: "🦍", display_name: "Blair", mine: false },
      { reaction: "🔥", display_name: "Blair", mine: false },
    ]);
    // Another Group cannot read it, nor can an unknown proof be listed.
    const outsider = "30000000-0000-4000-8000-000000000009";
    await db.exec(`
      insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at, display_name) values
        ('20000000-0000-4000-8000-000000000009', '${outsider}', 'z@example.test', '2026-03-01Z', 'Zed');
      insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
        ('10000000-0000-4000-8000-000000000009', 'Others', 'UTC', 'active', '2026-03-02Z');
      insert into app_private.memberships
        (membership_id, account_id, group_id, joined_at, recurring_target) values
        ('40000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000009',
         '10000000-0000-4000-8000-000000000009', '2026-03-01Z', 1);
    `);
    await db.query("select set_config('app.auth_user_id', $1, false)", [
      outsider,
    ]);
    await expect(list()).rejects.toThrow("Reactions unavailable");
    await as(db, 1);
    await expect(
      db.query(
        "select * from app_private.proof_reactors($1, '2026-03-05T12:00Z')",
        [randomUUID()],
      ),
    ).rejects.toThrow("Reactions unavailable");
  });

  it("keeps reactions and reactors on a post 400 days old", async () => {
    const db = await database();
    const id = await submit(db, 0);
    await react(db, 2, id, "🔥");
    await as(db, 1);
    const later = "2027-04-09T12:00Z";
    expect(
      (
        await db.query<{ workout_checkin_id: string }>(
          "select workout_checkin_id from app_private.proof_reaction_summary($1)",
          [later],
        )
      ).rows.map((row) => row.workout_checkin_id),
    ).toEqual([id]);
    expect(
      (
        await db.query(
          "select reaction, display_name from app_private.proof_reactors($1, $2)",
          [id, later],
        )
      ).rows,
    ).toEqual([{ reaction: "🔥", display_name: "Casey" }]);
  });

  it("nudges only members behind target, once per day", async () => {
    const db = await database();
    await submit(db, 2);
    await expect(nudge(db, 0, 0)).rejects.toThrow("Nudge unavailable");
    await expect(nudge(db, 0, 2)).rejects.toThrow("Nudge unavailable");
    await nudge(db, 0, 1);
    await expect(nudge(db, 0, 1)).rejects.toThrow("Already nudged today");
    await nudge(db, 0, 1, "2026-03-06T11:00Z");
    await expect(nudge(db, 0, 1, "2026-03-09T01:00Z")).rejects.toThrow(
      "Nudge unavailable",
    );
    await as(db, 0);
    const today = (
      await db.query<{ id: string }>(
        "select app_private.nudged_today('2026-03-06T12:00Z') as id",
      )
    ).rows.map((row) => row.id);
    expect(today).toEqual([memberships[1]]);
  });

  it("nudges a member whose only report was rejected", async () => {
    const db = await database();
    const id = await submit(db, 2);
    await db.query(
      "update app_private.workout_checkins set review_status = 'rejected' where workout_checkin_id = $1",
      [id],
    );
    await nudge(db, 0, 2);
  });

  it("pushes the recipient at once, bundles within 15 minutes, with no daily cap", async () => {
    const db = await database();
    await subscribe(db, 0);
    const id = await submit(db, 0);
    await react(db, 1, id, "🔥");
    await social(db, "2026-03-05T11:00Z");
    expect(await outbox(db, 0)).toEqual(["Blair reacted to your workout"]);
    expect(await outbox(db, 1)).toEqual([]);
    // A second emoji from the same member does not push again.
    await react(db, 1, id, "🦍");
    await react(db, 2, id, "👏");
    await social(db, "2026-03-05T11:05Z");
    expect(await outbox(db, 0)).toHaveLength(1);
    await social(db, "2026-03-05T11:16Z");
    expect(await outbox(db, 0)).toEqual([
      "Blair reacted to your workout",
      "Casey reacted to your workout",
    ]);
    await subscribe(db, 1);
    await nudge(db, 0, 1);
    await nudge(db, 2, 1);
    await social(db, "2026-03-05T11:20Z");
    expect(await outbox(db, 1)).toEqual(["Alex and Casey nudged you"]);
    const second = await submit(db, 0);
    await react(db, 1, second, "💪");
    await social(db, "2026-03-05T11:40Z");
    await react(db, 2, second, "🔥");
    await social(db, "2026-03-05T12:00Z");
    expect(await outbox(db, 0)).toHaveLength(4);
  });
});
