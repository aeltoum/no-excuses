import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  as,
  data,
  database,
  memberships,
  memberWeeks,
  rejects,
  submitProof,
} from "./support/pwa-db.js";

type Extras = {
  exceptions: {
    mine: Array<{ id: string; week: string; status: string; note: string }>;
    toDecide: Array<{ id: string; name: string; myResponse: string | null }>;
    excused: string[];
    pending: string[];
  };
};

const request = (
  db: Awaited<ReturnType<typeof database>>,
  member: number,
  week = "current",
  at = "2026-03-04T10:00Z",
) => {
  const id = randomUUID();
  return data<Extras>(
    db,
    member,
    "select app_private.request_exception($1, $2, 'travel_access', 'Work trip', $3) as data",
    [id, week, at],
  ).then((extras) => ({ id, extras }));
};
const respond = (
  db: Awaited<ReturnType<typeof database>>,
  member: number,
  id: string,
  response: string,
  at = "2026-03-04T11:00Z",
) =>
  data<Extras>(
    db,
    member,
    "select app_private.respond_to_exception($1, $2, $3) as data",
    [id, response, at],
  );
const status = async (db: Awaited<ReturnType<typeof database>>) =>
  (
    await db.query<{ status: string }>(
      "select status::text from app_private.member_weeks where member_week_id = $1",
      [memberWeeks[0]],
    )
  ).rows[0]?.status;

describe("Exceptions", { timeout: 30_000 }, () => {
  it("approved by a strict majority settles the week as Excepted with no card or streak change", async () => {
    const db = await database([3, 1, 1]);
    await db.query(
      "update app_private.memberships set target_streak = 2 where membership_id = $1",
      [memberships[0]],
    );
    const { id, extras } = await request(db, 0);
    expect(extras.exceptions.mine).toMatchObject([
      { id, week: "current", status: "pending", note: "Work trip" },
    ]);
    const voter = await data<Extras>(
      db,
      1,
      "select app_private.home_extras('2026-03-04T10:30Z') as data",
    );
    expect(voter.exceptions.toDecide).toMatchObject([
      { id, name: "Alex", myResponse: null },
    ]);
    expect(voter.exceptions.pending).toEqual([memberships[0]]);

    // One approval of two is not a strict majority; a changed ballot still counts once.
    await respond(db, 1, id, "deny");
    await respond(db, 1, id, "approve");
    expect((await respond(db, 2, id, "approve")).exceptions.excused).toEqual([
      memberships[0],
    ]);

    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T01:00Z')",
    );
    expect(await status(db)).toBe("excepted");
    const obligations = await db.query(
      "select 1 from app_private.consequence_obligations where membership_id = $1",
      [memberships[0]],
    );
    expect(obligations.rows).toHaveLength(0);
    const streak = await db.query<{ target_streak: number }>(
      "select target_streak from app_private.memberships where membership_id = $1",
      [memberships[0]],
    );
    expect(streak.rows[0]?.target_streak).toBe(2);
  });

  it("holds settlement while open, then a timeout denies it", async () => {
    const db = await database([3, 1, 1]);
    const { id } = await request(db, 0, "current", "2026-03-08T20:00Z");
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T01:00Z')",
    );
    expect(await status(db)).toBe("active");
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-10T21:00Z')",
    );
    expect(await status(db)).toBe("missed");
    const row = await db.query<{ status: string }>(
      "select status from app_private.exception_requests where exception_request_id = $1",
      [id],
    );
    expect(row.rows[0]?.status).toBe("denied");
  });

  it("keeps ballots sealed to the audience and allows one open request per week", async () => {
    const db = await database();
    const { id } = await request(db, 0);
    expect(
      await rejects(
        db.query(
          "select app_private.request_exception($1, 'current', 'private', null, '2026-03-04T12:00Z')",
          [randomUUID()],
        ),
      ),
    ).toBe("23505");
    // The requester cannot vote on their own request.
    expect(await rejects(respond(db, 0, id, "approve"))).toBe("42501");
    const next = await request(db, 0, "next");
    expect(next.extras.exceptions.mine.map((item) => item.week)).toEqual([
      "current",
      "next",
    ]);
    await as(db, 0);
    await db.query(
      "select app_private.withdraw_exception($1, '2026-03-04T13:00Z')",
      [id],
    );
    const after = await data<Extras>(
      db,
      1,
      "select app_private.home_extras('2026-03-04T13:30Z') as data",
    );
    expect(after.exceptions.toDecide.map((item) => item.id)).toEqual([next.id]);
  });

  it("freezes the Workout streak through an excused week and clears private context later", async () => {
    const db = await database([1, 1, 1]);
    const { id } = await request(db, 0);
    await respond(db, 1, id, "approve");
    await respond(db, 2, id, "approve");
    await submitProof(db, 0);
    await as(db, 1);
    const progress = await db.query<{ workout_streak: number }>(
      "select workout_streak from app_private.current_week_progress('10000000-0000-4000-8000-000000000001', '2026-03-05T12:00Z') where display_name = 'Alex'",
    );
    expect(progress.rows[0]?.workout_streak).toBe(0);
    await db.query(
      "select app_private.advance_exceptions('2026-03-12T12:00Z')",
    );
    const cleared = await db.query<{ category: string | null }>(
      "select category from app_private.exception_requests where exception_request_id = $1",
      [id],
    );
    expect(cleared.rows[0]?.category).toBeNull();
  });
});
