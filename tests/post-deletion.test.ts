import { describe, expect, it } from "vitest";
import {
  as,
  data,
  database,
  group,
  rejects,
  submitProof,
} from "./support/pwa-db.js";

type Deleted = { workoutCheckinId: string; currentWeekCount: number };

const progress = async (
  db: Awaited<ReturnType<typeof database>>,
  member: number,
) => {
  await as(db, member);
  return (
    await db.query<{ completed_workout_count: number }>(
      "select completed_workout_count from app_private.current_week_progress($1, '2026-03-05T12:00Z') where display_name = 'Alex'",
      [group],
    )
  ).rows[0]?.completed_workout_count;
};

describe("Post deletion", { timeout: 30_000 }, () => {
  it("drops a verified post from the week so a new one keeps the member on track", async () => {
    const db = await database([2, 1, 1]);
    const first = await submitProof(db, 0);
    await as(db, 1);
    await as(db, 2);
    await db.query(
      "select app_private.react_to_proof($1, '🔥', true, '2026-03-05T11:00Z')",
      [first],
    );
    expect(await progress(db, 0)).toBe(1);

    const deleted = await data<Deleted>(
      db,
      0,
      "select app_private.delete_own_checkin($1, '2026-03-05T12:00Z') as data",
      [first],
    );
    expect(deleted).toMatchObject({ currentWeekCount: 0 });
    expect(await progress(db, 0)).toBe(0);
    // Its photos fall to the unused-upload sweep.
    const due = await db.query<{ path: string }>(
      "select path from app_private.proof_media_due('2026-03-07Z')",
    );
    expect(due.rows).toHaveLength(2);

    await submitProof(db, 0, "2026-03-05T13:00Z");
    await submitProof(db, 0, "2026-03-05T14:00Z");
    expect(await progress(db, 0)).toBe(2);
  });

  it("refuses other members' posts, rejected reports, and closed weeks", async () => {
    const db = await database();
    const mine = await submitProof(db, 0);
    await as(db, 1);
    expect(
      await rejects(
        db.query(
          "select app_private.delete_own_checkin($1, '2026-03-05T12:00Z')",
          [mine],
        ),
      ),
    ).toBe("42501");
    await as(db, 0);
    expect(
      await rejects(
        db.query(
          "select app_private.delete_own_checkin($1, '2026-03-09T01:00Z')",
          [mine],
        ),
      ),
    ).toBe("42501");
    await db.query(
      "update app_private.workout_checkins set review_status = 'rejected' where workout_checkin_id = $1",
      [mine],
    );
    expect(
      await rejects(
        db.query(
          "select app_private.delete_own_checkin($1, '2026-03-05T12:00Z')",
          [mine],
        ),
      ),
    ).toBe("42501");
  });

  it("removes every shared photo while the count stays", async () => {
    const db = await database();
    await submitProof(db, 0);
    await as(db, 0);
    const removed = await db.query<{ n: number }>(
      "select app_private.remove_all_my_proof('2026-03-05T12:00Z') as n",
    );
    expect(removed.rows[0]?.n).toBe(1);
    expect(await progress(db, 0)).toBe(1);
    await as(db, 1);
    const feed = await db.query(
      "select * from app_private.proof_feed('2026-03-05T12:00Z')",
    );
    expect(feed.rows).toHaveLength(0);
  });

  it("takes down a verified post's photos after its week ends, and the week stands", async () => {
    const db = await database([1, 1, 1]);
    const verified = await submitProof(db, 0);
    const rejected = await submitProof(db, 0, "2026-03-05T11:00Z");
    await db.query(
      "update app_private.workout_checkins set review_status = 'rejected' where workout_checkin_id = $1",
      [rejected],
    );
    await as(db, 1);
    await db.query(
      "select app_private.finalize_ended_member_weeks('2026-03-09T01:00Z')",
    );
    const remove = async (member: number, id: string) => {
      await as(db, member);
      return rejects(
        db.query(
          "select app_private.remove_own_photos($1, '2026-03-10T09:00Z')",
          [id],
        ),
      );
    };
    // Only the author, and only once a friend has verified it.
    expect(await remove(1, verified)).toBe("42501");
    expect(await remove(0, rejected)).toBe("42501");
    expect(await remove(0, verified)).toBeNull();

    const after = await db.query<{
      review_status: string;
      removed: boolean;
    }>(
      "select review_status, removed_at is not null as removed from app_private.workout_checkins where workout_checkin_id = $1",
      [verified],
    );
    expect(after.rows).toEqual([{ review_status: "verified", removed: true }]);
    const week = await db.query<{ status: string }>(
      "select mw.status::text from app_private.member_weeks mw join app_private.workout_checkins c using (member_week_id) where c.workout_checkin_id = $1",
      [verified],
    );
    expect(week.rows).toEqual([{ status: "attained" }]);
  });
});
