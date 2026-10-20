import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  as,
  database,
  memberships,
  rejects,
  submitProof,
} from "./support/pwa-db.js";

type Db = Awaited<ReturnType<typeof database>>;
const accept = async (db: Db, member: number) => {
  await as(db, member);
  await db.query("select app_private.accept_conduct()");
};
const message = (db: Db, id: string, body: string) =>
  db.query(
    "select app_private.post_proof_message($1, $2, $3, '2026-03-05T11:00Z')",
    [randomUUID(), id, body],
  );
const text = async (db: Db, member: number) => {
  await as(db, member);
  return (
    await db.query<{
      caption: string | null;
      messages: Array<{ body: string }>;
    }>(
      "select caption, messages from app_private.proof_text('2026-03-05T12:00Z')",
    )
  ).rows;
};

describe("Safety and member text", { timeout: 30_000 }, () => {
  it("needs the conduct rules before captions and messages", async () => {
    const db = await database();
    const post = await submitProof(db, 0);
    await as(db, 0);
    expect(
      await rejects(
        db.query(
          "select app_private.set_checkin_caption($1, 'Leg day', '2026-03-05T10:10Z')",
          [post],
        ),
      ),
    ).toBe("42501");
    await accept(db, 0);
    await db.query(
      "select app_private.set_checkin_caption($1, '  Leg day  ', '2026-03-05T10:10Z')",
      [post],
    );
    await accept(db, 1);
    await message(db, post, "Strong work!");
    expect(await text(db, 2)).toEqual([
      {
        caption: "Leg day",
        messages: [expect.objectContaining({ body: "Strong work!" })],
      },
    ]);
  });

  it("blocks both ways and hides each other's history but not posts in review", async () => {
    const db = await database();
    const verified = await submitProof(db, 0, "2026-03-04T10:00Z");
    await db.query(
      "update app_private.workout_checkins set review_status = 'verified', verified_at = '2026-03-04T11:00Z' where workout_checkin_id = $1",
      [verified],
    );
    const pending = await submitProof(db, 0, "2026-03-05T10:00Z");
    await as(db, 1);
    await db.query(
      "select app_private.set_safety_block($1, true, '2026-03-05T10:30Z')",
      [memberships[0]],
    );
    const hidden = await db.query<{ id: string }>(
      "select app_private.block_hidden_posts('2026-03-05T12:00Z') as id",
    );
    expect(hidden.rows.map((row) => row.id)).toEqual([verified]);
    // The blocked member cannot react to, or nudge, the blocker either.
    await as(db, 0);
    const blair = await submitProof(db, 1, "2026-03-05T10:40Z");
    await as(db, 0);
    expect(
      await rejects(
        db.query(
          "select app_private.react_to_proof($1, '🔥', true, '2026-03-05T11:00Z')",
          [blair],
        ),
      ),
    ).toBe("42501");
    expect(pending).toBeTruthy();
    const cases = await db.query<{ kind: string }>(
      "select kind from app_private.moderation_cases",
    );
    expect(cases.rows).toEqual([{ kind: "safety_block" }]);
  });

  it("hides a reported message at once and opens an operator case", async () => {
    const db = await database();
    const post = await submitProof(db, 0);
    await accept(db, 1);
    const id = randomUUID();
    await db.query(
      "select app_private.post_proof_message($1, $2, 'rude words', '2026-03-05T11:00Z')",
      [id, post],
    );
    await as(db, 2);
    await db.query(
      "select app_private.report_message($1, 'harassment', '2026-03-05T11:30Z')",
      [id],
    );
    expect((await text(db, 0))[0]?.messages).toEqual([]);
    const cases = await db.query<{ kind: string; category: string }>(
      "select kind, category from app_private.moderation_cases",
    );
    expect(cases.rows).toEqual([
      { kind: "message_report", category: "harassment" },
    ]);
  });
});
