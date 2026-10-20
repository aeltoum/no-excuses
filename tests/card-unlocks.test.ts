import { describe, expect, it } from "vitest";
import {
  accounts,
  data,
  database,
  memberships,
  submitProof,
} from "./support/pwa-db.js";

describe("Card unlock visibility", { timeout: 30_000 }, () => {
  it("shows the member the card a met week unlocked and pushes it once", async () => {
    const db = await database();
    const id = await submitProof(db, 0);
    await db.query(
      "update app_private.workout_checkins set review_status = 'verified', verified_at = '2026-03-05T11:00Z' where workout_checkin_id = $1",
      [id],
    );
    await db.query(
      "insert into app_private.web_push_subscriptions (endpoint, account_id, p256dh, auth, created_at) values ('https://push.example.test/a', $1, 'k', 'a', '2026-03-01Z')",
      [accounts[0]],
    );
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T01:00Z')",
    );
    const extras = await data<{
      unlocks: Array<{ title: string; milestone: number; recent: boolean }>;
    }>(db, 0, "select app_private.home_extras('2026-03-09T02:00Z') as data");
    expect(extras.unlocks).toHaveLength(1);
    expect(extras.unlocks[0]).toMatchObject({ milestone: 1, recent: true });
    const streak = await db.query<{ target_streak: number }>(
      "select target_streak from app_private.memberships where membership_id = $1",
      [memberships[0]],
    );
    expect(streak.rows[0]?.target_streak).toBe(1);
    for (const at of ["2026-03-09T02:00Z", "2026-03-09T03:00Z"])
      await db.query("select app_private.enqueue_unlock_push($1)", [at]);
    const pushes = await db.query<{ title: string }>(
      "select title from app_private.web_push_outbox where account_id = $1 and dedupe_key like 'unlock:%'",
      [accounts[0]],
    );
    expect(pushes.rows).toEqual([{ title: "1-week streak: card unlocked" }]);
  });
});
