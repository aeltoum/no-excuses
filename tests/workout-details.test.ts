import { describe, expect, it } from "vitest";
import { as, database, rejects, submitProof } from "./support/pwa-db.js";

const set = async (
  db: Awaited<ReturnType<typeof database>>,
  id: string,
  details: unknown,
  at = "2026-03-05T10:30Z",
) =>
  db.query("select app_private.set_checkin_details($1, $2::jsonb, $3)", [
    id,
    JSON.stringify(details),
    at,
  ]);

describe("Workout details", { timeout: 30_000 }, () => {
  it("records catalog cardio details once, within the hour, and shows them in the feed", async () => {
    const db = await database();
    const id = await submitProof(db, 0);
    const details = {
      cardio: { activity: "run", distanceKm: 5, timeSeconds: 1500 },
    };
    await set(db, id, details);
    // Same details again is a harmless retry; different ones are refused.
    await set(db, id, details);
    expect(
      await rejects(
        set(db, id, { cardio: { activity: "run", distanceKm: 6 } }),
      ),
    ).toBe("23505");
    await as(db, 1);
    const feed = await db.query<{ details: unknown }>(
      "select details from app_private.proof_details('2026-03-05T11:00Z')",
    );
    expect(feed.rows).toEqual([{ details }]);
  });

  it("refuses free text, wrong shapes, other members, and late edits", async () => {
    const db = await database();
    const id = await submitProof(db, 0);
    await as(db, 0);
    for (const bad of [
      { cardio: { activity: "moonwalk", distanceKm: 5 } },
      { cardio: { activity: "run" } },
      { cardio: { activity: "run", distanceKm: "five" } },
      { cardio: { activity: "run", distanceKm: 5, note: "felt great" } },
      // A cardio post cannot carry lifts.
      {
        lifts: [
          { exercise: "deadlift", equipment: "barbell", sets: 3, reps: 5 },
        ],
      },
      { lifts: "deadlift" },
      [],
    ])
      expect(await rejects(set(db, id, bad))).toBe("22023");
    expect(
      await rejects(
        set(
          db,
          id,
          { cardio: { activity: "run", distanceKm: 5 } },
          "2026-03-05T11:30Z",
        ),
      ),
    ).toBe("42501");
    await as(db, 1);
    expect(
      await rejects(
        set(db, id, { cardio: { activity: "run", distanceKm: 5 } }),
      ),
    ).toBe("42501");
  });

  it("accepts lifts on strength posts", async () => {
    const db = await database();
    const id = await submitProof(db, 0);
    await db.query(
      "update app_private.workout_checkins set activity_type = 'strength' where workout_checkin_id = $1",
      [id],
    );
    await as(db, 0);
    expect(
      await rejects(
        set(db, id, {
          lifts: [
            {
              exercise: "back_squat",
              equipment: "barbell",
              sets: 2.5,
              reps: 5,
            },
          ],
        }),
      ),
    ).toBe("22023");
    await set(db, id, {
      lifts: [
        {
          exercise: "back_squat",
          equipment: "barbell",
          sets: 3,
          reps: 5,
          weightKg: 100,
        },
        { exercise: "pull_up", equipment: "bodyweight", sets: 3, reps: 8 },
      ],
    });
  });
});
