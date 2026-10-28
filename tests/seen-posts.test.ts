import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { as, database, rejects, submitProof } from "./support/pwa-db.js";

type Db = Awaited<ReturnType<typeof database>>;
const at = "2026-03-05T12:00Z";

const mark = async (db: Db, member: number, ids: string[]) => {
  await as(db, member);
  return (
    await db.query<{ added: number }>(
      "select app_private.mark_posts_seen($1::uuid[], $2) as added",
      [ids, at],
    )
  ).rows[0]?.added;
};
const seen = async (db: Db, member: number) => {
  await as(db, member);
  return Object.fromEntries(
    (
      await db.query<{ workout_checkin_id: string; seen: boolean }>(
        "select workout_checkin_id, seen from app_private.proof_feed($1)",
        [at],
      )
    ).rows.map((row) => [row.workout_checkin_id, row.seen]),
  );
};
const marks = async (db: Db) =>
  (
    await db.query<{ count: number }>(
      "select count(*)::integer as count from app_private.proof_seen_marks",
    )
  ).rows[0]?.count;

describe("Seen posts", { timeout: 30_000 }, () => {
  it("marks many posts once, ignoring repeats, own posts and invisible ids", async () => {
    const db = await database();
    const alex = await submitProof(db, 0, "2026-03-05T09:00Z");
    const blair = await submitProof(db, 1, "2026-03-05T10:00Z");
    const own = await submitProof(db, 2, "2026-03-05T11:00Z");

    expect(await seen(db, 2)).toEqual({
      [alex]: false,
      [blair]: false,
      [own]: true,
    });
    expect(await mark(db, 2, [alex, alex, own, randomUUID()])).toBe(1);
    expect(await mark(db, 2, [alex, blair])).toBe(1);
    expect(await mark(db, 2, [alex, blair])).toBe(0);
    expect(await marks(db)).toBe(2);
    expect(await seen(db, 2)).toEqual({
      [alex]: true,
      [blair]: true,
      [own]: true,
    });
    // Another viewer's marks are their own.
    expect(await seen(db, 1)).toMatchObject({ [alex]: false, [own]: false });

    // A new reaction or comment never re-surfaces a seen post.
    await as(db, 1);
    await db.query("select app_private.react_to_proof($1, '🔥', true, $2)", [
      alex,
      at,
    ]);
    expect((await seen(db, 2))[alex]).toBe(true);
  });

  it("ignores posts that are off the Wall and needs a current membership", async () => {
    const db = await database();
    const removed = await submitProof(db, 0);
    await db.query(
      "update app_private.workout_checkins set removed_at = $2 where workout_checkin_id = $1",
      [removed, at],
    );
    expect(await mark(db, 1, [removed])).toBe(0);
    await db.query("select set_config('app.auth_user_id', $1, false)", [
      randomUUID(),
    ]);
    expect(
      await rejects(
        db.query("select app_private.mark_posts_seen($1::uuid[], $2)", [
          [removed],
          at,
        ]),
      ),
    ).toBe("42501");
    expect(
      (
        await db.query<{ granted: boolean }>(
          "select has_function_privilege('authenticated', 'app_private.mark_posts_seen(uuid[], timestamptz)', 'execute') as granted",
        )
      ).rows[0]?.granted,
    ).toBe(false);
  });

  it("drops marks when a post leaves the Wall", async () => {
    const db = await database();
    const posts = [
      await submitProof(db, 0, "2026-03-05T08:00Z"),
      await submitProof(db, 0, "2026-03-05T09:00Z"),
      await submitProof(db, 0, "2026-03-05T10:00Z"),
      await submitProof(db, 0, "2026-03-05T11:00Z"),
    ];
    expect(await mark(db, 1, posts)).toBe(4);
    const off = [
      "removed_at = now()",
      "media_deleted_at = now()",
      "review_status = 'rejected'",
      "review_status = 'unsupported'",
    ];
    for (const [index, change] of off.entries()) {
      await db.query(
        `update app_private.workout_checkins set ${change} where workout_checkin_id = $1`,
        [posts[index]],
      );
      expect(await marks(db)).toBe(3 - index);
    }
  });

  it("drops marks when the viewer or the author leaves", async () => {
    const db = await database();
    const alex = await submitProof(db, 0, "2026-03-05T09:00Z");
    const casey = await submitProof(db, 2, "2026-03-05T10:00Z");
    expect(await mark(db, 1, [alex, casey])).toBe(2);
    expect(await mark(db, 2, [alex])).toBe(1);

    // Blair leaves: Blair's marks go.
    await as(db, 1);
    await db.query("select app_private.leave_group($1)", [at]);
    expect(await marks(db)).toBe(1);
    // Alex, the author, departs: marks on Alex's post go.
    await db.query(
      "update app_private.memberships set ended_at = $1, end_reason = 'removed' where membership_id = '40000000-0000-4000-8000-000000000001'",
      [at],
    );
    expect(await marks(db)).toBe(0);
  });
});
