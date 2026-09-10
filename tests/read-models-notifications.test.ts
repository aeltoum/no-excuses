import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const group = "a1000000-0000-4000-8000-000000000001";
const otherGroup = "a1000000-0000-4000-8000-000000000002";
const accounts = [1, 2, 3].map(
  (n) => `a2000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
) as [string, string, string];
const auth = [1, 2, 3].map(
  (n) => `a3000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
) as [string, string, string];
const memberships = [1, 2, 3].map(
  (n) => `a4000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
) as [string, string, string];
const week = "a5000000-0000-4000-8000-000000000001";

async function database() {
  const db = new PGlite();
  opened.push(db);
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const file of (await readdir(migrationsDirectory)).sort())
    await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
  await db.exec(`
    insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at) values
      ('${accounts[0]}','${auth[0]}','a@example.test','2026-01-01Z'),
      ('${accounts[1]}','${auth[1]}','b@example.test','2026-01-01Z'),
      ('${accounts[2]}','${auth[2]}','c@example.test','2026-01-01Z');
    insert into app_private.groups (group_id,name,time_zone,status,activation_at) values
      ('${group}','Friends','UTC','active','2026-09-07Z'),
      ('${otherGroup}','Other','UTC','active','2026-06-07Z');
    insert into app_private.memberships (membership_id,account_id,group_id,joined_at,recurring_target) values
      ('${memberships[0]}','${accounts[0]}','${group}','2026-09-07Z',2),
      ('${memberships[1]}','${accounts[1]}','${group}','2026-09-07Z',3),
      ('${memberships[2]}','${accounts[2]}','${otherGroup}','2026-06-07Z',2);
    insert into app_private.accountability_weeks
      (accountability_week_id,group_id,starts_at,ends_at,time_zone,activation_at)
      values ('${week}','${group}','2026-09-07Z','2026-09-14Z','UTC','2026-09-07Z');
    insert into app_private.member_weeks
      (member_week_id,membership_id,accountability_week_id,target,target_locked_at) values
      ('a6000000-0000-4000-8000-000000000001','${memberships[0]}','${week}',2,'2026-09-07Z'),
      ('a6000000-0000-4000-8000-000000000002','${memberships[1]}','${week}',3,'2026-09-07Z');
    insert into app_private.workout_checkins values
      ('a7000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
       '${memberships[0]}','strength','2026-09-08Z',30,'moderate',true,'2026-09-08Z');
  `);
  return db;
}

async function actor(db: PGlite, value: string) {
  await db.exec(`select set_config('app.auth_user_id','${value}',false);
    select set_config('app.token_issued_at','2026-09-10Z',false);`);
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("M7 read models, social delivery, and notifications", () => {
  it("rebuilds projections exactly from authoritative facts without cross-Group rows", async () => {
    const db = await database();
    await db.query(
      "select * from app_private.rebuild_group_read_models($1,$2)",
      [group, "2026-09-10Z"],
    );
    const first =
      await db.query(`select membership_id, locked_target, completed_workout_count, needs_you_count
      from app_private.member_home_projections order by membership_id`);
    expect(first.rows).toEqual([
      {
        membership_id: memberships[0],
        locked_target: 2,
        completed_workout_count: 1,
        needs_you_count: 1,
      },
      {
        membership_id: memberships[1],
        locked_target: 3,
        completed_workout_count: 0,
        needs_you_count: 1,
      },
    ]);
    await db.query(
      "select * from app_private.rebuild_group_read_models($1,$2)",
      [group, "2026-09-10Z"],
    );
    expect(
      (
        await db.query(`select membership_id, locked_target, completed_workout_count, needs_you_count
        from app_private.member_home_projections order by membership_id`)
      ).rows,
    ).toEqual(first.rows);
    expect(
      (
        await db.query(
          "select count(*)::integer count from app_private.group_member_projections",
        )
      ).rows,
    ).toEqual([{ count: 4 }]);
  });

  it("authorizes home reads live and removes departed viewers on rebuild", async () => {
    const db = await database();
    await db.query(
      "select * from app_private.rebuild_group_read_models($1,$2)",
      [group, "2026-09-10Z"],
    );
    await actor(db, auth[0]);
    expect(
      (
        await db.query(
          "select * from app_private.read_member_home('2026-09-10Z')",
        )
      ).rows,
    ).toHaveLength(1);
    await actor(db, auth[2]);
    expect(
      (
        await db.query(
          "select * from app_private.read_member_home('2026-09-10Z')",
        )
      ).rows,
    ).toEqual([]);
    await db.exec(`update app_private.memberships set ended_at='2026-09-10Z', end_reason='left'
      where membership_id='${memberships[1]}';`);
    await db.query(
      "select * from app_private.rebuild_group_read_models($1,$2)",
      [group, "2026-09-10T00:01Z"],
    );
    expect(
      (
        await db.query(
          "select count(*)::integer count from app_private.group_member_projections",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  });

  it("records idempotent same-Group social interactions without changing outcomes", async () => {
    const db = await database();
    await actor(db, auth[0]);
    const interaction = randomUUID();
    const before = await db.query(
      "select status from app_private.member_weeks order by membership_id",
    );
    await db.query(
      "select app_private.create_social_interaction($1,$2,'reaction','fire',$3)",
      [interaction, memberships[1], "2026-09-10Z"],
    );
    await db.query(
      "select app_private.create_social_interaction($1,$2,'reaction','fire',$3)",
      [interaction, memberships[1], "2026-09-10T00:01Z"],
    );
    expect(
      (
        await db.query(
          "select count(*)::integer count from app_private.social_interactions",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    expect(
      (
        await db.query(
          "select event_type from app_private.domain_events where aggregate_id=$1",
          [interaction],
        )
      ).rows,
    ).toEqual([{ event_type: "social.interaction_created" }]);
    expect(
      await db.query(
        "select status from app_private.member_weeks order by membership_id",
      ),
    ).toEqual(expect.objectContaining({ rows: before.rows }));
    await expect(
      db.query(
        "select app_private.create_social_interaction($1,$2,'reaction','fire',$3)",
        [randomUUID(), memberships[2], "2026-09-10Z"],
      ),
    ).rejects.toThrow("same-Group");
  });

  it("bundles due work and enforces independent three-delivery daily caps", async () => {
    const db = await database();
    await db.exec(`
      insert into app_private.notification_preferences
        (account_id,notification_time_zone,changed_at) values ('${accounts[1]}','UTC','2026-09-01Z');
      insert into app_private.push_subscriptions
        (subscription_id,account_id,installation_id,permission,endpoint_digest,verified_at)
        values (gen_random_uuid(),'${accounts[1]}',gen_random_uuid(),'granted','${"a".repeat(64)}','2026-09-01Z');
    `);
    for (const kind of ["social", "action"] as const) {
      for (let n = 0; n < 5; n++) {
        await db.query(
          `select app_private.schedule_notification($1::uuid,$2::uuid,$3,$4::app_private.notification_class,1,'generic','home',null::uuid,$5::timestamptz,$6::timestamptz)`,
          [
            randomUUID(),
            accounts[1],
            `${kind}-${n}`,
            kind,
            `2026-09-10T0${n}:00Z`,
            "2026-09-11Z",
          ],
        );
        await db.query(
          "select * from app_private.dispatch_notification_work($1)",
          [`2026-09-10T0${n}:00Z`],
        );
      }
    }
    expect(
      (
        await db.query(
          `select class, consumed from app_private.notification_budgets order by class::text`,
        )
      ).rows,
    ).toEqual([
      { class: "action", consumed: 3 },
      { class: "social", consumed: 3 },
    ]);
    expect(
      (
        await db.query(
          `select class, count(*)::integer count from app_private.push_bundles group by class order by class::text`,
        )
      ).rows,
    ).toEqual([
      { class: "action", count: 3 },
      { class: "social", count: 3 },
    ]);
    expect(
      (
        await db.query(`select suppression_reason, count(*)::integer count
        from app_private.notification_delivery_work where state='suppressed'
        group by suppression_reason`)
      ).rows,
    ).toEqual([{ suppression_reason: "daily_cap", count: 4 }]);
  });

  it("charges one budget slot for a bundle and none for duplicate dispatch", async () => {
    const db = await database();
    await db.exec(`
      insert into app_private.notification_preferences
        (account_id,notification_time_zone,changed_at) values ('${accounts[1]}','UTC','2026-09-01Z');
      insert into app_private.push_subscriptions
        (subscription_id,account_id,installation_id,permission,endpoint_digest,verified_at)
        values (gen_random_uuid(),'${accounts[1]}',gen_random_uuid(),'granted','${"c".repeat(64)}','2026-09-01Z');
    `);
    for (let n = 0; n < 2; n++)
      await db.query(
        `select app_private.schedule_notification($1::uuid,$2::uuid,$3,'action'::app_private.notification_class,1,'generic','home',null::uuid,$4::timestamptz,$5::timestamptz)`,
        [
          randomUUID(),
          accounts[1],
          `bundle-${n}`,
          "2026-09-10Z",
          "2026-09-11Z",
        ],
      );
    expect(
      (
        await db.query(
          "select notification_count from app_private.dispatch_notification_work('2026-09-10Z')",
        )
      ).rows,
    ).toEqual([{ notification_count: 2 }]);
    await db.query(
      "select * from app_private.dispatch_notification_work('2026-09-10Z')",
    );
    expect(
      (
        await db.query(
          "select consumed from app_private.notification_budgets where class='action'",
        )
      ).rows,
    ).toEqual([{ consumed: 1 }]);
  });

  it("suppresses denied push and resolves stale links without mutating notification authority", async () => {
    const db = await database();
    const notification = randomUUID();
    await db.exec(`insert into app_private.notification_preferences
      (account_id,notification_time_zone,changed_at) values ('${accounts[0]}','UTC','2026-09-01Z');
      insert into app_private.push_subscriptions
      (subscription_id,account_id,installation_id,permission,endpoint_digest)
      values (gen_random_uuid(),'${accounts[0]}',gen_random_uuid(),'denied','${"b".repeat(64)}');`);
    await db.query(
      `select app_private.schedule_notification($1::uuid,$2::uuid,'deadline','action'::app_private.notification_class,1,
      'deadline_due','task',$3::uuid,'2026-09-10Z','2026-09-11Z')`,
      [notification, accounts[0], randomUUID()],
    );
    await db.query(
      "select * from app_private.dispatch_notification_work('2026-09-10Z')",
    );
    expect(
      (
        await db.query(
          "select state,suppression_reason from app_private.notification_delivery_work",
        )
      ).rows,
    ).toEqual([
      { state: "suppressed", suppression_reason: "permission_unavailable" },
    ]);
    expect(
      (await db.query("select state from app_private.notification_items")).rows,
    ).toEqual([{ state: "unread" }]);
    await actor(db, auth[0]);
    expect(
      (
        await db.query(
          "select app_private.resolve_member_route($1,'2026-09-12Z') route",
          [notification],
        )
      ).rows,
    ).toEqual([{ route: "/home?notice=unavailable" }]);
  });
});
