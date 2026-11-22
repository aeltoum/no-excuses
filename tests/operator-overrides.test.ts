import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  accounts,
  as,
  data,
  database,
  memberships,
  memberWeeks,
  rejects,
} from "./support/pwa-db.js";

type Member = {
  name: string;
  targetStreak: number;
  owed: Array<{ id: string; source: string; card: unknown }>;
  weeks: Array<{
    memberWeekId: string;
    status: string;
    verified: number;
    added: number;
  }>;
};
type Db = Awaited<ReturnType<typeof database>>;

// Casey (member 2) is the operator.
async function withOperator() {
  const db = await database();
  await db.query(
    "insert into app_private.staff_assignments (assignment_id, account_id, role, starts_at) values ($1, $2, 'operator', '2026-01-01Z')",
    [randomUUID(), accounts[2]],
  );
  return db;
}
const settle = (db: Db, at = "2026-03-09T01:00Z") =>
  db.query("select app_private.advance_true_mvp_weeks($1)", [at]);
const member = (db: Db, index: number) =>
  data<Member>(db, 2, "select app_private.operator_member($1, $2) as data", [
    memberships[index],
    "2026-03-10Z",
  ]);
const addWorkout = (db: Db, index: number, completedAt: string, at: string) =>
  data<Member>(
    db,
    2,
    "select app_private.operator_add_workout($1, 'strength', $2, 45, 'moderate', $3) as data",
    [memberWeeks[index], completedAt, at],
  );
const weekOf = (state: Member, index: number) =>
  state.weeks.find((entry) => entry.memberWeekId === memberWeeks[index]);
const owedStatus = async (db: Db, index: number) =>
  (
    await db.query<{ status: string }>(
      "select status from app_private.consequence_obligations where membership_id = $1",
      [memberships[index]],
    )
  ).rows.map((row) => row.status);

describe("Operator overrides", { timeout: 30_000 }, () => {
  it("is for operators only", async () => {
    const db = await withOperator();
    await as(db, 0);
    for (const sql of [
      "select app_private.operator_member($1, '2026-03-10Z')",
      "select app_private.operator_waive_consequences($1, null, '2026-03-10Z')",
    ])
      expect(await rejects(db.query(sql, [memberships[1]]))).toBe("42501");
  });

  it("waives a member's owed Consequence and closes the live card offer", async () => {
    const db = await withOperator();
    await settle(db);
    await db.query(
      "select app_private.advance_consequences('2026-03-09T01:00Z')",
    );
    const before = await member(db, 1);
    expect(before.owed).toMatchObject([{ source: "missed_target" }]);
    const offers = () =>
      db.query<{ status: string }>(
        "select status from app_private.card_offers where membership_id = $1",
        [memberships[1]],
      );
    expect((await offers()).rows.map((row) => row.status)).toEqual(["initial"]);

    const after = await data<Member>(
      db,
      2,
      "select app_private.operator_waive_consequences($1, null, '2026-03-10Z') as data",
      [memberships[1]],
    );
    expect(after.owed).toEqual([]);
    expect(await owedStatus(db, 1)).toEqual(["waived"]);
    expect((await offers()).rows.map((row) => row.status)).toEqual([
      "replaced",
    ]);
    // Maintenance deals no new card for a waived item.
    await db.query(
      "select app_private.advance_consequences('2026-03-10T00:01Z')",
    );
    expect((await offers()).rows).toHaveLength(1);
    expect(
      await rejects(
        db.query(
          "select app_private.operator_waive_consequences($1, null, '2026-03-10Z')",
          [memberships[1]],
        ),
      ),
    ).toBe("P0002");
  });

  it("excuses a missed week", async () => {
    const db = await withOperator();
    await settle(db);
    const after = await data<Member>(
      db,
      2,
      "select app_private.operator_excuse_week($1, '2026-03-10Z') as data",
      [memberWeeks[0]],
    );
    expect(weekOf(after, 0)).toMatchObject({ status: "excepted" });
    expect(after.owed).toEqual([]);
    expect(await owedStatus(db, 0)).toEqual(["waived"]);
  });

  it("adds a workout that turns a missed week Attained", async () => {
    const db = await withOperator();
    await settle(db);
    const after = await addWorkout(db, 0, "2026-03-05T18:00Z", "2026-03-10Z");
    expect(weekOf(after, 0)).toMatchObject({
      status: "attained",
      verified: 1,
      added: 1,
    });
    expect(after.targetStreak).toBe(1);
    expect(after.owed).toEqual([]);
    expect(await owedStatus(db, 0)).toEqual(["waived"]);
  });

  it("adds a workout to the open week that counts at settlement", async () => {
    const db = await withOperator();
    const after = await addWorkout(db, 1, "2026-03-04T09:00Z", "2026-03-05Z");
    expect(after.weeks[0]).toMatchObject({ status: "active", verified: 1 });
    await settle(db);
    expect(weekOf(await member(db, 1), 1)?.status).toBe("attained");
    // Outside the week or in the future is refused.
    for (const completedAt of ["2026-03-01T09:00Z", "2026-03-06T09:00Z"])
      expect(await rejects(addWorkout(db, 1, completedAt, "2026-03-05Z"))).toBe(
        "22023",
      );
  });
});
