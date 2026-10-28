import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { accounts, as, data, database, submitProof } from "./support/pwa-db.js";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

const pushes = async (db: PGlite, kind: string) =>
  (
    await db.query<{ account_id: string; title: string; body: string }>(
      "select account_id, title, body from app_private.web_push_outbox where dedupe_key like $1 order by outbox_id",
      [`${kind}:%`],
    )
  ).rows;

describe("New-post push wording and one-time notice", {
  timeout: 60_000,
}, () => {
  it("names the member and workout without asking anyone to review it", async () => {
    const db = await database([3, 3, 3]);
    await db.query(
      "update app_private.accounts set notifications_since = '2026-03-01Z'",
    );
    const id = await submitProof(db, 1);
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-05T10:05Z')",
    );
    expect(await pushes(db, "workout")).toEqual([
      {
        account_id: accounts[0],
        title: "Blair posted a cardio workout",
        body: "1 of 3 this week.",
      },
      {
        account_id: accounts[2],
        title: "Blair posted a cardio workout",
        body: "1 of 3 this week.",
      },
    ]);
    for (const row of await pushes(db, "workout"))
      expect(`${row.title} ${row.body}`).not.toMatch(
        /verify|review|check the proof/i,
      );

    // Structured details name the workout when they exist.
    const label = async (activity: string, details: unknown) =>
      (
        await db.query<{ label: string }>(
          `update app_private.workout_checkins set activity_type = $2, details = $3::jsonb
           where workout_checkin_id = $1
           returning app_private.workout_label(workout_checkins.*) as label`,
          [id, activity, details === null ? null : JSON.stringify(details)],
        )
      ).rows[0]?.label;
    expect(
      await label("cardio", { cardio: { activity: "run", distanceKm: 5 } }),
    ).toBe("a 5 km run");
    expect(
      await label("cardio", {
        cardio: { activity: "cycle", distanceKm: 12.5 },
      }),
    ).toBe("a 12.5 km ride");
    expect(
      await label("mixed", { cardio: { activity: "swim", timeSeconds: 900 } }),
    ).toBe("a swim");
    expect(
      await label("strength", {
        lifts: [
          { exercise: "deadlift", equipment: "barbell", sets: 3, reps: 5 },
        ],
      }),
    ).toBe("a strength workout");
    expect(await label("class", null)).toBe("a class");
  });

  it("tells the author the real outcome of a Group decision", async () => {
    const db = await database();
    await db.query(
      "update app_private.accounts set notifications_since = '2026-03-01Z'",
    );
    const stays = await submitProof(db, 1, "2026-03-05T10:00Z");
    const rejected = await submitProof(db, 1, "2026-03-05T10:01Z");
    const withdrawn = await submitProof(db, 1, "2026-03-05T10:02Z");
    await as(db, 0);
    for (const id of [stays, rejected, withdrawn])
      await db.query(
        "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
        [id],
      );
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T12:00Z')",
      [stays],
    );
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T12:00Z')",
      [rejected],
    );
    await as(db, 2);
    await db.query(
      "select app_private.vote_proof_checkin($1, 'cannot_assess', '2026-03-05T12:00Z')",
      [stays],
    );
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T12:00Z')",
      [rejected],
    );
    await as(db, 1);
    await db.query(
      "select app_private.withdraw_proof_checkin($1, '2026-03-05T12:00Z')",
      [withdrawn],
    );
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-05T12:05Z')",
    );
    expect(await pushes(db, "proof-outcome")).toEqual([
      {
        account_id: accounts[1],
        title: "Your workout still counts",
        body: "The Group decision ended without a majority to reject it.",
      },
      {
        account_id: accounts[1],
        title: "Your workout was rejected",
        body: "It does not count, and you owe a Consequence card.",
      },
      {
        account_id: accounts[1],
        title: "Your workout did not count",
        body: "You withdrew it, so it does not count.",
      },
    ]);
  });

  it("shows the notice once to members present at release, never to later joiners", async () => {
    const db = new PGlite();
    await db.exec(
      "create role anon; create role authenticated; create role service_role;",
    );
    const files = (await readdir(migrationsDirectory)).sort();
    const release = files.indexOf("20261116000000_push_wording_notice.sql");
    for (const file of files.slice(0, release))
      await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
    await db.exec(`
      insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at, display_name) values
        ('${accounts[0]}', '30000000-0000-4000-8000-000000000001', 'a@example.test', '2026-03-01Z', 'Alex');
      insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
        ('10000000-0000-4000-8000-000000000001', 'Friends', 'UTC', 'active', '2026-03-02Z');
      insert into app_private.memberships (membership_id, account_id, group_id, joined_at, recurring_target) values
        ('40000000-0000-4000-8000-000000000001', '${accounts[0]}', '10000000-0000-4000-8000-000000000001', '2026-03-01Z', 3);
    `);
    for (const file of files.slice(release))
      await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
    await db.exec(`
      insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at, display_name) values
        ('${accounts[1]}', '30000000-0000-4000-8000-000000000002', 'b@example.test', '2026-03-01Z', 'Blair');
      insert into app_private.memberships (membership_id, account_id, group_id, joined_at, recurring_target) values
        ('40000000-0000-4000-8000-000000000002', '${accounts[1]}', '10000000-0000-4000-8000-000000000001', '2026-03-03Z', 3);
    `);
    const notices = (member: number) =>
      data(db, member, "select app_private.notices() as data");
    expect(await notices(0)).toEqual({ countsRightAway: true });
    expect(await notices(1)).toEqual({ countsRightAway: false });
    expect(
      await data(db, 0, "select app_private.dismiss_count_notice() as data"),
    ).toBe(true);
    expect(await notices(0)).toEqual({ countsRightAway: false });
    await db.close();
  });
});
