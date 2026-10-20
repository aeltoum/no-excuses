import { describe, expect, it } from "vitest";
import { as, data, database, submitProof } from "./support/pwa-db.js";

type Season = {
  season: number;
  week: number;
  standings: Array<{ name: string; crowns: number; rank: number }>;
  latest: {
    results: Array<{
      category: string;
      name: string;
      score: number;
      winner: boolean;
    }>;
  } | null;
};

async function post(
  db: Awaited<ReturnType<typeof database>>,
  member: number,
  at: string,
  activity: "strength" | "cardio",
  details: unknown,
) {
  const id = await submitProof(db, member, at);
  await db.query(
    "update app_private.workout_checkins set activity_type = $2, review_status = 'verified', verified_at = $3 where workout_checkin_id = $1",
    [id, activity, at],
  );
  await as(db, member);
  await db.query(
    "select app_private.set_checkin_details($1, $2::jsonb, $3::timestamptz + interval '1 minute')",
    [id, JSON.stringify(details), at],
  );
}
const squat = (weightKg: number) => ({
  lifts: [
    {
      exercise: "back_squat",
      equipment: "barbell",
      sets: 3,
      reps: 5,
      weightKg,
    },
  ],
});
const run = (timeSeconds: number) => ({
  cardio: { activity: "run", distanceKm: 5, timeSeconds },
});

describe("Crowns and Seasons", { timeout: 60_000 }, () => {
  it("crowns the biggest gain over each member's own baseline, contested categories only", async () => {
    const db = await database();
    await post(db, 0, "2026-03-03T10:00Z", "strength", squat(100));
    await post(db, 1, "2026-03-03T11:00Z", "strength", squat(60));
    await post(db, 0, "2026-03-04T10:00Z", "cardio", run(1500));
    await post(db, 2, "2026-03-04T11:00Z", "cardio", {
      cardio: { activity: "walk", distanceKm: 2 },
    });
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T01:00Z')",
    );
    expect(
      (
        await db.query(
          "select app_private.advance_crowns('2026-03-09T01:00Z') as n",
        )
      ).rows[0],
    ).toEqual({ n: 1 });

    await post(db, 0, "2026-03-10T10:00Z", "strength", squat(105));
    await post(db, 1, "2026-03-10T11:00Z", "strength", squat(66));
    await post(db, 0, "2026-03-11T10:00Z", "cardio", run(1440));
    // A first comparable result only sets a baseline.
    await post(db, 2, "2026-03-11T11:00Z", "cardio", run(1200));
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-16T01:00Z')",
    );
    await db.query("select app_private.advance_crowns('2026-03-16T01:00Z')");

    const season = await data<Season>(
      db,
      2,
      "select app_private.season_home('2026-03-16T02:00Z') as data",
    );
    expect(season).toMatchObject({ season: 1, week: 3 });
    expect(season.latest?.results).toEqual([
      // Alone in Cardio Leap: no contest, no Crown.
      {
        category: "cardio_leap",
        name: "Alex",
        mine: false,
        score: 4,
        winner: false,
      },
      {
        category: "load_progression",
        name: "Blair",
        mine: false,
        score: 10,
        winner: true,
      },
      {
        category: "load_progression",
        name: "Alex",
        mine: false,
        score: 5,
        winner: false,
      },
    ]);
    expect(
      season.standings.map(({ name, crowns, rank }) => ({
        name,
        crowns,
        rank,
      })),
    ).toEqual([
      { name: "Blair", crowns: 1, rank: 1 },
      { name: "Alex", crowns: 0, rank: 2 },
      { name: "Casey", crowns: 0, rank: 2 },
    ]);
    // Crowning is once per week.
    expect(
      (
        await db.query(
          "select app_private.advance_crowns('2026-03-16T03:00Z') as n",
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  });

  it("numbers Seasons in runs of four weeks", async () => {
    const db = await database();
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-04-07T00:00Z')",
    );
    const positions = await db.query<{
      season_number: number;
      week_number: number;
    }>(
      "select season_number, week_number from app_private.group_week_positions('10000000-0000-4000-8000-000000000001') order by starts_at",
    );
    expect(
      positions.rows.map((row) => `${row.season_number}.${row.week_number}`),
    ).toEqual(["1.1", "1.2", "1.3", "1.4", "2.1", "2.2"]);
  });
});
