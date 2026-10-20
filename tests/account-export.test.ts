import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { as, data, database, rejects, submitProof } from "./support/pwa-db.js";

type Export = {
  account: { email: string; displayName: string };
  memberships: Array<{
    group: string;
    workouts: Array<{ activityType: string; photos: boolean }>;
    messages: Array<{ body: string }>;
  }>;
};

describe("Account export", { timeout: 30_000 }, () => {
  it("returns only the member's own data", async () => {
    const db = await database();
    await submitProof(db, 0);
    const friendPost = await submitProof(db, 1);
    await as(db, 0);
    await db.query("select app_private.accept_conduct()");
    await db.query(
      "select app_private.post_proof_message($1, $2, 'nice', '2026-03-05T11:00Z')",
      [randomUUID(), friendPost],
    );
    const exported = await data<Export>(
      db,
      0,
      "select app_private.account_export('2026-03-05T12:00Z') as data",
    );
    expect(exported.account).toMatchObject({
      email: "a@example.test",
      displayName: "Alex",
    });
    expect(exported.memberships).toHaveLength(1);
    expect(exported.memberships[0]).toMatchObject({
      group: "Friends",
      workouts: [{ activityType: "cardio", photos: true }],
      messages: [{ body: "nice" }],
    });
    await db.query("select set_config('app.auth_user_id', '', false)");
    expect(
      await rejects(db.query("select app_private.account_export(now())")),
    ).toBe("42501");
  });
});
