import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const group = "91000000-0000-4000-8000-000000000001";
const accounts = [1, 2, 3].map(
  (n) => `92000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
) as [string, string, string];
const memberships = [1, 2, 3].map(
  (n) => `93000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
) as [string, string, string];
const weeks = [1, 2, 3, 4, 5].map(
  (n) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
) as [string, string, string, string, string];
const season = "95000000-0000-4000-8000-000000000001";
const priorMembership = "93000000-0000-4000-8000-000000000010";

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
      ('${accounts[0]}', '96000000-0000-4000-8000-000000000001', 'a@example.test', '2026-01-01Z'),
      ('${accounts[1]}', '96000000-0000-4000-8000-000000000002', 'b@example.test', '2026-01-01Z'),
      ('${accounts[2]}', '96000000-0000-4000-8000-000000000003', 'c@example.test', '2026-01-01Z');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at)
      values ('${group}', 'Competition', 'UTC', 'active', '2026-03-02T12:00Z');
    insert into app_private.memberships (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('${memberships[0]}', '${accounts[0]}', '${group}', '2025-01-01Z', 2),
      ('${memberships[1]}', '${accounts[1]}', '${group}', '2026-03-02T12:00Z', 2),
      ('${memberships[2]}', '${accounts[2]}', '${group}', '2026-03-04T12:00Z', 2);
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, ended_at, end_reason, recurring_target)
      values ('${priorMembership}', '${accounts[1]}', '${group}', '2026-02-01Z', '2026-03-02Z', 'left', 2);
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('${weeks[0]}', '${group}', '2026-02-23Z', '2026-03-02Z', 'UTC', '2026-02-23Z'),
      ('${weeks[1]}', '${group}', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02T12:00Z'),
      ('${weeks[2]}', '${group}', '2026-03-09Z', '2026-03-16Z', 'UTC', '2026-03-09Z'),
      ('${weeks[3]}', '${group}', '2026-03-16Z', '2026-03-23Z', 'UTC', '2026-03-16Z'),
      ('${weeks[4]}', '${group}', '2026-03-23Z', '2026-03-30Z', 'UTC', '2026-03-23Z');
    insert into app_private.seasons
      (season_id, group_id, season_number, starts_at, ends_at, time_zone)
      values ('${season}', '${group}', 1, '2026-03-02T12:00Z', '2026-03-30Z', 'UTC');
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      (gen_random_uuid(), '${memberships[0]}', '${weeks[0]}', 2, '2026-02-23Z'),
      (gen_random_uuid(), '${priorMembership}', '${weeks[0]}', 2, '2026-02-23Z'),
      (gen_random_uuid(), '${memberships[0]}', '${weeks[1]}', 2, '2026-03-02T12:00Z'),
      (gen_random_uuid(), '${memberships[1]}', '${weeks[1]}', 2, '2026-03-02T12:00Z'),
      (gen_random_uuid(), '${memberships[2]}', '${weeks[1]}', 2, '2026-03-04T12:00Z');
    insert into app_private.activity_connections values
      ('${accounts[0]}', 'healthkit', 'granted', 1, '2026-03-01Z'),
      ('${accounts[1]}', 'health_connect', 'granted', 1, '2026-03-01Z'),
      ('${accounts[2]}', 'healthkit', 'limited', 1, '2026-03-01Z');
  `);
  return db;
}

async function snapshot(
  db: PGlite,
  member: string,
  platform: string,
  steps: number | null,
  sync = "2026-03-09T00:01Z",
) {
  const start =
    member === memberships[2] ? "2026-03-04T12:00Z" : "2026-03-02T12:00Z";
  await db.query(
    `select app_private.record_activity_snapshot($1,$2,$3,$4,1,$5,'2026-03-09Z',$6,$7,$8,$9)`,
    [
      randomUUID(),
      member,
      weeks[1],
      platform,
      start,
      sync,
      member === memberships[2] ? "limited" : "granted",
      member === memberships[2] ? "partial" : "complete",
      steps,
    ],
  );
}

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("M6 activity, Competition, and Seasons", () => {
  it("keeps immutable exact-interval snapshots, deduplicates, and ignores prior source generations", async () => {
    const db = await database();
    const id = randomUUID();
    const args = [
      id,
      memberships[0],
      weeks[1],
      "healthkit",
      "2026-03-02T12:00Z",
    ];
    const sql =
      "select app_private.record_activity_snapshot($1,$2,$3,$4,1,$5,'2026-03-09Z','2026-03-09T00:01Z','granted','complete',12349)";
    expect((await db.query(sql, args)).rows).toEqual([
      { record_activity_snapshot: id },
    ]);
    expect((await db.query(sql, args)).rows).toEqual([
      { record_activity_snapshot: id },
    ]);
    await expect(
      db.exec(
        `update app_private.activity_interval_snapshots set steps=0 where snapshot_id='${id}'`,
      ),
    ).rejects.toThrow("immutable");
    await expect(
      db.query(sql, [
        randomUUID(),
        memberships[0],
        weeks[1],
        "healthkit",
        "2026-03-02T00:00Z",
      ]),
    ).rejects.toThrow("exact membership eligibility interval");
    await db.exec(
      `update app_private.activity_connections set source_generation=2, changed_at='2026-03-09T00:02Z' where account_id='${accounts[0]}'`,
    );
    await db.query(
      "select app_private.score_competition_week($1, '2026-03-09T01:00Z')",
      [weeks[1]],
    );
    expect(
      (
        await db.query(
          `select status, displayed_score from app_private.competition_results where membership_id='${memberships[0]}' and category='top_steps'`,
        )
      ).rows,
    ).toEqual([{ status: "stale", displayed_score: null }]);
  });

  it("uses hand-calculated rounding, strict baselines, ties, multi-awards, and never converts gaps to zero", async () => {
    const db = await database();
    await snapshot(db, memberships[0], "healthkit", 12_349);
    await snapshot(db, memberships[1], "health_connect", 12_351);
    await snapshot(db, memberships[2], "healthkit", null);
    await db.exec(`
      insert into app_private.performance_results values
        (gen_random_uuid(),'${memberships[0]}','${weeks[0]}','load_progression','squat:kg','higher',100,5,'2026-03-01Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[0]}','load_progression','deadlift:kg','higher',100,5,'2026-03-01Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[0]}','cardio_leap','5k','lower',1500,null,'2026-03-01Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[1]}','load_progression','squat:kg','higher',110.04,5,'2026-03-08Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[1]}','load_progression','deadlift:kg','higher',120,5,'2026-03-08Z',true),
        (gen_random_uuid(),'${memberships[1]}','${weeks[1]}','load_progression','squat:kg','higher',90,5,'2026-03-08Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[1]}','cardio_leap','5k','lower',1363.6,null,'2026-03-08Z',true),
        (gen_random_uuid(),'${memberships[1]}','${weeks[1]}','cardio_leap','5k','lower',1400,null,'2026-03-08Z',true);
      select app_private.consume_season_week('${weeks[1]}','2026-03-09T00:02Z');
      update app_private.member_weeks set status='attained' where accountability_week_id='${weeks[1]}';
    `);
    await db.query(
      "select app_private.score_competition_week($1,'2026-03-09T01:00Z')",
      [weeks[1]],
    );
    const results =
      await db.query(`select membership_id, category, status, displayed_score::float8 score
      from app_private.competition_results order by category, membership_id`);
    expect(results.rows).toEqual(
      expect.arrayContaining([
        {
          membership_id: memberships[0],
          category: "top_steps",
          status: "eligible",
          score: 12300,
        },
        {
          membership_id: memberships[1],
          category: "top_steps",
          status: "eligible",
          score: 12400,
        },
        {
          membership_id: memberships[2],
          category: "top_steps",
          status: "limited",
          score: null,
        },
        {
          membership_id: memberships[0],
          category: "load_progression",
          status: "eligible",
          score: 20,
        },
        {
          membership_id: memberships[1],
          category: "load_progression",
          status: "ineligible",
          score: null,
        },
        {
          membership_id: memberships[0],
          category: "cardio_leap",
          status: "eligible",
          score: 10,
        },
      ]),
    );
    expect(
      (
        await db.query(
          `select app_private.finalize_crown_category('${weeks[1]}','load_progression','2026-03-10T00:00Z') award_count`,
        )
      ).rows,
    ).toEqual([{ award_count: 0 }]);
    expect(
      (
        await db.query(
          `select app_private.finalize_crown_category('${weeks[1]}','top_steps','2026-03-10T00:00Z') award_count`,
        )
      ).rows,
    ).toEqual([{ award_count: 1 }]);
  });

  it("finalizes rounded ties exactly once, allows three awards, and rejects late rewrites", async () => {
    const db = await database();
    await snapshot(db, memberships[0], "healthkit", 12_349);
    await snapshot(db, memberships[1], "health_connect", 12_348);
    await db.exec(`
      insert into app_private.performance_results values
        (gen_random_uuid(),'${memberships[0]}','${weeks[0]}','load_progression','press:kg','higher',100,5,'2026-03-01Z',true),
        (gen_random_uuid(),'${priorMembership}','${weeks[0]}','load_progression','press:kg','higher',100,5,'2026-03-01Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[0]}','cardio_leap','10min','higher',2000,null,'2026-03-01Z',true),
        (gen_random_uuid(),'${priorMembership}','${weeks[0]}','cardio_leap','10min','higher',2000,null,'2026-03-01Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[1]}','load_progression','press:kg','higher',110,5,'2026-03-08Z',true),
        (gen_random_uuid(),'${memberships[1]}','${weeks[1]}','load_progression','press:kg','higher',105,5,'2026-03-08Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[1]}','cardio_leap','10min','higher',2200,null,'2026-03-08Z',true),
        (gen_random_uuid(),'${memberships[1]}','${weeks[1]}','cardio_leap','10min','higher',2100,null,'2026-03-08Z',true);
      update app_private.member_weeks set status='attained' where accountability_week_id='${weeks[1]}';
    `);
    await expect(
      db.exec(`insert into app_private.performance_results values
        (gen_random_uuid(),'${memberships[1]}','${weeks[1]}','load_progression','prejoin:kg','higher',50,5,'2026-03-02T11:59Z',true)`),
    ).rejects.toThrow("membership eligibility interval");
    await expect(
      db.query(
        `select app_private.finalize_crown_category('${weeks[1]}','top_steps','2026-03-09T23:59:59Z')`,
      ),
    ).rejects.toThrow("settled Accountability week required");
    await expect(
      db.query(
        `select app_private.finalize_crown_category('${weeks[1]}','top_steps','2026-03-10T00:00Z')`,
      ),
    ).rejects.toThrow("Season assignment required before Crown finalization");
    await db.query(
      `select app_private.consume_season_week('${weeks[1]}','2026-03-10T00:01Z')`,
    );
    expect(
      (
        await db.query(
          `select app_private.finalize_crown_category('${weeks[1]}','top_steps','2026-03-10T00:02Z') n`,
        )
      ).rows,
    ).toEqual([{ n: 2 }]);
    expect(
      (
        await db.query(
          `select app_private.finalize_crown_category('${weeks[1]}','top_steps','2026-03-10T01:00Z') n`,
        )
      ).rows,
    ).toEqual([{ n: 2 }]);
    expect(
      (
        await db.query(
          `select app_private.finalize_crown_category('${weeks[1]}','load_progression','2026-03-10T00:02Z') n`,
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (
        await db.query(
          `select app_private.finalize_crown_category('${weeks[1]}','cardio_leap','2026-03-10T00:02Z') n`,
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    await expect(
      snapshot(db, memberships[0], "healthkit", 99_999, "2026-03-10Z"),
    ).rejects.toThrow("duplicate key");
    await expect(
      db.exec(`insert into app_private.performance_results values
        (gen_random_uuid(),'${memberships[0]}','${weeks[1]}','load_progression','late:kg','higher',1,1,'2026-03-08Z',true)`),
    ).rejects.toThrow("finalized Crown performance facts are immutable");
    await expect(
      db.exec(`update app_private.competition_results set displayed_score=0
        where membership_id='${memberships[0]}' and accountability_week_id='${weeks[1]}' and category='top_steps'`),
    ).rejects.toThrow("finalized Competition results are immutable");
    expect(
      (
        await db.query(
          `select count(*)::integer n from app_private.crown_awards where membership_id='${memberships[0]}'`,
        )
      ).rows,
    ).toEqual([{ n: 3 }]);
  });

  it("makes Exceptions and pre-finalization departures ineligible", async () => {
    const db = await database();
    await snapshot(db, memberships[0], "healthkit", 20_000);
    await snapshot(db, memberships[1], "health_connect", 10_000);
    await db.exec(`
      update app_private.member_weeks set status='excepted' where membership_id='${memberships[0]}' and accountability_week_id='${weeks[1]}';
      update app_private.member_weeks set status='attained' where membership_id <> '${memberships[0]}' and accountability_week_id='${weeks[1]}';
      update app_private.memberships set ended_at='2026-03-09T00:30Z', end_reason='left' where membership_id='${memberships[1]}';
      select app_private.consume_season_week('${weeks[1]}','2026-03-10Z');
    `);
    expect(
      (
        await db.query(
          `select app_private.finalize_crown_category('${weeks[1]}','top_steps','2026-03-10T00:00Z') n`,
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await db.query(
          `select membership_id, source_status from app_private.competition_results where category='top_steps' order by membership_id`,
        )
      ).rows,
    ).toEqual(
      expect.arrayContaining([
        { membership_id: memberships[0], source_status: "exception" },
        { membership_id: memberships[1], source_status: "departed" },
      ]),
    );
  });

  it("uses previous eight Accountability weeks rather than eight calendar weeks", async () => {
    const db = await database();
    const oldWeek = "94000000-0000-4000-8000-000000000099";
    await db.exec(`
      insert into app_private.accountability_weeks
        (accountability_week_id,group_id,starts_at,ends_at,time_zone,activation_at)
      values ('${oldWeek}','${group}','2025-12-01Z','2025-12-08Z','UTC','2025-12-01Z');
      insert into app_private.member_weeks
        (member_week_id,membership_id,accountability_week_id,target,target_locked_at,status)
      values (gen_random_uuid(),'${memberships[0]}','${oldWeek}',2,'2025-12-01Z','attained');
      insert into app_private.performance_results values
        (gen_random_uuid(),'${memberships[0]}','${oldWeek}','load_progression','row:kg','higher',100,8,'2025-12-07Z',true),
        (gen_random_uuid(),'${memberships[0]}','${weeks[1]}','load_progression','row:kg','higher',110,8,'2026-03-08Z',true);
      select app_private.score_competition_week('${weeks[1]}','2026-03-10Z');
    `);
    expect(
      (
        await db.query(
          `select status,displayed_score::float8 score from app_private.competition_results
           where membership_id='${memberships[0]}' and accountability_week_id='${weeks[1]}' and category='load_progression'`,
        )
      ).rows,
    ).toEqual([{ status: "eligible", score: 10 }]);
  });

  it("consumes four active weeks, pauses below two, rolls over despite provisional results, and snapshots tied cochampions", async () => {
    const db = await database();
    await db.exec(
      `select app_private.consume_season_week('${weeks[1]}','2026-03-09T00:02Z')`,
    );
    await db.exec(`update app_private.memberships set ended_at='2026-03-20Z', end_reason='left'
      where membership_id='${memberships[2]}'`);
    for (let index = 2; index < 5; index += 1) {
      await db.exec(`insert into app_private.member_weeks (member_week_id,membership_id,accountability_week_id,target,target_locked_at)
        values (gen_random_uuid(),'${memberships[0]}','${weeks[index]}',2,'2026-03-09Z'),
               (gen_random_uuid(),'${memberships[1]}','${weeks[index]}',2,'2026-03-09Z');`);
      await db.query("select app_private.consume_season_week($1,$2)", [
        weeks[index],
        index === 4
          ? "2026-04-02T00:01:00Z"
          : `2026-03-${16 + (index - 2) * 7}T00:01:00Z`,
      ]);
    }
    expect(
      (
        await db.query(
          "select season_number, active_weeks_consumed from app_private.seasons order by season_number",
        )
      ).rows,
    ).toEqual([
      { season_number: 1, active_weeks_consumed: 4 },
      { season_number: 2, active_weeks_consumed: 1 },
    ]);
    expect(
      (
        await db.query(`select
          starts_at = '2026-03-30Z'::timestamptz boundary_start,
          ends_at = '2026-04-27Z'::timestamptz boundary_end
          from app_private.seasons where season_number=2`)
      ).rows,
    ).toEqual([{ boundary_start: true, boundary_end: true }]);
    expect(
      (
        await db.query(
          `select count(*)::integer summaries from app_private.season_summaries where season_id='${season}'`,
        )
      ).rows,
    ).toEqual([{ summaries: 0 }]);
    await expect(
      db.query(
        "select app_private.finalize_season_summary($1,'2026-03-30T00:01Z')",
        [season],
      ),
    ).rejects.toThrow("all Season Crown categories must be finalized");
    await db.exec(`
      insert into app_private.crown_category_finalizations
        (accountability_week_id,category,finalized_at,eligible_result_count,contested)
      select sw.accountability_week_id, category.category, '2026-03-31Z', 2, true
      from app_private.season_weeks sw
      cross join (values ('top_steps'::app_private.crown_category), ('load_progression'), ('cardio_leap')) category(category)
      where sw.season_id='${season}';
      insert into app_private.crown_awards
        (accountability_week_id,category,membership_id,account_id,season_id,displayed_score,awarded_at)
      values
        ('${weeks[1]}','top_steps','${memberships[0]}','${accounts[0]}','${season}',100,'2026-03-31Z'),
        ('${weeks[2]}','load_progression','${memberships[0]}','${accounts[0]}','${season}',10,'2026-03-31Z'),
        ('${weeks[3]}','top_steps','${memberships[1]}','${accounts[1]}','${season}',200,'2026-03-31Z'),
        ('${weeks[4]}','cardio_leap','${memberships[1]}','${accounts[1]}','${season}',20,'2026-03-31Z');
    `);
    expect(
      (
        await db.query(
          "select app_private.finalize_season_summary($1,'2026-03-31T00:01Z') season_id",
          [season],
        )
      ).rows,
    ).toEqual([{ season_id: season }]);
    expect(
      (
        await db.query(
          "select app_private.finalize_season_summary($1,'2026-04-01Z') season_id",
          [season],
        )
      ).rows,
    ).toEqual([{ season_id: season }]);
    const standings = await db.query(
      "select crowns, rank, cochampion from app_private.season_summary_standings order by membership_id",
    );
    expect(standings.rows).toEqual([
      { crowns: 2, rank: 1, cochampion: true },
      { crowns: 2, rank: 1, cochampion: true },
    ]);
    await db.exec(`select set_config('app.auth_user_id','96000000-0000-4000-8000-000000000001',false);
      select set_config('app.token_issued_at','2026-03-30T01:00Z',false); set role authenticated;`);
    expect(
      (
        await db.query(
          `select count(*)::integer visible from app_private.read_season_summary('${season}')`,
        )
      ).rows,
    ).toEqual([{ visible: 2 }]);
    await db.exec("reset role");
    await db.exec(
      `update app_private.memberships set ended_at='2026-04-01Z', end_reason='left' where membership_id in ('${memberships[1]}','${memberships[2]}')`,
    );
    await db.exec(`select set_config('app.auth_user_id','96000000-0000-4000-8000-000000000002',false);
      select set_config('app.token_issued_at','2026-04-01T00:30Z',false); set role authenticated;`);
    expect(
      (
        await db.query(
          `select count(*)::integer visible from app_private.read_season_summary('${season}')`,
        )
      ).rows,
    ).toEqual([{ visible: 0 }]);
    await db.exec("reset role");
    const returnedMembership = "93000000-0000-4000-8000-000000000004";
    await db.exec(`insert into app_private.memberships
      (membership_id,account_id,group_id,joined_at,recurring_target)
      values ('${returnedMembership}','${accounts[1]}','${group}','2026-04-02Z',2)`);
    expect(
      (
        await db.query(
          `select count(*)::integer crowns from app_private.crown_awards where membership_id='${returnedMembership}'`,
        )
      ).rows,
    ).toEqual([{ crowns: 0 }]);
    await db.exec(`select set_config('app.auth_user_id','96000000-0000-4000-8000-000000000002',false);
      select set_config('app.token_issued_at','2026-04-02T00:30Z',false); set role authenticated;`);
    expect(
      (
        await db.query(
          `select count(*)::integer visible from app_private.read_season_summary('${season}')`,
        )
      ).rows,
    ).toEqual([{ visible: 0 }]);
    await db.exec("reset role");
    await db.exec(
      `update app_private.memberships set ended_at='2026-04-02T01:00Z', end_reason='left' where membership_id='${returnedMembership}'`,
    );
  });

  it("does not let a late join retroactively consume a paused week and consumes a shortened resume week", async () => {
    const db = await database();
    const pausedGroup = "97000000-0000-4000-8000-000000000001";
    const pausedWeek = "97000000-0000-4000-8000-000000000002";
    const resumedWeek = "97000000-0000-4000-8000-000000000003";
    const pausedSeason = "97000000-0000-4000-8000-000000000004";
    const departureWeek = "97000000-0000-4000-8000-000000000005";
    await db.exec(`
      insert into app_private.accounts (account_id,auth_user_id,email,adult_attested_at) values
        ('97000000-0000-4000-8000-000000000010','97000000-0000-4000-8000-000000000011','pause-a@example.test','2026-01-01Z'),
        ('97000000-0000-4000-8000-000000000020','97000000-0000-4000-8000-000000000021','pause-b@example.test','2026-01-01Z');
      insert into app_private.groups (group_id,name,time_zone,status,activation_at)
        values ('${pausedGroup}','Pause','UTC','active','2026-04-06Z');
      insert into app_private.memberships (membership_id,account_id,group_id,joined_at,recurring_target) values
        ('97000000-0000-4000-8000-000000000030','97000000-0000-4000-8000-000000000010','${pausedGroup}','2026-04-01Z',2),
        ('97000000-0000-4000-8000-000000000040','97000000-0000-4000-8000-000000000020','${pausedGroup}','2026-04-13T12:00Z',2);
      insert into app_private.accountability_weeks
        (accountability_week_id,group_id,starts_at,ends_at,time_zone,activation_at) values
        ('${pausedWeek}','${pausedGroup}','2026-04-06Z','2026-04-13Z','UTC','2026-04-06Z'),
        ('${resumedWeek}','${pausedGroup}','2026-04-13Z','2026-04-20Z','UTC','2026-04-13T12:00Z'),
        ('${departureWeek}','${pausedGroup}','2026-04-20Z','2026-04-27Z','UTC','2026-04-20Z');
      insert into app_private.seasons
        (season_id,group_id,season_number,starts_at,ends_at,time_zone)
        values ('${pausedSeason}','${pausedGroup}',1,'2026-04-13T12:00Z','2026-05-11Z','UTC');
    `);
    await expect(
      db.query("select app_private.consume_season_week($1,'2026-04-14Z')", [
        pausedWeek,
      ]),
    ).rejects.toThrow("paused below two");
    expect(
      (
        await db.query(
          "select app_private.consume_season_week($1,'2026-04-20Z') season_id",
          [resumedWeek],
        )
      ).rows,
    ).toEqual([{ season_id: pausedSeason }]);
    expect(
      (
        await db.query(
          `select active_week_number from app_private.season_weeks where accountability_week_id='${resumedWeek}'`,
        )
      ).rows,
    ).toEqual([{ active_week_number: 1 }]);
    await db.query(
      "select app_private.end_membership('97000000-0000-4000-8000-000000000040','left','2026-04-22Z')",
    );
    await expect(
      db.query("select app_private.consume_season_week($1,'2026-04-27Z')", [
        departureWeek,
      ]),
    ).rejects.toThrow("paused below two");
  });
});
